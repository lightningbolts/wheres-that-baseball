"""Fetch player handedness + season stats for ml-engine feature joins."""
from __future__ import annotations
import json
import time
from pathlib import Path
import pandas as pd
import requests
DATA_PATH = Path(__file__).parent / "data" / "at_bat_pitches.parquet"
HANDS_PATH = Path(__file__).parent / "data" / "player_hands.parquet"
CHECKPOINT = Path(__file__).parent / "data" / "player_fetch_checkpoint.json"
MLB = "https://statsapi.mlb.com/api/v1"
STATS_PATH = Path(__file__).parent / "data" / "player_stats.parquet"

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
    return {
        "player_id": player_id,
        "season": season,
        "role": "batter",
        "pa": pa,
        "k_rate": (stat.get("strikeOuts") or 0) / pa,
        "bb_rate": (stat.get("baseOnBalls") or 0) / pa,
        "iso": float(stat.get("slg", 0) or 0) - float(stat.get("avg", 0) or 0),
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

def fetch_person(player_id: int) -> dict | None:
    """Fetch player info from MLB API."""
    r = requests.get(f"{MLB}/people/{player_id}", timeout=15)
    r.raise_for_status()
    people = r.json().get("people") or []
    return people[0] if people else None

def main() -> None:
    df = pd.read_parquet(DATA_PATH)
    ids = sorted(set(df["batter_id"].dropna().astype(int)) | set(df["pitcher_id"].dropna().astype(int)))
    done = set(json.loads(CHECKPOINT.read_text())) if CHECKPOINT.exists() else set()
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
        except Exception as e:
            print(f"Error fetching player {pid}: {e}")
            time.sleep(1)
            continue

    if rows:
        pd.DataFrame(rows).drop_duplicates("player_id").to_parquet(HANDS_PATH, index=False)
    CHECKPOINT.write_text(json.dumps(sorted(done)))
    print(f"wrote {HANDS_PATH} ({len(rows)} players)")

if __name__ == "__main__":
    main()