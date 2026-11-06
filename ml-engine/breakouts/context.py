"""Context the Savant leaderboards don't carry: park-adjusted wRC+ and injured-list time.

wRC+ follows the FanGraphs formula with public inputs:
  wRAA/PA = (wOBA - lgwOBA) / wOBA scale, wOBA scale = lgOBP / raw lgwOBA, where raw wOBA uses
  standard run values above an out (uBB .55, HBP .57, 1B .70, 2B 1.00, 3B 1.27, HR 1.65)
  wRC+    = 100 * (wRAA/PA + lgR/PA + (lgR/PA - PF * lgR/PA)) / lgR/PA
League runs, PA and OBP come from MLB Stats API team totals; PF is the Statcast 3-year rolling
runs index for the player's team park, halved because only half the games are at home. Players
who changed teams mid-season get a neutral park.

IL time comes from MLB Stats API transactions ("placed ... on the N-day injured list",
"activated ... from the N-day injured list"), clipped to the regular season.
"""

from __future__ import annotations

import json
import re
import time
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import requests

CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "savant_breakouts" / "context"
API = "https://statsapi.mlb.com/api/v1"
UA = {"User-Agent": "Mozilla/5.0"}


def _get_json(url: str, params: dict | None = None) -> dict:
    for attempt in range(4):
        try:
            resp = requests.get(url, params=params, timeout=90, headers=UA)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def _cached(name: str, refresh: bool, fetch) -> object:
    path = CACHE_DIR / name
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    data = fetch()
    path.write_text(json.dumps(data))
    return data


# ---------------------------------------------------------------- wRC+


def league_hitting(year: int, refresh: bool = False) -> dict:
    def fetch():
        d = _get_json(f"{API}/teams/stats", {"season": year, "group": "hitting", "stats": "season", "sportIds": 1})
        splits = d["stats"][0]["splits"]
        tot = {k: sum(float(s["stat"][k]) for s in splits)
               for k in ("runs", "plateAppearances", "hits", "doubles", "triples", "homeRuns", "baseOnBalls",
                         "intentionalWalks", "hitByPitch", "atBats", "sacFlies")}
        return tot
    t = _cached(f"league_v2_{year}.json", refresh, fetch)
    den = t["atBats"] + t["baseOnBalls"] - t["intentionalWalks"] + t["hitByPitch"] + t["sacFlies"]
    obp = (t["hits"] + t["baseOnBalls"] + t["hitByPitch"]) / (t["atBats"] + t["baseOnBalls"] + t["hitByPitch"] + t["sacFlies"])
    singles = t["hits"] - t["doubles"] - t["triples"] - t["homeRuns"]
    raw = (0.55 * (t["baseOnBalls"] - t["intentionalWalks"]) + 0.57 * t["hitByPitch"] + 0.70 * singles
           + 1.00 * t["doubles"] + 1.27 * t["triples"] + 1.65 * t["homeRuns"]) / den
    return {"r_pa": t["runs"] / t["plateAppearances"], "obp": obp, "scale": obp / raw}


def park_factors(year: int, refresh: bool = False) -> dict[int, float]:
    """team_id -> halved runs park factor (1.0 = neutral) from Statcast's 3-year rolling index."""
    def fetch():
        resp = requests.get(
            "https://baseballsavant.mlb.com/leaderboard/statcast-park-factors",
            params={"type": "year", "year": year, "batSide": "", "stat": "index_wOBA", "condition": "All",
                    "rolling": 3, "parks": "mlb"},
            timeout=90, headers=UA)
        resp.raise_for_status()
        m = re.search(r"var data = (\[.*?\]);", resp.text, re.S)
        rows = json.loads(m.group(1)) if m else []
        return {str(r["main_team_id"]): float(r["index_runs"]) for r in rows if r.get("index_runs")}
    raw = _cached(f"parks_{year}.json", refresh, fetch)
    return {int(k): 1 + (v / 100 - 1) / 2 for k, v in raw.items()}


def player_teams(year: int, refresh: bool = False) -> dict[int, int | None]:
    """player_id -> team id for single-team seasons, None for players who moved."""
    def fetch():
        d = _get_json(f"{API}/stats", {"stats": "season", "group": "hitting", "season": year,
                                       "playerPool": "ALL", "sportId": 1, "limit": 5000})
        out = {}
        for s in d["stats"][0]["splits"]:
            multi = (s.get("numTeams") or 1) > 1
            out[str(s["player"]["id"])] = None if multi else (s.get("team") or {}).get("id")
        return out
    return {int(k): v for k, v in _cached(f"teams_{year}.json", refresh, fetch).items()}


