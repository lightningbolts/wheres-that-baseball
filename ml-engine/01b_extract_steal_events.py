"""Extract pitch-level steal attempt labels from locally cached parsed game states."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
from importlib import import_module

extract_mod = import_module("01_extract_data")

DATA_DIR = Path(__file__).parent / "data"
STEAL_PITCHES_PATH = DATA_DIR / "steal_pitches.parquet"

STEAL_EVENTS = {
    "stolen_base",
    "caught_stealing",
    "pickoff_caught_stealing",
    "pickoff_1_2",
    "stolen_base_2b",
    "stolen_base_3b",
    "stolen_base_home",
    "stolen_base_2nd",
    "stolen_base_3rd",
}


def _normalize_event(event: str | None) -> str:
    if not event:
        return ""
    return event.lower().replace(" ", "_").replace("-", "_")


def _steal_label_for_play(play: dict) -> str | None:
    event = _normalize_event(play.get("event") or (play.get("detail") or {}).get("event"))
    if "stolen_base" in event or event == "stolen_base":
        return "steal_success"
    if "caught_stealing" in event or event in STEAL_EVENTS and ("caught" in event or event.startswith("pickoff")):
        return "steal_caught"
    if event in STEAL_EVENTS:
        return "steal_success"
    return None


def extract_steal_rows_from_state(
    game_pk: int,
    game_date: str,
    venue_id: int | None,
    state: dict,
) -> list[dict]:
    rows: list[dict] = []
    state = extract_mod.unwrap_game_state(state)

    for play in state.get("plays", []):
        if _steal_label_for_play(play) is None:
            continue

        detail = play.get("detail") or {}
        situation = play.get("situationBefore") or {}
        steal_label = _steal_label_for_play(play)
        sit = extract_mod._situation_fields(play, situation)

        pitches = [p for p in detail.get("pitches", []) if p.get("isPitch")]
        pitch_index = max(0, len(pitches) - 1)
        balls, strikes = extract_mod.pre_pitch_count(pitches, pitch_index)
        last_pitch = pitches[pitch_index] if pitches else {}

        rows.append({
            "game_pk": game_pk,
            "game_date": game_date,
            "venue_id": venue_id,
            "batter_id": play.get("batterId") or detail.get("batterId"),
            "pitcher_id": detail.get("pitcherId"),
            **sit,
            "balls": balls,
            "strikes": strikes,
            "pitch_count_in_ab": pitch_index + 1 if pitches else 1,
            "last_pitch_speed": last_pitch.get("startSpeed"),
            "last_pitch_type": last_pitch.get("typeCode"),
            "steal_label": steal_label,
        })

    for play in state.get("plays", []):
        if play.get("isAtBat") is not True:
            continue
        detail = play.get("detail") or {}
        situation = play.get("situationBefore") or {}
        if _steal_label_for_play(play) is not None:
            continue

        pitches = [p for p in detail.get("pitches", []) if p.get("isPitch")]
        if not pitches:
            continue

        sit = extract_mod._situation_fields(play, situation)
        on_first = bool(sit["on_first"])
        on_second = bool(sit["on_second"])
        if not (on_first or on_second):
            continue

        for i, pitch in enumerate(pitches):
            balls, strikes = extract_mod.pre_pitch_count(pitches, i)
            rows.append({
                "game_pk": game_pk,
                "game_date": game_date,
                "venue_id": venue_id,
                "batter_id": play.get("batterId") or detail.get("batterId"),
                "pitcher_id": detail.get("pitcherId"),
                **sit,
                "balls": balls,
                "strikes": strikes,
                "pitch_count_in_ab": i + 1,
                "last_pitch_speed": pitch.get("startSpeed"),
                "last_pitch_type": pitch.get("typeCode"),
                "steal_label": "no_steal",
            })

    return rows


def extract_steal_dataset_from_games(games: list[dict]) -> pd.DataFrame:
    rows: list[dict] = []
    for game in games:
        try:
            rows.extend(
                extract_steal_rows_from_state(
                    game["game_pk"],
                    game["game_date"],
                    game.get("venue_id"),
                    game["game_state"],
                )
            )
        except Exception as exc:
            print(f"Skipping game {game['game_pk']} for steal extract: {exc}")

    df = pd.DataFrame(rows)
    if df.empty:
        return df
    return extract_mod.enrich_dataframe(df)


def main() -> None:
    from mlb_cache import load_cached_games

    games = load_cached_games()
    if not games:
        raise FileNotFoundError(
            "No local parsed cache. Run: python 01_extract_data.py --build-mlb-cache --max-games=500"
        )

    df = extract_steal_dataset_from_games(games)
    if df.empty:
        print("No steal rows extracted.")
        return

    positives = df[df["steal_label"] != "no_steal"]
    negative_pool = df[df["steal_label"] == "no_steal"]
    sample_n = min(len(positives) * 20, len(negative_pool)) if len(positives) else 0
    negatives = negative_pool.sample(n=sample_n, random_state=42) if sample_n else negative_pool.iloc[0:0]
    balanced = pd.concat([positives, negatives], ignore_index=True)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    balanced.to_parquet(STEAL_PITCHES_PATH, index=False)
    print(f"Wrote {STEAL_PITCHES_PATH} ({len(balanced)} rows)")
    print(balanced["steal_label"].value_counts())


if __name__ == "__main__":
    main()
