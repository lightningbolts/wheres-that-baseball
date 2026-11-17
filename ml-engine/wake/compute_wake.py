"""Wake: how much worse a pitcher is after facing a given hitter.

For every plate appearance we look at the same pitcher's next N pitches in the
same game and ask whether his velocity, zone rate and called+swinging strike
rate (CSW) fell below what we'd expect had an average-length PA happened
instead. A hitter's Wake is the average of that "damage" across his PAs,
reliability-weighted, shrunk toward the mean and scaled so 100 = average.

Usage:
    .venv/bin/python wake/compute_wake.py --season 2026 [--window 15] [--min-pa 250]
"""

from __future__ import annotations

import argparse
import glob
import json
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parent.parent / "data"
OUT = Path(__file__).resolve().parent / "output"

CSW_CODES = {"C", "S", "W", "T", "M", "Q"}
ON_BASE = {"single", "double", "triple", "home_run", "walk", "intent_walk", "hit_by_pitch"}
SKIP_PITCH_TYPES = {"PO", "IN", "EP", "AB", "NP", "UN", None}


def load_pitches(season: str) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    rows, pas, names = [], [], {}
    for f in sorted(glob.glob(str(DATA / "mlb_feeds" / "*.json"))):
        feed = json.load(open(f))
        gd = feed["gameData"]
        if gd["game"]["season"] != season or gd["game"]["type"] != "R":
            continue
        gpk = feed["gamePk"]
        teams = {"top": gd["teams"]["away"]["abbreviation"], "bottom": gd["teams"]["home"]["abbreviation"]}
        slot: dict[int, int] = {}
        for side in ("away", "home"):
            for pl in feed["liveData"]["boxscore"]["teams"][side]["players"].values():
                if pl.get("battingOrder"):
                    slot[pl["person"]["id"]] = int(pl["battingOrder"]) // 100
        pc: dict[int, int] = {}  # pitcher -> cumulative pitches this game
        last_half: dict[int, tuple] = {}
        inn_pos: dict[int, int] = {}
        for play in feed["liveData"]["plays"]["allPlays"]:
            if play.get("result", {}).get("type") != "atBat":
                continue
            m, ab = play["matchup"], play["about"]
            b, p = m["batter"]["id"], m["pitcher"]["id"]
            names[b] = m["batter"]["fullName"]
            half = (ab["inning"], ab["halfInning"])
            if last_half.get(p) != half:
                inn_pos[p] = 0
                last_half[p] = half
            start_pc = pc.get(p, 0)
            n_pitches = 0
            for e in play["playEvents"]:
                if not e.get("isPitch"):
                    continue
                pc[p] = pc.get(p, 0) + 1
                inn_pos[p] += 1
                n_pitches += 1
                det, pdat = e.get("details", {}), e.get("pitchData", {})
                pt = (det.get("type") or {}).get("code")
                rows.append(
                    dict(
                        game_pk=gpk,
                        ab_idx=ab["atBatIndex"],
                        pitcher=p,
                        batter=b,
                        pc=pc[p],
                        inn_pos=inn_pos[p],
                        ptype=pt,
                        speed=pdat.get("startSpeed"),
                        zone=pdat.get("zone"),
                        call=(det.get("call") or {}).get("code"),
                    )
                )
            pas.append(
                dict(
                    game_pk=gpk,
                    ab_idx=ab["atBatIndex"],
                    batter=b,
                    pitcher=p,
                    start_pc=start_pc,
                    n_pitches=n_pitches,
                    event=play["result"].get("eventType"),
                    half=f"{half[0]}{half[1]}",
                    team=teams[ab["halfInning"]],
                    slot=slot.get(b, 0),
                )
            )
    return pd.DataFrame(rows), pd.DataFrame(pas), names


def residualize(pitches: pd.DataFrame) -> pd.DataFrame:
    """Per-pitch residuals vs the pitcher's own norms (not yet vs fatigue curve)."""
    df = pitches[~pitches.ptype.isin(SKIP_PITCH_TYPES)].copy()
    df["in_zone"] = df.zone.between(1, 9).astype(float)
    df["csw"] = df.call.isin(CSW_CODES).astype(float)
    df["velo_r"] = df.speed
    df["zone_r"] = df.in_zone
    df["csw_r"] = df.csw
    # Additive pitcher(+pitch type) and batter-faced effects, fit by alternating means.
    # Without the batter term, pitchers "reaching back" for the star hitting next makes
    # every hitter in a strong lineup look like he leaves no wake.
    pkeys = {"velo_r": ["pitcher", "ptype"], "zone_r": ["pitcher"], "csw_r": ["pitcher"]}
    for c, pk in pkeys.items():
        y = df[c] - df[c].mean()
        b_eff = pd.Series(0.0, index=df.index)
        for _ in range(5):
            p_eff = (y - b_eff).groupby([df[k] for k in pk]).transform("mean")
            b_eff = (y - p_eff).groupby(df.batter).transform("mean")
        df[c] = y - p_eff - b_eff
    return df


