import os
from datetime import date
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from supabase import Client, create_client

from constants import LEAGUE_AVG_PITCH_SPEED, LEAGUE_DEFAULTS, OUTCOME_KEYS, PITCH_TYPE_CODES

load_dotenv()

url: str = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")

if not url or not key:
    raise ValueError(
        "Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and "
        "SUPABASE_SERVICE_ROLE_KEY in ml-engine/.env"
    )

supabase: Client = create_client(url, key)

DATA_DIR = Path(__file__).parent / "data"
AT_BATS_PATH = DATA_DIR / "at_bats.parquet"
AT_BAT_PITCHES_PATH = DATA_DIR / "at_bat_pitches.parquet"
PLAYER_HANDS_PATH = DATA_DIR / "player_hands.parquet"
PLAYER_STATS_PATH = DATA_DIR / "player_stats.parquet"
PAGE_SIZE = 1000
GAME_STATE_BATCH = 25


def normalize_count(balls: int, strikes: int) -> tuple[int, int]:
    """Clamp to valid pre-pitch counts (MLB API sometimes reports post-pitch on terminal events)."""
    return min(int(balls or 0), 3), min(int(strikes or 0), 2)


def pre_pitch_count(pitches: list[dict], pitch_index: int) -> tuple[int, int]:
    """MLB pitch objects carry post-pitch count; return pre-pitch balls/strikes."""
    if pitch_index <= 0:
        return 0, 0
    prev = pitches[pitch_index - 1]
    return normalize_count(prev.get("balls", 0), prev.get("strikes", 0))


def map_outcome(event_type: str | None) -> str | None:
    """Map MLB play event string to one of OUTCOME_KEYS, or None to drop."""
    if not event_type:
        return None

    normalized = event_type.lower().replace(" ", "_").replace("-", "_")

    direct = {
        "strikeout": "strikeout",
        "strikeout_double_play": "gidp",
        "walk": "walk",
        "intentional_walk": "walk",
        "intent_walk": "walk",
        "hit_by_pitch": "hit_by_pitch",
        "single": "single",
        "double": "double",
        "triple": "triple",
        "home_run": "home_run",
        "field_out": "field_out",
        "force_out": "field_out",
        "forceout": "field_out",
        "grounded_into_dp": "gidp",
        "grounded_into_double_play": "gidp",
        "fly_out": "field_out",
        "flyout": "field_out",
        "line_out": "field_out",
        "lineout": "field_out",
        "pop_out": "field_out",
        "groundout": "field_out",
        "ground_out": "field_out",
        "sac_fly": "sac_fly",
        "sacrifice_fly": "sac_fly",
        "sac_bunt": "sac_bunt",
        "sacrifice_bunt": "sac_bunt",
        "bunt_groundout": "sac_bunt",
        "double_play": "field_out",
        "fielders_choice_out": "field_out",
        "fielders_choice": "field_out",
        "field_error": "field_out",
    }

    return direct.get(normalized)


def unwrap_game_state(state: dict) -> dict:
    """Support both legacy raw feed JSON and web `parsed` LiveGameState snapshots."""
    parsed = state.get("parsed")
    if isinstance(parsed, dict):
        return parsed
    return state


def _situation_fields(play: dict, situation: dict) -> dict:
    outs = play.get("outs") if play.get("outs") is not None else situation.get("outs", 0)
    return {
        "inning": play.get("inning") or play.get("detail", {}).get("inning"),
        "half_inning": play.get("halfInning") or play.get("detail", {}).get("halfInning"),
        "outs": min(int(outs or 0), 2),
        "on_first": bool(play.get("onFirst") or situation.get("onFirst")),
        "on_second": bool(play.get("onSecond") or situation.get("onSecond")),
        "on_third": bool(play.get("onThird") or situation.get("onThird")),
        "away_score": play.get("awayScore") if play.get("awayScore") is not None else situation.get("awayScore", 0),
        "home_score": play.get("homeScore") if play.get("homeScore") is not None else situation.get("homeScore", 0),
    }

