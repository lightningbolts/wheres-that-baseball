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
    unmatched = []
    for r in rows:
        mid = bref_ids.get(r["bref"])
        if mid is None:
            cands = names.get(norm_name(r["name"]), [])
            same = [c for c in cands if c[1] == r["team"]] or cands
            mid = same[0][0] if len(same) == 1 else None
        if mid is None:
            unmatched.append(f"{r['name']} ({BREF[r['team']]})")
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

    payload = {
        "season": season,
        "built": date.today().isoformat(),
        "source": "Baseball-Reference team payrolls (Cot's Baseball Contracts; MLBTR arbitration estimates)",
        "players": players,
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
