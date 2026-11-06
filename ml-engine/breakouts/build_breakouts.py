"""Build next-season breakout candidates for hitters and pitchers from Statcast data.

Pipeline
--------
1. Pull Baseball Savant season leaderboards, OAA and MLB awards (cached) for 2015..LAST_SEASON.
2. Mark every player-season where a player became "established" (an above-average regular
   season, a big partial season, 30 HR / 180 K, +10 OAA, elite relief work, or an All-Star /
   Gold Glove / Silver Slugger / ROY / All-MLB / Players Choice honor). Once established, a
   player is no longer a breakout candidate.
3. Build (season Y -> season Y+1) pairs for players not yet established after Y. The label is a
   true breakout in Y+1 (a ~120 wRC+ full season, 30 HR, a quality-starter / 200 K season, an
   elite relief season, or a major honor).
4. Walk-forward backtest: for each test season Y, train only on pairs whose outcome season is
   <= Y, score the Y cohort, and measure how many of the top-N broke out in Y+1. Compare with
   the public heuristics ("unlucky" xwOBA-wOBA / ERA-xERA gaps) and single-stat rankings.
5. Fit on all labeled pairs, score the LAST_SEASON cohort, drop anyone who already had a
   dominant half (pre/post All-Star split), and explain each pick with its model drivers,
   biggest risk, the closest historical comp who broke out, and Statcast detail.

Output: web/data/breakouts/<LAST_SEASON+1>.json

Usage: .venv/bin/python breakouts/build_breakouts.py [--refresh]
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mlbapi import (  # noqa: E402
    BREAKOUT_AWARDS,
    award_label,
    fetch_awards,
    fetch_half_splits,
    fetch_people,
)
from prospect_model import (  # noqa: E402
    FIRST_LIST,
    HIT_P_FEATURES,
    PIT_P_FEATURES,
    PROSPECT_C,
    explain_prospect,
    prospect_bar,
    prospect_frame,
    prospect_profile,
)
from savant import fetch_arsenal, fetch_bat_tracking, fetch_fip_inputs, fetch_oaa, fetch_season  # noqa: E402

FIRST_SEASON = 2015
LAST_SEASON = 2026
SHORT_SEASON_SCALE = {2020: 162 / 60}
OUT_DIR = Path(__file__).resolve().parents[2] / "web" / "data" / "breakouts"
TOP_N = 30
# Chosen by walk-forward backtest: L2 logistic regression on a focused feature set
# beat gradient boosting (all features) on AUC and precision@25 for both groups.
REG_C = 0.05


class _Args:
    refresh = False


ARGS = _Args()


def scale(year: int) -> float:
    return SHORT_SEASON_SCALE.get(year, 1.0)


# ---------------------------------------------------------------- definitions

HIT_MIN_PA = 100
HIT_MAX_AGE = 30
PIT_MIN_IP = 15
PIT_MAX_AGE = 31

# Breakout (label) bars
HIT_BREAKOUT_PA = 400
HIT_BREAKOUT_WOBA = 0.030  # above league ≈ 120 wRC+
SP_BREAKOUT_IP = 100
SP_BREAKOUT_RUNS = 0.60  # ERA/xERA average below league
RP_BREAKOUT_IP = 50
RP_BREAKOUT_KBB = 20.0
RP_BREAKOUT_RUNS = 1.00


def awards_by_season(awards: dict[int, list[tuple[str, int]]]) -> pd.DataFrame:
    rows = [(pid, season, aid) for pid, items in awards.items() for aid, season in items]
    df = pd.DataFrame(rows, columns=["player_id", "year", "award"])
    if df.empty:
        return pd.DataFrame(columns=["player_id", "year", "awards", "breakout_award"])
    grouped = df.groupby(["player_id", "year"])["award"].apply(list).reset_index(name="awards")
    grouped["breakout_award"] = grouped["awards"].apply(lambda xs: any(a in BREAKOUT_AWARDS or a == "RELIEVER" for a in xs))
    return grouped


def attach_awards(df: pd.DataFrame, aw: pd.DataFrame) -> pd.DataFrame:
    df = df.merge(aw, on=["player_id", "year"], how="left")
    df["awards"] = df["awards"].apply(lambda v: v if isinstance(v, list) else [])
    df["breakout_award"] = df["breakout_award"].fillna(False).astype(bool)
    return df


# ---------------------------------------------------------------- hitters


def load_hitters() -> pd.DataFrame:
    frames = []
    for year in range(FIRST_SEASON, LAST_SEASON + 1):
        refresh = ARGS.refresh and year == LAST_SEASON
        df = fetch_season("batter", year, refresh=refresh)
        lg = np.average(df["woba"].fillna(0), weights=df["pa"])
        lg_x = np.average(df["xwoba"].fillna(df["woba"]).fillna(0), weights=df["pa"])
        df["lg_woba"] = lg
        df["woba_plus"] = df["woba"] - lg
        df["xwoba_plus"] = df["xwoba"] - lg_x
        df["pa_162"] = df["pa"] * scale(year)
        df["hr_162"] = df["home_run"] * scale(year)
        if year >= 2016:
            df = df.merge(fetch_oaa(year, refresh=refresh), on=["player_id", "year"], how="left")
        else:
            df["outs_above_average"] = np.nan
        frames.append(df)
    all_h = pd.concat(frames, ignore_index=True)
    ids = all_h.loc[(all_h["player_age"] <= HIT_MAX_AGE + 1) & (all_h["pa"] >= 50), "player_id"].unique()
    awards, debuts = fetch_awards([int(i) for i in ids], refresh=ARGS.refresh)
    all_h = attach_awards(all_h, awards_by_season(awards))
    all_h["debut_year"] = all_h["player_id"].map(debuts)

    breakout_bat = (all_h["pa_162"] >= HIT_BREAKOUT_PA) & (all_h["woba_plus"] >= HIT_BREAKOUT_WOBA)
    all_h["breakout_season"] = breakout_bat | (all_h["hr_162"] >= 30) | all_h["breakout_award"]

    reasons = []
    for r in all_h.itertuples():
        why = []
        if r.pa_162 >= 450 and r.woba_plus >= 0.015:
            why.append(f"{int(r.pa)} PA of above-average offense (.{int(round(r.woba * 1000)):03d} wOBA)")
        elif r.pa_162 >= 250 and r.woba_plus >= 0.035:
            why.append(f".{int(round(r.woba * 1000)):03d} wOBA over {int(r.pa)} PA")
        if r.hr_162 >= 30:
            why.append(f"{int(r.home_run)} HR")
        if pd.notna(r.outs_above_average) and r.outs_above_average >= 10:
            why.append(f"+{int(r.outs_above_average)} OAA on defense")
        for aid in dict.fromkeys(r.awards):
            why.append(award_label(aid))
        reasons.append(why)
    all_h["established_why"] = reasons
    all_h["established_season"] = all_h["established_why"].apply(bool) | all_h["breakout_season"]
    return all_h


HIT_FEATURES = [
    "player_age", "pa_162", "career_pa", "xwoba_plus", "woba_plus", "avg_best_speed",
    "barrel_batted_rate", "k_percent", "bb_percent", "oz_swing_percent", "whiff_percent",
    "sweet_spot_percent", "pa_162_prev", "xwoba_plus_prev", "sprint_speed",
]


def hitter_features(all_h: pd.DataFrame) -> pd.DataFrame:
    cur = all_h.copy()
    prev = all_h[["player_id", "year", "pa_162", "woba_plus", "xwoba_plus", "xwoba",
                  "avg_best_speed", "k_percent"]].copy()
    prev["year"] += 1
    cur = cur.merge(prev, on=["player_id", "year"], how="left", suffixes=("", "_prev"))
    cur["xwoba_gap"] = cur["xwoba"] - cur["woba"]
    cur = cur.sort_values(["player_id", "year"])
    cur["established"] = cur.groupby("player_id")["established_season"].cummax()
    cur["mlb_seasons"] = cur.groupby("player_id").cumcount() + 1
    cur["career_pa"] = cur.groupby("player_id")["pa_162"].cumsum()
    return cur


def hitter_pairs(feat: pd.DataFrame, all_h: pd.DataFrame) -> pd.DataFrame:
    nxt = all_h[["player_id", "year", "breakout_season", "pa", "woba", "home_run"]].copy()
    nxt["year"] -= 1
    nxt = nxt.rename(columns={"breakout_season": "label", "pa": "pa_next", "woba": "woba_next",
                              "home_run": "hr_next"})
    eligible = feat[
        (feat["pa_162"] >= HIT_MIN_PA) & (feat["player_age"] <= HIT_MAX_AGE) & (~feat["established"])
    ].copy()
    pairs = eligible.merge(nxt, on=["player_id", "year"], how="left")
    pairs["label"] = pairs["label"].fillna(False).astype(bool)
    return pairs


# ---------------------------------------------------------------- pitchers


def fip_frame(year: int, *, refresh: bool = False) -> pd.DataFrame:
    """FIP and xFIP on the ERA scale, with that season's league constant and HR/FB rate."""
    f = fetch_fip_inputs(year, refresh=refresh)
    ip = f["f_p_out"] / 3
    fb = f["f_flyballs"].fillna(0) + f["f_popups"].fillna(0)
    bb = f["f_walk"].fillna(0) + f["f_p_hit_by_pitch"].fillna(0)
    k, hr = f["f_strikeout"].fillna(0), f["f_home_run"].fillna(0)
    lg_era = 9 * f["f_p_earned_run"].sum() / ip.sum()
    const = lg_era - (13 * hr.sum() + 3 * bb.sum() - 2 * k.sum()) / ip.sum()
    lg_hrfb = hr.sum() / fb.sum()
    ipn = ip.where(ip > 0)
    f["fip"] = (13 * hr + 3 * bb - 2 * k) / ipn + const
    f["xfip"] = (13 * fb * lg_hrfb + 3 * bb - 2 * k) / ipn + const
    f["hr_fb"] = hr / fb.where(fb > 0)
    f["lg_hr_fb"] = lg_hrfb
    return f[["player_id", "year", "fip", "xfip", "hr_fb", "lg_hr_fb"]]