def _hands_lookup() -> pd.DataFrame:
    """player_id -> bat_side / pitch_hand (L/R/S). Built by 04_fetch_player_stats.py."""
    if not PLAYER_HANDS_PATH.exists():
        return pd.DataFrame(columns=["player_id", "bat_side", "pitch_hand"])
    return pd.read_parquet(PLAYER_HANDS_PATH)


def _join_hands(df: pd.DataFrame) -> pd.DataFrame:
    hands = _hands_lookup()
    if hands.empty:
        df["batter_hand"] = ""
        df["pitcher_hand"] = ""
        return df

    bat = hands[["player_id", "bat_side"]].rename(
        columns={"player_id": "batter_id", "bat_side": "batter_hand"},
    )
    pit = hands[["player_id", "pitch_hand"]].rename(
        columns={"player_id": "pitcher_id", "pitch_hand": "pitcher_hand"},
    )
    df = df.merge(bat[["batter_id", "batter_hand"]], on="batter_id", how="left")
    df = df.merge(pit[["pitcher_id", "pitcher_hand"]], on="pitcher_id", how="left")
    df["batter_hand"] = df["batter_hand"].fillna("")
    df["pitcher_hand"] = df["pitcher_hand"].fillna("")
    return df

def enrich_platoon(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["batter_hand"] = df["batter_hand"].fillna("").str.upper()
    df["pitcher_hand"] = df["pitcher_hand"].fillna("").str.upper()
    df["batter_hand_L"] = (df["batter_hand"] == "L").astype(int)
    df["batter_hand_R"] = (df["batter_hand"] == "R").astype(int)
    df["pitcher_hand_L"] = (df["pitcher_hand"] == "L").astype(int)
    df["pitcher_hand_R"] = (df["pitcher_hand"] == "R").astype(int)
    df["platoon_adv"] = (
        ((df["batter_hand"] == "L") & (df["pitcher_hand"] == "R"))
        | ((df["batter_hand"] == "R") & (df["pitcher_hand"] == "L"))
    ).astype(int)
    return df


def _join_player_stats(df: pd.DataFrame) -> pd.DataFrame:
    if not PLAYER_STATS_PATH.exists():
        for col, default in LEAGUE_DEFAULTS.items():
            df[col] = default
        return df

    stats = pd.read_parquet(PLAYER_STATS_PATH)
    df["season"] = pd.to_datetime(df["game_date"]).dt.year

    bat_cols = {
        "k_rate": "batter_k_rate",
        "bb_rate": "batter_bb_rate",
        "iso": "batter_iso",
        "gb_rate": "batter_gb_rate",
        "fb_rate": "batter_fb_rate",
        "hbp_rate": "batter_hbp_rate",
        "gdp_rate": "batter_gdp_rate",
        "sf_rate": "batter_sf_rate",
    }
    pit_cols = {
        "k_rate": "pitcher_k_rate",
        "bb_rate": "pitcher_bb_rate",
        "gb_rate": "pitcher_gb_rate",
        "hr_rate": "pitcher_hr_rate",
        "hbp_rate": "pitcher_hbp_rate",
    }

    bat = stats[stats["role"] == "batter"].copy()
    pit = stats[stats["role"] == "pitcher"].copy()
    bat = bat.rename(columns={src: dest for src, dest in bat_cols.items() if src in bat.columns})
    pit = pit.rename(columns={src: dest for src, dest in pit_cols.items() if src in pit.columns})

    bat_merge_cols = ["player_id", "season", *[dest for dest in bat_cols.values() if dest in bat.columns]]
    pit_merge_cols = ["player_id", "season", *[dest for dest in pit_cols.values() if dest in pit.columns]]

    df = df.merge(
        bat[bat_merge_cols],
        left_on=["batter_id", "season"],
        right_on=["player_id", "season"],
        how="left",
    ).drop(columns=["player_id"], errors="ignore")

    df = df.merge(
        pit[pit_merge_cols],
        left_on=["pitcher_id", "season"],
        right_on=["player_id", "season"],
        how="left",
    ).drop(columns=["player_id"], errors="ignore")

    for col, default in LEAGUE_DEFAULTS.items():
        df[col] = df[col].fillna(default) if col in df.columns else default
    return df


def extract_at_bats_from_state(
    game_pk: int,
    game_date: str,
    venue_id: int | None,
    state: dict,
) -> list[dict]:
    """One row per completed at-bat (terminal pitch count)."""
    rows = []
    state = unwrap_game_state(state)

    for play in state.get("plays", []):
        if play.get("isAtBat") is False:
            continue
        detail = play.get("detail") or {}
        situation = play.get("situationBefore") or {}

        pitches = [p for p in detail.get("pitches", []) if p.get("isPitch")]
        if not pitches:
            continue

        outcome = map_outcome(play.get("event") or detail.get("event"))
        if outcome is None:
            continue

        last_pitch = pitches[-1]
        sit = _situation_fields(play, situation)
        balls, strikes = pre_pitch_count(pitches, len(pitches) - 1)

        rows.append({
            "game_pk": game_pk,
            "game_date": game_date,
            "venue_id": venue_id,
            "batter_id": play.get("batterId") or detail.get("batterId"),
            "pitcher_id": detail.get("pitcherId"),
            **sit,
            "balls": balls,
            "strikes": strikes,
            "pitch_count_in_ab": len(pitches),
            "is_final_pitch": True,
            "last_pitch_speed": last_pitch.get("startSpeed"),
            "last_pitch_type": last_pitch.get("typeCode"),
            "outcome_label": outcome,
        })

    return rows


def extract_pitch_snapshots_from_state(
    game_pk: int,
    game_date: str,
    venue_id: int | None,
    state: dict,
) -> list[dict]:
    """One row per pitch; label is the final at-bat outcome."""
    rows = []
    state = unwrap_game_state(state)

    for play in state.get("plays", []):
        if play.get("isAtBat") is False:
            continue
        detail = play.get("detail") or {}
        situation = play.get("situationBefore") or {}

        outcome = map_outcome(play.get("event") or detail.get("event"))
        if outcome is None:
            continue

        pitches = [p for p in detail.get("pitches", []) if p.get("isPitch")]
        if not pitches:
            continue

        sit = _situation_fields(play, situation)

        for i, pitch in enumerate(pitches):
            balls, strikes = pre_pitch_count(pitches, i)
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
                "is_final_pitch": i == len(pitches) - 1,
                "last_pitch_speed": pitch.get("startSpeed"),
                "last_pitch_type": pitch.get("typeCode"),
                "outcome_label": outcome,
            })

    return rows


