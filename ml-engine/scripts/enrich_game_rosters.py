"""Merge Baseball Savant player metrics into web/data/game/rosters.json for Play Ball.

build_game_rosters.py derives pitch kinematics, plate discipline and contact quality
from local pitch data; everything a player *is* beyond that comes from Savant's
leaderboards (cached under data/savant_breakouts/, fetched when missing):

  sprint speed + home-to-first     → baserunning / bunting speed
  arm strength (max, by position)  → throw speed
  outs above average               → fielding range / glove
  catcher pop time + exchange      → stolen-base defense
  bat tracking (bat speed, swing length, squared-up, blasts)
  expected stats, barrel / hard-hit / sweet-spot, pull / GB / FB rates

Usage:  ./venv/bin/python scripts/enrich_game_rosters.py [--season 2026] [--refresh]
"""

from __future__ import annotations

import argparse
import io
import json
import math
import sys
import time
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "savant_breakouts"
OUT = ROOT.parent / "web" / "data" / "game" / "rosters.json"
UA = {"User-Agent": "Mozilla/5.0"}
SAVANT = "https://baseballsavant.mlb.com/leaderboard"


def fetch(name: str, url: str, refresh: bool) -> pd.DataFrame:
    path = CACHE / name
    if refresh or not path.exists():
        for attempt in range(3):
            try:
                resp = requests.get(url, timeout=90, headers=UA)
                resp.raise_for_status()
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(resp.content)
                break
            except Exception as exc:  # network is optional: keep whatever is cached
                print(f"  fetch {name} failed ({exc}); retry {attempt + 1}", file=sys.stderr)
                time.sleep(2)
    if not path.exists():
        return pd.DataFrame()
    text = path.read_text(encoding="utf-8-sig")
    return pd.read_csv(io.StringIO(text))


def num(x, d: int = 3):
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return round(f, d)