def load_pitchers() -> pd.DataFrame:
    frames = []
    for year in range(FIRST_SEASON, LAST_SEASON + 1):
        df = fetch_season("pitcher", year, refresh=ARGS.refresh and year == LAST_SEASON)
        df = df[df["ip"] > 0].copy()
        lg_era = np.average(df["p_era"].fillna(0), weights=df["ip"])
        lg_xera = np.average(df["xera"].fillna(df["p_era"]).fillna(0), weights=df["ip"])
        df["lg_era"] = lg_era
        df["era_minus_lg"] = df["p_era"] - lg_era
        df["xera_minus_lg"] = df["xera"] - lg_xera
        df["runs_vs_lg"] = (df["era_minus_lg"] + df["xera_minus_lg"]) / 2
        df = df.merge(fip_frame(year, refresh=ARGS.refresh and year == LAST_SEASON), on=["player_id", "year"], how="left")
        df["fip_minus_lg"] = df["fip"] - lg_era
        df["xfip_minus_lg"] = df["xfip"] - lg_era
        df["ip_162"] = df["ip"] * scale(year)
        df["k_162"] = df["strikeout"] * scale(year)
        df["sv_162"] = df["p_save"].fillna(0) * scale(year)
        df["kbb"] = df["k_percent"] - df["bb_percent"]
        df["ip_per_g"] = df["ip"] / df["p_game"].replace(0, np.nan)
        df["starter_like"] = (df["ip_per_g"] >= 3.0).astype(float)
        frames.append(df)
    all_p = pd.concat(frames, ignore_index=True)
    ids = all_p.loc[(all_p["player_age"] <= PIT_MAX_AGE + 1) & (all_p["ip"] >= 10), "player_id"].unique()
    awards, debuts = fetch_awards([int(i) for i in ids], refresh=ARGS.refresh)
    all_p = attach_awards(all_p, awards_by_season(awards))
    all_p["debut_year"] = all_p["player_id"].map(debuts)

    sp = (all_p["ip_162"] >= SP_BREAKOUT_IP) & (all_p["runs_vs_lg"] <= -SP_BREAKOUT_RUNS)
    rp = (all_p["ip_162"] >= RP_BREAKOUT_IP) & (all_p["kbb"] >= RP_BREAKOUT_KBB) & (all_p["runs_vs_lg"] <= -RP_BREAKOUT_RUNS)
    all_p["breakout_season"] = sp | rp | (all_p["k_162"] >= 200) | all_p["breakout_award"]

    reasons = []
    for r in all_p.itertuples():
        why = []
        if r.ip_162 >= 140 and r.runs_vs_lg <= -0.15:
            why.append(f"{fmt_ip(r.ip)} IP with a {r.p_era:.2f} ERA")
        if r.k_162 >= 180:
            why.append(f"{int(r.strikeout)} strikeouts")
        if r.ip_162 >= 40 and r.ip_per_g < 2 and r.runs_vs_lg <= -0.9 and r.kbb >= 18:
            why.append(f"elite relief ({r.p_era:.2f} ERA, {r.kbb:.0f}% K-BB)")
        if r.sv_162 >= 20:
            why.append(f"{int(r.p_save)} saves")
        for aid in dict.fromkeys(r.awards):
            why.append(award_label(aid))
        reasons.append(why)
    all_p["established_why"] = reasons
    all_p["established_season"] = all_p["established_why"].apply(bool) | all_p["breakout_season"]
    return all_p


