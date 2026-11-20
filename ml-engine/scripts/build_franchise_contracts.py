"""Real MLB contracts for Play Ball franchise mode.

Reads each club's "Team Future Payrolls" table on Baseball-Reference (sourced from Cot's
Baseball Contracts; arbitration estimates from MLB Trade Rumors) for the first franchise
season onward:

  * guaranteed salary for each remaining season (signing bonuses and buyouts included the
    way B-Ref spreads them), total value and length of the whole deal,
  * club / player / mutual / vesting options after the guaranteed years (salary + buyout),
  * arbitration status with the MLBTR projected award, or pre-arbitration,
  * MLB service time (YY.DDD).

B-Ref ids are mapped to MLBAM ids through the Chadwick Bureau register, falling back to a
name match against rosters.json (+ the 40-man extras in franchise-proj.json).

Then every rostered player's offseason transactions come from the MLB Stats API, so the
league opens the way the winter actually stands:

  * players who elected free agency / were released (and haven't signed with a club since)
    are listed under "fa" and start on the open market,
  * players who changed organizations (trades, waiver claims, signings) are listed under
    "org" with their new club,
  * a few deals B-Ref's payroll pages miss (club options picked up, opt-outs not taken —
    the page shows those players as free agents, but they never left) come from OVERRIDES.

Pages are cached in ml-engine/data/franchise_hist_cache/ like the other franchise builders.
B-Ref allows ~20 requests a minute, so a fresh run takes about two minutes.

Writes web/data/game/franchise-contracts.json.

Usage:  python3 scripts/build_franchise_contracts.py [--season 2027] [--refresh]
"""

from __future__ import annotations

import argparse
import csv
import html
import io
import json
import re
import time
import unicodedata
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "franchise_hist_cache"
WEB = ROOT.parent / "web" / "data" / "game"
ROSTERS = WEB / "rosters.json"
PROJ = WEB / "franchise-proj.json"
OUT = WEB / "franchise-contracts.json"

# MLBAM team id → Baseball-Reference franchise code.
BREF = {108: "ANA", 109: "ARI", 110: "BAL", 111: "BOS", 112: "CHC", 113: "CIN", 114: "CLE", 115: "COL",
        116: "DET", 117: "HOU", 118: "KCR", 119: "LAD", 120: "WSN", 121: "NYM", 133: "OAK", 134: "PIT",
        135: "SDP", 136: "SEA", 137: "SFG", 138: "STL", 139: "TBD", 140: "TEX", 141: "TOR", 142: "MIN",
        143: "PHI", 144: "ATL", 145: "CHW", 146: "FLA", 147: "NYY", 158: "MIL"}
# B-Ref's evergreen "salaries and contracts" page per club (always the current payroll; some
# "<year>-payroll-salaries" pages 404 or lag a season behind).
SLUG = {108: "los-angeles-angels", 109: "arizona-diamondbacks", 110: "baltimore-orioles", 111: "boston-red-sox",
        112: "chicago-cubs", 113: "cincinnati-reds", 114: "cleveland-guardians", 115: "colorado-rockies",
        116: "detroit-tigers", 117: "houston-astros", 118: "kansas-city-royals", 119: "los-angeles-dodgers",
        120: "washington-nationals", 121: "new-york-mets", 133: "athletics", 134: "pittsburgh-pirates",
        135: "san-diego-padres", 136: "seattle-mariners", 137: "san-francisco-giants", 138: "st-louis-cardinals",
        139: "tampa-bay-rays", 140: "texas-rangers", 141: "toronto-blue-jays", 142: "minnesota-twins",
        143: "philadelphia-phillies", 144: "atlanta-braves", 145: "chicago-white-sox", 146: "miami-marlins",
        147: "new-york-yankees", 158: "milwaukee-brewers"}
