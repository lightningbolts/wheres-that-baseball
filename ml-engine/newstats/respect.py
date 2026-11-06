"""Respect Index: how much pitchers change their plan because of who is batting.

For every pitch we ask three questions the pitcher answers before the batter
does anything: is it in the zone, is it in the heart of the zone, is it a
fastball? We remove everything that isn't the batter -- count x platoon,
base/out state, score/inning, ballpark x batter hand, and the pitcher's own
tendencies vs that batter hand -- with additive fixed effects fit by alternating means. What's left,
averaged per batter, is how far pitchers deviate from their normal plan for him.

Raw avoidance mixes fear (don't let him hurt you) with exploitation (he'll chase
anyway). Respect+ is the avoidance that his chase and whiff rates don't explain.

Usage:
    venv/bin/python newstats/respect.py --season 2026 [--min-pa 200]
"""

from __future__ import annotations

import argparse

import numpy as np
import pandas as pd

from common import FASTBALLS, OUT, SKIP_PITCH_TYPES, WOBA_W, load_pitches, plus_scale, shrink_k, split_half

SWING_CODES = {"S", "W", "T", "F", "L", "M", "X", "D", "E"}
WHIFF_CODES = {"S", "W", "M"}
COMPONENTS = ["zone_avoid", "heart_avoid", "fb_avoid"]


def prep(df: pd.DataFrame) -> pd.DataFrame:
    d = df[~df.ptype.isin(SKIP_PITCH_TYPES) & df.px.notna() & df.pz.notna() & df.sz_top.notna()].copy()
    d = d[~d.event.isin({"intent_walk"})]
    in_zone = d.zone.between(1, 9)
    h = d.sz_top - d.sz_bot
    heart = (d.px.abs() < 0.56) & (d.pz > d.sz_bot + h / 6) & (d.pz < d.sz_top - h / 6)
    d["zone_avoid"] = (~in_zone).astype(float)
    d["heart_avoid"] = (~heart).astype(float)
    d["fb_avoid"] = (~d.ptype.isin(FASTBALLS)).astype(float)
    d["swing"] = d.call.isin(SWING_CODES)
    d["whiff"] = d.call.isin(WHIFF_CODES)
    d["ooz"] = ~in_zone
    # context keys
    d["k_count"] = d.balls.astype(str) + d.strikes.astype(str) + (d.b_hand == d.p_hand).map({True: "s", False: "o"})
    d["k_state"] = d.bases.astype(str) + "_" + d.outs.astype(str)
    d["k_game"] = d.score_diff.clip(-4, 4).astype(str) + "_" + pd.cut(d.inning, [0, 3, 6, 99], labels=["e", "m", "l"]).astype(str)
    d["k_pitcher"] = d.pitcher.astype(str) + d.b_hand
    # park x batter hand: short porches and big gaps change how hitters on each side get pitched
    d["k_park"] = d.venue.astype(str) + d.b_hand
    return d


CONTEXT_KEYS = ["k_count", "k_state", "k_game", "k_park"]


def fixed_effects(d: pd.DataFrame, y: str, iters: int = 10, target: str = "batter",
                  keys: list[str] | None = None) -> tuple[pd.Series, pd.Series]:
    """Return (residual without the target's effect, target effect) for outcome y.

    Default: batter is the target and the pitcher (x batter hand) is a nuisance key.
    """
    keys = keys if keys is not None else CONTEXT_KEYS + ["k_pitcher"]
    r = d[y] - d[y].mean()
    eff = {k: pd.Series(0.0, index=d.index) for k in keys + [target]}
    for _ in range(iters):
        for k in keys + [target]:
            others = sum(v for kk, v in eff.items() if kk != k)
            eff[k] = (r - others).groupby(d[k]).transform("mean")
    resid_no_target = r - sum(v for kk, v in eff.items() if kk != target)
    return resid_no_target, eff[target]


