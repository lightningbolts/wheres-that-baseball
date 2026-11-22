"""Inputs for backtesting the season projection against a finished season.

Rebuilds the league as it stood on Opening Day of SEASON using only data from before it:

  * ratings from the previous season's Statcast rosters (build_game_rosters.py --season SEASON-1),
  * each club's real Opening Day active roster (MLB Stats API, by date),
  * the rest of its healthy 40-man as organizational depth,

and saves what actually happened (standings, postseason, player lines, awards) to score
against. Then run build_franchise_projections.py with the files this writes.

Usage:  ./venv/bin/python scripts/build_backtest_inputs.py --season 2026 --dir <backtest dir>
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "backtest_cache"
API = "https://statsapi.mlb.com/api/v1"
TEAM_IDS = [108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 133, 134,
            135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 158]
KINDS = ("lineup", "bench", "rotation", "bullpen")
# MLB Stats API award ids for the league awards the projection gives odds on.
AWARDS = {"mvp": ("ALMVP", "NLMVP"), "cy": ("ALCY", "NLCY"), "roy": ("ALROY", "NLROY")}


def get(path: str, name: str, refresh: bool = False) -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / name
    if f.exists() and not refresh:
        return json.loads(f.read_text())
    for attempt in range(4):
        try:
            req = urllib.request.Request(f"{API}{path}", headers={"User-Agent": "wtbb-backtest"})
            text = urllib.request.urlopen(req, timeout=60).read().decode()
            f.write_text(text)
            time.sleep(0.15)
            return json.loads(text)
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f"  retry {name}: {e}")
            time.sleep(2 * (attempt + 1))
    return {}


def opening_day(season: int) -> str:
    d = get(f"/seasons/{season}?sportId=1", f"season_{season}.json")
    return d["seasons"][0]["regularSeasonStartDate"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--dir", type=Path, required=True)
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    season, out = args.season, args.dir
    prev = json.loads((out / f"rosters-{season - 1}.json").read_text())

    # Every rated player from the previous season, wherever he played.
    pool: dict[int, tuple[str, dict]] = {}
    for t in prev["teams"].values():
        for kind in KINDS:
            for p in t[kind]:
                if p["id"] not in pool or kind in ("lineup", "rotation"):
                    pool[p["id"]] = (kind, p)

    # Opening Day: rosters two days in, once every club has played.
    od = opening_day(season)
    y, m, d = map(int, od.split("-"))
    date = f"{y}-{m:02d}-{d + 2:02d}"
    teams: dict[str, dict] = {}
    missing: dict[str, list[int]] = {}
    counts = {"rated": 0, "unrated active": 0, "depth": 0}
    for tid in TEAM_IDS:
        act = get(f"/teams/{tid}/roster?rosterType=active&date={date}", f"active_{tid}_{date}.json", args.refresh).get("roster", [])
        forty = get(f"/teams/{tid}/roster?rosterType=40Man&date={date}", f"forty_{tid}_{date}.json", args.refresh).get("roster", [])
        buckets: dict[str, list[dict]] = {k: [] for k in KINDS}
        hitters, pitchers = [], []
        need: list[int] = []
        for r in act:
            pid, pos = r["person"]["id"], r["position"]["abbreviation"]
            if pid not in pool:
                need.append(pid)
                counts["unrated active"] += 1
                continue
            counts["rated"] += 1
            kind, rp = pool[pid]
            if pos == "P" or (pos == "TWP" and kind in ("rotation", "bullpen") and "bat" not in rp):
                pitchers.append((kind, rp))
            else:
                hitters.append((kind, {**rp, "pos": pos}))
        # Last year's everyday players start; rotations keep last year's starters first.
        hitters.sort(key=lambda x: (x[0] != "lineup", -((x[1].get("bat") or {}).get("pa") or 0)))
        for i, (_, rp) in enumerate(hitters):
            buckets["lineup" if i < 9 else "bench"].append(rp)
        pitchers.sort(key=lambda x: (x[0] != "rotation", -((x[1].get("pitch") or {}).get("bf") or 0)))
        for i, (kind, rp) in enumerate(pitchers):
            buckets["rotation" if kind == "rotation" and len(buckets["rotation"]) < 5 else "bullpen"].append(rp)
        # Healthy 40-man players off the active roster: depth (and the active players last year's data missed).
        for r in forty:
            pid = r["person"]["id"]
            status = (r.get("status") or {}).get("code", "A")
            if any(pid == x["person"]["id"] for x in act) or status.startswith("D"):
                continue
            need.append(pid)
            counts["depth"] += 1
        teams[str(tid)] = {"teamId": tid, **buckets}
        missing[str(tid)] = need

    (out / f"rosters-od{season}.json").write_text(json.dumps(
        {"season": season - 1, "generatedFrom": f"backtest: {season - 1} ratings, {date} rosters", "teams": teams,
         "savant": prev.get("savant")}, separators=(",", ":")))
    (out / f"forty-od{season}.json").write_text(json.dumps(missing))
    print(f"opening day {date}: {counts}")

    # ---- What actually happened.
    st = get(f"/standings?leagueId=103,104&season={season}&standingsTypes=regularSeason", f"standings_{season}.json", args.refresh)
    standings = {}
    for rec in st.get("records", []):
        for tr in rec["teamRecords"]:
            standings[tr["team"]["id"]] = {
                "w": tr["wins"], "l": tr["losses"], "rs": tr["runsScored"], "ra": tr["runsAllowed"],
                "divWin": bool(tr.get("divisionChamp")), "playoffs": bool(tr.get("clinched")) or tr.get("clinchIndicator") in ("x", "y", "z", "w"),
            }
    post = get(f"/schedule/postseason/series?season={season}&sportId=1", f"post_{season}.json", args.refresh)
    reach: dict[int, int] = {}
    ROUND = {"F": 1, "D": 2, "L": 3, "W": 4}
    for s in post.get("series", []):
        games = s.get("games") or []
        if not games:
            continue
        r = ROUND.get(games[0].get("gameType"), 0)
        for side in ("away", "home"):
            tid = games[0]["teams"][side]["team"]["id"]
            reach[tid] = max(reach.get(tid, 0), r)
        if r == 4:
            last = games[-1]
            for side in ("away", "home"):
                if last["teams"][side].get("isWinner") and last.get("status", {}).get("abstractGameState") == "Final":
                    # The champion won the last game of the World Series.
                    reach[last["teams"][side]["team"]["id"]] = 5
    for tid, r in reach.items():
        if tid in standings:
            standings[tid]["playoffs"] = True
            standings[tid]["reach"] = r

    def lines(group: str) -> dict[int, dict]:
        d = get(f"/stats?stats=season&group={group}&season={season}&sportId=1&playerPool=ALL&limit=3000",
                f"stats_{group}_{season}.json", args.refresh)
        out_: dict[int, dict] = {}
        for sp in (d.get("stats") or [{}])[0].get("splits", []):
            out_[sp["player"]["id"]] = {"name": sp["player"]["fullName"], "team": (sp.get("team") or {}).get("id"), **sp["stat"]}
        return out_

    awards = {}
    for key, (al, nl) in AWARDS.items():
        for lg, aid in (("AL", al), ("NL", nl)):
            a = get(f"/awards/{aid}/recipients?season={season}", f"award_{aid}_{season}.json", args.refresh)
            rec = a.get("awards") or []
            if rec:
                awards.setdefault(key, {})[lg] = rec[0]["player"]["id"]
    (out / f"actual-{season}.json").write_text(json.dumps(
        {"season": season, "standings": standings, "hitting": lines("hitting"), "pitching": lines("pitching"), "awards": awards},
        separators=(",", ":")))
    print(f"actuals: {len(standings)} teams, {sum(1 for s in standings.values() if s.get('playoffs'))} playoff clubs, "
          f"champion {[t for t, s in standings.items() if s.get('reach') == 5]}, awards {awards}")


if __name__ == "__main__":
    main()