def _encode_pitch_type_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    speed = pd.to_numeric(df.get("last_pitch_speed"), errors="coerce")
    df["last_pitch_speed"] = speed.fillna(LEAGUE_AVG_PITCH_SPEED)

    pitch_type = df.get("last_pitch_type", pd.Series("", index=df.index)).fillna("").astype(str).str.upper()
    for code in PITCH_TYPE_CODES:
        df[f"last_pitch_type_{code}"] = (pitch_type == code).astype(int)
    return df


def enrich_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    df = df.copy()
    for col in ("home_score", "away_score"):
        if col not in df.columns:
            df[col] = 0
    df["score_diff"] = df["home_score"] - df["away_score"]
    df["runners_code"] = (
        df["on_first"].astype(int) * 1
        + df["on_second"].astype(int) * 2
        + df["on_third"].astype(int) * 4
    )
    df["runners_on"] = df["on_first"] | df["on_second"] | df["on_third"]
    df["half_inning_bottom"] = (df["half_inning"] == "bottom").astype(int)
    df["risp"] = (df["on_second"] | df["on_third"]).astype(int)
    df["bases_loaded"] = (df["on_first"] & df["on_second"] & df["on_third"]).astype(int)
    df["gidp_setup"] = (df["on_first"] & (df["outs"] < 2)).astype(int)
    df["sac_fly_setup"] = (df["on_third"] & (df["outs"] < 2)).astype(int)
    df["inning_late"] = (df["inning"] >= 7).astype(int)
    df = _join_hands(df)
    df = enrich_platoon(df)
    df = _join_player_stats(df)
    return _encode_pitch_type_features(df)