def batter_quality(df: pd.DataFrame) -> pd.DataFrame:
    pa = df[df["last"] & ~df.event.isin({"intent_walk", "catcher_interf", "sac_bunt"})]
    woba = pa.event.map(WOBA_W).fillna(0.0)
    return pd.DataFrame({"pa": pa.groupby("batter").size(), "woba": woba.groupby(pa.batter).mean(),
                         "hr_rate": (pa.event == "home_run").groupby(pa.batter).mean()})


def compute(season: str, min_pa: int, min_half_pitches: int = 300) -> tuple[pd.DataFrame, dict]:
    raw, names = load_pitches(season)
    d = prep(raw)
    print(f"{season}: {d.game_pk.nunique()} games, {len(d):,} pitches")

    rel, per_batter = {}, {}
    comp_std = []
    for c in COMPONENTS:
        resid, _ = fixed_effects(d, c)
        d[c + "_r"] = resid
        comp_std.append(resid / resid.std())
    d["respect_r"] = sum(comp_std) / len(comp_std)

    pg = d.groupby(["batter", "game_pk"]).agg(
        n=("respect_r", "size"), **{c: (c + "_r", "sum") for c in COMPONENTS}, respect=("respect_r", "sum")
    ).reset_index()
    for c in COMPONENTS + ["respect"]:
        r_half, r_full = split_half(pg, c, "n", min_w=min_half_pitches)
        rel[c] = dict(split_half_r=round(r_half, 3), full_season_r=round(r_full, 3))

    g = d.groupby("batter")
    out = pd.DataFrame({"pitches": g.size()})
    # reliability was measured on regulars; use their typical sample size
    n_mean = out.pitches[out.pitches >= out.pitches.quantile(0.75)].mean()
    for c in COMPONENTS + ["respect"]:
        mean = g[c + "_r"].mean()
        k = shrink_k(rel[c]["full_season_r"], n_mean)
        out[c] = mean * out.pitches / (out.pitches + k)
    out["chase"] = g.apply(lambda x: x.swing[x.ooz].mean(), include_groups=False)
    out["whiff"] = g.apply(lambda x: x.whiff[x.swing].sum() / max(1, x.swing.sum()), include_groups=False)
    out = out.join(batter_quality(raw))
    out["name"] = out.index.map(names)
    out["team_id"] = raw.sort_values("date").groupby("batter").bat_team.last()
    out = out[out.pa >= min_pa].copy()

    # Respect+ = avoidance not explained by how much he chases / whiffs
    X = np.column_stack([np.ones(len(out)), out.chase, out.whiff])
    beta, *_ = np.linalg.lstsq(X, out.respect.values, rcond=None)
    out["respect_adj"] = out.respect - X @ beta
    out["Respect+"] = plus_scale(out.respect_adj)
    out["Avoidance+"] = plus_scale(out.respect)
    out["Respect_pct"] = (out.respect_adj.rank(pct=True) * 100).round(0)
    for c in COMPONENTS:
        out[c + "_pp"] = (out[c] * 100).round(2)

    val = {
        "corr_avoidance_woba": round(out.respect.corr(out.woba), 3),
        "corr_respect_woba": round(out.respect_adj.corr(out.woba), 3),
        "corr_respect_hr_rate": round(out.respect_adj.corr(out.hr_rate), 3),
        "corr_avoidance_chase": round(out.respect.corr(out.chase), 3),
        "r2_chase_whiff": round(1 - out.respect_adj.var() / out.respect.var(), 3),
    }
    return out.sort_values("Respect+", ascending=False), {"reliability": rel, "validity": val}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2026")
    ap.add_argument("--min-pa", type=int, default=200)
    a = ap.parse_args()
    out, diag = compute(a.season, a.min_pa)
    OUT.mkdir(exist_ok=True)
    cols = ["name", "pa", "Respect+", "Respect_pct", "Avoidance+"] + [c + "_pp" for c in COMPONENTS] + ["chase", "whiff", "woba"]
    out[cols].round(3).to_csv(OUT / f"respect_{a.season}.csv")
    print(diag)
    print(out[cols].head(15).round(3).to_string())
    print(out[cols].tail(8).round(3).to_string())


if __name__ == "__main__":
    main()