def by_id(df: pd.DataFrame, col: str) -> dict[int, dict]:
    if df.empty or col not in df.columns:
        return {}
    out = {}
    for row in df.to_dict("records"):
        try:
            out[int(row[col])] = row
        except (TypeError, ValueError):
            continue
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--out", type=Path, default=OUT, help="roster file to enrich in place")
    args = ap.parse_args()
    y = args.season
    out = args.out

    sprint = by_id(fetch(f"sprint_{y}.csv", f"{SAVANT}/sprint_speed?min_season={y}&max_season={y}&position=&team=&min=10&csv=true", args.refresh), "player_id")
    arm = by_id(fetch(f"arm_{y}.csv", f"{SAVANT}/arm-strength?type=player&year={y}&minThrows=50&pos=&team=&csv=true", args.refresh), "player_id")
    steal = by_id(fetch(f"basestealing_{y}.csv", f"{SAVANT}/basestealing-run-value?game_type=Regular&n=0&pitch_hand=&runner_moved=All&target_base=All&prior_pos_count=All&season_start={y}&season_end={y}&split=no&team=&type=Batter&with_team_only=1&csv=true", args.refresh), "player_id")
    pop = by_id(fetch(f"poptime_{y}.csv", f"{SAVANT}/poptime?year={y}&team=&min2b=5&min3b=0&csv=true", args.refresh), "entity_id")
    oaa = by_id(fetch(f"oaa_{y}.csv", f"{SAVANT}/outs_above_average?type=Fielder&startYear={y}&endYear={y}&split=no&team=&range=year&min=10&pos=&roles=&viz=hide&csv=true", False), "player_id")
    bt = by_id(fetch(f"bat_tracking_{y}.csv", f"{SAVANT}/bat-tracking?attackZone=&batSide=&contactType=&count=&dateStart={y}-03-01&dateEnd={y}-11-30&gameType=Regular&isHardHit=&minSwings=50&minGroupSwings=1&pitchHand=&pitchType=&seasonStart=&seasonEnd=&team=&type=batter&csv=true", False), "id")
    bv2 = by_id(fetch(f"batter_{y}_v2.csv", "", False), "player_id")
    bx = by_id(fetch(f"batter_{y}_extra.csv", "", False), "player_id")
    pv2 = by_id(fetch(f"pitcher_{y}_v2.csv", "", False), "player_id")
    print(f"savant: sprint {len(sprint)}, arm {len(arm)}, pop {len(pop)}, oaa {len(oaa)}, bat-tracking {len(bt)}, batters {len(bv2)}, pitchers {len(pv2)}", file=sys.stderr)

    payload = json.loads(out.read_text())
    hits = {"steal": 0, "sprint": 0, "arm": 0, "oaa": 0, "bt": 0, "bat": 0, "pit": 0, "pop": 0}
    for team in payload["teams"].values():
        for group in ("lineup", "bench", "rotation", "bullpen"):
            for p in team.get(group, []):
                pid = int(p["id"])
                sav: dict = {}
                s = sprint.get(pid)
                if s and num(s.get("sprint_speed")):
                    p["sprint"] = num(s["sprint_speed"], 1)
                    sav["hpTo1b"] = num(s.get("hp_to_1b"), 2)
                    sav["bolts"] = num(s.get("bolts"), 0)
                    hits["sprint"] += 1
                st = steal.get(pid)
                if st and group in ("lineup", "bench") and num(st.get("n_init")):
                    # Reads and jumps, not just speed: leads on attempts, SB/CS, attempt rate.
                    sav["sbOpp"] = num(st.get("n_init"), 0)
                    sav["sb"] = num(st.get("n_sb"), 0)
                    sav["cs"] = num(st.get("n_cs"), 0)
                    sav["sbLead"] = num(st.get("r_primary_lead_sbx"), 1)
                    sav["sbRuns"] = num(st.get("runs_stolen_on_running_act"), 2)
                    hits["steal"] += 1
                a = arm.get(pid)
                if a and num(a.get("arm_overall")):
                    p["arm"] = num(a["arm_overall"], 1)
                    sav["armMax"] = num(a.get("max_arm_strength"), 1)
                    hits["arm"] += 1
                o = oaa.get(pid)
                if o:
                    sav["oaa"] = num(o.get("outs_above_average"), 0)
                    sav["frp"] = num(o.get("fielding_runs_prevented"), 0)
                    sav["oaaIn"] = num(o.get("outs_above_average_infront"), 0)
                    sav["oaaBack"] = num(o.get("outs_above_average_behind"), 0)
                    hits["oaa"] += 1
                c = pop.get(pid)
                if c:
                    sav["pop2b"] = num(c.get("pop_2b_sba"), 2)
                    sav["exchange"] = num(c.get("exchange_2b_3b_sba"), 2)
                    sav["popArm"] = num(c.get("maxeff_arm_2b_3b_sba"), 1)
                    hits["pop"] += 1
                t = bt.get(pid)
                if t and num(t.get("avg_bat_speed")):
                    sav["batSpeed"] = num(t["avg_bat_speed"], 1)
                    sav["swingLength"] = num(t.get("swing_length"), 2)
                    sav["squaredUp"] = num(t.get("squared_up_per_swing"), 3)
                    sav["blast"] = num(t.get("blast_per_swing"), 3)
                    sav["hardSwing"] = num(t.get("hard_swing_rate"), 3)
                    hits["bt"] += 1
                b = bv2.get(pid)
                if b and group in ("lineup", "bench"):
                    for key, col, d in [
                        ("xwoba", "xwoba", 3), ("xba", "xba", 3), ("xslg", "xslg", 3), ("woba", "woba", 3),
                        ("barrel", "barrel_batted_rate", 1), ("hardHit", "hard_hit_percent", 1),
                        ("sweetSpot", "sweet_spot_percent", 1), ("maxEv", "avg_best_speed", 1),
                        ("pull", "pull_percent", 1), ("gb", "groundballs_percent", 1), ("fb", "flyballs_percent", 1),
                        ("whiff", "whiff_percent", 1), ("hrs", "home_run", 0),
                    ]:
                        v = num(b.get(col), d)
                        if v is not None:
                            sav[key] = v
                    x = bx.get(pid)
                    if x:
                        sav["avg"] = num(x.get("batting_avg"), 3)
                        sav["slg"] = num(x.get("slg_percent"), 3)
                    hits["bat"] += 1
                q = pv2.get(pid)
                if q and group in ("rotation", "bullpen"):
                    for key, col, d in [
                        ("era", "p_era", 2), ("xera", "xera", 2), ("xwoba", "xwoba", 3), ("whiff", "whiff_percent", 1),
                        ("chase", "oz_swing_percent", 1), ("gb", "groundballs_percent", 1), ("barrel", "barrel_batted_rate", 1),
                        ("ip", "p_formatted_ip", 1), ("so", "strikeout", 0), ("sv", "p_save", 0),
                    ]:
                        v = num(q.get(col), d)
                        if v is not None:
                            sav[key] = v
                    hits["pit"] += 1
                sav = {k: v for k, v in sav.items() if v is not None}
                if sav:
                    p["sav"] = sav
                else:
                    p.pop("sav", None)

    payload["savant"] = y
    out.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"enriched {out.name}: {hits}", file=sys.stderr)


if __name__ == "__main__":
    main()
