"""Fetch player handedness + season stats for ml-engine feature joins."""
from __future__ import annotations

import json
import time
from pathlib import Path

import pandas as pd
import requests

DATA_PATH = Path(__file__).parent / "data" / "at_bat_pitches.parquet"
HANDS_PATH = Path(__file__).parent / "data" / "player_hands.parquet"
HANDS_CHECKPOINT = Path(__file__).parent / "data" / "player_fetch_checkpoint.json"
STATS_PATH = Path(__file__).parent / "data" / "player_stats.parquet"
STATS_CHECKPOINT = Path(__file__).parent / "data" / "player_stats_fetch_checkpoint.json"
MLB = "https://statsapi.mlb.com/api/v1"


def _safe_rate(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        return 0.0
    return float(numerator) / float(denominator)


def fetch_hitting(player_id: int, season: int) -> dict | None:
    r = requests.get(
        f"{MLB}/people/{player_id}/stats",
        params={"stats": "season", "group": "hitting", "season": str(season)},
        timeout=15,
    )
    r.raise_for_status()
    stat = (r.json().get("stats") or [{}])[0].get("splits", [{}])[0].get("stat")
    if not stat:
        return None
    pa = stat.get("plateAppearances") or 0
    ab = stat.get("atBats") or 0
    if pa < 20:
        return None
    batted = (stat.get("groundOuts") or 0) + (stat.get("airOuts") or 0)
    return {
        "player_id": player_id,
        "season": season,
        "role": "batter",
        "pa": pa,
        "k_rate": _safe_rate(stat.get("strikeOuts") or 0, pa),
        "bb_rate": _safe_rate(stat.get("baseOnBalls") or 0, pa),
        "iso": float(stat.get("slg", 0) or 0) - float(stat.get("avg", 0) or 0),
        "gb_rate": _safe_rate(stat.get("groundOuts") or 0, batted) if batted > 0 else 0.44,
        "fb_rate": _safe_rate(stat.get("airOuts") or 0, batted) if batted > 0 else 0.36,
        "hbp_rate": _safe_rate(stat.get("hitByPitch") or 0, pa),
        "gdp_rate": _safe_rate(stat.get("groundIntoDoublePlay") or 0, pa),
        "sf_rate": _safe_rate(stat.get("sacFlies") or 0, pa),
        "sb_rate": _safe_rate(stat.get("stolenBases") or 0, pa),
    }


def fetch_pitching(player_id: int, season: int) -> dict | None:
    r = requests.get(
        f"{MLB}/people/{player_id}/stats",
        params={"stats": "season", "group": "pitching", "season": str(season)},
        timeout=15,
    )
    r.raise_for_status()
    stat = (r.json().get("stats") or [{}])[0].get("splits", [{}])[0].get("stat")
    if not stat:
        return None
    bf = stat.get("battersFaced") or 0
    if bf < 20:
        return None
    batted = (stat.get("groundOuts") or 0) + (stat.get("airOuts") or 0)
    return {
        "player_id": player_id,
        "season": season,
        "role": "pitcher",
        "pa": bf,
        "k_rate": _safe_rate(stat.get("strikeOuts") or 0, bf),
        "bb_rate": _safe_rate(stat.get("baseOnBalls") or 0, bf),
        "iso": 0.0,
        "gb_rate": _safe_rate(stat.get("groundOuts") or 0, batted) if batted > 0 else 0.44,
        "fb_rate": _safe_rate(stat.get("airOuts") or 0, batted) if batted > 0 else 0.36,
        "hbp_rate": _safe_rate(stat.get("hitBatsmen") or 0, bf),
        "gdp_rate": _safe_rate(stat.get("groundIntoDoublePlay") or 0, bf),
        "sf_rate": 0.0,
        "sb_rate": 0.0,
        "hr_rate": _safe_rate(stat.get("homeRuns") or 0, bf),
    }


def fetch_person(player_id: int) -> dict | None:
    """Fetch player info from MLB API."""
    r = requests.get(f"{MLB}/people/{player_id}", timeout=15)
    r.raise_for_status()
    people = r.json().get("people") or []
    return people[0] if people else None


def _load_checkpoint(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return set(json.loads(path.read_text()))


def _save_checkpoint(path: Path, done: set[str]) -> None:
    path.write_text(json.dumps(sorted(done)))


def fetch_hands(df: pd.DataFrame) -> None:
    ids = sorted(
        set(df["batter_id"].dropna().astype(int)) | set(df["pitcher_id"].dropna().astype(int))
    )
    done = _load_checkpoint(HANDS_CHECKPOINT)
    rows: list[dict] = []
    if HANDS_PATH.exists():
        rows = pd.read_parquet(HANDS_PATH).to_dict("records")

    for pid in ids:
        key = str(pid)
        if key in done:
            continue
        try:
            person = fetch_person(pid)
            if person:
                bat = (person.get("batSide") or {}).get("code", "")
                throw = (person.get("pitchHand") or {}).get("code", "")
                rows.append({
                    "player_id": pid,
                    "bat_side": str(bat).upper(),
                    "pitch_hand": str(throw).upper(),
                })
            done.add(key)
            time.sleep(0.1)
        except Exception as exc:
            print(f"Error fetching player {pid}: {exc}")
            time.sleep(1)
            continue

    if rows:
        pd.DataFrame(rows).drop_duplicates("player_id").to_parquet(HANDS_PATH, index=False)
    _save_checkpoint(HANDS_CHECKPOINT, done)
    print(f"wrote {HANDS_PATH} ({len(rows)} hand rows)")


def fetch_stats(df: pd.DataFrame) -> None:
    df = df.copy()
    df["season"] = pd.to_datetime(df["game_date"]).dt.year

    batter_pairs = (
        df[["batter_id", "season"]]
        .dropna()
        .drop_duplicates()
        .astype({"batter_id": int, "season": int})
    )
    pitcher_pairs = (
        df[["pitcher_id", "season"]]
        .dropna()
        .drop_duplicates()
        .astype({"pitcher_id": int, "season": int})
    )

    done = _load_checkpoint(STATS_CHECKPOINT)
    rows: list[dict] = []
    if STATS_PATH.exists():
        rows = pd.read_parquet(STATS_PATH).to_dict("records")

    tasks: list[tuple[str, int, int]] = []
    for _, row in batter_pairs.iterrows():
        tasks.append(("batter", int(row["batter_id"]), int(row["season"])))
    for _, row in pitcher_pairs.iterrows():
        tasks.append(("pitcher", int(row["pitcher_id"]), int(row["season"])))

    for role, player_id, season in tasks:
        key = f"{role}:{player_id}:{season}"
        if key in done:
            continue
        try:
            if role == "batter":
                stat = fetch_hitting(player_id, season)
            else:
                stat = fetch_pitching(player_id, season)
            if stat:
                rows.append(stat)
            done.add(key)
            time.sleep(0.1)
        except Exception as exc:
            print(f"Error fetching {role} stats for {player_id} ({season}): {exc}")
            time.sleep(1)
            continue

    if rows:
        out = pd.DataFrame(rows).drop_duplicates(["player_id", "season", "role"])
        out.to_parquet(STATS_PATH, index=False)
    _save_checkpoint(STATS_CHECKPOINT, done)
    print(f"wrote {STATS_PATH} ({len(rows)} stat rows)")


def main() -> None:
    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Missing {DATA_PATH}. Run 01_extract_data.py first.")
    df = pd.read_parquet(DATA_PATH)
    fetch_hands(df)
    fetch_stats(df)


if __name__ == "__main__":
    main()
