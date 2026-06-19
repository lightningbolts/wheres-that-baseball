"""Shared outcome labels and feature columns for the ml-engine pipeline."""

# Must match ingestor/internal/predictor/predictor.go and web/types/database.ts
OUTCOME_KEYS = [
    "strikeout",
    "walk",
    "single",
    "double",
    "triple",
    "home_run",
    "field_out",
]

# Features available at live inference time (ingestor GameState)
FEATURE_COLS = [
    "inning",
    "balls",
    "strikes",
    "outs",
    "on_first",
    "on_second",
    "on_third",
    "runners_code",
    "half_inning_bottom",
    "pitch_count_in_ab",
    "batter_hand_L",
    "batter_hand_R",
    "pitcher_hand_L",
    "pitcher_hand_R",
    "platoon_adv",
    "batter_k_rate",
    "batter_bb_rate",
    "batter_iso",
    "pitcher_k_rate",
    "pitcher_bb_rate",
]

LEAGUE_DEFAULTS = {
    "batter_k_rate": 0.23,
    "batter_bb_rate": 0.09,
    "batter_iso": 0.15,
    "pitcher_k_rate": 0.23,
    "pitcher_bb_rate": 0.09,
}