PIT_FEATURES = [
    "player_age", "ip_162", "career_ip", "ip_per_g", "kbb", "k_percent", "bb_percent",
    "whiff_percent", "xwoba", "xera_minus_lg", "era_minus_lg", "fastball_avg_speed",
    "fastball_avg_break_z_induced", "groundballs_percent", "oz_swing_percent", "ip_162_prev",
    "kbb_prev", "d_velo", "barrel_batted_rate", "in_zone_percent", "fip_minus_lg", "xfip_minus_lg",
]


def pitcher_features(all_p: pd.DataFrame) -> pd.DataFrame:
    cur = all_p.copy()
    prev = all_p[["player_id", "year", "ip_162", "kbb", "whiff_percent", "fastball_avg_speed"]].copy()
    prev["year"] += 1
    cur = cur.merge(prev, on=["player_id", "year"], how="left", suffixes=("", "_prev"))
    cur["era_xera_gap"] = cur["p_era"] - cur["xera"]
    cur["neg_xfip"] = -cur["xfip_minus_lg"]
    cur["d_velo"] = cur["fastball_avg_speed"] - cur["fastball_avg_speed_prev"]
    cur["d_kbb"] = cur["kbb"] - cur["kbb_prev"]
    cur = cur.sort_values(["player_id", "year"])
    cur["established"] = cur.groupby("player_id")["established_season"].cummax()
    cur["mlb_seasons"] = cur.groupby("player_id").cumcount() + 1
    cur["career_ip"] = cur.groupby("player_id")["ip_162"].cumsum()
    return cur


def pitcher_pairs(feat: pd.DataFrame, all_p: pd.DataFrame) -> pd.DataFrame:
    nxt = all_p[["player_id", "year", "breakout_season", "ip", "p_era", "strikeout", "p_save"]].copy()
    nxt["year"] -= 1
    nxt = nxt.rename(columns={"breakout_season": "label", "ip": "ip_next", "p_era": "era_next",
                              "strikeout": "k_next", "p_save": "sv_next"})
    eligible = feat[
        (feat["ip_162"] >= PIT_MIN_IP) & (feat["player_age"] <= PIT_MAX_AGE) & (~feat["established"])
    ].copy()
    pairs = eligible.merge(nxt, on=["player_id", "year"], how="left")
    pairs["label"] = pairs["label"].fillna(False).astype(bool)
    return pairs


# ---------------------------------------------------------------- modeling


def make_model(c: float = REG_C) -> Pipeline:
    return Pipeline([
        ("impute", SimpleImputer(strategy="median")),
        ("scale", StandardScaler()),
        ("lr", LogisticRegression(C=c, max_iter=5000)),
    ])


def fit_predict(train: pd.DataFrame, test: pd.DataFrame, features: list[str], c: float = REG_C) -> np.ndarray:
    model = make_model(c).fit(train[features], train["label"])
    return model.predict_proba(test[features])[:, 1]


def precision_at(scores: np.ndarray, labels: np.ndarray, n: int) -> float:
    order = np.argsort(-scores)[:n]
    return float(labels[order].mean())


def metric_set(labels: np.ndarray, scores: np.ndarray, ns: tuple[int, ...] = (10, 25, 50)) -> dict:
    out = {"auc": round(float(roc_auc_score(labels, scores)), 3)}
    for n in ns:
        out[f"p{n}"] = round(precision_at(scores, labels, n), 3)
    return out


def backtest(pairs: pd.DataFrame, features: list[str], baselines: dict[str, str], *,
             c: float = REG_C, first: int = 2019, min_pos: int = 30,
             ns: tuple[int, ...] = (10, 25, 50)) -> dict:
    rows = []
    for year in [y for y in range(first, LAST_SEASON) if y + 1 != 2020]:
        train = pairs[(pairs["year"] + 1 <= year) & (pairs["year"] + 1 != 2020)]
        test = pairs[pairs["year"] == year]
        if train["label"].sum() < min_pos or test["label"].sum() == 0:
            continue
        labels = test["label"].to_numpy()
        row = {
            "season": int(year),
            "outcomeSeason": int(year + 1),
            "cohort": int(len(test)),
            "breakouts": int(labels.sum()),
            "baseRate": round(float(labels.mean()), 4),
            "model": metric_set(labels, fit_predict(train, test, features, c), ns),
            "baselines": {},
        }
        for name, col in baselines.items():
            s = test[col]
            row["baselines"][name] = metric_set(labels, s.fillna(s.min()).to_numpy(), ns)
        rows.append(row)

    def mean_of(get) -> float:
        return round(float(np.mean([get(r) for r in rows])), 3)

    metrics = ("auc", *(f"p{n}" for n in ns))
    return {
        "seasons": rows,
        "summary": {
            "model": {m: mean_of(lambda r, m=m: r["model"][m]) for m in metrics},
            "baselines": {
                name: {m: mean_of(lambda r, m=m, n=name: r["baselines"][n][m]) for m in metrics}
                for name in baselines
            },
            "baseRate": round(float(np.mean([r["baseRate"] for r in rows])), 4),
        },
    }


# ---------------------------------------------------------------- explanation helpers


def none_or2(x: float) -> float | None:
    return None if pd.isna(x) else round(float(x), 2)


def fmt_ip(ip: float) -> str:
    """Decimal innings -> baseball notation (184.333 -> "184.1")."""
    outs = int(round(float(ip) * 3))
    whole, rem = divmod(outs, 3)
    return f"{whole}.{rem}" if rem else str(whole)


def rate3(x: float) -> str:
    return f".{int(round(x * 1000)):03d}" if x < 1 else f"{x:.3f}"


def standing(pct_good: float) -> str:
    """pct_good in [0,1], higher = better for the player."""
    if pct_good >= 0.5:
        top = max(1, int(round((1 - pct_good) * 100)))
        return f"top {top}%"
    return f"bottom {max(1, int(round(pct_good * 100)))}%"


def pct_rank(series: pd.Series, value: float) -> float:
    s = series.dropna()
    return float((s < value).mean()) if len(s) and pd.notna(value) else np.nan


