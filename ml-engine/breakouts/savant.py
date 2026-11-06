"""Fetch and cache Baseball Savant leaderboard CSVs."""

from __future__ import annotations

import time
from pathlib import Path

import pandas as pd
import requests

CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "savant_breakouts"
UA = {"User-Agent": "Mozilla/5.0"}
# Bump when the selected columns change so stale caches are not reused.
CACHE_VERSION = "v2"

BATTER_FIELDS = [
    "player_age", "pa", "home_run", "k_percent", "bb_percent", "woba", "xwoba", "xslg", "xba",
    "barrel_batted_rate", "hard_hit_percent", "avg_best_speed", "sweet_spot_percent",
    "exit_velocity_avg", "launch_angle_avg", "whiff_percent", "oz_swing_percent",
    "z_swing_percent", "iz_contact_percent", "pull_percent", "flyballs_percent",
    "groundballs_percent", "sprint_speed",
]

PITCHER_FIELDS = [
    "player_age", "pa", "p_formatted_ip", "p_era", "xera", "p_game", "strikeout", "p_save",
    "k_percent", "bb_percent", "woba", "xwoba", "barrel_batted_rate", "hard_hit_percent",
    "whiff_percent", "oz_swing_percent", "in_zone_percent", "f_strike_percent",
    "groundballs_percent", "fastball_avg_speed", "fastball_avg_spin",
    "fastball_avg_break_z_induced", "breaking_avg_speed", "breaking_avg_spin",
    "n_breaking_formatted", "n_offspeed_formatted", "iz_contact_percent",
]


def _get_csv(url: str, params: dict, path: Path, refresh: bool) -> pd.DataFrame:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if refresh or not path.exists():
        for attempt in range(4):
            try:
                resp = requests.get(url, params=params, timeout=90, headers=UA)
                resp.raise_for_status()
                break
            except requests.RequestException:
                if attempt == 3:
                    raise
                time.sleep(2 * (attempt + 1))
        path.write_text(resp.content.decode("utf-8-sig"))
    df = pd.read_csv(path)
    return df.rename(columns={"last_name, first_name": "name_lf"})


def _numeric(df: pd.DataFrame, keep: tuple[str, ...]) -> pd.DataFrame:
    for col in df.columns:
        if col not in keep:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def fetch_season(role: str, year: int, *, refresh: bool = False) -> pd.DataFrame:
    """Season leaderboard. role: 'batter' | 'pitcher'."""
    fields = BATTER_FIELDS if role == "batter" else PITCHER_FIELDS
    df = _get_csv(
        "https://baseballsavant.mlb.com/leaderboard/custom",
        {"year": year, "type": role, "filter": "", "min": 1, "selections": ",".join(fields), "csv": "true"},
        CACHE_DIR / f"{role}_{year}_{CACHE_VERSION}.csv",
        refresh,
    )
    df = _numeric(df, ("name_lf",))
    if "p_formatted_ip" in df.columns:
        # "195.1" means 195 1/3 innings.
        ip = df["p_formatted_ip"].fillna(0)
        whole = ip.astype(int)
        df["ip"] = whole + (ip - whole).round(1) * 10 / 3
    df["year"] = year
    return df


def fetch_oaa(year: int, *, refresh: bool = False) -> pd.DataFrame:
    """Outs Above Average by fielder for a season (2016+)."""
    df = _get_csv(
        "https://baseballsavant.mlb.com/leaderboard/outs_above_average",
        {"type": "Fielder", "startYear": year, "endYear": year, "split": "no", "team": "", "range": "year",
         "min": 1, "pos": "", "roles": "", "viz": "hide", "csv": "true"},
        CACHE_DIR / f"oaa_{year}.csv",
        refresh,
    )
    df = _numeric(df, ("name_lf", "display_team_name", "primary_pos_formatted", "year",
                       "actual_success_rate_formatted", "adj_estimated_success_rate_formatted",
                       "diff_success_rate_formatted"))
    df["year"] = year
    return df[["player_id", "year", "outs_above_average"]]


def fetch_bat_tracking(year: int, *, refresh: bool = False) -> pd.DataFrame:
    """Bat speed / blast rate leaderboard (2024+)."""
    df = _get_csv(
        "https://baseballsavant.mlb.com/leaderboard/bat-tracking",
        {"attackZone": "", "batSide": "", "contactType": "", "count": "", "dateStart": f"{year}-01-01",
         "dateEnd": f"{year}-12-31", "gameType": "Regular", "isHardHit": "", "minSwings": 100,
         "minGroupSwings": 1, "pitchHand": "", "pitchType": "", "seasonStart": year, "seasonEnd": year,
         "team": "", "type": "batter", "csv": "true"},
        CACHE_DIR / f"bat_tracking_{year}.csv",
        refresh,
    )
    df = _numeric(df, ("name",))
    return df.rename(columns={"id": "player_id"})


def fetch_arsenal(year: int, *, refresh: bool = False) -> pd.DataFrame:
    """Per-pitch-type results for pitchers."""
    df = _get_csv(
        "https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats",
        {"type": "pitcher", "pitchType": "", "year": year, "team": "", "min": 1, "csv": "true"},
        CACHE_DIR / f"arsenal_{year}.csv",
        refresh,
    )
    return _numeric(df, ("name_lf", "team_name_alt", "pitch_type", "pitch_name"))