# Deals the payroll pages drop: the 2027 option was exercised (or an opt-out not taken), so the
# Stats API shows no free agency, but B-Ref lists the player as a 2027 free agent. Terms from
# Cot's Baseball Contracts. Keyed by name; only used when B-Ref has no deal for the player.
OVERRIDES: dict[str, dict] = {
    "Ronald Acuña Jr.": {"sal": [17.0], "total": 100.0, "len": 8, "first": 2019, "last": 2027,
                         "opt": {"season": 2028, "type": "team", "salary": 17.0, "buyout": 0},
                         "summary": "8 yrs/$100M (19-26), 27 club option exercised & 28 club option"},
    "Ozzie Albies": {"sal": [7.0], "total": 35.0, "len": 7, "first": 2019, "last": 2027,
                     "summary": "7 yrs/$35M (19-25), 26-27 club options exercised"},
    "Sandy Alcantara": {"sal": [21.0], "total": 56.0, "len": 5, "first": 2022, "last": 2027,
                        "summary": "5 yrs/$56M (22-26), 27 club option exercised"},
    "Bo Bichette": {"sal": [42.0], "total": 126.0, "len": 3, "first": 2026, "last": 2027,
                    "opt": {"season": 2028, "type": "player", "salary": 42.0, "buyout": 0},
                    "summary": "3 yrs/$126M (26-28), opt-out after 27"},
    "Andrés Muñoz": {"sal": [6.0], "total": 7.5, "len": 4, "first": 2023, "last": 2027,
                     "opt": {"season": 2028, "type": "team", "salary": 8.0, "buyout": 0},
                     "summary": "4 yrs/$7.5M (23-26), 27 club option exercised, 28-29 club options"},
    "Garrett Whitlock": {"sal": [10.0], "total": 18.75, "len": 4, "first": 2022, "last": 2027,
                         "summary": "4 yrs/$18.75M (22-25), 26-27 club options exercised"},
    "Luis Severino": {"sal": [22.33], "total": 67.0, "len": 3, "first": 2025, "last": 2027,
                      "summary": "3 yrs/$67M (25-27), opt-out after 26 not exercised"},
    "Ryan Helsley": {"sal": [14.0], "total": 28.0, "len": 2, "first": 2026, "last": 2027,
                     "summary": "2 yrs/$28M (26-27), opt-out after 26 not exercised"},
    # 2027 options picked up / vested (MLB.com, Tampa Bay Times, theScore, Spotrac, Oct-Nov 2026).
    "Drew Rasmussen": {"sal": [20.0], "total": 20.0, "len": 1, "first": 2027, "last": 2027,
                       "summary": "27 club option exercised ($20M, escalated from $8M)"},
    "Yandy Díaz": {"sal": [13.0], "total": 13.0, "len": 1, "first": 2027, "last": 2027,
                   "summary": "27 vesting option vested ($13M)"},
    "Aroldis Chapman": {"sal": [13.0], "total": 13.0, "len": 1, "first": 2027, "last": 2027,
                        "summary": "27 vesting option vested ($13M)"},
    "Wandy Peralta": {"sal": [4.45], "total": 4.45, "len": 1, "first": 2027, "last": 2027,
                      "summary": "27 player option exercised ($4.45M)"},
    "Drew Anderson": {"sal": [10.0], "total": 10.0, "len": 1, "first": 2027, "last": 2027,
                      "summary": "27 club option exercised ($10M)"},
    "Tony Gonsolin": {"sal": [2.5], "total": 2.5, "len": 1, "first": 2027, "last": 2027,
                      "summary": "27 club option exercised ($2.5M)"},
    # Re-signed / signed this winter, after the payroll pages were captured.
    "Jacob Webb": {"sal": [2.5], "total": 2.5, "len": 1, "first": 2027, "last": 2027,
                   "opt": {"season": 2028, "type": "team", "salary": 4.0, "buyout": 0},
                   "summary": "1 yr/$2.5M (27) & 28 club option"},
    "Jacob Waguespack": {"sal": [1.3], "total": 1.3, "len": 1, "first": 2027, "last": 2027,
                         "summary": "1 yr/$1.3M (27)"},
    "Tim Mayza": {"sal": [2.75], "total": 2.75, "len": 1, "first": 2027, "last": 2027,
                  "summary": "1 yr/$2.75M (27)"},
    "David Bednar": {"sal": [23.15], "total": 23.15, "len": 1, "first": 2027, "last": 2027,
                     "summary": "1 yr/$23.15M (27), qualifying offer accepted"},
    "Ryan Jeffers": {"sal": [23.15], "total": 23.15, "len": 1, "first": 2027, "last": 2027,
                     "summary": "1 yr/$23.15M (27), qualifying offer accepted"},
    "Evan Phillips": {"sal": [11.0, 11.0, 13.0], "total": 35.0, "len": 3, "first": 2027, "last": 2029,
                      "summary": "3 yrs/$35M (27-29)"},
    "Jake Bauers": {"sal": [14.5, 14.5, 14.5, 14.5], "total": 58.0, "len": 4, "first": 2027, "last": 2030,
                    "summary": "4 yrs/$58M (27-30)"},
    "Sonny Gray": {"sal": [20.0], "total": 55.0, "len": 2, "first": 2027, "last": 2027,
                   "opt": {"season": 2028, "type": "player", "salary": 30.0, "buyout": 5.0},
                   "summary": "2 yrs/$55M (27-28), 28 player option ($5M buyout)"},
    "Dustin May": {"sal": [17.5, 17.5, 17.5], "total": 52.5, "len": 3, "first": 2027, "last": 2029,
                   "summary": "3 yrs/$52.5M (27-29)"},
    "Emilio Pagán": {"sal": [11.5], "total": 11.5, "len": 1, "first": 2027, "last": 2027,
                     "summary": "1 yr/$11.5M (27)"},
}