# feature -> (label, formatter, higher_is_better)
HIT_TEXT = {
    "xwoba_plus": ("xwOBA", lambda r: rate3(r["xwoba"]), True),
    "woba_plus": ("wOBA", lambda r: rate3(r["woba"]), True),
    "avg_best_speed": ("EV50 (avg of hardest-hit half)", lambda r: f"{r['avg_best_speed']:.1f} mph", True),
    "barrel_batted_rate": ("barrel rate", lambda r: f"{r['barrel_batted_rate']:.1f}%", True),
    "k_percent": ("strikeout rate", lambda r: f"{r['k_percent']:.1f}%", False),
    "bb_percent": ("walk rate", lambda r: f"{r['bb_percent']:.1f}%", True),
    "oz_swing_percent": ("chase rate", lambda r: f"{r['oz_swing_percent']:.1f}%", False),
    "whiff_percent": ("whiff rate", lambda r: f"{r['whiff_percent']:.1f}%", False),
    "sweet_spot_percent": ("sweet-spot rate (8-32° launch)", lambda r: f"{r['sweet_spot_percent']:.1f}%", True),
    "sprint_speed": ("sprint speed", lambda r: f"{r['sprint_speed']:.1f} ft/s", True),
}
PIT_TEXT = {
    "kbb": ("K-BB%", lambda r: f"{r['kbb']:.1f}%", True),
    "k_percent": ("strikeout rate", lambda r: f"{r['k_percent']:.1f}%", True),
    "bb_percent": ("walk rate", lambda r: f"{r['bb_percent']:.1f}%", False),
    "whiff_percent": ("whiff rate", lambda r: f"{r['whiff_percent']:.1f}%", True),
    "xwoba": ("xwOBA allowed", lambda r: rate3(r["xwoba"]), False),
    "xera_minus_lg": ("xERA", lambda r: f"{r['xera']:.2f}", False),
    "era_minus_lg": ("ERA", lambda r: f"{r['p_era']:.2f}", False),
    "fip_minus_lg": ("FIP", lambda r: f"{r['fip']:.2f}", False),
    "xfip_minus_lg": ("xFIP", lambda r: f"{r['xfip']:.2f}", False),
    "fastball_avg_speed": ("fastball velo", lambda r: f"{r['fastball_avg_speed']:.1f} mph", True),
    "fastball_avg_break_z_induced": ("fastball ride (IVB)", lambda r: f"{r['fastball_avg_break_z_induced']:.1f} in", True),
    "groundballs_percent": ("ground-ball rate", lambda r: f"{r['groundballs_percent']:.1f}%", True),
    "oz_swing_percent": ("chase rate induced", lambda r: f"{r['oz_swing_percent']:.1f}%", True),
    "barrel_batted_rate": ("barrel rate allowed", lambda r: f"{r['barrel_batted_rate']:.1f}%", False),
    "in_zone_percent": ("zone rate", lambda r: f"{r['in_zone_percent']:.1f}%", True),
}


def cap(text: str) -> str:
    return text if text.startswith(("xw", "wOBA", "xERA", "xFIP")) or text[:2].isupper() else text[:1].upper() + text[1:]


SKILL_STAT_COL = {"xwoba_plus": "xwoba", "woba_plus": "woba", "xera_minus_lg": "xera", "era_minus_lg": "p_era",
                  "fip_minus_lg": "fip", "xfip_minus_lg": "xfip"}


def skill_sentence(feature: str, r: pd.Series, ref: pd.DataFrame, kind: str) -> tuple[str, float] | None:
    """('Barrel rate 13.5% (top 9% of regulars)', pct_good) for a Statcast skill feature."""
    text = HIT_TEXT if kind == "hitter" else PIT_TEXT
    if feature not in text:
        return None
    label, fmt, higher_better = text[feature]
    col = SKILL_STAT_COL.get(feature, feature)
    if pd.isna(r.get(col)):
        return None
    pr = pct_rank(ref[col], r[col])
    good = pr if higher_better else 1 - pr
    return f"{cap(label)} {fmt(r)} ({standing(good)} of regulars)", good


# Historical breakout rate by next-season age bucket, filled in by build_side().
AGE_RATES: dict[str, dict[str, float]] = {}


def context_sentence(feature: str, r: pd.Series, kind: str, season: int, positive: bool) -> str | None:
    """Age / role / trend drivers that are not raw skill stats."""
    age_next = int(r["player_age"]) + 1
    if feature == "player_age":
        rates = AGE_RATES.get(kind, {})
        who = "hitters" if kind == "hitter" else "pitchers"
        if positive and age_next <= 25 and rates:
            return (f"Only {age_next} in {season + 1}: {who} 25 or younger broke out {rates['young'] * 100:.0f}% of the time "
                    f"vs {rates['old'] * 100:.0f}% at 28+")
        if not positive and age_next >= 28 and rates:
            return f"Age {age_next} in {season + 1}: only {rates['old'] * 100:.0f}% of eligible {who} 28+ broke out"
        return None
    if kind == "hitter":
        if feature == "pa_162":
            if not positive and r["pa"] < 300:
                return f"Only {int(r['pa'])} PA in {season}: has to win an everyday job first"
            return None
        if feature == "career_pa" and not positive and r["career_pa"] >= 1200:
            return f"{int(r['career_pa'])} career PA without a breakout: the clock is ticking"
        if feature == "xwoba_plus_prev" and positive:
            prev = r.get("xwoba_prev")
            if pd.notna(prev) and (r["xwoba"] - prev) * 1000 >= 15:
                return f"xwOBA climbed {rate3(prev)} → {rate3(r['xwoba'])} from {season - 1} to {season}"
    else:
        if feature == "ip_162" and not positive and r["ip"] < 60:
            return f"Only {fmt_ip(r['ip'])} IP in {season}: needs a bigger role to get there"
        if feature == "ip_per_g" and not positive and r["ip_per_g"] < 1.5:
            return "One-inning relief role caps his innings and visibility"
        if feature == "kbb_prev" and positive:
            prev = r.get("kbb_prev")
            if pd.notna(prev) and r["kbb"] - prev >= 3:
                return f"K-BB% jumped {prev:.1f}% → {r['kbb']:.1f}% from {season - 1}"
        if feature == "d_velo":
            d = r.get("d_velo")
            if pd.notna(d) and positive and d >= 0.7:
                return f"Fastball up {d:.1f} mph from {season - 1} ({r['fastball_avg_speed']:.1f} mph)"
            if pd.notna(d) and not positive and d <= -0.7:
                return f"Fastball down {abs(d):.1f} mph from {season - 1}"
    return None


