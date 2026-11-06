"""Build next-season regression and bounceback candidates for hitters and pitchers.

Same approach as build_breakouts.py (Statcast leaderboards 2015..LAST_SEASON, an L2 logistic
regression, a walk-forward backtest against the public heuristics, model-driven explanations
and a historical comp), with two new outcomes:

Regression  A good season (above-average regular, or a strong starter / elite reliever) that is
            followed by a real drop: wOBA down 30+ points, or ERA up 1+ run. Measured only for
            players who kept playing (200+ PA / 40+ IP), so it is about performance, not injuries.
Bounceback  A player with a good two-year track record who had a bad season (wOBA down 25+
            points, or ERA up 1+ run, vs. that track record) and gets back near it the next year
            in a real role (250+ PA / 40+ IP). Not playing counts as no bounceback.

Output: web/data/breakouts/<LAST_SEASON+1>-turnarounds.json

Usage: .venv/bin/python breakouts/build_turnarounds.py [--refresh]
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_breakouts as bb  # noqa: E402
from build_breakouts import (  # noqa: E402
    FIRST_SEASON,
    LAST_SEASON,
    OUT_DIR,
    backtest,
    fmt1,
    fmt3,
    fmt_ip,
    make_model,
    name_from_lf,
    pct_rank,
    rate3,
    standing,
)
from mlbapi import fetch_half_splits, fetch_people  # noqa: E402
from savant import fetch_extra  # noqa: E402

NEXT = LAST_SEASON + 1
Y1, Y2 = LAST_SEASON - 1, LAST_SEASON - 2  # track-record seasons for the current cohort

# ---------------------------------------------------------------- definitions

HIT_REG_PA, HIT_REG_WOBA, HIT_REG_DROP, HIT_REG_NEXT_PA = 400, 0.015, 0.030, 200
PIT_REG_SP_IP, PIT_REG_SP_RUNS = 90, 0.40
PIT_REG_RP_IP, PIT_REG_RP_RUNS = 40, 1.00
PIT_REG_RISE, PIT_NEXT_IP = 1.00, 40

HIT_BNC_BASE_PA, HIT_BNC_BASE_WOBA, HIT_BNC_DROP, HIT_BNC_MIN_PA = 600, 0.010, 0.025, 150
HIT_BNC_MAX_WRC = 120  # a 120+ wRC+ season isn't a slump, even if it trails a star's own standard
HIT_BNC_NEXT_PA, HIT_BNC_TOL = 250, 0.015
PIT_BNC_BASE_IP, PIT_BNC_BASE_RUNS, PIT_BNC_RISE, PIT_BNC_MIN_IP = 100, 0.25, 1.00, 25
PIT_BNC_TOL = 0.50


def _lag(df: pd.DataFrame, cols: list[str], k: int, suffix: str) -> pd.DataFrame:
    x = df[["player_id", "year", *cols]].copy()
    x["year"] += k
    return x.rename(columns={c: f"{c}{suffix}" for c in cols})


def _wavg(df: pd.DataFrame, col: str, w: str) -> pd.Series:
    a, b = df[f"{col}_p1"], df[f"{col}_p2"]
    wa, wb = df[f"{w}_p1"].where(a.notna(), 0).fillna(0), df[f"{w}_p2"].where(b.notna(), 0).fillna(0)
    tot = (wa + wb).replace(0, np.nan)
    return (a.fillna(0) * wa + b.fillna(0) * wb) / tot


def _extra(role: str) -> pd.DataFrame:
    return pd.concat(
        [fetch_extra(role, y, refresh=bb.ARGS.refresh and y == LAST_SEASON) for y in range(FIRST_SEASON, LAST_SEASON + 1)],
        ignore_index=True,
    )


def hitter_frame(all_h: pd.DataFrame) -> pd.DataFrame:
    h = all_h.drop_duplicates(["player_id", "year"]).merge(_extra("batter"), on=["player_id", "year"], how="left")
    h["babip"] = h["x_babip"]
    h["slg"], h["xslg_"] = h["x_slg_percent"], h["x_xslg"]
    h["slg_gap"] = h["slg"] - h["xslg_"]
    h["xgap"] = h["woba"] - h["xwoba"]
    lag = ["pa", "woba_plus", "xwoba_plus", "woba", "xwoba", "babip", "avg_best_speed", "k_percent", "sprint_speed",
           "wrc_plus", "il_days"]
    h = h.merge(_lag(h, lag, 1, "_p1"), on=["player_id", "year"], how="left")
    h = h.merge(_lag(h[["player_id", "year", *lag]], lag, 2, "_p2"), on=["player_id", "year"], how="left")
    h = h.merge(_lag(h[["player_id", "year", "pa", "woba", "woba_plus"]], ["pa", "woba", "woba_plus"], -1, "_n"),
                on=["player_id", "year"], how="left")
    h["base_pa"] = h["pa_p1"].fillna(0) + h["pa_p2"].fillna(0)
    for col in ("woba_plus", "xwoba_plus", "woba", "xwoba", "babip", "wrc_plus"):
        h[f"base_{col}"] = _wavg(h, col, "pa")
    h["base_il_days"] = h["il_days_p1"].fillna(0) + h["il_days_p2"].fillna(0)
    h["jump"] = h["woba_plus"] - h["base_woba_plus"]
    h["xdrop"] = h["xwoba_plus"] - h["base_xwoba_plus"]
    h["babip_gap"] = h["babip"] - h["base_babip"]
    h["d_ev50"] = h["avg_best_speed"] - h["avg_best_speed_p1"]
    h["d_k"] = h["k_percent"] - h["k_percent_p1"]
    h["d_sprint"] = h["sprint_speed"] - h["sprint_speed_p1"]
    h["neg_xgap"] = -h["xgap"]
    h["il_any"] = (h["il_days"] > 0).astype(float)
    return h


def pitcher_frame(all_p: pd.DataFrame) -> pd.DataFrame:
    p = all_p.drop_duplicates(["player_id", "year"]).merge(_extra("pitcher"), on=["player_id", "year"], how="left")
    p["babip"] = p["x_babip"]
    p["hr9"] = p["x_home_run"] / p["ip"].replace(0, np.nan) * 9
    p["slg"], p["xslg_"] = p["x_slg_percent"], p["x_xslg"]
    p["slg_gap"] = p["slg"] - p["xslg_"]
    p["egap"] = p["p_era"] - p["xera"]
    p["era_fip"] = p["p_era"] - p["fip"]
    p["era_xfip"] = p["p_era"] - p["xfip"]
    lag = ["ip", "era_minus_lg", "xera_minus_lg", "p_era", "xera", "kbb", "babip", "fastball_avg_speed", "whiff_percent",
           "il_days"]
    p = p.merge(_lag(p, lag, 1, "_p1"), on=["player_id", "year"], how="left")
    p = p.merge(_lag(p[["player_id", "year", *lag]], lag, 2, "_p2"), on=["player_id", "year"], how="left")
    p = p.merge(_lag(p[["player_id", "year", "ip", "p_era", "era_minus_lg"]], ["ip", "p_era", "era_minus_lg"], -1, "_n"),
                on=["player_id", "year"], how="left")
    p["base_ip"] = p["ip_p1"].fillna(0) + p["ip_p2"].fillna(0)
    for col in ("era_minus_lg", "xera_minus_lg", "p_era", "xera", "babip"):
        p[f"base_{col}"] = _wavg(p, col, "ip")
    p["base_il_days"] = p["il_days_p1"].fillna(0) + p["il_days_p2"].fillna(0)
    p["era_jump"] = p["era_minus_lg"] - p["base_era_minus_lg"]
    p["xrise"] = p["xera_minus_lg"] - p["base_xera_minus_lg"]
    p["babip_gap"] = p["babip"] - p["base_babip"]
    p["d_velo"] = p["fastball_avg_speed"] - p["fastball_avg_speed_p1"]
    p["d_kbb"] = p["kbb"] - p["kbb_p1"]
    p["d_whiff"] = p["whiff_percent"] - p["whiff_percent_p1"]
    p["neg_egap"] = -p["egap"]
    p["neg_era_xfip"] = -p["era_xfip"]
    p["neg_era"] = -p["era_minus_lg"]
    p["neg_base_era"] = -p["base_era_minus_lg"]
    p["reliever"] = (p["ip_per_g"] < 2).astype(float)
    return p


# ---------------------------------------------------------------- specs


@dataclass
class Spec:
    key: str  # "regression" | "bounceback"
    kind: str  # "hitter" | "pitcher"
    eligible: Callable[[pd.DataFrame], pd.Series]
    label: Callable[[pd.DataFrame], pd.Series]
    played: Callable[[pd.DataFrame], pd.Series] | None
    features: list[str]
    baselines: dict[str, str]
    c: float
    ns: tuple[int, ...]
    top_n: int
    first: int = 2018
    min_pos: int = 30
    rates: dict[str, float] = field(default_factory=dict)


HIT_REG = Spec(
    "regression", "hitter",
    eligible=lambda f: (f["pa_162"] >= HIT_REG_PA) & (f["woba_plus"] >= HIT_REG_WOBA),
    label=lambda f: (f["woba_plus_n"] - f["woba_plus"]) <= -HIT_REG_DROP,
    played=lambda f: f["pa_n"] >= HIT_REG_NEXT_PA,
    features=["player_age", "woba_plus", "xwoba_plus", "xgap", "babip", "babip_gap", "slg_gap", "jump",
              "barrel_batted_rate", "avg_best_speed", "d_ev50", "k_percent", "bb_percent", "whiff_percent",
              "oz_swing_percent", "sprint_speed", "d_sprint", "sweet_spot_percent", "launch_angle_avg",
              "wrc_plus", "il_days", "base_il_days"],
    baselines={"wobaOverX": "xgap", "rawWoba": "woba_plus"},
    c=0.1, ns=(10, 25), top_n=25,
)
HIT_BNC = Spec(
    "bounceback", "hitter",
    eligible=lambda f: (f["base_pa"] >= HIT_BNC_BASE_PA) & (f["base_woba_plus"] >= HIT_BNC_BASE_WOBA)
    & (f["jump"] <= -HIT_BNC_DROP) & (f["pa"] >= HIT_BNC_MIN_PA) & (f["wrc_plus"] <= HIT_BNC_MAX_WRC),
    label=lambda f: (f["pa_n"] >= HIT_BNC_NEXT_PA) & (f["woba_plus_n"] >= f["base_woba_plus"] - HIT_BNC_TOL),
    played=None,
    features=["player_age", "base_woba_plus", "jump", "xdrop", "xgap", "xwoba_plus", "babip_gap", "slg_gap",
              "pa_162", "barrel_batted_rate", "avg_best_speed", "d_ev50", "k_percent", "d_k", "sprint_speed",
              "d_sprint", "bb_percent", "oz_swing_percent", "il_any"],
    baselines={"xOverWoba": "neg_xgap", "trackRecord": "base_woba_plus"},
    c=0.05, ns=(5, 10), top_n=20, first=2019, min_pos=20,
)
PIT_REG = Spec(
    "regression", "pitcher",
    eligible=lambda f: ((f["ip_162"] >= PIT_REG_SP_IP) & (f["era_minus_lg"] <= -PIT_REG_SP_RUNS))
    | ((f["ip_162"] >= PIT_REG_RP_IP) & (f["ip_per_g"] < 2) & (f["era_minus_lg"] <= -PIT_REG_RP_RUNS)),
    label=lambda f: (f["era_minus_lg_n"] - f["era_minus_lg"]) >= PIT_REG_RISE,
    played=lambda f: f["ip_n"] >= PIT_NEXT_IP,
    # A lean, FIP-anchored set: the full skills set (K-BB, velo, BABIP, ...) backtested worse than
    # ERA - xFIP alone, while these five beat it on top-10/top-25 hit rate.
    features=["era_xfip", "era_fip", "egap", "player_age", "reliever"],
    baselines={"eraUnderXfip": "neg_era_xfip", "eraUnderX": "neg_egap"},
    c=0.1, ns=(10, 25), top_n=25,
)
PIT_BNC = Spec(
    "bounceback", "pitcher",
    eligible=lambda f: (f["base_ip"] >= PIT_BNC_BASE_IP) & (f["base_era_minus_lg"] <= -PIT_BNC_BASE_RUNS)
    & (f["era_jump"] >= PIT_BNC_RISE) & (f["ip"] >= PIT_BNC_MIN_IP),
    label=lambda f: (f["ip_n"] >= PIT_NEXT_IP) & (f["era_minus_lg_n"] <= f["base_era_minus_lg"] + PIT_BNC_TOL),
    played=None,
    features=["player_age", "base_era_minus_lg", "era_jump", "xrise", "egap", "babip_gap", "hr9", "kbb", "d_kbb",
              "d_velo", "whiff_percent", "d_whiff", "ip_162", "base_ip", "reliever", "barrel_batted_rate",
              "fastball_avg_speed"],
    baselines={"eraOverX": "egap", "trackRecord": "neg_base_era"},
    c=0.1, ns=(5, 10), top_n=20, first=2019, min_pos=20,
)


def cohort_rows(spec: Spec, frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(labeled history, LAST_SEASON cohort)."""
    elig = frame[spec.eligible(frame)].copy()
    elig["label"] = spec.label(elig).fillna(False).astype(bool)
    hist = elig[(elig["year"] < LAST_SEASON) & (elig["year"] + 1 != 2020)]
    if spec.played is not None:
        hist = hist[spec.played(hist).fillna(False)]
    cur = elig[elig["year"] == LAST_SEASON].copy()
    return hist.copy(), cur


