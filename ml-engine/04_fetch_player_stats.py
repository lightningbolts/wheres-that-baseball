"""Fetch player handedness + season stats for ml-engine feature joins."""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import pandas as pd
import requests

DATA_PATH = Path(__file__).parent / "data" / "at_bat_pitches.parquet"
HANDS_PATH = Path(__file__).parent / "data" / "player_hands.parquet"
STATS_PATH = Path(__file__).parent / "data" / "player_stats.parquet"
CHECKPOINT = Path(__file__).parent / "data" / "player_fetch_checkpoint.json"
MLB = "https://statsapi.mlb.com/api/v1"
REQUEST_DELAY_SEC = 0.12


def _load_checkpoint() -> set[str]:
    if not CHECKPOINT.exists():
        return set()
    return set(json.loads(CHECKPOINT.read_text()))


def _save_checkpoint(done: set[str]) -> None:
    CHECKPOINT.parent.mkdir(parents=True, exist_ok=True)
    CHECKPOINT.write_text(json.dumps(sorted(done)))


def _parse_avg(value: object) -> float:
    if value is None:
        return 0.0
    if isinstance(value, str):
        text = value.strip()
        if not text or text == ".---":
            return 0.0
        return float(text)
    return float(value)


def fetch_person(player_id: int) -> dict | None:
    r = requests.get(f"{MLB}/people/{player_id}", timeout=15)
    r.raise_for_status()
    people = r.json().get("people") or []
    return people[0] if people else None


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
    if pa < 20:
        return None
    avg = _parse_avg(stat.get("avg"))
    slg = _parse_avg(stat.get("slg"))
    return {
        "player_id": player_id,
        "season": season,
        "role": "batter",
        "pa": pa,
        "k_rate": (stat.get("strikeOuts") or 0) / pa,
        "bb_rate": (stat.get("baseOnBalls") or 0) / pa,
        "iso": slg - avg,
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
    return {
        "player_id": player_id,
        "season": season,
        "role": "pitcher",
        "pa": bf,
        "k_rate": (stat.get("strikeOuts") or 0) / bf,
        "bb_rate": (stat.get("baseOnBalls") or 0) / bf,
        "iso": 0.0,
    }


def fetch_hands(df: pd.DataFrame, done: set[str]) -> None:
    ids = sorted(
        set(df["batter_id"].dropna().astype(int)) | set(df["pitcher_id"].dropna().astype(int))
    )
    rows: list[dict] = []
    if HANDS_PATH.exists():
        rows = pd.read_parquet(HANDS_PATH).to_dict("records")

    fetched = 0
    for pid in ids:
        key = f"hand:{pid}"
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
            fetched += 1
            time.sleep(REQUEST_DELAY_SEC)
        except Exception as exc:
            print(f"skip hand {pid}: {exc}")

    if rows:
        pd.DataFrame(rows).drop_duplicates("player_id").to_parquet(HANDS_PATH, index=False)
    print(f"hands: fetched {fetched} new, total {len(rows)} rows -> {HANDS_PATH}")


def fetch_season_stats(df: pd.DataFrame, done: set[str]) -> None:
    df = df.copy()
    df["season"] = pd.to_datetime(df["game_date"]).dt.year

    jobs: set[tuple[str, int, int]] = set()
    for _, row in df[["batter_id", "season"]].drop_duplicates().iterrows():
        jobs.add(("batter", int(row["batter_id"]), int(row["season"])))
    for _, row in df[["pitcher_id", "season"]].drop_duplicates().iterrows():
        jobs.add(("pitcher", int(row["pitcher_id"]), int(row["season"])))

    rows: list[dict] = []
    if STATS_PATH.exists():
        rows = pd.read_parquet(STATS_PATH).to_dict("records")

    fetched = 0
    for role, pid, season in sorted(jobs):
        key = f"stats:{role}:{pid}:{season}"
        if key in done:
            continue
        try:
            row = fetch_hitting(pid, season) if role == "batter" else fetch_pitching(pid, season)
            if row:
                rows.append(row)
            done.add(key)
            fetched += 1
            if fetched % 50 == 0:
                print(f"  stats progress: {fetched} fetched...")
            time.sleep(REQUEST_DELAY_SEC)
        except Exception as exc:
            print(f"skip {key}: {exc}")

    if rows:
        pd.DataFrame(rows).drop_duplicates(["player_id", "season", "role"]).to_parquet(
            STATS_PATH, index=False
        )
    print(f"stats: fetched {fetched} new, total {len(rows)} rows -> {STATS_PATH}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch MLB player hands and season stats")
    parser.add_argument("--hands-only", action="store_true")
    parser.add_argument("--stats-only", action="store_true")
    args = parser.parse_args()

    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Missing {DATA_PATH}. Run `python 01_extract_data.py` first.")

    df = pd.read_parquet(DATA_PATH)
    done = _load_checkpoint()

    run_hands = not args.stats_only
    run_stats = not args.hands_only

    if run_hands:
        fetch_hands(df, done)
    if run_stats:
        fetch_season_stats(df, done)

    _save_checkpoint(done)


if __name__ == "__main__":
    main()