def validate_dataset(df: pd.DataFrame) -> None:
    if df.empty:
        return

    unknown = set(df["outcome_label"].unique()) - set(OUTCOME_KEYS)
    if unknown:
        raise ValueError(f"Unknown outcome labels: {unknown}")

    if not df["balls"].between(0, 3).all():
        raise ValueError("Invalid balls count in dataset")
    if not df["strikes"].between(0, 2).all():
        raise ValueError("Invalid strikes count in dataset")
    if not df["outs"].between(0, 2).all():
        raise ValueError("Invalid outs count in dataset")


def fetch_game_index(client: Client) -> list[dict]:
    """Lightweight listing of games that have synced feeds."""
    rows: list[dict] = []
    offset = 0

    while True:
        response = (
            client.table("games")
            .select("game_pk, game_date, venue_id")
            .not_.is_("game_state", "null")
            .order("game_date")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        batch = response.data or []
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    return rows


def fetch_game_states(client: Client, game_pks: list[int]) -> dict[int, dict]:
    """Fetch game_state JSON for a batch of games."""
    response = (
        client.table("games")
        .select("game_pk, game_state")
        .in_("game_pk", game_pks)
        .execute()
    )
    return {row["game_pk"]: row["game_state"] for row in (response.data or [])}


def fetch_all_games_with_state(client: Client) -> list[dict]:
    index = fetch_game_index(client)
    games: list[dict] = []

    for start in range(0, len(index), GAME_STATE_BATCH):
        batch = index[start : start + GAME_STATE_BATCH]
        game_pks = [row["game_pk"] for row in batch]
        states = fetch_game_states(client, game_pks)

        for row in batch:
            state = states.get(row["game_pk"])
            if state is None:
                continue
            games.append({**row, "game_state": state})

        loaded = min(start + GAME_STATE_BATCH, len(index))
        print(f"  Loaded game_state for {loaded}/{len(index)} games")

    return games


def extract_datasets_from_games(games: list[dict]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Flatten cached game_state JSON into training frames."""
    print(f"Flattening play-by-play for {len(games)} games...")

    at_bat_rows: list[dict] = []
    pitch_rows: list[dict] = []

    for game in games:
        game_pk = game["game_pk"]
        state = game["game_state"]
        game_date = game["game_date"]
        venue_id = game.get("venue_id")

        try:
            at_bat_rows.extend(
                extract_at_bats_from_state(game_pk, game_date, venue_id, state)
            )
            pitch_rows.extend(
                extract_pitch_snapshots_from_state(game_pk, game_date, venue_id, state)
            )
        except Exception as e:
            print(f"Skipping game {game_pk} due to parsing error: {e}")

    at_bats_df = enrich_dataframe(pd.DataFrame(at_bat_rows))
    pitches_df = enrich_dataframe(pd.DataFrame(pitch_rows))

    validate_dataset(at_bats_df)
    validate_dataset(pitches_df)

    return at_bats_df, pitches_df


def extract_datasets(client: Client) -> tuple[pd.DataFrame, pd.DataFrame]:
    print("Fetching game JSONs from Supabase...")
    games = fetch_all_games_with_state(client)
    print(f"Retrieved {len(games)} games.")
    return extract_datasets_from_games(games)


def extract_datasets_from_local_cache() -> tuple[pd.DataFrame, pd.DataFrame]:
    from mlb_cache import load_cached_games

    games = load_cached_games()
    if not games:
        raise FileNotFoundError(
            "No parsed game cache found. Run:\n"
            "  python mlb_cache.py --max-games 500\n"
            "or:\n"
            "  python 01_extract_data.py --build-mlb-cache --max-games 500"
        )
    print(f"Loaded {len(games)} games from local cache.")
    return extract_datasets_from_games(games)


def save_datasets(at_bats_df: pd.DataFrame, pitches_df: pd.DataFrame) -> tuple[Path, Path]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    at_bats_df.to_parquet(AT_BATS_PATH, index=False)
    pitches_df.to_parquet(AT_BAT_PITCHES_PATH, index=False)
    return AT_BATS_PATH, AT_BAT_PITCHES_PATH


def re_enrich_local_datasets() -> None:
    """Re-apply hand/platoon/stat joins to existing parquet without Supabase."""
    for path in (AT_BATS_PATH, AT_BAT_PITCHES_PATH):
        if not path.exists():
            raise FileNotFoundError(f"Missing {path}")
        df = pd.read_parquet(path)
        drop_cols = [
            "batter_hand", "pitcher_hand",
            "batter_hand_L", "batter_hand_R", "pitcher_hand_L", "pitcher_hand_R",
            "platoon_adv", "season",
            "risp", "bases_loaded", "gidp_setup", "sac_fly_setup", "inning_late",
            "last_pitch_speed",
            *[f"last_pitch_type_{code}" for code in PITCH_TYPE_CODES],
            *LEAGUE_DEFAULTS.keys(),
        ]
        df = df.drop(columns=[c for c in drop_cols if c in df.columns])
        df = enrich_dataframe(df)
        df.to_parquet(path, index=False)
        print(f"Re-enriched {path} ({len(df)} rows)")


if __name__ == "__main__":
    import sys

    if "--re-enrich-only" in sys.argv:
        re_enrich_local_datasets()
    elif "--from-local-cache" in sys.argv:
        at_bats_df, pitches_df = extract_datasets_from_local_cache()
        print(f"\nTerminal at-bats: {len(at_bats_df)}")
        print(f"Per-pitch snapshots: {len(pitches_df)}")
        if len(at_bats_df) > 0:
            print("\nAt-bat outcome distribution:")
            print(at_bats_df["outcome_label"].value_counts(normalize=True))
        at_bats_path, pitches_path = save_datasets(at_bats_df, pitches_df)
        print(f"\nWrote {at_bats_path}")
        print(f"Wrote {pitches_path}")
    elif "--build-mlb-cache" in sys.argv:
        from mlb_cache import build_local_game_cache

        max_games = None
        for arg in sys.argv:
            if arg.startswith("--max-games="):
                max_games = int(arg.split("=", 1)[1])
        season = date.today().year
        for arg in sys.argv:
            if arg.startswith("--season="):
                season = int(arg.split("=", 1)[1])
        build_local_game_cache(season=season, max_games=max_games)
        at_bats_df, pitches_df = extract_datasets_from_local_cache()
        print(f"\nTerminal at-bats: {len(at_bats_df)}")
        print(f"Per-pitch snapshots: {len(pitches_df)}")
        at_bats_path, pitches_path = save_datasets(at_bats_df, pitches_df)
        print(f"\nWrote {at_bats_path}")
        print(f"Wrote {pitches_path}")
    else:
        at_bats_df, pitches_df = extract_datasets(supabase)

        print(f"\nTerminal at-bats: {len(at_bats_df)}")
        print(f"Per-pitch snapshots: {len(pitches_df)}")

        if len(at_bats_df) > 0:
            print("\nAt-bat outcome distribution:")
            print(at_bats_df["outcome_label"].value_counts(normalize=True))

            print("\nPer-game at-bat counts:")
            print(at_bats_df.groupby("game_pk").size().describe())

        at_bats_path, pitches_path = save_datasets(at_bats_df, pitches_df)
        print(f"\nWrote {at_bats_path}")
        print(f"Wrote {pitches_path}")