def age_rates(spec: Spec, hist: pd.DataFrame) -> dict[str, float]:
    age_next = hist["player_age"] + 1
    young_cut, old_cut = (27, 31) if spec.key == "regression" else (30, 33)
    out = {
        "young": float(hist.loc[age_next <= young_cut, "label"].mean()),
        "old": float(hist.loc[age_next >= old_cut, "label"].mean()),
        "youngCut": young_cut, "oldCut": old_cut,
    }
    if spec.kind == "pitcher":
        out["rp"] = float(hist.loc[hist["reliever"] >= 1, "label"].mean())
        out["sp"] = float(hist.loc[hist["reliever"] < 1, "label"].mean())
    return out


# ---------------------------------------------------------------- explanations

# feature -> (label, column, formatter, higher_is_better)
SKILL = {
    "hitter": {
        "xwoba_plus": ("xwOBA", "xwoba", lambda v: rate3(v), True),
        "barrel_batted_rate": ("barrel rate", "barrel_batted_rate", lambda v: f"{v:.1f}%", True),
        "avg_best_speed": ("EV50", "avg_best_speed", lambda v: f"{v:.1f} mph", True),
        "k_percent": ("strikeout rate", "k_percent", lambda v: f"{v:.1f}%", False),
        "bb_percent": ("walk rate", "bb_percent", lambda v: f"{v:.1f}%", True),
        "whiff_percent": ("whiff rate", "whiff_percent", lambda v: f"{v:.1f}%", False),
        "oz_swing_percent": ("chase rate", "oz_swing_percent", lambda v: f"{v:.1f}%", False),
        "sprint_speed": ("sprint speed", "sprint_speed", lambda v: f"{v:.1f} ft/s", True),
        "wrc_plus": ("wRC+", "wrc_plus", lambda v: f"{v:.0f}", True),
        "sweet_spot_percent": ("sweet-spot rate", "sweet_spot_percent", lambda v: f"{v:.1f}%", True),
    },
    "pitcher": {
        "kbb": ("K-BB%", "kbb", lambda v: f"{v:.1f}%", True),
        "whiff_percent": ("whiff rate", "whiff_percent", lambda v: f"{v:.1f}%", True),
        "barrel_batted_rate": ("barrel rate allowed", "barrel_batted_rate", lambda v: f"{v:.1f}%", False),
        "groundballs_percent": ("ground-ball rate", "groundballs_percent", lambda v: f"{v:.1f}%", True),
        "fastball_avg_speed": ("fastball velo", "fastball_avg_speed", lambda v: f"{v:.1f} mph", True),
        "xera_minus_lg": ("xERA", "xera", lambda v: f"{v:.2f}", False),
    },
}


