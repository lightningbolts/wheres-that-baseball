"""Attack+: the pitcher-side mirror of Respect+.

Attack+ is how often a pitcher challenges hitters (strikes, pitches in the
heart of the zone) compared with what the count, base/out state, score,
ballpark and the specific hitter (x pitcher hand) would predict. Fastball share
is left out: for a pitcher it mostly measures his arsenal, not his intent.

We also tried a "pitch-around" score (how much more than the league a pitcher
shies away from dangerous hitters). Its full-season reliability was ~0.23 in
2026, so it is computed here for research but not published.

Usage:
    venv/bin/python newstats/attack.py --season 2026 [--min-pitches 1000]
"""

from __future__ import annotations

import argparse

import numpy as np
import pandas as pd

from common import OUT, load_pitches, plus_scale, shrink_k, split_half
from respect import CONTEXT_KEYS, fixed_effects, prep

ATTACK = ["zone_attack", "heart_attack"]


def _slope_rel(d: pd.DataFrame, min_x2: float) -> tuple[float, float]:
    """Split-half reliability of each pitcher's pitch-around slope."""
    g = d.assign(half=d.game_pk % 2).groupby(["pitcher", "half"])[["xy", "x2"]].sum().unstack("half")
    g = g[(g.x2[0] >= min_x2) & (g.x2[1] >= min_x2)]
    r = float(np.corrcoef(g.xy[0] / g.x2[0], g.xy[1] / g.x2[1])[0, 1])
    return r, (2 * r / (1 + r)) if r > 0 else r


def compute(season: str, min_pitches: int, min_half_pitches: int = 400) -> tuple[pd.DataFrame, dict]:
    raw, _ = load_pitches(season)
    names = pitcher_names(season)
    d = prep(raw)
    d["zone_attack"] = 1 - d.zone_avoid
    d["heart_attack"] = 1 - d.heart_avoid
    d["k_batter"] = d.batter.astype(str) + d.p_hand
    print(f"{season}: {d.game_pk.nunique()} games, {len(d):,} pitches, {d.pitcher.nunique()} pitchers")

    # 1) level: pitcher effect with hitter identity as a nuisance key
    std = []
    for c in ATTACK:
        resid, _ = fixed_effects(d, c, target="pitcher", keys=CONTEXT_KEYS + ["k_batter"])
        d[c + "_r"] = resid
        std.append(resid / resid.std())
    d["attack_r"] = sum(std) / len(std)

    # 2) pitch-around: hitter's league respect effect vs this pitcher's avoidance beyond his own norm
    comp = []
    for c in ["zone_avoid", "heart_avoid", "fb_avoid"]:
        _, beff = fixed_effects(d, c)
        comp.append(beff / beff.std())
    d["x"] = sum(comp) / len(comp)
    d["x"] -= d.x.mean()
    avoid = []
    for c in ["zone_avoid", "heart_avoid", "fb_avoid"]:
        r = d[c] - d[c].mean()
        # remove context + this pitcher's own level (vs that hand), keep hitter-driven variation
        ctx, _ = fixed_effects(d.assign(_y=r), "_y", target="k_pitcher", keys=CONTEXT_KEYS)
        avoid.append(ctx / ctx.std())
    d["y"] = sum(avoid) / len(avoid)
    d["xy"], d["x2"] = d.x * d.y, d.x ** 2
    league_slope = d.xy.sum() / d.x2.sum()

    pg = d.rename(columns={"batter": "_b", "pitcher": "batter"}).groupby(["batter", "game_pk"]).agg(
        n=("attack_r", "size"), attack=("attack_r", "sum"), **{c: (c + "_r", "sum") for c in ATTACK}).reset_index()
    rel = {}
    for c in ATTACK + ["attack"]:
        h, f = split_half(pg, c, "n", min_w=min_half_pitches)
        rel[c] = dict(split_half_r=round(h, 3), full_season_r=round(f, 3))
    x2_half = d.groupby("pitcher").x2.sum().quantile(0.75) / 2 * 0.5
    h, f = _slope_rel(d, x2_half)
    rel["pitch_around"] = dict(split_half_r=round(h, 3), full_season_r=round(f, 3))

    g = d.groupby("pitcher")
    out = pd.DataFrame({"pitches": g.size(), "bf": g["last"].sum()})
    n_mean = out.pitches[out.pitches >= out.pitches.quantile(0.75)].mean()
    for c in ATTACK + ["attack"]:
        k = shrink_k(rel[c]["full_season_r"], n_mean)
        out[c] = g[c + "_r"].mean() * out.pitches / (out.pitches + k)
    x2 = g.x2.sum()
    kx = shrink_k(rel["pitch_around"]["full_season_r"], x2[out.pitches >= out.pitches.quantile(0.75)].mean())
    # shrink each pitcher's slope toward the league slope
    out["slope"] = (g.xy.sum() + kx * league_slope) / (x2 + kx) if np.isfinite(kx) else league_slope
    out["zone_pct"] = g.zone_attack.mean()
    out["fb_pct"] = 1 - g.fb_avoid.mean()
    pa = d[d["last"]]
    out["k_pct"] = pa.event.isin({"strikeout", "strikeout_double_play"}).groupby(pa.pitcher).mean()
    out["bb_pct"] = pa.event.isin({"walk"}).groupby(pa.pitcher).mean()
    out["name"] = out.index.map(names)
    out["team_id"] = fielding_team(raw)
    out = out[out.pitches >= min_pitches].copy()
    out["Attack+"] = plus_scale(out.attack)
    out["Attack_pct"] = (out.attack.rank(pct=True) * 100).round(0)
    out["PitchAround+"] = (100 * out.slope / league_slope).round(0)
    for c in ATTACK:
        out[c + "_pp"] = (out[c] * 100).round(2)
    val = {
        "corr_attack_bb": round(out.attack.corr(out.bb_pct), 3),
        "corr_attack_k": round(out.attack.corr(out.k_pct), 3),
        "corr_attack_zone_raw": round(out.attack.corr(out.zone_pct), 3),
        "corr_attack_pitcharound": round(out.attack.corr(out.slope), 3),
        "league_slope": round(float(league_slope), 3),
    }
    return out.sort_values("Attack+", ascending=False), {"reliability": rel, "validity": val}


