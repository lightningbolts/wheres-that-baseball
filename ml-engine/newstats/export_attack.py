"""Write web/data/newstats/attack-<season>.json for the Attack+ (pitchers) leaderboard.

Usage:
    venv/bin/python newstats/export_attack.py --season 2026 [--prior 2025] [--min-pitches 1000]
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone

from attack import compute
from export_respect import WEB_OUT, num


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2026")
    ap.add_argument("--prior", default="2025")
    ap.add_argument("--min-pitches", type=int, default=1000)
    a = ap.parse_args()

    cur, diag = compute(a.season, a.min_pitches)
    yoy = None
    if a.prior:
        prev, _ = compute(a.prior, 500)
        j = prev[["attack"]].join(cur[["attack"]], lsuffix="_p", rsuffix="_c", how="inner")
        yoy = {"season": int(a.prior), "pitchers": len(j), "r": num(j.attack_p.corr(j.attack_c), 3)}

    players = []
    for rank, (pid, r) in enumerate(cur.iterrows(), start=1):
        players.append({
            "rank": rank, "playerId": int(pid), "name": r["name"],
            "teamId": None if math.isnan(r.team_id) else int(r.team_id),
            "pitches": int(r.pitches), "bf": int(r.bf),
            "attackPlus": int(r["Attack+"]), "percentile": int(r.Attack_pct),
            "zoneAttackPp": num(r.zone_attack_pp, 2), "heartAttackPp": num(r.heart_attack_pp, 2),
            "zonePct": num(r.zone_pct * 100, 1), "fbPct": num(r.fb_pct * 100, 1),
            "kPct": num(r.k_pct * 100, 1), "bbPct": num(r.bb_pct * 100, 1),
        })
    rel = diag["reliability"]
    report = {
        "season": int(a.season),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "minPitches": a.min_pitches,
        "reliability": {k: v["full_season_r"] for k, v in rel.items()},
        "yearOverYear": yoy,
        "validity": {k: float(v) for k, v in diag["validity"].items()},
        "players": players,
    }
    WEB_OUT.mkdir(parents=True, exist_ok=True)
    path = WEB_OUT / f"attack-{a.season}.json"
    path.write_text(json.dumps(report, indent=1, allow_nan=False))
    print(f"wrote {path} ({len(players)} pitchers)", report["reliability"], yoy, report["validity"])


if __name__ == "__main__":
    main()