def cap(text: str) -> str:
    return text if text[:2] in ("xw", "xE", "EV", "K-", "wR") else text[:1].upper() + text[1:]


def speed_player(r: pd.Series) -> bool:
    return max(r.get("sprint_speed") or 0, r.get("sprint_speed_p1") or 0) >= bb.SPEED_PLAYER


def il_note(r: pd.Series) -> str:
    what = r.get("il_what")
    return f" ({what})" if isinstance(what, str) and what else ""


def skill_line(spec: Spec, f: str, r: pd.Series, ref: pd.DataFrame, supports: bool) -> str | None:
    """Generic skill stat. For regression a strong skill argues against a drop; for a bounceback
    it argues for one."""
    table = SKILL[spec.kind]
    if f not in table:
        return None
    label, col, fmt, hib = table[f]
    v = r.get(col)
    if pd.isna(v):
        return None
    if f == "sprint_speed" and v < bb.SPEED_PLAYER:
        return None  # not a speed player: sprint speed isn't part of his value
    pr = pct_rank(ref[col], v)
    good = pr if hib else 1 - pr
    strong, weak = good >= 0.70, good <= 0.35
    who = "regulars" if spec.kind == "hitter" else "pitchers"
    base = f"{cap(label)} {fmt(v)} ({standing(good)} of {who})"
    if spec.key == "regression":
        if supports and weak:
            return f"{base}: thin support for that output"
        if not supports and strong:
            return f"{base} says the production is backed by real skill"
    else:
        if supports and strong:
            return f"{base}: the underlying skill is still there"
        if not supports and weak:
            return base
    return None


def pts(x: float) -> int:
    return int(round(abs(x) * 1000))


def yrs() -> str:
    return f"{Y2}-{str(Y1)[2:]}"