def fielding_team(raw: pd.DataFrame) -> pd.Series:
    """Each pitcher's most recent team (the side not batting when he pitched)."""
    away = raw[raw.top].groupby("game_pk").bat_team.first()
    home = raw[~raw.top].groupby("game_pk").bat_team.first()
    r = raw[["game_pk", "date", "pitcher", "top"]].drop_duplicates(["game_pk", "pitcher"])
    r = r.assign(team=np.where(r.top, r.game_pk.map(home), r.game_pk.map(away)))
    return r.sort_values("date").groupby("pitcher").team.last()


def pitcher_names(season: str) -> dict[int, str]:
    import glob, json
    from common import DATA
    cache = DATA / f"newstats_pitcher_names_{season}.json"
    if cache.exists():
        return {int(k): v for k, v in json.load(open(cache)).items()}
    names = {}
    for f in glob.glob(str(DATA / "mlb_feeds" / "*.json")):
        gd = json.load(open(f))
        if gd["gameData"]["game"]["season"] != season:
            continue
        for p in gd["liveData"]["plays"]["allPlays"]:
            m = p["matchup"]["pitcher"]
            names[m["id"]] = m["fullName"]
    json.dump({str(k): v for k, v in names.items()}, open(cache, "w"))
    return names


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2026")
    ap.add_argument("--min-pitches", type=int, default=1000)
    a = ap.parse_args()
    out, diag = compute(a.season, a.min_pitches)
    OUT.mkdir(exist_ok=True)
    cols = ["name", "pitches", "Attack+", "PitchAround+", "zone_pct", "fb_pct", "k_pct", "bb_pct"]
    out[cols].round(3).to_csv(OUT / f"attack_{a.season}.csv")
    print(diag)
    print(out[cols].head(15).round(3).to_string())
    print(out[cols].tail(10).round(3).to_string())
    print(out.sort_values("PitchAround+")[cols].iloc[list(range(6)) + list(range(-6, 0))].round(3).to_string())


if __name__ == "__main__":
    main()