STATSAPI = "https://statsapi.mlb.com/api/v1"
# Offseason moves: leaving an organization / joining one. Within a day, outrights and
# assignments happen before the player elects free agency, and signings come last.
LEAVE = ("Declared Free Agency", "Released", "Retired", "Voluntarily Retired")
JOIN = ("Signed as Free Agent", "Trade", "Claimed Off Waivers", "Signed", "Rule 5 Draft")
OPT_TYPES = {"team": "team", "club": "team", "player": "player", "mutual": "mutual", "vesting": "vesting"}


def fetch(url: str, name: str, refresh: bool, pause: float = 0.25) -> str:
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / name
    if f.exists() and not refresh:
        return f.read_text()
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (wtbb-franchise-builder)"})
            text = urllib.request.urlopen(req, timeout=60).read().decode("utf-8-sig")
            f.write_text(text)
            time.sleep(pause)
            return text
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f"  retry {name}: {e}")
            time.sleep(10 * (attempt + 1))
    return ""


def money(s: str) -> float | None:
    """'$27.83M' → 27.83, '$750K' → 0.75 ($M)."""
    m = re.search(r"\$([\d,.]+)\s*([MKmk])?", s)
    if not m:
        return None
    v = float(m.group(1).replace(",", ""))
    if (m.group(2) or "").upper() == "K":
        v /= 1000
    elif not m.group(2):
        v /= 1e6
    return round(v, 3)


def text(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s)).replace("\xa0", " ").strip()


