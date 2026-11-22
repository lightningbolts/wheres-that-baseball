"""Build compact game rosters + ratings for the WTBB "Play Ball" game.

Reads the local 2026 Statcast pitch parquet and cached MLB live feeds, and writes
web/data/game/rosters.json with, per team: lineup, bench, rotation, bullpen, and
per-player ratings (batter plate discipline / contact quality, pitcher arsenals
with averaged Statcast kinematics so the game's physics can reproduce real movement).

Usage:  ./venv/bin/python scripts/build_game_rosters.py [--season 2026] [--recent-games 30]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import sys
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
FEEDS = DATA / "mlb_feeds"
OUT = ROOT.parent / "web" / "data" / "game" / "rosters.json"

PITCH_NAMES = {
    "FF": "4-Seam Fastball", "SI": "Sinker", "FC": "Cutter", "SL": "Slider", "ST": "Sweeper",
    "CU": "Curveball", "KC": "Knuckle Curve", "CH": "Changeup", "FS": "Splitter", "SV": "Slurve",
    "FO": "Forkball", "KN": "Knuckleball", "SC": "Screwball", "CS": "Slow Curve",
}
KIN_KEYS = ["x0", "y0", "z0", "vX0", "vY0", "vZ0", "aX", "aY", "aZ", "pX", "pZ"]
FIELD_POS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"]
# Typical Statcast sprint speed (ft/s) and arm (mph) by primary position: priors for
# players missing from Savant's leaderboards (enrich_game_rosters.py fills in the rest).
POS_SPRINT = {"C": 25.3, "1B": 25.9, "2B": 27.4, "3B": 26.8, "SS": 27.8, "LF": 27.3,
              "CF": 28.4, "RF": 27.3, "DH": 26.0, "P": 25.5, "TWP": 26.5}
POS_ARM = {"C": 80, "1B": 74, "2B": 78, "3B": 85, "SS": 86, "LF": 84, "CF": 87, "RF": 89,
           "DH": 75, "P": 80, "TWP": 82}


def r(x: float | None, d: int = 3):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(float(x), d)


def parse_feed(path: str):
    """Extract pitch kinematics, batted-ball spray, lineups and player bios from one feed."""
    try:
        with open(path) as fh:
            d = json.load(fh)
    except Exception:
        return None
    gd, ld = d.get("gameData", {}), d.get("liveData", {})
    date = gd.get("datetime", {}).get("officialDate")
    if not date:
        return None
    pitches, spray = [], []
    for play in ld.get("plays", {}).get("allPlays", []):
        m = play.get("matchup", {})
        pid, bid = m.get("pitcher", {}).get("id"), m.get("batter", {}).get("id")
        for pe in play.get("playEvents", []):
            if not pe.get("isPitch"):
                continue
            pdata = pe.get("pitchData") or {}
            c = pdata.get("coordinates") or {}
            ptype = ((pe.get("details") or {}).get("type") or {}).get("code")
            br = pdata.get("breaks") or {}
            if ptype and all(k in c for k in KIN_KEYS) and pdata.get("startSpeed"):
                pitches.append((pid, ptype, pdata["startSpeed"], br.get("spinRate"),
                                br.get("spinDirection"), pdata.get("extension"),
                                *[c[k] for k in KIN_KEYS]))
            hd = pe.get("hitData") or {}
            hc = hd.get("coordinates") or {}
            if "coordX" in hc and "coordY" in hc:
                # spray angle, degrees; + toward RF (MLBAM home plate at 125,200)
                ang = math.degrees(math.atan2(hc["coordX"] - 125.0, 200.0 - hc["coordY"]))
                spray.append((bid, ang))
    lineups = {}
    for side in ("home", "away"):
        t = ld.get("boxscore", {}).get("teams", {}).get(side, {})
        tid = t.get("team", {}).get("id")
        rows = []
        for p in (t.get("players") or {}).values():
            bo = p.get("battingOrder")
            pos = (p.get("position") or {}).get("abbreviation")
            pst = (p.get("stats") or {}).get("pitching") or {}
            rows.append({
                "id": p["person"]["id"], "bo": int(bo) if bo else None, "pos": pos,
                "gs": pst.get("gamesStarted", 0), "np": pst.get("numberOfPitches", 0),
                "pitched": bool(pst),
            })
        lineups[tid] = rows
    bios = {}
    for p in (gd.get("players") or {}).values():
        h = p.get("height") or ""
        try:
            ft, inch = h.replace('"', "").split("' ")
            height_in = int(ft) * 12 + int(inch)
        except Exception:
            height_in = None
        bios[p["id"]] = {
            "name": p.get("fullName"), "num": p.get("primaryNumber"),
            "pos": (p.get("primaryPosition") or {}).get("abbreviation"),
            "bats": (p.get("batSide") or {}).get("code"), "throws": (p.get("pitchHand") or {}).get("code"),
            "h": height_in, "w": p.get("weight"), "age": p.get("currentAge"),
            "szt": p.get("strikeZoneTop"), "szb": p.get("strikeZoneBottom"),
        }
    return {"date": date, "pitches": pitches, "spray": spray, "lineups": lineups, "bios": bios}


def batter_ratings(df: pd.DataFrame) -> dict[int, dict]:
    df = df.copy()
    df["in_zone"] = df["zone"].between(1, 9)
    swing_calls = {"S", "F", "X", "D", "E", "T", "W", "L", "M", "O"}
    whiff_calls = {"S", "W", "M", "O"}
    df["swing"] = df["call"].isin(swing_calls)
    df["whiff"] = df["call"].isin(whiff_calls)
    df["foul"] = df["call"].isin({"F", "T", "L"})
    out = {}
    pa = df[df["last"]]
    for bid, g in df.groupby("batter"):
        last = pa[pa["batter"] == bid]
        n_pa = len(last)
        if n_pa < 40:
            continue
        z, oz = g[g["in_zone"]], g[~g["in_zone"]]
        sw_z, sw_o = z[z["swing"]], oz[oz["swing"]]
        bip = g[g["ev"].notna() & g["la"].notna()]
        ev = bip["ev"]
        out[int(bid)] = {
            "pa": n_pa,
            "k": r((last["event"].isin(["strikeout", "strikeout_double_play"])).mean()),
            "bb": r((last["event"].isin(["walk", "intent_walk"])).mean()),
            "zSwing": r(z["swing"].mean()), "oSwing": r(oz["swing"].mean()),
            "zContact": r(1 - sw_z["whiff"].mean()) if len(sw_z) else None,
            "oContact": r(1 - sw_o["whiff"].mean()) if len(sw_o) else None,
            "foulPerContact": r(g["foul"].sum() / max(1, (g["swing"] & ~g["whiff"]).sum())),
            "evMean": r(ev.mean(), 1) if len(ev) else None,
            "evP90": r(ev.quantile(0.9), 1) if len(ev) > 10 else None,
            "laMean": r(bip["la"].mean(), 1) if len(bip) else None,
            "laSd": r(bip["la"].std(), 1) if len(bip) > 10 else None,
            "hr": r((last["event"] == "home_run").mean()),
        }
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--recent-games", type=int, default=30)
    ap.add_argument("--out", type=Path, default=OUT, help="output file (backtests write elsewhere)")
    args = ap.parse_args()
    out = args.out

    df = pd.read_parquet(DATA / f"newstats_pitches_{args.season}.parquet")
    games = set(int(g) for g in df["game_pk"].unique())
    files = [str(FEEDS / f"{g}.json") for g in games if (FEEDS / f"{g}.json").exists()]
    print(f"{len(df):,} pitches, {len(files)} feeds", file=sys.stderr)

    pitch_rows, spray_rows = [], []
    team_games: dict[int, list] = defaultdict(list)
    bios: dict[int, dict] = {}
    with ProcessPoolExecutor() as ex:
        for i, res in enumerate(ex.map(parse_feed, files, chunksize=16)):
            if res is None:
                continue
            pitch_rows.extend(res["pitches"])
            spray_rows.extend(res["spray"])
            for tid, rows in res["lineups"].items():
                team_games[tid].append((res["date"], rows))
            bios.update(res["bios"])
            if i % 500 == 0:
                print(f"  parsed {i}", file=sys.stderr)

    pdf = pd.DataFrame(pitch_rows, columns=["pitcher", "ptype", "speed", "spin", "spinDir", "ext", *KIN_KEYS])
    arsenals: dict[int, list] = {}
    for pid, g in pdf.groupby("pitcher"):
        n = len(g)
        if n < 150:
            continue
        rows = []
        for pt, h in g.groupby("ptype"):
            use = len(h) / n
            if use < 0.03 or pt in {"PO", "EP", "IN", "UN", "AB"}:
                continue
            rows.append({
                "type": pt, "name": PITCH_NAMES.get(pt, pt), "usage": r(use),
                "speed": r(h["speed"].mean(), 1), "speedSd": r(h["speed"].std(), 2),
                "spin": r(h["spin"].mean(), 0), "spinDir": r(h["spinDir"].mean(), 0),
                "ext": r(h["ext"].mean(), 2),
                # Average Statcast 9-parameter kinematics (ft, ft/s, ft/s²).
                "kin": {k: r(h[k].mean(), 3) for k in KIN_KEYS if k not in ("pX", "pZ")},
                # Location spread around the pitcher's average spot — proxy for command.
                "locSd": [r(h["pX"].std(), 3), r(h["pZ"].std(), 3)],
            })
        total = sum(x["usage"] for x in rows) or 1
        for x in rows:
            x["usage"] = r(x["usage"] / total)
        arsenals[int(pid)] = sorted(rows, key=lambda x: -x["usage"])

    spray_by: dict[int, list] = defaultdict(list)
    for bid, ang in spray_rows:
        spray_by[bid].append(ang)

    bat = batter_ratings(df)
    pit_stats = {}
    last_pa = df[df["last"]]
    for pid, g in last_pa.groupby("pitcher"):
        allp = df[df["pitcher"] == pid]
        z = allp[allp["zone"].between(1, 9)]
        pit_stats[int(pid)] = {
            "bf": len(g),
            "k": r(g["event"].isin(["strikeout", "strikeout_double_play"]).mean()),
            "bb": r(g["event"].isin(["walk", "intent_walk"]).mean()),
            "zoneRate": r(len(z) / max(1, len(allp))),
        }

    teams_out = {}
    for tid, glist in team_games.items():
        glist.sort(key=lambda x: x[0])
        recent = glist[-args.recent_games:]
        starts, slot_sum, pos_ct, gs, apps, np_start = Counter(), Counter(), defaultdict(Counter), Counter(), Counter(), defaultdict(list)
        for _, rows in recent:
            for p in rows:
                if p["bo"] and p["bo"] % 100 == 0:
                    starts[p["id"]] += 1
                    slot_sum[p["id"]] += p["bo"] // 100
                    if p["pos"]:
                        pos_ct[p["id"]][p["pos"]] += 1
                if p["pitched"]:
                    apps[p["id"]] += 1
                    if p["gs"]:
                        gs[p["id"]] += 1
                        np_start[p["id"]].append(p["np"])
        # Greedy lineup: fill each field position with its most frequent starter, then DH.
        used, lineup = set(), []
        for pos in FIELD_POS + ["DH"]:
            cands = sorted(
                (pid for pid in starts if pid not in used and (pos == "DH" or pos_ct[pid][pos] > 0)),
                key=lambda pid: -(pos_ct[pid][pos] if pos != "DH" else starts[pid]),
            )
            cands = [c for c in cands if c in bat] or cands
            if cands:
                pid = cands[0]
                used.add(pid)
                lineup.append({"id": pid, "pos": pos, "slot": slot_sum[pid] / max(1, starts[pid])})
        lineup.sort(key=lambda x: x["slot"])
        bench = [pid for pid, _ in starts.most_common() if pid not in used and pid in bat][:4]
        rotation = [pid for pid, _ in gs.most_common(5) if pid in arsenals]
        bullpen = [pid for pid, _ in apps.most_common() if pid not in rotation and gs[pid] == 0 and pid in arsenals][:8]

        def player(pid: int, role: str, pos: str | None = None) -> dict:
            b = bios.get(pid, {})
            prim = pos or b.get("pos") or "DH"
            sp = spray_by.get(pid, [])
            rec = {
                "id": pid, "name": b.get("name"), "num": b.get("num"), "pos": prim,
                "bats": b.get("bats"), "throws": b.get("throws"), "heightIn": b.get("h"),
                "weight": b.get("w"), "age": b.get("age"),
                "zone": [r(b.get("szb"), 2), r(b.get("szt"), 2)],
                "sprint": POS_SPRINT.get(prim, 26.5), "arm": POS_ARM.get(prim, 80),
            }
            if pid in bat:
                rec["bat"] = {**bat[pid], "sprayMean": r(statistics.fmean(sp), 1) if len(sp) > 10 else None,
                              "spraySd": r(statistics.pstdev(sp), 1) if len(sp) > 10 else None}
            if role == "P" and pid in arsenals:
                stam = np_start.get(pid)
                rec["pitch"] = {**pit_stats.get(pid, {}), "arsenal": arsenals[pid],
                                "stamina": r(statistics.fmean(stam), 0) if stam else 25}
            return rec

        teams_out[str(tid)] = {
            "teamId": tid,
            "lineup": [{**player(x["id"], "B", x["pos"]), "pos": x["pos"]} for x in lineup],
            "bench": [player(pid, "B") for pid in bench],
            "rotation": [player(pid, "P", "P") for pid in rotation],
            "bullpen": [player(pid, "P", "P") for pid in bullpen],
        }

    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {"season": args.season, "generatedFrom": "statcast-local", "teams": teams_out}
    out.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {out} ({os.path.getsize(out) / 1024:.0f} KB, {len(teams_out)} teams)", file=sys.stderr)
    # Savant player metrics: sprint speed, arm, OAA, pop time, bat tracking, expected stats.
    import subprocess
    subprocess.run([sys.executable, str(Path(__file__).with_name("enrich_game_rosters.py")), "--season", str(args.season),
                    "--out", str(out)], check=False)
    # Skin tones for the 3D players, read from each player's MLB headshot (the game's own file only).
    if out == OUT:
        subprocess.run([sys.executable, str(Path(__file__).with_name("sample_skin_tones.py"))], check=False)


if __name__ == "__main__":
    main()