def explain(model: Pipeline, features: list[str], row: pd.Series, ref: pd.DataFrame, kind: str, season: int):
    """(drivers, risk) from per-feature logistic contributions.

    Drivers: skill stats that push the score up AND are genuinely above median, then
    age/trend context. Risk: the biggest negative contributor that is actually a weakness.
    """
    x = model.named_steps["impute"].transform(row[features].to_frame().T.astype(float))
    z = model.named_steps["scale"].transform(x)[0]
    contrib = model.named_steps["lr"].coef_[0] * z
    skills, context, used = [], [], set()
    for idx in np.argsort(-contrib):
        if contrib[idx] <= 0.03:
            break
        f = features[idx]
        group = "xwoba" if f in ("xwoba_plus", "woba_plus") else ("k" if f in ("k_percent", "kbb") else f)
        if group in used:
            continue
        sk = skill_sentence(f, row, ref, kind)
        if sk and sk[1] >= 0.6:
            skills.append(sk[0])
            used.add(group)
            continue
        ctx = context_sentence(f, row, kind, season, positive=True)
        if ctx:
            context.append(ctx)
            used.add(group)
    drivers = (skills + context)[:3]

    risk = None
    for idx in np.argsort(contrib):
        if contrib[idx] >= -0.03:
            break
        f = features[idx]
        sk = skill_sentence(f, row, ref, kind)
        if sk and sk[1] <= 0.4:
            risk = sk[0]
            break
        ctx = context_sentence(f, row, kind, season, positive=False)
        if ctx:
            risk = ctx
            break
    return drivers, risk


def find_comp(model: Pipeline, features: list[str], row: pd.Series, history: pd.DataFrame):
    """Nearest past player (by model-weighted Statcast profile) who broke out the next year."""
    pos = history[history["label"] & (history["player_id"] != row["player_id"])]
    if pos.empty:
        return None
    imp, sc = model.named_steps["impute"], model.named_steps["scale"]
    w = np.abs(model.named_steps["lr"].coef_[0])
    zp = sc.transform(imp.transform(pos[features].astype(float)))
    zr = sc.transform(imp.transform(row[features].to_frame().T.astype(float)))[0]
    d = np.sqrt((((zp - zr) * w) ** 2).sum(axis=1))
    return pos.iloc[int(np.argmin(d))]


def comp_payload(comp: pd.Series | None, kind: str, people: dict[int, dict]) -> dict | None:
    if comp is None:
        return None
    pid = int(comp["player_id"])
    name = people.get(pid, {}).get("name") or name_from_lf(comp["name_lf"])
    year = int(comp["year"])
    if kind == "hitter":
        before = f"{rate3(comp['xwoba'])} xwOBA, {comp['barrel_batted_rate']:.1f}% barrels in {int(comp['pa'])} PA"
        after = f"{rate3(comp['woba_next'])} wOBA, {int(comp['hr_next'])} HR in {int(comp['pa_next'])} PA"
    else:
        before = f"{comp['kbb']:.1f}% K-BB, {comp['xera']:.2f} xERA in {fmt_ip(comp['ip'])} IP"
        after = f"{comp['era_next']:.2f} ERA, {int(comp['k_next'])} K in {fmt_ip(comp['ip_next'])} IP"
    return {"playerId": pid, "name": name, "season": year, "before": before, "after": after}


def name_from_lf(name_lf: str) -> str:
    last, _, first = str(name_lf).partition(", ")
    return f"{first} {last}".strip()


def hitter_bar(r: pd.Series, lg_woba: float) -> str:
    target = lg_woba + HIT_BREAKOUT_WOBA
    gap = (target - r["woba"]) * 1000
    xgap = (target - r["xwoba"]) * 1000
    pa_note = "" if r["pa"] >= HIT_BREAKOUT_PA else f" and {HIT_BREAKOUT_PA}+ PA (had {int(r['pa'])})"
    if gap <= 0:
        return f"Already hit the {rate3(target)} wOBA bar in a part-time role; the step is doing it over a full season{pa_note}."
    if xgap <= 0:
        return f"Needs {rate3(target)} wOBA{pa_note}. His {rate3(r['xwoba'])} xwOBA already clears it, so the bar is {gap:.0f} pts of results, not skill."
    return f"Needs {rate3(target)} wOBA{pa_note}: {gap:.0f} pts above his {rate3(r['woba'])} ({xgap:.0f} above his xwOBA)."


def pitcher_bar(r: pd.Series, lg_era: float) -> str:
    target = lg_era - SP_BREAKOUT_RUNS
    if r["starter_like"] >= 1 or r["ip"] >= 90:
        ip_note = "" if r["ip"] >= SP_BREAKOUT_IP else f" across {SP_BREAKOUT_IP}+ IP (had {fmt_ip(r['ip'])})"
        return (f"Needs ERA and xERA around {target:.2f}{ip_note} or 200 K. "
                f"Was {r['p_era']:.2f} ERA / {r['xera']:.2f} xERA.")
    rp_target = lg_era - RP_BREAKOUT_RUNS
    return (f"Needs elite relief: ~{rp_target:.2f} ERA/xERA with {RP_BREAKOUT_KBB:.0f}%+ K-BB over "
            f"{RP_BREAKOUT_IP}+ IP, or a move into the rotation. Was {r['p_era']:.2f} / {r['xera']:.2f}, {r['kbb']:.1f}% K-BB.")


# ---------------------------------------------------------------- Statcast detail signals


def hitter_signals(r: pd.Series, bat: pd.DataFrame, season: int) -> list[str]:
    out: list[str] = []
    b = bat[bat["player_id"] == r["player_id"]]
    if not b.empty:
        b = b.iloc[0]
        for col, label, fmt in [
            ("avg_bat_speed", "Bat speed", lambda v: f"{v:.1f} mph"),
            ("blast_per_swing", "Blast rate", lambda v: f"{v * 100:.1f}% of swings"),
            ("squared_up_per_swing", "Squared-up rate", lambda v: f"{v * 100:.1f}% of swings"),
        ]:
            pr = pct_rank(bat[col], b[col])
            if pr >= 0.75:
                out.append(f"{label} {fmt(b[col])} ({standing(pr)} of MLB)")
    splits = fetch_half_splits(int(r["player_id"]), "hitting", season,
                               refresh=ARGS.refresh and season == LAST_SEASON)
    pre, post = splits.get("preas"), splits.get("posas")
    if pre and post and post.get("plateAppearances", 0) >= 120 and pre.get("plateAppearances", 0) >= 60:
        d = float(post["ops"]) - float(pre["ops"])
        if d >= 0.070 and float(post["ops"]) >= 0.800:
            out.append(f"Finished strong: {post['ops']} OPS after the All-Star break vs {pre['ops']} before")
    return out[:2]


