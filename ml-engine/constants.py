"""Shared outcome labels and feature columns for the ml-engine pipeline."""

# Must match ingestor/internal/predictor/predictor.go and web/types/database.ts
OUTCOME_KEYS = [
    "strikeout",
    "walk",
    "hit_by_pitch",
    "single",
    "double",
    "triple",
    "home_run",
    "field_out",
    "gidp",
    "sac_fly",
    "sac_bunt",
]

# One-hot columns for the most common pitch type codes from Statcast.
PITCH_TYPE_CODES = ["FF", "SL", "CH", "CU", "SI", "FC", "FS", "ST", "KC"]

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
    "risp",
    "bases_loaded",
    "gidp_setup",
    "sac_fly_setup",
    "score_diff",
    "inning_late",
    "batter_k_rate",
    "batter_bb_rate",
    "batter_iso",
    "batter_gb_rate",
    "batter_fb_rate",
    "batter_hbp_rate",
    "batter_gdp_rate",
    "batter_sf_rate",
    "pitcher_k_rate",
    "pitcher_bb_rate",
    "pitcher_gb_rate",
    "pitcher_hr_rate",
    "pitcher_hbp_rate",
    "last_pitch_speed",
    *[f"last_pitch_type_{code}" for code in PITCH_TYPE_CODES],
]

LEAGUE_DEFAULTS = {
    "batter_k_rate": 0.23,
    "batter_bb_rate": 0.09,
    "batter_iso": 0.15,
    "batter_gb_rate": 0.44,
    "batter_fb_rate": 0.36,
    "batter_hbp_rate": 0.01,
    "batter_gdp_rate": 0.02,
    "batter_sf_rate": 0.005,
    "pitcher_k_rate": 0.23,
    "pitcher_bb_rate": 0.09,
    "pitcher_gb_rate": 0.44,
    "pitcher_hr_rate": 0.03,
    "pitcher_hbp_rate": 0.01,
    "last_pitch_speed": 93.0,
}

LEAGUE_AVG_PITCH_SPEED = 93.0
