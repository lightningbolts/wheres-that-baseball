"""Shared inference helpers — model loaded once, reused by CLI and HTTP server."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import joblib
import pandas as pd

from constants import FEATURE_COLS, LEAGUE_AVG_PITCH_SPEED, LEAGUE_DEFAULTS, PITCH_TYPE_CODES

MODEL_PATH = Path(__file__).parent / "models" / "at_bat_model.joblib"
STEAL_MODEL_PATH = Path(__file__).parent / "models" / "steal_model.joblib"
_STATS_PATH = Path(__file__).parent / "data" / "player_stats.parquet"

_ARTIFACT: dict | None = None
_STEAL_ARTIFACT: dict | None = None
_PLAYER_STATS: pd.DataFrame | None = None


def get_artifact() -> dict:
    global _ARTIFACT
    if _ARTIFACT is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(
                f"Missing {MODEL_PATH}. Run `python 02_train_model.py` first."
            )
        _ARTIFACT = joblib.load(MODEL_PATH)
    return _ARTIFACT


def get_steal_artifact() -> dict | None:
    global _STEAL_ARTIFACT
    if _STEAL_ARTIFACT is None and STEAL_MODEL_PATH.exists():
        _STEAL_ARTIFACT = joblib.load(STEAL_MODEL_PATH)
    return _STEAL_ARTIFACT


def _league_defaults() -> dict[str, float]:
    artifact = get_artifact()
    return dict(artifact.get("league_defaults") or LEAGUE_DEFAULTS)


def _load_player_stats() -> pd.DataFrame:
    global _PLAYER_STATS
    if _PLAYER_STATS is None and _STATS_PATH.exists():
        _PLAYER_STATS = pd.read_parquet(_STATS_PATH)
    return _PLAYER_STATS if _PLAYER_STATS is not None else pd.DataFrame()


def _resolve_batter_hand(batter_hand: str, pitcher_hand: str) -> str:
    b = (batter_hand or "").upper()
    p = (pitcher_hand or "").upper()
    if b == "S":
        if p == "R":
            return "L"
        if p == "L":
            return "R"
    return b


def _hands_to_features(batter_hand: str, pitcher_hand: str) -> dict[str, int]:
    b = _resolve_batter_hand(batter_hand, pitcher_hand)
    p = (pitcher_hand or "").upper()
    return {
        "batter_hand_L": int(b == "L"),
        "batter_hand_R": int(b == "R"),
        "pitcher_hand_L": int(p == "L"),
        "pitcher_hand_R": int(p == "R"),
        "platoon_adv": int((b == "L" and p == "R") or (b == "R" and p == "L")),
    }


def _lookup_player_rates(batter_id: int, pitcher_id: int, season: int) -> dict[str, float]:
    out = _league_defaults()
    stats = _load_player_stats()
    if stats.empty or season <= 0:
        return out

    bat = stats[
        (stats["player_id"] == batter_id)
        & (stats["season"] == season)
        & (stats["role"] == "batter")
    ]
    pit = stats[
        (stats["player_id"] == pitcher_id)
        & (stats["season"] == season)
        & (stats["role"] == "pitcher")
    ]

    if not bat.empty:
        row = bat.iloc[0]
        out["batter_k_rate"] = float(row["k_rate"])
        out["batter_bb_rate"] = float(row["bb_rate"])
        out["batter_iso"] = float(row.get("iso", out["batter_iso"]))
        out["batter_gb_rate"] = float(row.get("gb_rate", out["batter_gb_rate"]))
        out["batter_fb_rate"] = float(row.get("fb_rate", out["batter_fb_rate"]))
        out["batter_hbp_rate"] = float(row.get("hbp_rate", out["batter_hbp_rate"]))
        out["batter_gdp_rate"] = float(row.get("gdp_rate", out["batter_gdp_rate"]))
        out["batter_sf_rate"] = float(row.get("sf_rate", out["batter_sf_rate"]))
    if not pit.empty:
        row = pit.iloc[0]
        out["pitcher_k_rate"] = float(row["k_rate"])
        out["pitcher_bb_rate"] = float(row["bb_rate"])
        out["pitcher_gb_rate"] = float(row.get("gb_rate", out["pitcher_gb_rate"]))
        out["pitcher_hr_rate"] = float(row.get("hr_rate", out["pitcher_hr_rate"]))
        out["pitcher_hbp_rate"] = float(row.get("hbp_rate", out["pitcher_hbp_rate"]))
    return out


def _situational_features(
    *,
    outs: int,
    on_first: bool,
    on_second: bool,
    on_third: bool,
    inning: int,
    away_score: int,
    home_score: int,
) -> dict[str, int | float]:
    return {
        "risp": int(on_second or on_third),
        "bases_loaded": int(on_first and on_second and on_third),
        "gidp_setup": int(on_first and outs < 2),
        "sac_fly_setup": int(on_third and outs < 2),
        "score_diff": home_score - away_score,
        "inning_late": int(inning >= 7),
    }


def _pitch_type_features(pitch_type: str = "", pitch_speed: float = 0.0) -> dict[str, float | int]:
    code = (pitch_type or "").upper()
    speed = pitch_speed if pitch_speed > 0 else LEAGUE_AVG_PITCH_SPEED
    features: dict[str, float | int] = {"last_pitch_speed": speed}
    for pitch_code in PITCH_TYPE_CODES:
        features[f"last_pitch_type_{pitch_code}"] = int(code == pitch_code)
    return features


def predict_outcome_probs(features: dict) -> dict[str, float]:
    """
    Return snake_case outcome probabilities summing to 1.0.

    `features` keys must match FEATURE_COLS in constants.py.
    """
    artifact = get_artifact()
    pipeline = artifact["pipeline"]
    outcome_keys = artifact["outcome_keys"]
    feature_cols = artifact["feature_cols"]

    row = pd.DataFrame([{col: features.get(col) for col in feature_cols}])
    probs = pipeline.predict_proba(row)[0]

    result = {key: float(probs[i]) for i, key in enumerate(outcome_keys)}
    total = sum(result.values())
    if total <= 0:
        raise ValueError("Model returned non-positive probability sum")
    return {key: value / total for key, value in result.items()}


def game_state_to_features(
    *,
    inning: int,
    balls: int,
    strikes: int,
    outs: int,
    on_first: bool,
    on_second: bool,
    on_third: bool,
    inning_half: str,
    pitch_count: int,
    batter_hand: str = "",
    pitcher_hand: str = "",
    batter_id: int = 0,
    pitcher_id: int = 0,
    season: int = 0,
    away_score: int = 0,
    home_score: int = 0,
    last_pitch_speed: float = 0.0,
    last_pitch_type: str = "",
) -> dict:
    """Map ingestor GameState fields to model feature dict."""
    runners_code = int(on_first) * 1 + int(on_second) * 2 + int(on_third) * 4
    hands = _hands_to_features(batter_hand, pitcher_hand)
    rates = _lookup_player_rates(batter_id, pitcher_id, season)
    situational = _situational_features(
        outs=outs,
        on_first=on_first,
        on_second=on_second,
        on_third=on_third,
        inning=inning,
        away_score=away_score,
        home_score=home_score,
    )
    pitch_features = _pitch_type_features(last_pitch_type, last_pitch_speed)
    return {
        "inning": inning,
        "balls": balls,
        "strikes": strikes,
        "outs": outs,
        "on_first": int(on_first),
        "on_second": int(on_second),
        "on_third": int(on_third),
        "runners_code": runners_code,
        "half_inning_bottom": int(inning_half.lower() == "bottom"),
        "pitch_count_in_ab": pitch_count,
        **hands,
        **rates,
        **situational,
        **pitch_features,
    }


def predict_from_game_state(state: dict) -> dict[str, float]:
    """Accept ingestor JSON body and return outcome probabilities."""
    season = int(state.get("season", 0))
    if season <= 0:
        season = datetime.now(timezone.utc).year

    features = game_state_to_features(
        inning=int(state.get("inning", 1)),
        balls=int(state.get("balls", 0)),
        strikes=int(state.get("strikes", 0)),
        outs=int(state.get("outs", 0)),
        on_first=bool(state.get("on_first", False)),
        on_second=bool(state.get("on_second", False)),
        on_third=bool(state.get("on_third", False)),
        inning_half=str(state.get("inning_half", "top")),
        pitch_count=int(state.get("pitch_count", 0)),
        batter_hand=str(state.get("batter_hand", "")),
        pitcher_hand=str(state.get("pitcher_hand", "")),
        batter_id=int(state.get("batter_id", 0)),
        pitcher_id=int(state.get("pitcher_id", 0)),
        season=season,
        away_score=int(state.get("away_score", 0)),
        home_score=int(state.get("home_score", 0)),
        last_pitch_speed=float(state.get("last_pitch_speed", 0)),
        last_pitch_type=str(state.get("last_pitch_type", "")),
    )
    return predict_outcome_probs(features)


def predict_steal_from_game_state(state: dict) -> dict[str, float]:
    """Return steal attempt/success probabilities when the steal model is available."""
    artifact = get_steal_artifact()
    if artifact is None:
        return {"steal_attempt": 0.0, "steal_success": 0.0}

    season = int(state.get("season", 0))
    if season <= 0:
        season = datetime.now(timezone.utc).year

    features = game_state_to_features(
        inning=int(state.get("inning", 1)),
        balls=int(state.get("balls", 0)),
        strikes=int(state.get("strikes", 0)),
        outs=int(state.get("outs", 0)),
        on_first=bool(state.get("on_first", False)),
        on_second=bool(state.get("on_second", False)),
        on_third=bool(state.get("on_third", False)),
        inning_half=str(state.get("inning_half", "top")),
        pitch_count=int(state.get("pitch_count", 0)),
        batter_hand=str(state.get("batter_hand", "")),
        pitcher_hand=str(state.get("pitcher_hand", "")),
        batter_id=int(state.get("batter_id", 0)),
        pitcher_id=int(state.get("pitcher_id", 0)),
        season=season,
        away_score=int(state.get("away_score", 0)),
        home_score=int(state.get("home_score", 0)),
        last_pitch_speed=float(state.get("last_pitch_speed", 0)),
        last_pitch_type=str(state.get("last_pitch_type", "")),
    )

    pipeline = artifact["pipeline"]
    feature_cols = artifact["feature_cols"]
    row = pd.DataFrame([{col: features.get(col) for col in feature_cols}])
    probs = pipeline.predict_proba(row)[0]
    classes = list(pipeline.named_steps["clf"].classes_)
    result = {str(classes[i]): float(probs[i]) for i in range(len(classes))}
    attempt = result.get("steal_success", 0.0) + result.get("steal_caught", 0.0)
    success = result.get("steal_success", 0.0)
    return {"steal_attempt": attempt, "steal_success": success}