def add_wrc_plus(df: pd.DataFrame, year: int, lg_woba: float, refresh: bool = False) -> pd.Series:
    lg = league_hitting(year, refresh)
    pf = park_factors(year, refresh)
    teams = player_teams(year, refresh)
    scale = lg["scale"]
    park = df["player_id"].map(lambda p: pf.get(teams.get(int(p)) or -1, 1.0)).astype(float)
    r_pa = lg["r_pa"]
    return 100 * ((df["woba"] - lg_woba) / scale + r_pa + (r_pa - park * r_pa)) / r_pa


# ---------------------------------------------------------------- injured list

PLACED = re.compile(r"placed .*? on the (\d+)-day (?:injured|disabled) list"
                    r"(?: retroactive to ([A-Z][a-z]+ \d{1,2}, \d{4}))?\.?\s*(.*)$", re.I)
ACTIVATED = re.compile(r"(?:activated|reinstated) .*? from the (\d+)-day (?:injured|disabled) list", re.I)


def transactions(year: int, refresh: bool = False) -> list[dict]:
    def fetch():
        out = []
        for m0, m1 in ((1, 3), (4, 6), (7, 9), (10, 12)):
            end = (date(year, m1 % 12 + 1, 1) if m1 < 12 else date(year + 1, 1, 1)) - timedelta(days=1)
            d = _get_json(f"{API}/transactions",
                          {"startDate": f"{year}-{m0:02d}-01", "endDate": end.isoformat(), "sportId": 1})
            for t in d.get("transactions", []):
                desc = t.get("description") or ""
                if "injured list" in desc or "disabled list" in desc:
                    out.append({"id": (t.get("person") or {}).get("id"), "date": t.get("date"), "desc": desc})
        return out
    return _cached(f"il_{year}.json", refresh, fetch)


def season_window(year: int) -> tuple[date, date]:
    if year == 2020:
        return date(2020, 7, 23), date(2020, 9, 27)
    return date(year, 3, 26), date(year, 9, 30)


def injury_label(text: str) -> str:
    text = text.strip().rstrip(".")
    text = re.sub(r"^(right|left|bilateral)\s+", lambda m: m.group(1).lower() + " ", text, flags=re.I)
    return text[:1].lower() + text[1:] if text else ""


def il_summary(year: int, refresh: bool = False) -> pd.DataFrame:
    """One row per player: regular-season IL days, stints, and injury descriptions."""
    start, end = season_window(year)
    rows = sorted(transactions(year, refresh), key=lambda t: t["date"] or "")
    open_: dict[int, tuple[date, str]] = {}
    spans: dict[int, list[tuple[date, date, str]]] = {}
    for t in rows:
        pid, desc = t["id"], t["desc"]
        if not pid or not t["date"]:
            continue
        when = date.fromisoformat(t["date"][:10])
        if (m := PLACED.search(desc)) and m.group(1) != "7":
            if pid in open_:
                continue  # transfer to the 60-day list etc: same stint
            begin = when
            if m.group(2):
                try:
                    begin = pd.to_datetime(m.group(2)).date()
                except (ValueError, TypeError):
                    pass
            open_[pid] = (begin, injury_label(m.group(3)))
        elif (m := ACTIVATED.search(desc)) and m.group(1) != "7" and pid in open_:
            begin, what = open_.pop(pid)
            spans.setdefault(pid, []).append((begin, when, what))
    for pid, (begin, what) in open_.items():
        spans.setdefault(pid, []).append((begin, end, what))
    out = []
    for pid, ss in spans.items():
        days, stints, what = 0, 0, []
        for b, e, w in ss:
            d = (min(e, end) - max(b, start)).days
            if d > 0:
                days += d
                stints += 1
                if w and w not in what:
                    what.append(w)
        if days:
            out.append({"player_id": int(pid), "year": year, "il_days": days, "il_stints": stints,
                        "il_what": "; ".join(what[:3])})
    return pd.DataFrame(out, columns=["player_id", "year", "il_days", "il_stints", "il_what"])
