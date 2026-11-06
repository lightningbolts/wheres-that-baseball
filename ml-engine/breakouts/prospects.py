"""MLB Pipeline prospect rankings and minor-league season stats, cached on disk.

Rankings come from the GraphQL API behind mlb.com/prospects. Each `sel-pr-<year>-top100`
selection is the list as published before that season (frozen), so a list for year Y only
uses information available before Y. The current year's selection is the live list.
"""

from __future__ import annotations

import json
import re
import time

import requests

from savant import CACHE_DIR

GRAPHQL = "https://data-graph.mlb.com/graphql"
STATS_API = "https://statsapi.mlb.com/api/v1"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36",
      "Content-Type": "application/json"}

# mlb.com prospect-list slugs per organization (Cleveland was "indians" through 2021).
TEAM_SLUGS = [
    "dbacks", "braves", "orioles", "redsox", "cubs", "whitesox", "reds", "guardians", "rockies",
    "tigers", "astros", "royals", "angels", "dodgers", "marlins", "brewers", "twins", "mets",
    "yankees", "athletics", "phillies", "pirates", "padres", "giants", "mariners", "cardinals",
    "rays", "rangers", "bluejays", "nationals",
]

# Minor-league levels, highest first: sportId -> (code, level score)
LEVELS = {11: ("AAA", 3), 12: ("AA", 2), 13: ("A+", 1), 14: ("A", 0)}

_QUERY = (
    "{ getPlayerRankingsFromSelection(limit: %d, slug: \"%s\") { rank playerEntity { eta position "
    "prospectBio { contentTitle contentText } player { id fullName } } } }"
)


def _post(query: str) -> dict:
    for attempt in range(4):
        try:
            resp = requests.post(GRAPHQL, json={"query": query}, headers=UA, timeout=60)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def _grades(bios: list[dict], season: int) -> dict:
    """Scouting grades from the most recent bio written before `season` (avoids later rewrites)."""
    best, best_year = None, -1
    for bio in bios or []:
        title = str(bio.get("contentTitle") or "")
        year = int(title) if title.isdigit() else 0  # "draft" / "international" = earliest
        if year >= season or year < best_year:
            continue
        m = re.search(r"Overall:?\s*(\d+)", bio.get("contentText") or "")
        if m:
            best, best_year = bio, year
    if best is None:
        return {}
    text = re.sub(r"<[^>]+>", " ", best.get("contentText") or "")
    out = {}
    for key in ("Hit", "Power", "Run", "Arm", "Field", "Fastball", "Slider", "Curveball", "Changeup",
                "Cutter", "Splitter", "Control", "Overall"):
        m = re.search(rf"{key}:?\s*(\d+)", text)
        if m:
            out[key.lower()] = int(m.group(1))
    return out


def _entries(slug: str, limit: int, season: int) -> list[dict]:
    data = _post(_QUERY % (limit, slug)).get("data") or {}
    out = []
    for e in data.get("getPlayerRankingsFromSelection") or []:
        pe = e.get("playerEntity") or {}
        player = pe.get("player") or {}
        if not player.get("id"):
            continue
        eta = pe.get("eta")
        out.append({
            "player_id": int(player["id"]),
            "name": player.get("fullName"),
            "rank": int(e["rank"]),
            "position": pe.get("position") or "",
            "eta": int(eta) if eta and str(eta).isdigit() else None,
            "grades": _grades(pe.get("prospectBio") or [], season),
        })
    return out


def fetch_rankings(season: int, *, refresh: bool = False) -> list[dict]:
    """Top-100 plus every org top-30 for the list published before `season`.

    One row per player: overall rank (None outside the top 100), org rank, ETA, grades.
    `season` may be one past the newest list; then the newest (live) list is used.
    """
    path = CACHE_DIR / f"prospects_{season}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    slug_year = season
    top = _entries(f"sel-pr-{slug_year}-top100", 100, season)
    if not top:  # next year's list isn't out yet: use the live current list
        slug_year = season - 1
        top = _entries(f"sel-pr-{slug_year}-top100", 100, season + 1)
    rows: dict[int, dict] = {}
    for e in top:
        rows[e["player_id"]] = {**e, "overall_rank": e["rank"], "org_rank": None, "org": None}
    for slug in TEAM_SLUGS:
        team_slug = "indians" if slug == "guardians" and slug_year <= 2021 else slug
        for e in _entries(f"sel-pr-{slug_year}-{team_slug}", 30, season if slug_year == season else season + 1):
            row = rows.setdefault(e["player_id"], {**e, "overall_rank": None})
            row["org_rank"] = e["rank"]
            row["org"] = slug
            if not row.get("grades"):
                row["grades"] = e["grades"]
            if row.get("eta") is None:
                row["eta"] = e["eta"]
    out = list(rows.values())
    for r in out:
        r.pop("rank", None)
    path.write_text(json.dumps(out))
    return out


def fetch_milb(group: str, sport_id: int, season: int, *, refresh: bool = False) -> list[dict]:
    """Season stat lines for every player at one minor-league level (one row per team stint)."""
    path = CACHE_DIR / "milb" / f"{group}_{sport_id}_{season}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    path.parent.mkdir(parents=True, exist_ok=True)
    resp = requests.get(
        f"{STATS_API}/stats",
        params={"stats": "season", "group": group, "sportId": sport_id, "season": season,
                "playerPool": "ALL", "limit": 5000},
        timeout=90,
    )
    resp.raise_for_status()
    rows = []
    for block in resp.json().get("stats", []):
        for split in block.get("splits", []):
            if not split.get("team"):
                continue
            rows.append({"player_id": split["player"]["id"], **split["stat"]})
    path.write_text(json.dumps(rows))
    return rows