def fatigue_curves(df: pd.DataFrame, cols: list[str]) -> dict[str, pd.Series]:
    """League-average residual by cumulative pitch count (smoothed), 1..150."""
    curves = {}
    idx = pd.RangeIndex(1, 151)
    for c in cols:
        s = df.groupby(df.pc.clip(upper=150))[c].mean().reindex(idx)
        curves[c] = s.interpolate().bfill().ffill().rolling(7, center=True, min_periods=1).mean()
    return curves


def compute(season: str, window: int, min_pa: int, adjust_slot: bool = False) -> pd.DataFrame:
    pitches, pas, names = load_pitches(season)
    print(f"{season}: {pitches.game_pk.nunique()} games, {len(pas):,} PAs, {len(pitches):,} pitches")
    df = residualize(pitches)
    cols = ["velo_r", "zone_r", "csw_r"]
    # Inning-position adjustment (first pitches after a rest differ), then fatigue curve.
    for c in cols:
        # Remove the pitcher's day-level form (good/bad velo day). Teammates share it,
        # which otherwise leaks lineup/team effects into a per-hitter number.
        df[c] -= df.groupby(["game_pk", "pitcher"])[c].transform("mean")
        df[c] -= df.groupby(df.inn_pos.clip(upper=25))[c].transform("mean")
    curves = fatigue_curves(df, cols)
    avg_len = pas.n_pitches.mean()

    df = df.sort_values(["game_pk", "pitcher", "pc"])
    by_gp = {k: g for k, g in df.groupby(["game_pk", "pitcher"])}

    recs = []
    for pa in pas.itertuples():
        g = by_gp.get((pa.game_pk, pa.pitcher))
        if g is None:
            continue
        end_pc = pa.start_pc + pa.n_pitches
        nxt = g[(g.pc > end_pc) & (g.pc <= end_pc + window)]
        if len(nxt) < 5:
            continue
        # Counterfactual: same pitcher had faced an average-length PA instead.
        cf_pc = (nxt.pc - pa.n_pitches + avg_len).round().clip(1, 150).astype(int)
        rec = dict(batter=pa.batter, game_pk=pa.game_pk, ab_idx=pa.ab_idx, n_next=len(nxt))
        for c in cols:
            expected = curves[c].reindex(cf_pc).to_numpy()
            # Damage is positive when the pitcher is *worse*: lower velo / zone / CSW.
            rec[c.replace("_r", "_dmg")] = -(nxt[c].to_numpy() - expected).mean()
        recs.append(rec)
    w = pd.DataFrame(recs)
    print(f"PAs with a scorable wake (>=5 follow-up pitches): {len(w):,}")

    # Validation target: did the next two hitters reach base more than expected?
    pas = pas.sort_values(["game_pk", "ab_idx"]).reset_index(drop=True)
    pas["ob"] = pas.event.isin(ON_BASE).astype(float)
    pas["ob_r"] = pas.ob - pas.groupby("batter").ob.transform("mean")
    same_p = lambda k: (pas.pitcher.shift(-k) == pas.pitcher) & (pas.game_pk.shift(-k) == pas.game_pk)
    nxt_ob = pd.concat([pas.ob_r.shift(-k).where(same_p(k)) for k in (1, 2)], axis=1).mean(axis=1)
    pas["next2_ob_r"] = nxt_ob
    w = w.merge(pas[["game_pk", "ab_idx", "next2_ob_r", "n_pitches", "slot"]], on=["game_pk", "ab_idx"])

    dmg = ["velo_dmg", "zone_dmg", "csw_dmg"]
    by_slot = w.groupby("slot").agg(pa=("velo_dmg", "size"), velo_dmg=("velo_dmg", "mean"),
                                    se=("velo_dmg", lambda s: s.std() / np.sqrt(len(s))))
    print("Velo damage by lineup slot (league):\n", by_slot.round(4).to_string())
    if adjust_slot:
        for c in dmg:
            w[c] -= w.groupby("slot")[c].transform("mean")
        print("Applied lineup-slot adjustment.")
    # Split-half reliability per component: odd vs even *games* per hitter, so PAs that
    # share a pitcher-day never land in both halves.
    w["half"] = w.groupby("batter").game_pk.rank(method="dense").astype(int) % 2
    agg = w.groupby("batter").agg(pa=("velo_dmg", "size"), pitches_per_pa=("n_pitches", "mean"),
                                  next2_ob_r=("next2_ob_r", "mean"), **{c: (c, "mean") for c in dmg})
    q = agg[agg.pa >= min_pa].copy()
    halves = w[w.batter.isin(q.index)].groupby(["batter", "half"])[dmg].mean().unstack()
    rel = {}
    for c in dmg:
        r = halves[c][0].corr(halves[c][1])
        rel[c] = max(2 * r / (1 + r), 0.0)  # Spearman-Brown to full sample
    print("Reliability (split-half, Spearman-Brown):", {k: round(v, 3) for k, v in rel.items()})

    # Composite: z-score each component, weight by reliability, shrink by composite reliability.
    z = (q[dmg] - q[dmg].mean()) / q[dmg].std()
    weights = pd.Series(rel)
    if weights.sum() == 0:
        weights[:] = 1
    comp = (z * weights).sum(axis=1) / weights.sum()
    comp_half = []
    for h in (0, 1):
        zh = (halves.xs(h, axis=1, level=1) - q[dmg].mean()) / q[dmg].std()
        comp_half.append((zh * weights).sum(axis=1) / weights.sum())
    r_comp = comp_half[0].corr(comp_half[1])
    rel_comp = max(2 * r_comp / (1 + r_comp), 0.0)
    print(f"Composite reliability: {rel_comp:.3f}")
    q["wake_raw_z"] = comp
    shrunk = comp * rel_comp
    q["wake_plus"] = 100 + 10 * shrunk / (shrunk.std() if shrunk.std() > 0 else 1)
    q["name"] = q.index.map(names)
    q["avg_slot"] = w.groupby("batter").slot.mean().reindex(q.index)
    team = pas.groupby("batter").team.agg(lambda s: s.mode().iat[0])
    q["team"] = q.index.map(team)
    team_r2 = q.groupby("team").wake_raw_z.transform("mean").var() / q.wake_raw_z.var()
    rng = np.random.default_rng(0)
    null = [
        pd.Series(rng.permutation(q.wake_raw_z.to_numpy()), index=q.index)
        .groupby(q.team).transform("mean").var() / q.wake_raw_z.var()
        for _ in range(500)
    ]
    p_team = (np.array(null) >= team_r2).mean()
    print(f"Share of Wake variance explained by team: {team_r2:.3f} "
          f"(chance ≈{np.mean(null):.3f}, permutation p={p_team:.3f})")

    print("corr(Wake raw, avg lineup slot):", round(q.wake_raw_z.corr(q.avg_slot), 3))
    print("corr(Wake raw, pitches/PA):", round(q.wake_raw_z.corr(q.pitches_per_pa), 3))
    print("corr(Wake raw, next-2 hitters OBP lift):", round(q.wake_raw_z.corr(q.next2_ob_r), 3))
    return q.sort_values("wake_plus", ascending=False)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2026")
    ap.add_argument("--window", type=int, default=15)
    ap.add_argument("--min-pa", type=int, default=250)
    ap.add_argument("--adjust-slot", action="store_true")
    ap.add_argument("--tag", default="")
    a = ap.parse_args()
    res = compute(a.season, a.window, a.min_pa, a.adjust_slot)
    OUT.mkdir(exist_ok=True)
    path = OUT / f"wake_{a.season}{a.tag}.csv"
    res.round(4).to_csv(path)
    cols = ["name", "team", "pa", "pitches_per_pa", "velo_dmg", "zone_dmg", "csw_dmg", "wake_plus"]
    pd.set_option("display.width", 160)
    print("\nTop 15\n", res[cols].head(15).round(3).to_string())
    print("\nBottom 10\n", res[cols].tail(10).round(3).to_string())
    print(f"\nWrote {path} ({len(res)} qualified hitters)")


if __name__ == "__main__":
    main()
