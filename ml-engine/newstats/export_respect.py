"""Write web/data/newstats/respect-<season>.json for the Respect+ leaderboard page.

Usage:
    venv/bin/python newstats/export_respect.py --season 2026 [--prior 2025] [--min-pa 300]
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone

from common import ROOT
from respect import compute

WEB_OUT = ROOT.parent / "web" / "data" / "newstats"


def num(x: float, nd: int) -> float | None:
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), nd)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2026")
    ap.add_argument("--prior", default="2025")
    ap.add_argument("--min-pa", type=int, default=300)
    a = ap.parse_args()

    cur, diag = compute(a.season, a.min_pa)
    yoy = None
    if a.prior:
        prev, _ = compute(a.prior, 100, min_half_pitches=100)
        j = prev[["respect_adj"]].join(cur[["respect_adj"]], lsuffix="_p", rsuffix="_c", how="inner")
        yoy = {"season": int(a.prior), "batters": len(j), "r": num(j.respect_adj_p.corr(j.respect_adj_c), 3)}

    players = []
    for rank, (pid, r) in enumerate(cur.iterrows(), start=1):
        players.append({
            "rank": rank, "playerId": int(pid), "name": r["name"],
            "teamId": None if math.isnan(r.team_id) else int(r.team_id), "pa": int(r.pa),
            "respectPlus": int(r["Respect+"]), "percentile": int(r.Respect_pct), "avoidancePlus": int(r["Avoidance+"]),
            "zoneAvoidPp": num(r.zone_avoid_pp, 2), "heartAvoidPp": num(r.heart_avoid_pp, 2), "fbAvoidPp": num(r.fb_avoid_pp, 2),
            "chasePct": num(r.chase * 100, 1), "whiffPct": num(r.whiff * 100, 1), "woba": num(r.woba, 3),
        })
    rel = diag["reliability"]
    report = {
        "season": int(a.season),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "minPa": a.min_pa,
        "reliability": {k: v["full_season_r"] for k, v in rel.items()},
        "yearOverYear": yoy,
        "validity": {k: float(v) for k, v in diag["validity"].items()},
        "players": players,
    }
    WEB_OUT.mkdir(parents=True, exist_ok=True)
    path = WEB_OUT / f"respect-{a.season}.json"
    path.write_text(json.dumps(report, indent=1, allow_nan=False))
    print(f"wrote {path} ({len(players)} players)", report["reliability"], yoy)


if __name__ == "__main__":
    main()