def hitter_reg_line(spec: Spec, f: str, r: pd.Series, ref: pd.DataFrame, supports: bool) -> str | None:
    a = spec.rates
    age_next = int(r["player_age"]) + 1
    if f == "player_age":
        if supports and age_next >= a["oldCut"]:
            return (f"Turns {age_next} in {NEXT}: {a['old'] * 100:.0f}% of strong hitters {a['oldCut']}+ lost 30+ points "
                    f"of wOBA the next year, vs {a['young'] * 100:.0f}% at {a['youngCut']} or younger")
        if not supports and age_next <= a["youngCut"]:
            return f"Only {age_next} in {NEXT}: young hitters kept their gains more often ({a['young'] * 100:.0f}% dropped vs {a['old'] * 100:.0f}% at {a['oldCut']}+)"
        return None
    if f == "wrc_plus" and supports:
        pr = pct_rank(ref["wrc_plus"], r["wrc_plus"])
        if pr >= 0.85:
            return f"{r['wrc_plus']:.0f} wRC+ ({standing(pr)} of regulars): the higher the peak, the bigger the usual give-back"
        return None
    if f == "il_days":
        d = r["il_days"]
        if supports and d >= 15:
            return f"Already lost {int(d)} days to the IL in {LAST_SEASON}{il_note(r)}"
        if not supports and d == 0 and r["base_il_days"] == 0:
            return f"No IL time in {LAST_SEASON} or {yrs()}"
        return None
    if f == "base_il_days":
        d = r["base_il_days"]
        if supports and d >= 30:
            return f"{int(d)} days on the IL across {yrs()}: the health record is a risk"
        return None
    if f == "woba_plus" and supports:
        pr = pct_rank(ref["woba"], r["woba"])
        if pr >= 0.85:
            return f"{rate3(r['woba'])} wOBA ({standing(pr)} of regulars): the higher the peak, the bigger the usual give-back"
        return None
    if f == "xgap":
        g = r["xgap"]
        if supports and g >= 0.012:
            return f"{rate3(r['woba'])} wOBA ran {pts(g)} points ahead of his {rate3(r['xwoba'])} xwOBA"
        if not supports and g <= -0.005:
            return f"His {rate3(r['woba'])} wOBA actually trailed his {rate3(r['xwoba'])} xwOBA, so the line isn't inflated"
        return None
    if f in ("babip", "babip_gap"):
        b, base, gap = r["babip"], r.get("base_babip"), r.get("babip_gap")
        if pd.isna(b):
            return None
        if supports:
            if pd.notna(gap) and gap >= 0.020 and r["base_pa"] >= 300:
                return f"BABIP {rate3(b)}, {pts(gap)} points above his {yrs()} mark ({rate3(base)})"
            pr = pct_rank(ref["babip"], b)
            if pr >= 0.85 and (pd.isna(gap) or r["base_pa"] < 300):
                return f"BABIP {rate3(b)} ({standing(pr)} of regulars) with no long track record to back it"
        elif pd.notna(gap) and gap <= -0.010 and r["base_pa"] >= 300:
            return f"BABIP {rate3(b)} was below his {yrs()} norm ({rate3(base)}): no hit luck to give back"
        return None
    if f == "slg_gap":
        g = r["slg_gap"]
        if pd.isna(g):
            return None
        if supports and g >= 0.030:
            return f"SLG {rate3(r['slg'])} vs a {rate3(r['xslg_'])} xSLG: the power results outran the contact"
        if not supports and g <= -0.020:
            return f"SLG {rate3(r['slg'])} trailed his {rate3(r['xslg_'])} xSLG"
        return None
    if f == "jump":
        j = r["jump"]
        if pd.isna(j) or r["base_pa"] < 400:
            return None
        if supports and j >= 0.020:
            return f"Career year: {rate3(r['woba'])} wOBA vs {rate3(r['base_woba'])} over {yrs()} ({int(r['base_pa'])} PA)"
        if not supports and abs(j) <= 0.012 and r["base_pa"] >= 700:
            return f"Not a one-off: he hit {rate3(r['base_woba'])} over {int(r['base_pa'])} PA in {yrs()}"
        return None
    if f == "d_ev50":
        d = r["d_ev50"]
        if pd.isna(d):
            return None
        if supports and d <= -0.8:
            return f"EV50 down {abs(d):.1f} mph from {Y1} ({r['avg_best_speed']:.1f} mph)"
        if not supports and d >= 0.8:
            return f"EV50 up {d:.1f} mph from {Y1}: the gains look physical"
        return None
    if f == "d_sprint":
        d = r["d_sprint"]
        if supports and pd.notna(d) and d <= -0.4 and speed_player(r):
            return f"Lost {abs(d):.1f} ft/s of sprint speed since {Y1}"
        return None
    return skill_line(spec, f, r, ref, supports)


def hitter_bnc_line(spec: Spec, f: str, r: pd.Series, ref: pd.DataFrame, supports: bool) -> str | None:
    a = spec.rates
    age_next = int(r["player_age"]) + 1
    if f == "player_age":
        if supports and age_next <= a["youngCut"]:
            return (f"Only {age_next} in {NEXT}: {a['young'] * 100:.0f}% of bounceback candidates {a['youngCut']} or younger "
                    f"got back to form, vs {a['old'] * 100:.0f}% at {a['oldCut']}+")
        if not supports and age_next >= a["oldCut"]:
            return f"Turns {age_next} in {NEXT}: only {a['old'] * 100:.0f}% of hitters {a['oldCut']}+ in his spot got back to their old level"
        return None
    if f == "base_woba_plus":
        # The model treats a less elite baseline as an easier bar to get back to.
        if supports:
            return f"A reachable bar: back to the {rate3(r['base_woba'])} wOBA he posted over {int(r['base_pa'])} PA in {yrs()}"
        return f"A high bar: his {yrs()} level was a {rate3(r['base_woba'])} wOBA over {int(r['base_pa'])} PA"
    if f == "xdrop":
        d = r["xdrop"]
        if pd.isna(d):
            return None
        if supports and d >= -0.015:
            return f"xwOBA {rate3(r['xwoba'])} stayed close to his {yrs()} {rate3(r['base_xwoba'])}: the drop was mostly results"
        if not supports and d <= -0.030:
            return f"xwOBA fell too ({rate3(r['base_xwoba'])} → {rate3(r['xwoba'])}): the underlying skills slipped"
        return None
    if f == "xgap":
        g = r["xgap"]
        if supports and g <= -0.010:
            return f"His {rate3(r['woba'])} wOBA trailed his {rate3(r['xwoba'])} xwOBA by {pts(g)} points"
        if not supports and g >= 0.005:
            return f"Even his {rate3(r['woba'])} wOBA was above his {rate3(r['xwoba'])} xwOBA"
        return None
    if f == "babip_gap":
        g = r["babip_gap"]
        if pd.isna(g):
            return None
        if supports and g <= -0.020:
            return f"BABIP {rate3(r['babip'])}, {pts(g)} points under his {yrs()} mark ({rate3(r['base_babip'])})"
        if not supports and g >= 0.010:
            return f"BABIP wasn't the problem ({rate3(r['babip'])} vs {rate3(r['base_babip'])} in {yrs()})"
        return None
    if f == "slg_gap":
        g = r["slg_gap"]
        if supports and pd.notna(g) and g <= -0.030:
            return f"SLG {rate3(r['slg'])} trailed a {rate3(r['xslg_'])} xSLG"
        return None
    if f == "il_any":
        d = r["il_days"]
        if supports and d >= 15:
            return f"The down year came with {int(d)} days on the IL{il_note(r)}: hurt, not just in decline"
        if not supports and d == 0:
            return f"No IL time in {LAST_SEASON}: he slumped while healthy"
        return None
    if f == "pa_162":
        # Only worth a line when the playing time itself is the story.
        if not supports and r["pa"] < 350:
            if r["il_days"] >= 15:
                return f"Only {int(r['pa'])} PA in {LAST_SEASON} after {int(r['il_days'])} days on the IL{il_note(r)}"
            return f"Only {int(r['pa'])} PA in {LAST_SEASON} with no IL time: he lost at-bats, not health"
        return None
    if f == "d_ev50":
        d = r["d_ev50"]
        if not supports and pd.notna(d) and d <= -0.8:
            return f"EV50 down {abs(d):.1f} mph from {Y1}: possible loss of bat speed"
        return None
    if f == "d_k":
        return None
    if f == "d_sprint":
        d = r["d_sprint"]
        if not supports and pd.notna(d) and d <= -0.4 and speed_player(r):
            return f"Lost {abs(d):.1f} ft/s of sprint speed since {Y1}"
        return None
    if f == "jump":
        return None
    return skill_line(spec, f, r, ref, supports)


