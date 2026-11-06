"""Shared pitch-level loader for the Respect Index and Short Memory prototypes.

Parses the raw MLB live feeds in data/mlb_feeds into one row per pitch (with
pre-pitch count, base/out state, location, call, batted-ball data) and caches it
as data/newstats_pitches_<season>.parquet.
"""

from __future__ import annotations

import glob
import json
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = Path(__file__).resolve().parent / "output"

FASTBALLS = {"FF", "SI", "FA"}
SKIP_PITCH_TYPES = {"PO", "IN", "EP", "AB", "NP", "UN", None}

# 2026-ish linear weights (FanGraphs Guts scale); exact values barely matter for
# within-batter comparisons.
WOBA_W = {
    "walk": 0.69, "intent_walk": 0.0, "hit_by_pitch": 0.72, "single": 0.88,
    "double": 1.25, "triple": 1.58, "home_run": 2.03,
}
NON_PA_EVENTS = {"intent_walk", "catcher_interf", "sac_bunt", "sac_bunt_double_play"}


def _parse_feed(path: str, season: str) -> tuple[list[dict], dict] | None:
    feed = json.load(open(path))
    gd = feed["gameData"]
    if gd["game"]["season"] != season or gd["game"]["type"] != "R":
        return None
    gpk = feed["gamePk"]
    date = gd["datetime"].get("officialDate")
    rows, names = [], {}
    team_ids = {True: gd["teams"]["away"]["id"], False: gd["teams"]["home"]["id"]}
    pa_seq: dict[int, int] = {}  # batter -> PA number within game
    half_key, outs_before, bases_before = None, 0, 0
    for play in feed["liveData"]["plays"]["allPlays"]:
        if play.get("result", {}).get("type") != "atBat":
            continue
        m, ab, res = play["matchup"], play["about"], play["result"]
        b, p = m["batter"]["id"], m["pitcher"]["id"]
        names[b] = m["batter"]["fullName"]
        hk = (ab["inning"], ab["halfInning"])
        if hk != half_key:
            half_key, outs_before, bases_before = hk, 0, 0
        bases = bases_before
        pa_seq[b] = pa_seq.get(b, 0) + 1
        top = ab["halfInning"] == "top"
        # score from the batting team's perspective at PA start (approx: end-of-PA minus RBI)
        a, h = res.get("awayScore", 0), res.get("homeScore", 0)
        rbi = res.get("rbi", 0) or 0
        bat_score = (a if top else h) - rbi
        fld_score = h if top else a
        balls = strikes = 0
        pitches = [e for e in play["playEvents"] if e.get("isPitch")]
        for i, e in enumerate(pitches):
            det, pdat = e.get("details", {}), e.get("pitchData", {}) or {}
            coords = pdat.get("coordinates", {}) or {}
            hd = e.get("hitData", {}) or {}
            rows.append(dict(
                game_pk=gpk, date=date, ab_idx=ab["atBatIndex"], pa_seq=pa_seq[b],
                batter=b, pitcher=p, b_hand=m["batSide"]["code"], p_hand=m["pitchHand"]["code"],
                bat_team=team_ids[top], inning=ab["inning"], top=top, outs=outs_before, bases=bases,
                score_diff=bat_score - fld_score,
                balls=balls, strikes=strikes, pitch_num=i + 1, last=i == len(pitches) - 1,
                ptype=(det.get("type") or {}).get("code"), speed=pdat.get("startSpeed"),
                px=coords.get("pX"), pz=coords.get("pZ"),
                sz_top=pdat.get("strikeZoneTop"), sz_bot=pdat.get("strikeZoneBottom"),
                zone=pdat.get("zone"), call=(det.get("call") or {}).get("code"),
                ev=hd.get("launchSpeed"), la=hd.get("launchAngle"),
                event=res.get("eventType"),
            ))
            c = e.get("count") or {}
            balls, strikes = min(3, c.get("balls", balls)), min(2, c.get("strikes", strikes))
        outs_before = (play.get("count") or {}).get("outs", outs_before) % 3
        bases_before = sum(bit for k, bit in (("postOnFirst", 1), ("postOnSecond", 2), ("postOnThird", 4)) if k in m)
    return rows, names


def load_pitches(season: str, refresh: bool = False) -> tuple[pd.DataFrame, dict[int, str]]:
    cache = DATA / f"newstats_pitches_{season}.parquet"
    ncache = DATA / f"newstats_names_{season}.json"
    if cache.exists() and ncache.exists() and not refresh:
        return pd.read_parquet(cache), {int(k): v for k, v in json.load(open(ncache)).items()}
    files = sorted(glob.glob(str(DATA / "mlb_feeds" / "*.json")))
    rows, names = [], {}
    with ProcessPoolExecutor() as ex:
        for out in ex.map(_parse_feed, files, [season] * len(files), chunksize=8):
            if out:
                rows.extend(out[0])
                names.update(out[1])
    df = pd.DataFrame(rows)
    df.to_parquet(cache, index=False)
    json.dump({str(k): v for k, v in names.items()}, open(ncache, "w"))
    return df, names


def split_half(per_game: pd.DataFrame, value: str, weight: str, min_w: float) -> tuple[float, float]:
    """Odd/even game_pk split-half correlation across batters + Spearman-Brown full-sample r.

    per_game: one row per (batter, game_pk) with a summed `value` numerator and `weight`.
    """
    g = per_game.assign(half=per_game.game_pk % 2)
    agg = g.groupby(["batter", "half"])[[value, weight]].sum().unstack("half")
    agg = agg[(agg[weight][0] >= min_w) & (agg[weight][1] >= min_w)]
    a = agg[value][0] / agg[weight][0]
    b = agg[value][1] / agg[weight][1]
    if len(a) < 3:
        raise ValueError(f"split_half({value}): only {len(a)} batters have {min_w}+ {weight} in both halves; lower min_w")
    r = float(np.corrcoef(a, b)[0, 1])
    if not np.isfinite(r):
        raise ValueError(f"split_half({value}): correlation is undefined (no variance across batters)")
    return r, (2 * r / (1 + r)) if r > 0 else r


def shrink_k(reliability: float, n_mean: float) -> float:
    """Pseudo-count k so that n/(n+k) equals the measured reliability at the average n."""
    if not (np.isfinite(reliability) and np.isfinite(n_mean)):
        raise ValueError(f"shrink_k: non-finite input (reliability={reliability}, n_mean={n_mean})")
    if reliability <= 0.01:
        return float("inf")
    return n_mean * (1 - reliability) / reliability


def plus_scale(x: pd.Series, sd: float = 15.0) -> pd.Series:
    return (100 + sd * (x - x.mean()) / x.std()).round(0)
