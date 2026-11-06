"""Short Memory: how well a hitter bounces back from an ugly plate appearance.

An "ugly" PA is a strikeout or weak contact (expected wOBA on contact < .100).
For each hitter we compare his NEXT plate appearance in the same game after an
ugly PA vs after any other PA, on two scales:

  * quality  -- PA value using expected wOBA on contact (EV/LA model), walks,
                HBP and strikeouts, adjusted for the pitcher faced
  * chase    -- chase rate in that next PA (pitch-level, many more samples)

Both are expressed relative to the league-average bounce-back so 100 = typical.
Within-hitter comparison removes talent and times-through-the-order effects.

Usage:
    venv/bin/python newstats/short_memory.py --season 2026 [--min-pa 200]
"""

from __future__ import annotations

import argparse

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from common import OUT, WOBA_W, load_pitches, plus_scale, shrink_k

SWING_CODES = {"S", "W", "T", "F", "L", "M", "X", "D", "E"}
SKIP_EVENTS = {"intent_walk", "catcher_interf", "sac_bunt", "sac_bunt_double_play"}
UGLY_XWOBA = 0.10


def pa_table(raw: pd.DataFrame) -> pd.DataFrame:
    pa = raw[raw["last"] & ~raw.event.isin(SKIP_EVENTS)].copy()
    pa["woba"] = pa.event.map(WOBA_W).fillna(0.0)
    bip = pa.ev.notna() & pa.la.notna() & (pa.call.isin({"X", "D", "E"}))
    m = HistGradientBoostingRegressor(max_iter=200, learning_rate=0.1)
    m.fit(pa.loc[bip, ["ev", "la"]], pa.loc[bip, "woba"])
    pa["xq"] = pa.woba
    pa.loc[bip, "xq"] = m.predict(pa.loc[bip, ["ev", "la"]])
    pa["ugly"] = (pa.event == "strikeout") | (bip & (pa.xq < UGLY_XWOBA))
    # pitcher adjustment (shrunk mean quality allowed)
    g = pa.groupby("pitcher").xq
    p_eff = (g.transform("sum") - pa.xq.mean() * g.transform("size")) / (g.transform("size") + 150)
    pa["xq_adj"] = pa.xq - p_eff

    # chase rate inside each PA
    ooz = raw[raw.zone.notna() & ~raw.zone.between(1, 9)]
    ch = ooz.assign(sw=ooz.call.isin(SWING_CODES)).groupby(["game_pk", "batter", "pa_seq"]).sw.agg(["sum", "size"])
    ch.columns = ["chase_sw", "chase_n"]
    pa = pa.merge(ch, left_on=["game_pk", "batter", "pa_seq"], right_index=True, how="left").fillna({"chase_sw": 0, "chase_n": 0})
    return pa.sort_values(["game_pk", "batter", "pa_seq"])


def pairs(pa: pd.DataFrame) -> pd.DataFrame:
    prev = pa[["game_pk", "batter", "pa_seq", "ugly"]].copy()
    prev["pa_seq"] += 1
    nxt = pa.merge(prev.rename(columns={"ugly": "prev_ugly"}), on=["game_pk", "batter", "pa_seq"])
    return nxt


def bounce(nx: pd.DataFrame) -> pd.DataFrame:
    """Per batter: after-ugly minus after-other, for quality and chase."""
    g = nx.groupby(["batter", "prev_ugly"])
    q = g.xq_adj.agg(["mean", "size"]).unstack("prev_ugly")
    c = g[["chase_sw", "chase_n"]].sum().unstack("prev_ugly")
    out = pd.DataFrame({
        "n_ugly": q["size"][True], "n_other": q["size"][False],
        "q_diff": q["mean"][True] - q["mean"][False],
        # positive = chases LESS after an ugly PA (good)
        "chase_diff": c["chase_sw"][False] / c["chase_n"][False] - c["chase_sw"][True] / c["chase_n"][True],
        "chase_n_ugly": c["chase_n"][True],
    })
    return out


def reliability(nx: pd.DataFrame, min_ugly: int) -> dict:
    halves = [bounce(nx[nx.game_pk % 2 == h]) for h in (0, 1)]
    j = halves[0].join(halves[1], lsuffix="_a", rsuffix="_b").dropna()
    j = j[(j.n_ugly_a >= min_ugly) & (j.n_ugly_b >= min_ugly)]
    res = {"batters": len(j)}
    for c in ["q_diff", "chase_diff"]:
        r = float(np.corrcoef(j[c + "_a"], j[c + "_b"])[0, 1])
        res[c] = dict(split_half_r=round(r, 3), full_season_r=round(2 * r / (1 + r) if r > 0 else r, 3))
    return res


def compute(season: str, min_pa: int) -> tuple[pd.DataFrame, dict]:
    raw, names = load_pitches(season)
    pa = pa_table(raw)
    nx = pairs(pa)
    league = {
        "pairs": len(nx),
        "ugly_share": round(pa.ugly.mean(), 3),
        "next_xq_after_ugly": round(nx.xq_adj[nx.prev_ugly].mean(), 4),
        "next_xq_after_other": round(nx.xq_adj[~nx.prev_ugly].mean(), 4),
        "next_chase_after_ugly": round(nx.chase_sw[nx.prev_ugly].sum() / nx.chase_n[nx.prev_ugly].sum(), 4),
        "next_chase_after_other": round(nx.chase_sw[~nx.prev_ugly].sum() / nx.chase_n[~nx.prev_ugly].sum(), 4),
    }
    rel = reliability(nx, min_ugly=25)
    out = bounce(nx)
    out["pa"] = pa.groupby("batter").size()
    out = out[out.pa >= min_pa].dropna().copy()
    for c, n in [("q_diff", "n_ugly"), ("chase_diff", "chase_n_ugly")]:
        centered = out[c] - out[c].mean()
        k = shrink_k(max(rel[c]["full_season_r"], 0.0), out[n].mean())
        out[c + "_shrunk"] = 0.0 if np.isinf(k) else centered * out[n] / (out[n] + k)
        out[c + "_raw_plus"] = plus_scale(out[c])
    # Headline: equal z-blend of the two raw (unshrunk) components, for display only
    out["ShortMemory+"] = plus_scale(
        (out.q_diff - out.q_diff.mean()) / out.q_diff.std() + (out.chase_diff - out.chase_diff.mean()) / out.chase_diff.std()
    )
    out["name"] = out.index.map(names)
    return out.sort_values("ShortMemory+", ascending=False), {"league": league, "reliability": rel}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2026")
    ap.add_argument("--min-pa", type=int, default=200)
    a = ap.parse_args()
    out, diag = compute(a.season, a.min_pa)
    OUT.mkdir(exist_ok=True)
    cols = ["name", "pa", "n_ugly", "ShortMemory+", "q_diff", "chase_diff", "q_diff_shrunk", "chase_diff_shrunk"]
    out[cols].round(4).to_csv(OUT / f"short_memory_{a.season}.csv")
    print(diag)
    print(out[cols].head(12).round(3).to_string())
    print(out[cols].tail(6).round(3).to_string())


if __name__ == "__main__":
    main()