def pitcher_signals(r: pd.Series, ars: pd.DataFrame, ars_prev: pd.DataFrame, season: int) -> list[str]:
    out: list[str] = []
    mine = ars[(ars["player_id"] == r["player_id"]) & (ars["pitch_usage"] >= 8)]
    if not mine.empty:
        best = mine.sort_values("whiff_percent", ascending=False).iloc[0]
        peers = ars[(ars["pitch_type"] == best["pitch_type"]) & (ars["pitches"] >= 150)]
        pr = pct_rank(peers["whiff_percent"], best["whiff_percent"])
        if pr >= 0.7:
            xw = f", {rate3(best['est_woba'])} xwOBA" if pd.notna(best.get("est_woba")) else ""
            out.append(f"Put-away pitch: {best['pitch_name']} ({best['pitch_usage']:.0f}% usage) gets {best['whiff_percent']:.0f}% whiffs{xw}, {standing(pr)} for the pitch type")
        prev = ars_prev[ars_prev["player_id"] == r["player_id"]]
        if prev["pitches"].sum() >= 400:
            prev_usage = dict(zip(prev["pitch_type"], prev["pitch_usage"]))
            for _, p in mine.sort_values("pitch_usage", ascending=False).iterrows():
                if prev_usage.get(p["pitch_type"], 0) < 3 and p["pitch_usage"] >= 10:
                    out.append(f"New weapon: added a {p['pitch_name'].lower()} in {season} ({p['pitch_usage']:.0f}% usage, {p['whiff_percent']:.0f}% whiffs)")
                    break
    splits = fetch_half_splits(int(r["player_id"]), "pitching", season,
                               refresh=ARGS.refresh and season == LAST_SEASON)
    pre, post = splits.get("preas"), splits.get("posas")
    if pre and post:
        def ip(s: dict) -> float:
            return float(s.get("inningsPitched", "0") or 0)
        def kp(s: dict) -> float:
            bf = s.get("battersFaced") or 0
            return 100 * s.get("strikeOuts", 0) / bf if bf else 0.0
        if ip(post) >= 25 and ip(pre) >= 15:
            era_pre, era_post = float(pre.get("era", "0") or 0), float(post.get("era", "0") or 0)
            if era_post <= 3.75 and (era_pre - era_post >= 1.0 or kp(post) - kp(pre) >= 5):
                out.append(f"Second-half jump: {era_post:.2f} ERA, {kp(post):.0f}% K after the break (vs {era_pre:.2f}, {kp(pre):.0f}% before)")
    return out[:2]


def dominant_half(player_id: int, kind: str, season: int) -> str | None:
    """Already broke out for half a season? (pre/post All-Star split)."""
    group = "hitting" if kind == "hitter" else "pitching"
    splits = fetch_half_splits(player_id, group, season, refresh=ARGS.refresh and season == LAST_SEASON)
    for code, label in (("preas", "first half"), ("posas", "second half")):
        s = splits.get(code)
        if not s:
            continue
        if kind == "hitter" and s.get("plateAppearances", 0) >= 250 and float(s.get("ops", "0") or 0) >= 0.850:
            return f"{s['ops']} OPS in the {label}"
        if kind == "pitcher":
            ip = float(s.get("inningsPitched", "0") or 0)
            if ip >= 80 and float(s.get("era", "9") or 9) <= 3.00:
                return f"{s['era']} ERA over {s['inningsPitched']} IP in the {label}"
    return None


# ---------------------------------------------------------------- main


def build_side(kind: str, all_df: pd.DataFrame, feat: pd.DataFrame, pairs: pd.DataFrame,
               features: list[str], baselines: dict[str, str]):
    # Train only on careers fully inside the Statcast era (debut 2015+), otherwise a veteran
    # who was established before 2015 would look like an unproven "candidate".
    labeled = pairs[
        (pairs["year"] < LAST_SEASON) & (pairs["year"] + 1 != 2020) & (pairs["debut_year"] >= FIRST_SEASON)
    ]
    bt = backtest(labeled, features, baselines)
    age_next = labeled["player_age"] + 1
    AGE_RATES[kind] = {
        "young": float(labeled.loc[age_next <= 25, "label"].mean()),
        "old": float(labeled.loc[age_next >= 28, "label"].mean()),
    }
    model = make_model().fit(labeled[features], labeled["label"])
    cohort = pairs[pairs["year"] == LAST_SEASON].copy()
    cohort["prob"] = model.predict_proba(cohort[features])[:, 1]
    cohort = cohort.sort_values("prob", ascending=False)

    picked, half_excluded = [], []
    for _, r in cohort.iterrows():
        if len(picked) >= TOP_N:
            break
        why = dominant_half(int(r["player_id"]), kind, LAST_SEASON)
        if why:
            half_excluded.append((int(r["player_id"]), r["name_lf"], [why]))
            continue
        picked.append(r)
    return bt, model, labeled, pd.DataFrame(picked), half_excluded


def recent_breakouts(feat: pd.DataFrame, half_excluded: list, people: dict, limit: int = 24) -> list[dict]:
    """Young players whose first 'established' season was LAST_SEASON: already broke out."""
    cur = feat[(feat["year"] == LAST_SEASON) & feat["established_season"]].copy()
    prior = feat[feat["year"] < LAST_SEASON].groupby("player_id")["established_season"].max()
    cur = cur[~cur["player_id"].map(prior).fillna(False).astype(bool)]
    cur = cur[cur["player_age"] <= HIT_MAX_AGE + 1]
    sort_col = "pa" if "pa_162" in cur.columns else "ip"
    cur = cur.assign(_n=cur["established_why"].apply(len)).sort_values(["_n", sort_col], ascending=False)
    out = []
    for r in cur.itertuples():
        out.append({"playerId": int(r.player_id), "name": people.get(int(r.player_id), {}).get("name") or name_from_lf(r.name_lf),
                    "why": list(r.established_why)})
    for pid, name_lf, why in half_excluded:
        out.append({"playerId": pid, "name": people.get(pid, {}).get("name") or name_from_lf(name_lf), "why": why})
    return out[:limit]


# ---------------------------------------------------------------- prospects

PROSPECT_TOP_N = 25


def build_prospects(kind: str, all_df: pd.DataFrame, feat: pd.DataFrame):
    """Backtest + score ranked prospects with little or no MLB time (see prospect_model.py).

    The newest Pipeline lists are live (graduates removed mid-season), so the LAST_SEASON list
    can't be used for training; it is only the analog of next spring's list for scoring.
    """
    min_mlb = HIT_MIN_PA if kind == "hitter" else PIT_MIN_IP
    features = HIT_P_FEATURES if kind == "hitter" else PIT_P_FEATURES
    c = PROSPECT_C[kind]
    hist = prospect_frame(kind, all_df, feat, range(FIRST_LIST, LAST_SEASON), min_mlb)
    hist = hist[hist["year"] != 2020].copy()
    hist["neg_rank"] = -hist["log_overall"]
    hist["neg_org"] = -hist["org_rank"]
    # backtest() pairs season-Y data with a Y+1 outcome; a list for season S uses S-1 stats.
    bt = backtest(hist.assign(year=hist["year"] - 1), features,
                  {"pipelineRank": "neg_rank", "orgRank": "neg_org"}, c=c, first=2017, min_pos=8)
    model = make_model(c).fit(hist[features], hist["label"])
    cohort = prospect_frame(kind, all_df, feat, range(LAST_SEASON + 1, LAST_SEASON + 2), min_mlb,
                             refresh=ARGS.refresh)
    cohort["prob"] = model.predict_proba(cohort[features])[:, 1]
    cohort = cohort.sort_values("prob", ascending=False).head(PROSPECT_TOP_N)
    return bt, model, hist, cohort