def pitcher_reg_line(spec: Spec, f: str, r: pd.Series, ref: pd.DataFrame, supports: bool) -> str | None:
    a = spec.rates
    age_next = int(r["player_age"]) + 1
    if f == "player_age":
        if supports and age_next >= a["oldCut"]:
            return f"Turns {age_next} in {NEXT}: {a['old'] * 100:.0f}% of pitchers {a['oldCut']}+ in his spot gave back a run or more"
        if not supports and age_next <= a["youngCut"]:
            return f"Only {age_next} in {NEXT}: young pitchers held their gains more often ({a['young'] * 100:.0f}% regressed)"
        return None
    if f == "era_minus_lg" and supports:
        pr = 1 - pct_rank(ref["p_era"], r["p_era"])
        if pr >= 0.85:
            return f"{r['p_era']:.2f} ERA ({standing(pr)} of pitchers): very hard to repeat"
        return None
    if f in ("era_xfip", "era_fip"):
        g = r[f]
        val = r["xfip"] if f == "era_xfip" else r["fip"]
        name = "xFIP" if f == "era_xfip" else "FIP"
        if pd.isna(g):
            return None
        if supports and g <= -0.40:
            hrfb, lg = r.get("hr_fb"), r.get("lg_hr_fb")
            if f == "era_xfip" and pd.notna(hrfb) and pd.notna(lg) and hrfb <= 0.75 * lg:
                return (f"{r['p_era']:.2f} ERA vs a {val:.2f} xFIP: only {hrfb * 100:.1f}% of his fly balls left the park "
                        f"(league {lg * 100:.1f}%)")
            if f == "era_xfip":
                return f"{r['p_era']:.2f} ERA was {abs(g):.2f} runs better than his {val:.2f} xFIP"
            return f"{r['p_era']:.2f} ERA vs a {val:.2f} FIP: his strikeouts, walks and homers point to more runs"
        if not supports and g >= -0.10:
            return f"His {r['p_era']:.2f} ERA is backed by a {val:.2f} {name}"
        return None
    if f == "egap":
        g = r["egap"]
        if pd.isna(g):
            return None
        if supports and g <= -0.40:
            return f"{r['p_era']:.2f} ERA was {abs(g):.2f} runs better than his {r['xera']:.2f} xERA"
        if not supports and g >= 0:
            return f"His {r['p_era']:.2f} ERA wasn't better than his {r['xera']:.2f} xERA"
        return None
    if f in ("babip", "babip_gap"):
        b, base, gap = r["babip"], r.get("base_babip"), r.get("babip_gap")
        if pd.isna(b):
            return None
        if supports:
            if pd.notna(gap) and gap <= -0.020 and r["base_ip"] >= 80:
                return f"BABIP allowed {rate3(b)}, {pts(gap)} points below his {yrs()} mark ({rate3(base)})"
            low = pct_rank(ref["babip"], b)
            if low <= 0.15:
                return f"BABIP allowed {rate3(b)}, lower than {100 - max(1, int(round(low * 100)))}% of pitchers"
        elif b >= 0.295:
            return f"BABIP allowed {rate3(b)}: no hit luck to give back"
        return None
    if f == "hr9":
        v = r["hr9"]
        if pd.isna(v):
            return None
        low = pct_rank(ref["hr9"], v)
        if supports and low <= 0.20:
            return f"Only {v:.2f} HR/9 (fewer than {100 - max(1, int(round(low * 100)))}% of pitchers) with a {r['barrel_batted_rate']:.1f}% barrel rate"
        if not supports and low >= 0.6:
            return f"Already allowing {v:.2f} HR/9, so no home-run luck to give back"
        return None
    if f == "slg_gap":
        g = r["slg_gap"]
        if supports and pd.notna(g) and g <= -0.030:
            return f"Allowed a {rate3(r['slg'])} SLG against a {rate3(r['xslg_'])} xSLG"
        return None
    if f == "d_velo":
        d = r["d_velo"]
        if pd.isna(d):
            return None
        if supports and d <= -0.7:
            return f"Fastball down {abs(d):.1f} mph from {Y1} ({r['fastball_avg_speed']:.1f} mph)"
        if not supports and d >= 0.7:
            return f"Fastball up {d:.1f} mph from {Y1}: a real stuff gain"
        return None
    if f == "d_kbb":
        d = r["d_kbb"]
        if pd.isna(d):
            return None
        if not supports and d >= 3:
            return f"K-BB% jumped {r['kbb_p1']:.1f}% → {r['kbb']:.1f}%: the skills improved, not just the results"
        if supports and d <= -2:
            return f"K-BB% fell {r['kbb_p1']:.1f}% → {r['kbb']:.1f}% even as the ERA dropped"
        return None
    if f == "reliever":
        if supports and r["reliever"] >= 1:
            return (f"Reliever ERAs swing hardest: {a['rp'] * 100:.0f}% of elite-ERA relievers gave back a run or more, "
                    f"vs {a['sp'] * 100:.0f}% of starters")
        return None
    if f == "era_jump":
        j = r["era_jump"]
        if pd.isna(j) or r["base_ip"] < 80:
            return None
        if supports and j <= -0.75:
            return f"Career year: {r['p_era']:.2f} ERA vs {r['base_p_era']:.2f} over {fmt_ip(r['base_ip'])} IP in {yrs()}"
        if not supports and abs(j) <= 0.35 and r["base_ip"] >= 150:
            return f"Not a one-off: {r['base_p_era']:.2f} ERA over {fmt_ip(r['base_ip'])} IP in {yrs()}"
        return None
    return skill_line(spec, f, r, ref, supports)


