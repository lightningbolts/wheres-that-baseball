"""Multi-year talent projections for Play Ball franchise mode.

rosters.json is a 2026-only snapshot, so a star who slumped or spent 2026 on the IL
looks like a scrub there (or is missing entirely). This builds a Marcel-style
projection for the first franchise season from every MLB season 2015-2026:

  * per-season rates (K, BB, HR per PA/BF; Statcast xBA / xSLG / xwOBA; barrel %)
    from the MLB Stats API (year-by-year) and Baseball Savant leaderboards,
  * each season aged to the projection year along a simple aging curve,
  * weighted toward recent seasons (5/4/3/2 for 2026-2023, tapering to 2015) and
    by playing time; the effective sample size is written out so the game's own
    regression to the mean still applies to thin track records.

It also lists players on each club's current 40-man roster who are absent from
rosters.json (typically stars hurt for much of 2026) so the franchise can add them.

Writes web/data/game/franchise-proj.json.

Usage:  python3 scripts/build_franchise_projections.py [--proj-season 2027] [--refresh]
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import time
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "franchise_hist_cache"
WEB = ROOT.parent / "web" / "data" / "game"
ROSTERS = WEB / "rosters.json"
OUT = WEB / "franchise-proj.json"

FIRST_YEAR = 2015
LAST_YEAR = 2026
# Recency weights (2020 was 60 games; the PA weighting already handles that).
YEAR_W = {2026: 5, 2025: 4, 2024: 3, 2023: 2, 2022: 1.3, 2021: 0.9, 2020: 0.6, 2019: 0.5,
          2018: 0.35, 2017: 0.25, 2016: 0.18, 2015: 0.12}
TEAM_IDS = [108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 133, 134,
            135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 158]
POS_SPRINT = {"C": 25.3, "1B": 25.9, "2B": 27.4, "3B": 26.8, "SS": 27.8, "LF": 27.3,
              "CF": 28.4, "RF": 27.3, "DH": 26.0, "P": 25.5, "TWP": 26.5}
POS_ARM = {"C": 80, "1B": 74, "2B": 78, "3B": 85, "SS": 86, "LF": 84, "CF": 87, "RF": 89,
           "DH": 75, "P": 80, "TWP": 82}


def fetch(url: str, name: str, refresh: bool) -> str:
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / name
    if f.exists() and not refresh:
        return f.read_text()
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "wtbb-franchise-builder"})
            text = urllib.request.urlopen(req, timeout=60).read().decode("utf-8-sig")
            f.write_text(text)
            time.sleep(0.25)
            return text
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f"  retry {name}: {e}")
            time.sleep(2 * (attempt + 1))
    return ""


def savant_csv(kind: str, year: int, refresh: bool) -> dict[int, dict]:
    base = "https://baseballsavant.mlb.com/leaderboard/"
    urls = {
        "xbat": f"{base}expected_statistics?type=batter&year={year}&position=&team=&filterType=bip&min=1&csv=true",
        "xpit": f"{base}expected_statistics?type=pitcher&year={year}&position=&team=&filterType=bip&min=1&csv=true",
        "brlbat": f"{base}statcast?type=batter&year={year}&position=&team=&min=1&csv=true",
        "brlpit": f"{base}statcast?type=pitcher&year={year}&position=&team=&min=1&csv=true",
        "sprint": f"{base}sprint_speed?year={year}&position=&team=&min=0&csv=true",
    }
    text = fetch(urls[kind], f"{kind}_{year}.csv", refresh and year >= LAST_YEAR - 1)
    out: dict[int, dict] = {}
    for row in csv.DictReader(io.StringIO(text)):
        try:
            out[int(row["player_id"])] = row
        except (KeyError, ValueError):
            continue
    return out


def savant_embedded(url: str, name: str, var: str, refresh: bool) -> list[dict]:
    """Leaderboards with no CSV export (ABS challenges) embed their rows as `const <var> = [...]`."""
    text = fetch(url, name, refresh)
    i = text.find(f"const {var} = ")
    if i < 0:
        return []
    rows, _ = json.JSONDecoder().raw_decode(text[i + len(f"const {var} = "):])
    return rows


def r1(x, nd=1):
    v = num(x)
    return None if v is None else round(v, nd)


def statcast_extras(ids: set[str], refresh: bool) -> dict[str, dict]:
    """Latest-season (LAST_YEAR) Savant fielding, baserunning and ABS challenge value per player:
      fld: Fielding Run Value (total, range, arm, double plays; catchers: framing, blocking,
           throwing, ABS) and outs/innings sample,
      run: Baserunning Run Value (total, extra bases, steals) and opportunities,
      abs: ABS challenges as batter / catcher / pitcher (challenges, overturns, runs above average,
           overturnable calls available and the share of them taken).
    """
    y = LAST_YEAR
    base = "https://baseballsavant.mlb.com/leaderboard/"
    out: dict[str, dict] = defaultdict(dict)
    frv = fetch(f"{base}fielding-run-value?gameType=Regular&seasonStart={y}&seasonEnd={y}&type=fielder&position=&minInnings=0&minResults=1&csv=true",
                f"frv_{y}.csv", refresh)
    for row in csv.DictReader(io.StringIO(frv)):
        pid = row.get("id")
        if not pid or (num(row.get("outs_total")) or 0) < 150:
            continue
        f = {"tot": r1(row.get("total_runs")), "rng": r1(row.get("range_runs")), "arm": r1(row.get("arm_runs")),
             "dp": r1(row.get("dp_runs")), "frm": r1(row.get("framing_runs")), "blk": r1(row.get("blocking_runs")),
             "thr": r1(row.get("throwing_runs")), "abs": r1(row.get("abs_runs")), "outs": int(num(row.get("outs_total")) or 0)}
        out[pid]["fld"] = {k: v for k, v in f.items() if v is not None}
    brv = fetch(f"{base}baserunning-run-value?game_type=Regular&season_start={y}&season_end={y}&sortColumn=runner_runs&sortDir=desc&min=0&csv=true",
                f"brv_{y}.csv", refresh)
    for row in csv.DictReader(io.StringIO(brv)):
        pid = row.get("player_id")
        if not pid:
            continue
        out[pid]["run"] = {"tot": r1(row.get("runner_runs_tot")), "xb": r1(row.get("runner_runs_XB")),
                           "sb": r1(row.get("runner_runs_SBX")), "n": int(num(row.get("N_runner_moved")) or 0)}
    for role in ("batter", "catcher", "pitcher"):
        rows = savant_embedded(f"{base}abs-challenges?challengeType={role}&season={y}&gameType=R",
                               f"abs_{role}_{y}.html", "absData", refresh)
        for r in rows:
            pid = str(r.get("id") or "")
            n = int(r.get("n_challenges") or 0)
            if not pid or n == 0:
                continue
            out[pid].setdefault("abs", {})[role[0]] = {
                "n": n, "ot": int(r.get("n_overturns") or 0), "raa": r1(r.get("runs_above_average"), 2),
                "avail": int(r.get("ot_available") or 0), "taken": r1(r.get("ot_chance_taken_percent"), 3),
                "exp": r1(r.get("exp_rate_overturns"), 3)}
    keep = {k: v for k, v in out.items() if k in ids}
    print(f"statcast extras: {sum('fld' in v for v in keep.values())} fielders, {sum('run' in v for v in keep.values())} runners, "
          f"{sum('abs' in v for v in keep.values())} ABS challengers")
    return keep


def load_steamer() -> tuple[dict[int, dict], dict[int, dict]]:
    """FanGraphs Steamer projections for the projection season, if saved in the cache.

    FanGraphs blocks scripted requests, so these are exported from a browser session as compact
    `;`-separated rows (see STEAMER_FIELDS) into franchise_hist_cache/steamer_<year>_{bat,pit}.json.
    """
    out = []
    for kind, fields in (("bat", ("pa", "k", "bb", "hr", "woba", "slg", "war", "def", "bsr")),
                         ("pit", ("bf", "gs", "g", "k", "bb", "hr", "fip", "war"))):
        f = CACHE / f"steamer_{LAST_YEAR + 1}_{kind}.json"
        rows: dict[int, dict] = {}
        if f.exists():
            for line in f.read_text().split(";"):
                parts = line.split(",")
                if len(parts) != len(fields) + 1:
                    continue
                rows[int(parts[0])] = {k: num(v) for k, v in zip(fields, parts[1:])}
        out.append(rows)
    print(f"steamer: {len(out[0])} hitters, {len(out[1])} pitchers")
    return out[0], out[1]


def steamer_weight(eff: float) -> float:
    """Share given to Steamer: half for an established player, more for a thin MLB record
    (Steamer also sees minor-league and Japanese stats, which this projection doesn't)."""
    return max(0.5, min(0.85, 0.5 + 0.35 * (1 - eff / 1200)))


def num(x) -> float | None:
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def ip_outs(ip: str | None) -> int:
    if not ip:
        return 0
    whole, _, frac = str(ip).partition(".")
    return int(whole or 0) * 3 + int(frac or 0)


def age_on(birth: str | None, year: int) -> float | None:
    if not birth:
        return None
    b = date.fromisoformat(birth)
    return (date(year, 7, 1) - b).days / 365.25


def bat_curve(age: float) -> float:
    """Cumulative hitting quality index by age (peak ~27-29)."""
    a = max(19.0, min(42.0, age))
    if a <= 27:
        return -0.012 * (27 - a)
    if a <= 29.5:
        return 0.0
    if a <= 33:
        return -0.010 * (a - 29.5)
    return -0.035 - 0.020 * (a - 33)


def pit_curve(age: float) -> float:
    a = max(19.0, min(42.0, age))
    if a <= 26:
        return -0.010 * (26 - a)
    if a <= 29:
        return 0.0
    if a <= 33:
        return -0.012 * (a - 29)
    return -0.048 - 0.020 * (a - 33)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--proj-season", type=int, default=2027)
    ap.add_argument("--refresh", action="store_true", help="re-download the latest seasons and rosters")
    args = ap.parse_args()
    proj_year = args.proj_season

    rosters = json.loads(ROSTERS.read_text())
    have: dict[int, str] = {}
    for t in rosters["teams"].values():
        for kind in ("lineup", "bench", "rotation", "bullpen"):
            for p in t[kind]:
                have.setdefault(p["id"], kind)

    # Current 40-man rosters: who is missing from the 2026 snapshot?
    forty: dict[int, list[dict]] = {}
    for tid in TEAM_IDS:
        d = json.loads(fetch(f"https://statsapi.mlb.com/api/v1/teams/{tid}/roster?rosterType=40Man",
                             f"forty_{tid}.json", args.refresh))
        forty[tid] = d.get("roster", [])
    missing = {r["person"]["id"]: tid for tid, rs in forty.items() for r in rs if r["person"]["id"] not in have}
    ids = sorted(set(have) | set(missing))
    print(f"{len(have)} roster players, {len(missing)} more on current 40-man rosters")

    # Year-by-year MLB stats + bio.
    people: dict[int, dict] = {}
    for i in range(0, len(ids), 80):
        chunk = ids[i:i + 80]
        url = ("https://statsapi.mlb.com/api/v1/people?personIds=" + ",".join(map(str, chunk)) +
               "&hydrate=stats(group=[hitting,pitching],type=[yearByYear],sportId=1)")
        d = json.loads(fetch(url, f"people_{chunk[0]}_{len(chunk)}.json", args.refresh))
        for p in d.get("people", []):
            people[p["id"]] = p

    st_bat, st_pit = load_steamer()
    sav = {k: {y: savant_csv(k, y, args.refresh) for y in range(FIRST_YEAR, LAST_YEAR + 1)}
           for k in ("xbat", "xpit", "brlbat", "brlpit", "sprint")}

    out_players: dict[str, dict] = {}
    extras: dict[str, list[dict]] = defaultdict(list)
    for pid in ids:
        p = people.get(pid)
        if not p:
            continue
        birth = p.get("birthDate")
        age_proj = age_on(birth, proj_year) or 28.0
        seasons: dict[str, dict[int, dict]] = {"hitting": defaultdict(lambda: defaultdict(float)),
                                               "pitching": defaultdict(lambda: defaultdict(float))}
        for s in p.get("stats", []):
            grp = s.get("group", {}).get("displayName")
            if grp not in seasons:
                continue
            for sp in s.get("splits", []):
                y = int(sp.get("season", 0))
                if y < FIRST_YEAR or y > LAST_YEAR or sp.get("sport", {}).get("id", 1) != 1 or "team" not in sp:
                    continue
                st = sp["stat"]
                acc = seasons[grp][y]
                if grp == "hitting":
                    for k_out, k_in in (("pa", "plateAppearances"), ("so", "strikeOuts"), ("bb", "baseOnBalls"),
                                        ("hbp", "hitByPitch"), ("hr", "homeRuns"), ("sb", "stolenBases"),
                                        ("cs", "caughtStealing")):
                        acc[k_out] += st.get(k_in, 0) or 0
                else:
                    for k_out, k_in in (("bf", "battersFaced"), ("so", "strikeOuts"), ("bb", "baseOnBalls"),
                                        ("hr", "homeRuns"), ("gs", "gamesStarted"), ("g", "gamesPitched"),
                                        ("sv", "saves")):
                        acc[k_out] += st.get(k_in, 0) or 0
                    acc["outs"] += ip_outs(st.get("inningsPitched"))

        entry: dict = {"born": birth}
        # ---- hitting
        tot_w = 0.0
        eff = 0.0
        acc = defaultdict(float)
        xw = 0.0
        sprint_w = 0.0
        sprint = 0.0
        raw_pa = 0
        for y, s in seasons["hitting"].items():
            pa = s["pa"]
            if pa < 1:
                continue
            raw_pa += pa
            a_y = age_on(birth, y) or (age_proj - (proj_year - y))
            f = bat_curve(age_proj) - bat_curve(a_y)
            w = YEAR_W[y] * pa
            k, bb, hr = s["so"] / pa, s["bb"] / pa, s["hr"] / pa
            acc["k"] += w * k * (1 - f)
            acc["bb"] += w * bb * (1 + f)
            acc["hr"] += w * hr * (1 + 2 * f)
            acc["sb"] += YEAR_W[y] * s["sb"]
            acc["cs"] += YEAR_W[y] * s["cs"]
            acc["opp"] += YEAR_W[y] * pa
            tot_w += w
            eff += YEAR_W[y] / 5 * pa
            xr = sav["xbat"][y].get(pid)
            if xr and num(xr.get("est_ba")) is not None:
                xpa = num(xr.get("pa")) or pa
                ww = YEAR_W[y] * xpa
                acc["xba"] += ww * num(xr["est_ba"]) * (1 + 0.5 * f)
                acc["xslg"] += ww * num(xr["est_slg"]) * (1 + 1.4 * f)
                acc["xwoba"] += ww * num(xr["est_woba"]) * (1 + f)
                xw += ww
            sr = sav["sprint"][y].get(pid)
            if sr and num(sr.get("sprint_speed")):
                # Sprint speed declines ~0.15 ft/s per year after 26.
                adj = -0.15 * max(0.0, age_proj - max(26.0, a_y))
                sprint += YEAR_W[y] * (num(sr["sprint_speed"]) + adj)
                sprint_w += YEAR_W[y]
        if tot_w > 0 and raw_pa >= 30:
            b = {"pa": round(eff), "career": raw_pa, "k": round(acc["k"] / tot_w, 4), "bb": round(acc["bb"] / tot_w, 4),
                 "hr": round(acc["hr"] / tot_w, 4)}
            if xw > 0:
                b.update(xba=round(acc["xba"] / xw, 3), xslg=round(acc["xslg"] / xw, 3), xwoba=round(acc["xwoba"] / xw, 3))
            if sprint_w > 0:
                b["sprint"] = round(sprint / sprint_w, 1)
            b["sbRate"] = round((acc["sb"] + acc["cs"]) / max(1.0, acc["opp"]), 4)
            b["sbPct"] = round((acc["sb"] + 6) / (acc["sb"] + acc["cs"] + 8), 3)
            st = st_bat.get(pid)
            if st and st.get("pa"):
                ws = steamer_weight(b["pa"])
                for ours, theirs in (("k", "k"), ("bb", "bb"), ("hr", "hr"), ("xwoba", "woba"), ("xslg", "slg")):
                    if b.get(ours) is not None and st.get(theirs) is not None:
                        b[ours] = round((1 - ws) * b[ours] + ws * st[theirs], 4)
                b["pa"] = round(b["pa"] + 0.5 * st["pa"])
            entry["bat"] = b

        # ---- pitching
        tot_w = 0.0
        eff = 0.0
        acc = defaultdict(float)
        xw = 0.0
        bw = 0.0
        raw_bf = 0
        gs = g = outs_gs = sv_n = 0.0
        for y, s in seasons["pitching"].items():
            bf = s["bf"]
            if bf < 1:
                continue
            raw_bf += bf
            a_y = age_on(birth, y) or (age_proj - (proj_year - y))
            f = pit_curve(age_proj) - pit_curve(a_y)
            w = YEAR_W[y] * bf
            acc["k"] += w * (s["so"] / bf) * (1 + f)
            acc["bb"] += w * (s["bb"] / bf) * (1 - f)
            acc["hr"] += w * (s["hr"] / bf) * (1 - f)
            tot_w += w
            eff += YEAR_W[y] / 5 * bf
            if y >= LAST_YEAR - 2:
                gs += s["gs"]
                g += s["g"]
                sv_n += s["sv"]
                outs_gs += s["outs"] * (s["gs"] / max(1.0, s["g"]))
            xr = sav["xpit"][y].get(pid)
            if xr and num(xr.get("est_woba")) is not None:
                ww = YEAR_W[y] * (num(xr.get("pa")) or bf)
                acc["xwoba"] += ww * num(xr["est_woba"]) * (1 - f)
                xw += ww
            br = sav["brlpit"][y].get(pid)
            if br and num(br.get("brl_percent")) is not None:
                ww = YEAR_W[y] * (num(br.get("attempts")) or bf * 0.65)
                acc["barrel"] += ww * num(br["brl_percent"]) * (1 - f)
                bw += ww
        if tot_w > 0 and raw_bf >= 30:
            pi = {"bf": round(eff), "career": raw_bf, "k": round(acc["k"] / tot_w, 4), "bb": round(acc["bb"] / tot_w, 4),
                  "hr": round(acc["hr"] / tot_w, 4)}
            if xw > 0:
                pi["xwoba"] = round(acc["xwoba"] / xw, 3)
            if bw > 0:
                pi["barrel"] = round(acc["barrel"] / bw, 1)
            if g > 0:
                pi["gsShare"] = round(gs / g, 2)
                pi["ipPerGs"] = round(outs_gs / 3 / gs, 2) if gs else 0
                pi["sv"] = int(sv_n)
            st = st_pit.get(pid)
            if st and st.get("bf"):
                ws = steamer_weight(pi["bf"])
                for k in ("k", "bb", "hr"):
                    if st.get(k) is not None:
                        pi[k] = round((1 - ws) * pi[k] + ws * st[k], 4)
                pi["bf"] = round(pi["bf"] + 0.5 * st["bf"])
            entry["pit"] = pi
        fg = {}
        sb_, sp_ = st_bat.get(pid), st_pit.get(pid)
        if sb_ and sb_.get("war") is not None:
            fg.update(bwar=sb_["war"], pa=int(sb_["pa"] or 0), defr=sb_.get("def"), bsr=sb_.get("bsr"), woba=sb_.get("woba"))
        if sp_ and sp_.get("war") is not None:
            fg.update(pwar=sp_["war"], bf=int(sp_["bf"] or 0), gs=int(sp_["gs"] or 0), fip=sp_.get("fip"))
        if fg:
            entry["fg"] = {k: v for k, v in fg.items() if v is not None}
        if "bat" in entry or "pit" in entry:
            out_players[str(pid)] = entry

        # ---- 40-man players missing from rosters.json, with a real MLB track record.
        tid = missing.get(pid)
        if tid is None:
            continue
        b, pi = entry.get("bat"), entry.get("pit")
        pos = (p.get("primaryPosition") or {}).get("abbreviation", "DH")
        is_pitcher = pos in ("P", "SP", "RP") or (pi and (not b or pi["career"] > b["career"]))
        recent = sum(s["bf" if is_pitcher else "pa"] for y, s in seasons["pitching" if is_pitcher else "hitting"].items()
                     if y >= LAST_YEAR - 3)
        if recent < (150 if is_pitcher else 300):
            continue
        if is_pitcher:
            starter = (pi.get("gsShare") or 0) >= 0.5
            role = "rotation" if starter else "bullpen"
            stamina = round(min(105, max(20, (pi.get("ipPerGs") or 1.2) * 16))) if starter else 25
        else:
            role = "lineup" if b["pa"] >= 350 else "bench"
        rp = {
            "id": pid, "name": p.get("fullName"), "num": p.get("primaryNumber"), "pos": "P" if is_pitcher else pos,
            "bats": (p.get("batSide") or {}).get("code"), "throws": (p.get("pitchHand") or {}).get("code"),
            "heightIn": None, "weight": p.get("weight"), "age": round(age_on(birth, LAST_YEAR) or 28),
            "zone": [None, None],
            "sprint": (b or {}).get("sprint") or POS_SPRINT.get(pos, 26.5), "arm": POS_ARM.get(pos, 82),
            "role": role,
        }
        if is_pitcher:
            rp["pitch"] = {"bf": pi["bf"], "k": pi["k"], "bb": pi["bb"], "stamina": stamina, "arsenal": []}
        else:
            rp["bat"] = {"pa": b["pa"], "k": b["k"], "bb": b["bb"], "hr": b["hr"]}
        extras[str(tid)].append(rp)

    sc = statcast_extras(set(out_players), args.refresh)
    payload = {"projSeason": proj_year, "years": [FIRST_YEAR, LAST_YEAR], "built": date.today().isoformat(),
               "players": out_players, "extras": extras, "sc": sc}
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    n_extra = sum(len(v) for v in extras.values())
    print(f"wrote {len(out_players)} projections + {n_extra} added 40-man players to {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