def prospect_comp(model: Pipeline, features: list[str], r: pd.Series, hist: pd.DataFrame,
                  all_df: pd.DataFrame, kind: str) -> dict | None:
    comp = find_comp(model, features, r, hist)
    if comp is None:
        return None
    season = int(comp["year"])
    line = all_df[(all_df["player_id"] == comp["player_id"]) & (all_df["year"] == season)]
    if line.empty:
        return None
    x = line.iloc[0]
    if kind == "hitter":
        after = f"{rate3(x['woba'])} wOBA, {int(x['home_run'])} HR in {int(x['pa'])} PA"
    else:
        after = f"{x['p_era']:.2f} ERA, {int(x['strikeout'])} K in {fmt_ip(x['ip'])} IP"
    return {"playerId": int(comp["player_id"]), "name": comp["name"], "season": season - 1,
            "before": prospect_profile(comp, kind), "after": after}


def prospect_payload(kind: str, cohort: pd.DataFrame, model: Pipeline, hist: pd.DataFrame,
                     all_df: pd.DataFrame, people: dict, lg_woba: float, lg_era: float) -> list[dict]:
    features = HIT_P_FEATURES if kind == "hitter" else PIT_P_FEATURES
    out = []
    for rank, (_, r) in enumerate(cohort.iterrows(), start=1):
        p = people.get(int(r["player_id"]), {})
        drivers, risk = explain_prospect(model, features, r, kind)
        milb: dict = {"season": int(r["stat_year"]), "levels": r.get("used_levels") or None}
        if kind == "hitter" and pd.notna(r.get("ops_raw")):
            milb.update({"pa": int(r["milb_volume"]), "ops": fmt3(r["ops_raw"]), "iso": fmt3(r["iso_raw"]),
                         "kPct": fmt1(r["k_pct_raw"]), "bbPct": fmt1(r["bb_pct_raw"]),
                         "hr": int(r.get("milb_hr") or 0), "sb": int(r.get("milb_sb") or 0)})
        elif kind == "pitcher" and pd.notna(r.get("kbb_raw")):
            milb.update({"ip": fmt_ip(r["milb_volume"]), "era": None if pd.isna(r["era_raw"]) else round(float(r["era_raw"]), 2),
                         "kPct": fmt1(r["k_pct_raw"]), "bbPct": fmt1(r["bb_pct_raw"]),
                         "kbbPct": fmt1(r["kbb_raw"]), "k": int(r.get("milb_k") or 0)})
        signals = []
        if r["mlb_prev"] > 0 and not any(d.startswith("Already got") for d in drivers):
            unit = "PA" if kind == "hitter" else "IP"
            val = int(r["mlb_prev"]) if kind == "hitter" else fmt_ip(r["mlb_prev"])
            signals.append(f"Debuted in {LAST_SEASON}: {val} MLB {unit} so far, still rookie-eligible")
        out.append({
            "rank": rank, "playerId": int(r["player_id"]), "name": p.get("name") or r["name"],
            "teamId": p.get("teamId"), "position": r["position"],
            "age": int(r["age"]) if pd.notna(r.get("age")) else None,
            "probability": round(float(r["prob"]), 3),
            "pipeline": {
                "overall": int(r["overall_rank"]) if pd.notna(r["overall_rank"]) else None,
                "org": int(r["org_rank"]) if r["org_rank"] <= 30 else None,
                "eta": int(r["eta"]) if pd.notna(r.get("eta")) else None,
                "fv": int(r["fv"]) if pd.notna(r.get("fv")) else None,
            },
            "milb": milb,
            "drivers": drivers, "signals": signals, "risk": risk,
            "bar": prospect_bar(r, kind, lg_woba, lg_era, HIT_BREAKOUT_PA, HIT_BREAKOUT_WOBA,
                                SP_BREAKOUT_IP, SP_BREAKOUT_RUNS),
            "comp": prospect_comp(model, features, r, hist, all_df, kind),
        })
    return out