def norm_name(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", s)
    return re.sub(r"[^a-z]", "", s)


def service_years(s: str) -> float | None:
    """B-Ref YY.DDD (172 days = 1 year) → fractional years."""
    m = re.match(r"(\d+)\.(\d{3})", s.strip())
    if not m:
        return None
    return round(int(m.group(1)) + min(171, int(m.group(2))) / 172, 3)


def parse_summary(s: str, season: int) -> dict:
    """'13 yrs/$325M (15-27) & 28 team option' → length, total, first/last guaranteed season, options."""
    out: dict = {}
    m = re.search(r"(\d+)\s*yrs?/\$([\d.,]+)\s*([MK])", s)
    if m:
        out["len"] = int(m.group(1))
        tot = float(m.group(2).replace(",", ""))
        out["total"] = round(tot / 1000 if m.group(3) == "K" else tot, 2)
    m = re.search(r"\((\d{2})(?:-(\d{2}))?\)", s)
    if m:
        century = season // 100 * 100
        out["first"] = century + int(m.group(1))
        out["last"] = century + int(m.group(2) or m.group(1))
    return out


def parse_team(page: str, team_id: int, season: int) -> list[dict]:
    page = page.replace("<!--", "").replace("-->", "")
    i = page.find('id="payroll"')
    if i < 0:
        raise RuntimeError(f"no payroll table for {team_id}")
    table = page[i:page.find("</table>", i)]
    years = [int(y) for y in re.findall(r'data-stat="contract_y\d"[^>]*>(\d{4})</th>', table)]
    if not years or years[0] != season:
        raise RuntimeError(f"{team_id}: payroll columns start {years[:1]}, expected {season}")
    out = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S):
        cells = {m.group(1): m.group(2) for m in re.finditer(r'<t[hd][^>]*data-stat="([^"]+)"[^>]*>(.*?)</t[hd]>', row, re.S)}
        link = re.search(r'href="/players/\w/([\w.]+)\.shtml">([^<]+)</a>', cells.get("player", ""))
        if not link:
            continue
        p = {"bref": link.group(1), "name": html.unescape(link.group(2)), "team": team_id}
        svc = service_years(text(cells.get("service_time", "")))
        if svc is not None:
            p["svc"] = svc
        summ = text(cells.get("contract_summary", ""))
        if summ:
            p["summary"] = summ
            p.update(parse_summary(summ, season))
        sal: list[float] = []
        status = None
        arb_est = None
        for k, y in enumerate(years):
            raw = cells.get(f"contract_y{k}", "")
            t = text(raw)
            tip = re.search(r'data-tip="([^"]*Option[^"]*)"', raw, re.I)
            if tip:
                tip_t = html.unescape(tip.group(1))
                kind = next((v for kk, v in OPT_TYPES.items() if kk in tip_t.lower()), "team")
                p["opt"] = {"season": y, "type": kind, "salary": money(tip_t) or 0, "buyout": money(t) or 0}
                break
            if t.startswith("$"):
                v = money(t)
                if v is not None:
                    sal.append(v)
                continue
            if k == 0:
                m = re.match(r"(Pre-Arb|Arb)(?:-(\d))?", t)
                if m:
                    status = "arb" if m.group(1) == "Arb" else "pre"
                    p["arbYear" if status == "arb" else "preYear"] = int(m.group(2) or 1)
                    arb_est = money(t)
                elif t.startswith("FA"):
                    status = "fa"
            break
        if sal:
            p["kind"] = "guar"
            # Seasons past the table's last column: carry the final salary.
            last = p.get("last", years[0] + len(sal) - 1)
            if len(sal) == len(years) and last > years[-1]:
                sal += [sal[-1]] * (last - years[-1])
            p["sal"] = sal
        elif status in ("arb", "pre"):
            p["kind"] = status
            if arb_est:
                p["arb"] = arb_est
        elif svc is not None and svc < 6:
            # Under six years of service the club still controls him, whatever the page shows
            # for next season (B-Ref marks an expiring one-year deal "FA" even for a pre-arb arm).
            p["kind"] = "arb" if svc >= 3 else "pre"
        elif svc is not None:
            p["kind"] = "none"  # no deal on the page; service time still useful for overrides
        else:
            continue
        out.append(p)
    return out


def chadwick(refresh: bool) -> dict[str, int]:
    ids: dict[str, int] = {}
    for h in "0123456789abcdef":
        txt = fetch(f"https://raw.githubusercontent.com/chadwickbureau/register/master/data/people-{h}.csv", f"chadwick_people_{h}.csv", refresh, 0)
        for r in csv.DictReader(io.StringIO(txt)):
            if r.get("key_bbref") and r.get("key_mlbam"):
                ids[r["key_bbref"]] = int(r["key_mlbam"])
    return ids


def known_players() -> dict[str, list[tuple[int, int]]]:
    """Normalized name → [(mlbam id, team id)] from rosters.json and the projection extras."""
    by: dict[str, list[tuple[int, int]]] = {}
    ros = json.loads(ROSTERS.read_text())
    for tid, t in ros["teams"].items():
        for grp in ("lineup", "bench", "rotation", "bullpen"):
            for p in t.get(grp, []):
                by.setdefault(norm_name(p["name"]), []).append((p["id"], int(tid)))
    if PROJ.exists():
        for tid, lst in json.loads(PROJ.read_text()).get("extras", {}).items():
            for p in lst:
                by.setdefault(norm_name(p["name"]), []).append((p["id"], int(tid)))
    return by


def fetch_json(url: str) -> dict:
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (wtbb-franchise-builder)"})
            return json.loads(urllib.request.urlopen(req, timeout=60).read())
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f"  retry {url[:80]}: {e}")
            time.sleep(5 * (attempt + 1))
    return {}