def pitcher_bnc_line(spec: Spec, f: str, r: pd.Series, ref: pd.DataFrame, supports: bool) -> str | None:
    a = spec.rates
    age_next = int(r["player_age"]) + 1
    if f == "player_age":
        if supports and age_next <= a["youngCut"]:
            return f"Only {age_next} in {NEXT}: {a['young'] * 100:.0f}% of bounceback candidates {a['youngCut']} or younger got back to form"
        if not supports and age_next >= a["oldCut"]:
            return f"Turns {age_next} in {NEXT}: only {a['old'] * 100:.0f}% of pitchers {a['oldCut']}+ in his spot got back to form"
        return None
    if f == "base_era_minus_lg":
        if supports:
            return f"A reachable bar: back to the {r['base_p_era']:.2f} ERA he posted over {fmt_ip(r['base_ip'])} IP in {yrs()}"
        return f"A high bar: his {yrs()} level was a {r['base_p_era']:.2f} ERA over {fmt_ip(r['base_ip'])} IP"
    if f == "xrise":
        d = r["xrise"]
        if pd.isna(d):
            return None
        if supports and d <= 0.5:
            return f"xERA {r['xera']:.2f} stayed near his {yrs()} {r['base_xera']:.2f} while the ERA rose to {r['p_era']:.2f}"
        if not supports and d >= 1.0:
            return f"xERA rose too ({r['base_xera']:.2f} → {r['xera']:.2f}): it wasn't just bad luck"
        return None
    if f == "egap":
        g = r["egap"]
        if pd.isna(g):
            return None
        if supports and g >= 0.50:
            return f"{r['p_era']:.2f} ERA was {g:.2f} runs worse than his {r['xera']:.2f} xERA"
        if not supports and g <= 0:
            return f"His {r['p_era']:.2f} ERA wasn't worse than his {r['xera']:.2f} xERA"
        return None
    if f == "babip_gap":
        g = r["babip_gap"]
        if pd.isna(g):
            return None
        if supports and g >= 0.020:
            return f"BABIP allowed {rate3(r['babip'])}, {pts(g)} points above his {yrs()} mark ({rate3(r['base_babip'])})"
        if not supports and g <= 0:
            return f"BABIP wasn't the problem ({rate3(r['babip'])}, vs {rate3(r['base_babip'])} in {yrs()})"
        return None
    if f == "hr9":
        v = r["hr9"]
        if pd.isna(v):
            return None
        hi = pct_rank(ref["hr9"], v)
        if supports and hi >= 0.80 and r["barrel_batted_rate"] < ref["barrel_batted_rate"].median() + 2:
            return f"{v:.2f} HR/9 (more than {int(round(hi * 100))}% of pitchers) on a {r['barrel_batted_rate']:.1f}% barrel rate"
        return None
    if f == "d_kbb":
        return None
    if f == "d_velo":
        d = r["d_velo"]
        if not supports and pd.notna(d) and d <= -0.8:
            return f"Fastball down {abs(d):.1f} mph from {Y1} ({r['fastball_avg_speed']:.1f} mph)"
        return None
    if f == "reliever":
        if supports and r["reliever"] >= 1 and a["rp"] - a["sp"] >= 0.05:
            return f"Reliever ERAs swing both ways: {a['rp'] * 100:.0f}% of relievers in his spot bounced back, vs {a['sp'] * 100:.0f}% of starters"
        return None
    if f == "d_whiff":
        d = r["d_whiff"]
        if pd.isna(d):
            return None
        if not supports and d <= -3:
            return f"Whiff rate down {abs(d):.1f} points to {r['whiff_percent']:.1f}%"
        return None
    if f == "ip_162":
        if not supports and r["ip"] < (80 if r["reliever"] < 1 else 40):
            if r["il_days"] >= 15:
                return f"Only {fmt_ip(r['ip'])} IP in {LAST_SEASON} after {int(r['il_days'])} days on the IL{il_note(r)}"
            return f"Only {fmt_ip(r['ip'])} IP in {LAST_SEASON} with no IL time: he lost the role, not health"
        return None
    if f in ("era_jump", "base_ip"):
        return None
    return skill_line(spec, f, r, ref, supports)


LINES = {
    ("hitter", "regression"): hitter_reg_line,
    ("hitter", "bounceback"): hitter_bnc_line,
    ("pitcher", "regression"): pitcher_reg_line,
    ("pitcher", "bounceback"): pitcher_bnc_line,
}
GROUPS = {"babip": "babip", "babip_gap": "babip", "xwoba_plus": "xw", "xdrop": "xw", "xgap": "gap",
          "egap": "gap", "woba_plus": "level", "wrc_plus": "level", "il_days": "il", "il_any": "il", "pa_162": "il", "era_fip": "fip", "era_xfip": "fip", "xrise": "xera", "xera_minus_lg": "xera", "d_kbb": "kbb", "kbb": "kbb"}


def explain(spec: Spec, model, r: pd.Series, ref: pd.DataFrame) -> tuple[list[str], str | None]:
    x = model.named_steps["impute"].transform(r[spec.features].to_frame().T.astype(float))
    contrib = model.named_steps["lr"].coef_[0] * model.named_steps["scale"].transform(x)[0]
    line = LINES[(spec.kind, spec.key)]
    drivers, used, age = [], set(), None
    for idx in np.argsort(-contrib):
        if contrib[idx] <= 0.02:
            break
        f = spec.features[idx]
        g = GROUPS.get(f, f)
        if g in used:
            continue
        text = line(spec, f, r, ref, True)
        if text and f == "player_age":
            age = text  # generic base rate: only if nothing more specific fills the slot
        elif text:
            drivers.append(text)
            used.add(g)
    drivers = (drivers + ([age] if age else []))[:3]
    against = None
    for idx in np.argsort(contrib):
        if contrib[idx] >= -0.02:
            break
        text = line(spec, spec.features[idx], r, ref, False)
        if text:
            against = text
            break
    return drivers, against