def main() -> None:
    all_h = load_hitters()
    feat_h = hitter_features(all_h)
    pairs_h = hitter_pairs(feat_h, all_h)
    all_p = load_pitchers()
    feat_p = pitcher_features(all_p)
    pairs_p = pitcher_pairs(feat_p, all_p)

    bt_h, model_h, hist_h, top_h, half_h = build_side(
        "hitter", all_h, feat_h, pairs_h, HIT_FEATURES, {"xwobaGap": "xwoba_gap", "xwoba": "xwoba_plus"})
    bt_p, model_p, hist_p, top_p, half_p = build_side(
        "pitcher", all_p, feat_p, pairs_p, PIT_FEATURES, {"eraMinusXera": "era_xera_gap", "kbb": "kbb", "xfip": "neg_xfip"})

    pbt_h, pmodel_h, phist_h, pros_h = build_prospects("hitter", all_h, feat_h)
    pbt_p, pmodel_p, phist_p, pros_p = build_prospects("pitcher", all_p, feat_p)

    ref_h = feat_h[(feat_h["year"] == LAST_SEASON) & (feat_h["pa"] >= 250)]
    ref_p = feat_p[(feat_p["year"] == LAST_SEASON) & (feat_p["ip"] >= 40)]
    lg_woba = float(all_h.loc[all_h["year"] == LAST_SEASON, "lg_woba"].iloc[0])
    lg_era = float(all_p.loc[all_p["year"] == LAST_SEASON, "lg_era"].iloc[0])
    bat = fetch_bat_tracking(LAST_SEASON, refresh=ARGS.refresh)
    ars = fetch_arsenal(LAST_SEASON, refresh=ARGS.refresh)
    ars_prev = fetch_arsenal(LAST_SEASON - 1)

    recent_h_feat = feat_h[(feat_h["year"] == LAST_SEASON) & feat_h["established_season"]]
    recent_p_feat = feat_p[(feat_p["year"] == LAST_SEASON) & feat_p["established_season"]]
    ids = set(top_h["player_id"]) | set(top_p["player_id"]) | set(recent_h_feat["player_id"]) | set(recent_p_feat["player_id"])
    comps_h = {int(r["player_id"]): find_comp(model_h, HIT_FEATURES, r, hist_h) for _, r in top_h.iterrows()}
    comps_p = {int(r["player_id"]): find_comp(model_p, PIT_FEATURES, r, hist_p) for _, r in top_p.iterrows()}
    ids |= {int(c["player_id"]) for c in [*comps_h.values(), *comps_p.values()] if c is not None}
    ids |= set(pros_h["player_id"]) | set(pros_p["player_id"])
    people = fetch_people(sorted(int(i) for i in ids))

    def name_of(r: pd.Series) -> str:
        return people.get(int(r["player_id"]), {}).get("name") or name_from_lf(r["name_lf"])

    hitters = []
    for rank, (_, r) in enumerate(top_h.iterrows(), start=1):
        p = people.get(int(r["player_id"]), {})
        drivers, risk = explain(model_h, HIT_FEATURES, r, ref_h, "hitter", LAST_SEASON)
        hitters.append({
            "rank": rank, "playerId": int(r["player_id"]), "name": name_of(r), "teamId": p.get("teamId"),
            "position": p.get("position"), "bats": p.get("bats"), "age": int(r["player_age"]) + 1,
            "probability": round(float(r["prob"]), 3),
            "stats": {
                "pa": int(r["pa"]), "woba": fmt3(r["woba"]), "xwoba": fmt3(r["xwoba"]),
                "barrelPct": fmt1(r["barrel_batted_rate"]), "ev50": fmt1(r["avg_best_speed"]),
                "kPct": fmt1(r["k_percent"]), "bbPct": fmt1(r["bb_percent"]),
                "chasePct": fmt1(r["oz_swing_percent"]), "hr": int(r["home_run"]),
            },
            "drivers": drivers, "signals": hitter_signals(r, bat, LAST_SEASON), "risk": risk,
            "bar": hitter_bar(r, lg_woba), "comp": comp_payload(comps_h[int(r["player_id"])], "hitter", people),
        })

    pitchers = []
    for rank, (_, r) in enumerate(top_p.iterrows(), start=1):
        p = people.get(int(r["player_id"]), {})
        drivers, risk = explain(model_p, PIT_FEATURES, r, ref_p, "pitcher", LAST_SEASON)
        pitchers.append({
            "rank": rank, "playerId": int(r["player_id"]), "name": name_of(r), "teamId": p.get("teamId"),
            "role": "SP" if r["starter_like"] >= 1 else ("SP/RP" if r["ip"] >= 90 else "RP"),
            "throws": p.get("throws"), "age": int(r["player_age"]) + 1,
            "probability": round(float(r["prob"]), 3),
            "stats": {
                "ip": fmt_ip(r["ip"]), "era": round(float(r["p_era"]), 2), "xera": round(float(r["xera"]), 2),
                "fip": none_or2(r["fip"]), "xfip": none_or2(r["xfip"]),
                "kPct": fmt1(r["k_percent"]), "bbPct": fmt1(r["bb_percent"]), "kbbPct": fmt1(r["kbb"]),
                "whiffPct": fmt1(r["whiff_percent"]), "xwoba": fmt3(r["xwoba"]),
                "fbVelo": fmt1(r["fastball_avg_speed"]), "fbIvb": fmt1(r["fastball_avg_break_z_induced"]),
                "k": int(r["strikeout"]),
            },
            "drivers": drivers, "signals": pitcher_signals(r, ars, ars_prev, LAST_SEASON), "risk": risk,
            "bar": pitcher_bar(r, lg_era), "comp": comp_payload(comps_p[int(r["player_id"])], "pitcher", people),
        })

    prospects = {
        "hitters": prospect_payload("hitter", pros_h, pmodel_h, phist_h, all_h, people, lg_woba, lg_era),
        "pitchers": prospect_payload("pitcher", pros_p, pmodel_p, phist_p, all_p, people, lg_woba, lg_era),
    }

    out = {
        "season": LAST_SEASON + 1,
        "basedOnSeason": LAST_SEASON,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": (f"Baseball Savant (Statcast) leaderboards, MLB Stats API awards and minor-league stats, "
                   f"and MLB Pipeline prospect rankings, {FIRST_SEASON}-{LAST_SEASON}"),
        "definitions": {
            "hitter": (
                f"A first true breakout season: {HIT_BREAKOUT_PA}+ PA with wOBA {int(HIT_BREAKOUT_WOBA * 1000)}+ points above "
                "league (about 120 wRC+), 30 HR, or an All-Star / Silver Slugger / ROY-level honor."
            ),
            "pitcher": (
                f"A first true breakout season: {SP_BREAKOUT_IP}+ IP with ERA and xERA {SP_BREAKOUT_RUNS:.1f}+ runs better than "
                f"league, 200 K, an elite relief season ({RP_BREAKOUT_IP}+ IP, {RP_BREAKOUT_KBB:.0f}%+ K-BB), or an "
                "All-Star / Cy Young / ROY-level honor."
            ),
            "eligibility": (
                "Excludes anyone who has already broken out: an above-average full season, a big partial season, "
                "30 HR, 180 K, +10 OAA, elite relief work or 20 saves, a dominant half, or an All-Star, Gold Glove, "
                f"Silver Slugger, ROY or Players Choice honor. Hitters {HIT_MAX_AGE} or younger, pitchers {PIT_MAX_AGE} or younger."
            ),
            "prospects": (
                f"Ranked MLB Pipeline prospects (Top 100 or an org Top 30) with under {HIT_MIN_PA} MLB PA / "
                f"{PIT_MIN_IP} MLB IP in {LAST_SEASON}. Same breakout bar, in their first real MLB season."
            ),
        },
        "backtest": {"hitters": bt_h, "pitchers": bt_p,
                     "prospectHitters": pbt_h, "prospectPitchers": pbt_p},
        "prospects": prospects,
        "alreadyBrokeOut": {
            "hitters": recent_breakouts(feat_h, half_h, people),
            "pitchers": recent_breakouts(feat_p, half_p, people),
        },
        "hitters": hitters,
        "pitchers": pitchers,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{LAST_SEASON + 1}.json"
    path.write_text(json.dumps(out, indent=2, allow_nan=False) + "\n")
    print(f"wrote {path}")
    print("hitters backtest:", json.dumps(bt_h["summary"]))
    print("pitchers backtest:", json.dumps(bt_p["summary"]))
    print("prospect hitters backtest:", json.dumps(pbt_h["summary"]))
    print("prospect pitchers backtest:", json.dumps(pbt_p["summary"]))


def fmt3(x: float) -> float | None:
    return None if pd.isna(x) else round(float(x), 3)


def fmt1(x: float) -> float | None:
    return None if pd.isna(x) else round(float(x), 1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="re-download the latest season")
    ARGS = parser.parse_args()
    main()