def parent_orgs(season: int) -> dict[int, int]:
    """Every MLB and affiliated minor-league club id → its MLB parent (MLB clubs map to themselves)."""
    out: dict[int, int] = {}
    d = fetch_json(f"{STATSAPI}/teams?sportIds=1,11,12,13,14,16&season={season}")
    for t in d.get("teams", []):
        if t.get("sport", {}).get("id") == 1:
            out[t["id"]] = t["id"]
        elif t.get("parentOrgId"):
            out[t["id"]] = t["parentOrgId"]
    return out


def offseason_status(ids: dict[int, int], season: int) -> tuple[dict[str, dict], dict[str, int], dict[str, int], dict[str, str]]:
    """
    Where each rostered player stands this winter (since the end of the regular season):
    free agents (with the club they left), players now in another organization, each
    player's MLB debut season, and players who left and signed again ("minor" / "major"
    league deal). `ids` maps MLBAM id → the club rosters.json has him on.
    """
    orgs = parent_orgs(season - 1)
    # From September on: a few veterans elect free agency off an outright in late September,
    # days before the regular season ends.
    since = f"{season - 1}-09-01"
    fa: dict[str, dict] = {}
    moved: dict[str, int] = {}
    debut: dict[str, int] = {}
    signed: dict[str, str] = {}
    order = {**{k: 1 for k in LEAVE}, **{k: 2 for k in JOIN}}
    keys = list(ids)
    for i in range(0, len(keys), 60):
        q = ",".join(str(k) for k in keys[i:i + 60])
        d = fetch_json(f"{STATSAPI}/people?personIds={q}&hydrate=transactions,currentTeam")
        for p in d.get("people", []):
            pid = p["id"]
            home = ids[pid]
            if p.get("mlbDebutDate"):
                debut[str(pid)] = int(p["mlbDebutDate"][:4])
            org: int | None = home
            left: str | None = None
            txs = [t for t in p.get("transactions", []) if (t.get("date") or "") >= since]
            txs.sort(key=lambda t: (t.get("date") or "", order.get(t.get("typeDesc", ""), 0)))
            for t in txs:
                kind = t.get("typeDesc", "")
                to = (t.get("toTeam") or {}).get("id")
                if kind in LEAVE:
                    org, left = None, t.get("date")
                elif kind in JOIN and to in orgs:
                    org = orgs[to]
                    if kind.startswith("Signed") and left:
                        # Signed again after leaving: a new deal, not the old one or club control.
                        signed[str(pid)] = "minor" if "minor league" in (t.get("description") or "").lower() else "major"
                elif kind in ("Outrighted", "Assigned", "Optioned", "Selected", "Recalled", "Status Change") and org is not None and to in orgs:
                    org = orgs[to]
            # The roster snapshot can predate a summer move (Gonsolin to KC in August): an
            # affiliated current club settles the organization for anyone still under contract.
            cur = (p.get("currentTeam") or {}).get("id")
            if org is not None and cur in orgs:
                org = orgs[cur]
            if org is None:
                fa[str(pid)] = {"from": home, "date": left}
            elif org != home:
                moved[str(pid)] = org
        time.sleep(0.2)
    return fa, moved, debut, signed


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2027, help="first franchise season (B-Ref page year is the one before)")
    ap.add_argument("--refresh", action="store_true", help="re-download the payroll pages")
    args = ap.parse_args()
    season = args.season

    rows: list[dict] = []
    for tid, code in BREF.items():
        name = f"bref_payroll_{code}_{season - 1}.html"
        cached = (CACHE / name).exists() and not args.refresh
        try:
            page = fetch(f"https://www.baseball-reference.com/teams/{code}/{SLUG[tid]}-salaries-and-contracts.shtml", name, args.refresh, 3.5)
            got = parse_team(page, tid, season)
        except Exception as e:  # noqa: BLE001
            print(f"  {code}: contracts page failed ({e}); trying {season - 1}-payroll-salaries")
            name = f"bref_payroll_{code}_{season - 1}_year.html"
            page = fetch(f"https://www.baseball-reference.com/teams/{code}/{season - 1}-payroll-salaries.shtml", name, args.refresh, 3.5)
            got = parse_team(page, tid, season)
        print(f"  {code}: {len(got)} players{' (cached)' if cached else ''}")
        rows += got

    bref_ids = chadwick(args.refresh)
    names = known_players()
    players: dict[str, dict] = {}
    svc_of: dict[str, float] = {}
    unmatched = []
    for r in rows:
        mid = bref_ids.get(r["bref"])
        if mid is None:
            cands = names.get(norm_name(r["name"]), [])
            same = [c for c in cands if c[1] == r["team"]] or cands
            mid = same[0][0] if len(same) == 1 else None
        if mid is None:
            if r["kind"] != "none":
                unmatched.append(f"{r['name']} ({BREF[r['team']]})")
            continue
        if "svc" in r:
            svc_of[str(mid)] = max(svc_of.get(str(mid), 0), r["svc"])
        if r["kind"] == "none":
            continue
        e: dict = {"team": r["team"], "kind": r["kind"]}
        for k in ("svc", "sal", "arb", "arbYear", "preYear", "total", "len", "first", "last", "opt", "summary"):
            if k in r:
                e[k] = r[k]
        prev = players.get(str(mid))
        # A player traded mid-deal can show on two pages (the payer's as cash): keep the richer entry.
        if prev and sum(prev.get("sal", [])) >= sum(e.get("sal", [])):
            continue
        players[str(mid)] = e

    # Payroll pages that dropped a deal (option picked up / opt-out not taken).
    by_name = {norm_name(n): n for n in OVERRIDES}
    for nm, cands in names.items():
        if nm not in by_name or len({c[0] for c in cands}) != 1:
            continue
        mid, tid = cands[0]
        if str(mid) in players and players[str(mid)]["kind"] == "guar":
            continue
        o = OVERRIDES[by_name[nm]]
        players[str(mid)] = {"team": players.get(str(mid), {}).get("team", tid), "kind": "guar",
                             **({"svc": svc_of[str(mid)]} if str(mid) in svc_of else {}), **o}

    # The winter so far: free agents and changes of organization.
    rostered: dict[int, int] = {}
    for nm, cands in names.items():
        for mid, tid in cands:
            rostered.setdefault(mid, tid)
    fa, moved, debut, signed = offseason_status(rostered, season)
    for k in fa:
        # A free agent's old deal is over (a released player's remaining salary stays with the
        # club as dead money — keep the entry so the game can charge it).
        e = players.get(k)
        if e and e["kind"] != "guar":
            del players[k]
    for k, org in moved.items():
        if k in players:
            players[k]["team"] = org
    # On a 40-man but on no payroll page (contract selected after the snapshot): still under
    # club control. Arbitration-eligible after about three seasons in the majors.
    added = 0
    new_deals = []
    for mid, tid in rostered.items():
        k = str(mid)
        if k in fa:
            continue
        e = players.get(k)
        # A winter signing replaces whatever the payroll page had, except a guaranteed deal
        # (OVERRIDES, or a page already showing the new contract).
        if k in signed and (e is None or e["kind"] != "guar"):
            if signed[k] == "minor":
                players[k] = {"team": moved.get(k, tid), "kind": "minor", **({"svc": e["svc"]} if e and "svc" in e else {})}
            else:
                players.pop(k, None)
                new_deals.append(k)
            continue
        if e is not None:
            continue
        # Service time isn't on any page: about three-quarters of a season per year since the
        # debut, capped below six so the game never treats him as a free agent while controlled.
        svc = round(min(5.5, 0.75 * max(0, season - debut[k])), 3) if k in debut else 0.0
        players[k] = {"team": moved.get(k, tid), "kind": "arb" if svc >= 3 else "pre", "svc": svc, "ctl": True}
        added += 1
    print(f"  offseason: {len(fa)} free agents, {len(moved)} changed organizations, {added} 40-man adds under club control")
    if new_deals:
        print(f"  {len(new_deals)} signed this winter with no deal on file (add to OVERRIDES): {', '.join(new_deals)}")

    payload = {
        "season": season,
        "built": date.today().isoformat(),
        "source": "Baseball-Reference team payrolls (Cot's Baseball Contracts; MLBTR arbitration estimates)",
        "players": players,
        "fa": fa,
        "org": moved,
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
    kinds: dict[str, int] = {}
    for e in players.values():
        kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
    print(f"wrote {len(players)} contracts {kinds} to {OUT} ({OUT.stat().st_size // 1024} KB)")
    if unmatched:
        print(f"  {len(unmatched)} unmatched: {', '.join(unmatched[:25])}{' …' if len(unmatched) > 25 else ''}")


if __name__ == "__main__":
    main()