def find_comp(spec: Spec, model, r: pd.Series, hist: pd.DataFrame) -> pd.Series | None:
    pos = hist[hist["label"] & (hist["player_id"] != r["player_id"])]
    if pos.empty:
        return None
    imp, sc = model.named_steps["impute"], model.named_steps["scale"]
    w = np.abs(model.named_steps["lr"].coef_[0])
    zp = sc.transform(imp.transform(pos[spec.features].astype(float)))
    zr = sc.transform(imp.transform(r[spec.features].to_frame().T.astype(float)))[0]
    return pos.iloc[int(np.argmin(np.sqrt((((zp - zr) * w) ** 2).sum(axis=1))))]


def comp_payload(spec: Spec, c: pd.Series | None, people: dict) -> dict | None:
    if c is None:
        return None
    pid = int(c["player_id"])
    name = people.get(pid, {}).get("name") or name_from_lf(c["name_lf"])
    if spec.kind == "hitter":
        after = f"{rate3(c['woba_n'])} wOBA in {int(c['pa_n'])} PA"
        if spec.key == "regression":
            before = f"{rate3(c['woba'])} wOBA, {rate3(c['xwoba'])} xwOBA, {rate3(c['babip'])} BABIP in {int(c['pa'])} PA"
        else:
            before = f"{rate3(c['base_woba'])} wOBA the two years before, then {rate3(c['woba'])} ({rate3(c['xwoba'])} xwOBA)"
    else:
        after = f"{c['p_era_n']:.2f} ERA in {fmt_ip(c['ip_n'])} IP"
        if spec.key == "regression":
            before = f"{c['p_era']:.2f} ERA, {c['xera']:.2f} xERA, {c['kbb']:.1f}% K-BB in {fmt_ip(c['ip'])} IP"
        else:
            before = f"{c['base_p_era']:.2f} ERA the two years before, then {c['p_era']:.2f} ({c['xera']:.2f} xERA)"
    return {"playerId": pid, "name": name, "season": int(c["year"]), "before": before, "after": after}


def il_signals(r: pd.Series, drivers: list[str], against: str | None) -> list[str]:
    """IL context as a blue bullet when the drivers didn't already cover it."""
    if any("IL" in t for t in [*drivers, against or ""]):
        return []
    s = bb.il_signal(r, LAST_SEASON)
    return [s] if s else []


def half_signal(spec: Spec, pid: int) -> list[str]:
    group = "hitting" if spec.kind == "hitter" else "pitching"
    s = fetch_half_splits(pid, group, LAST_SEASON, refresh=bb.ARGS.refresh)
    pre, post = s.get("preas"), s.get("posas")
    if not pre or not post:
        return []
    if spec.kind == "hitter":
        if post.get("plateAppearances", 0) < 100 or pre.get("plateAppearances", 0) < 100:
            return []
        a, b = float(pre["ops"]), float(post["ops"])
        if spec.key == "regression" and a - b >= 0.080:
            return [f"Faded late: {post['ops']} OPS after the All-Star break vs {pre['ops']} before"]
        if spec.key == "bounceback" and b - a >= 0.080 and b >= 0.760:
            return [f"Finished strong: {post['ops']} OPS after the All-Star break vs {pre['ops']} before"]
        return []

    def ip(x: dict) -> float:
        return float(x.get("inningsPitched", "0") or 0)

    if ip(pre) < 20 or ip(post) < 20:
        return []
    a, b = float(pre.get("era", "0") or 0), float(post.get("era", "0") or 0)
    if spec.key == "regression" and b - a >= 1.0:
        return [f"Faded late: {b:.2f} ERA after the All-Star break vs {a:.2f} before"]
    if spec.key == "bounceback" and a - b >= 1.0 and b <= 4.0:
        return [f"Better after the break: {b:.2f} ERA vs {a:.2f} before"]
    return []


def bar_text(spec: Spec, r: pd.Series, lg: float) -> str:
    if spec.kind == "hitter" and spec.key == "regression":
        return (f"Regression = a wOBA around {rate3(r['woba'] - HIT_REG_DROP)} or lower in {NEXT} "
                f"({pts(HIT_REG_DROP)}+ points below {LAST_SEASON}) over {HIT_REG_NEXT_PA}+ PA.")
    if spec.kind == "hitter":
        target = lg + r["base_woba_plus"] - HIT_BNC_TOL
        return (f"Bounceback = about {rate3(target)}+ wOBA over {HIT_BNC_NEXT_PA}+ PA, back within "
                f"{pts(HIT_BNC_TOL)} points of his {yrs()} level. Was {rate3(r['woba'])} in {LAST_SEASON}.")
    if spec.key == "regression":
        return f"Regression = an ERA of about {r['p_era'] + PIT_REG_RISE:.2f} or higher in {NEXT} over {PIT_NEXT_IP}+ IP."
    target = lg + r["base_era_minus_lg"] + PIT_BNC_TOL
    return (f"Bounceback = an ERA of about {target:.2f} or better over {PIT_NEXT_IP}+ IP, within half a run of "
            f"his {yrs()} level. Was {r['p_era']:.2f} in {LAST_SEASON}.")


def stats_payload(kind: str, r: pd.Series) -> dict:
    if kind == "hitter":
        return {
            "pa": int(r["pa"]), "woba": fmt3(r["woba"]), "wrcPlus": int(round(r["wrc_plus"])) if pd.notna(r["wrc_plus"]) else None, "xwoba": fmt3(r["xwoba"]), "babip": fmt3(r["babip"]),
            "slg": fmt3(r["slg"]), "xslg": fmt3(r["xslg_"]), "barrelPct": fmt1(r["barrel_batted_rate"]),
            "ev50": fmt1(r["avg_best_speed"]), "kPct": fmt1(r["k_percent"]), "bbPct": fmt1(r["bb_percent"]),
            "hr": int(r["home_run"]),
            "baseWoba": fmt3(r["base_woba"]) if r["base_pa"] >= 100 else None, "basePa": int(r["base_pa"]),
        }
    return {
        "ip": fmt_ip(r["ip"]), "era": round(float(r["p_era"]), 2), "xera": fmt1x(r["xera"]),
        "babip": fmt3(r["babip"]), "hr9": fmt1x(r["hr9"]), "kbbPct": fmt1(r["kbb"]),
        "whiffPct": fmt1(r["whiff_percent"]), "fbVelo": fmt1(r["fastball_avg_speed"]), "k": int(r["strikeout"]),
        "fip": fmt1x(r["fip"]), "xfip": fmt1x(r["xfip"]),
        "baseEra": fmt1x(r["base_p_era"]) if r["base_ip"] >= 30 else None,
        "baseIp": fmt_ip(r["base_ip"]) if r["base_ip"] >= 30 else None,
    }


def fmt1x(x: float) -> float | None:
    return None if pd.isna(x) else round(float(x), 2)


# ---------------------------------------------------------------- main


def run_spec(spec: Spec, frame: pd.DataFrame):
    hist, cur = cohort_rows(spec, frame)
    spec.rates = age_rates(spec, hist)
    bt = backtest(hist, spec.features, spec.baselines, c=spec.c, first=spec.first, min_pos=spec.min_pos, ns=spec.ns)
    bt["topN"] = list(spec.ns)
    model = make_model(spec.c).fit(hist[spec.features], hist["label"])
    cur["prob"] = model.predict_proba(cur[spec.features])[:, 1]
    return bt, model, hist, cur.sort_values("prob", ascending=False).head(spec.top_n)


def payload(spec: Spec, model, hist: pd.DataFrame, top: pd.DataFrame, ref: pd.DataFrame, people: dict,
            comps: dict, lg: float) -> list[dict]:
    out = []
    for rank, (_, r) in enumerate(top.iterrows(), start=1):
        pid = int(r["player_id"])
        p = people.get(pid, {})
        drivers, against = explain(spec, model, r, ref)
        row = {
            "rank": rank, "playerId": pid, "name": p.get("name") or name_from_lf(r["name_lf"]),
            "teamId": p.get("teamId"), "age": int(r["player_age"]) + 1,
            "probability": round(float(r["prob"]), 3), "stats": stats_payload(spec.kind, r),
            "drivers": drivers, "signals": il_signals(r, drivers, against) + half_signal(spec, pid), "risk": against,
            "bar": bar_text(spec, r, lg), "comp": comp_payload(spec, comps[pid], people),
        }
        if spec.kind == "hitter":
            row.update({"position": p.get("position"), "bats": p.get("bats")})
        else:
            row.update({"role": "RP" if r["reliever"] >= 1 else "SP", "throws": p.get("throws")})
        out.append(row)
    return out


def main() -> None:
    all_h = bb.load_hitters()
    all_p = bb.load_pitchers()
    fh, fp = hitter_frame(all_h), pitcher_frame(all_p)
    ref_h = fh[(fh["year"] == LAST_SEASON) & (fh["pa"] >= 250)]
    ref_p = fp[(fp["year"] == LAST_SEASON) & (fp["ip"] >= 40)]
    lg_woba = float(all_h.loc[all_h["year"] == LAST_SEASON, "lg_woba"].iloc[0])
    lg_era = float(all_p.loc[all_p["year"] == LAST_SEASON, "lg_era"].iloc[0])

    specs = [(HIT_REG, fh, ref_h, lg_woba), (HIT_BNC, fh, ref_h, lg_woba),
             (PIT_REG, fp, ref_p, lg_era), (PIT_BNC, fp, ref_p, lg_era)]
    results = [(spec, frame, ref, lg, *run_spec(spec, frame)) for spec, frame, ref, lg in specs]

    comps: dict[tuple[str, str], dict[int, pd.Series | None]] = {}
    ids: set[int] = set()
    for spec, _, _, _, _, model, hist, top in results:
        cmap = {int(r["player_id"]): find_comp(spec, model, r, hist) for _, r in top.iterrows()}
        comps[(spec.kind, spec.key)] = cmap
        ids |= set(cmap) | {int(c["player_id"]) for c in cmap.values() if c is not None}
    people = fetch_people(sorted(ids))

    out: dict = {
        "season": NEXT,
        "basedOnSeason": LAST_SEASON,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": f"Baseball Savant (Statcast) leaderboards and MLB Stats API, {FIRST_SEASON}-{LAST_SEASON}",
        "definitions": {
            "regression": {
                "hitter": (f"wOBA drops {pts(HIT_REG_DROP)}+ points the next season (about 15-20 wRC+), "
                           f"among hitters who still get {HIT_REG_NEXT_PA}+ PA."),
                "pitcher": (f"ERA rises {PIT_REG_RISE:.0f}+ run vs. league the next season, among pitchers who still "
                            f"throw {PIT_NEXT_IP}+ IP."),
                "eligibility": (f"Hitters with {HIT_REG_PA}+ PA and a wOBA {pts(HIT_REG_WOBA)}+ points above league in "
                                f"{LAST_SEASON}. Starters with {PIT_REG_SP_IP}+ IP and an ERA {PIT_REG_SP_RUNS:.1f}+ "
                                f"below league, or relievers with {PIT_REG_RP_IP}+ IP and an ERA {PIT_REG_RP_RUNS:.0f}+ "
                                f"below league. The probability assumes he plays."),
            },
            "bounceback": {
                "hitter": (f"Back within {pts(HIT_BNC_TOL)} points of his two-year wOBA (league-adjusted) over "
                           f"{HIT_BNC_NEXT_PA}+ PA the next season. Not playing counts as no bounceback."),
                "pitcher": (f"ERA back within {PIT_BNC_TOL:.1f} runs of his two-year level (league-adjusted) over "
                            f"{PIT_NEXT_IP}+ IP the next season. Not pitching counts as no bounceback."),
                "eligibility": (f"Hitters with {HIT_BNC_BASE_PA}+ PA and an above-average wOBA across {yrs()} whose "
                                f"{LAST_SEASON} wOBA fell {pts(HIT_BNC_DROP)}+ points ({HIT_BNC_MIN_PA}+ PA, wRC+ {HIT_BNC_MAX_WRC} or lower). Pitchers "
                                f"with {PIT_BNC_BASE_IP}+ IP and a better-than-league ERA across {yrs()} whose "
                                f"{LAST_SEASON} ERA rose {PIT_BNC_RISE:.0f}+ run ({PIT_BNC_MIN_IP}+ IP)."),
            },
        },
        "backtest": {"regression": {}, "bounceback": {}},
        "regression": {},
        "bounceback": {},
    }
    for spec, _, ref, lg, bt, model, hist, top in results:
        side = "hitters" if spec.kind == "hitter" else "pitchers"
        out["backtest"][spec.key][side] = bt
        out[spec.key][side] = payload(spec, model, hist, top, ref, people, comps[(spec.kind, spec.key)], lg)
        print(f"{spec.key} {side}: cohort {len(top)} shown, backtest {json.dumps(bt['summary'])}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{NEXT}-turnarounds.json"
    path.write_text(json.dumps(out, indent=2, allow_nan=False) + "\n")
    print(f"wrote {path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="re-download the latest season")
    bb.ARGS = parser.parse_args()
    main()
