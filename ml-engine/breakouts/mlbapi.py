"""MLB Stats API helpers (awards, bios, pre/post All-Star splits), cached on disk."""

from __future__ import annotations

import json
from pathlib import Path

import requests

from savant import CACHE_DIR

API = "https://statsapi.mlb.com/api/v1"

# MLB-level honors that mean a player is already "on the map".
ESTABLISHED_AWARDS = {
    "ALAS": "All-Star", "NLAS": "All-Star",
    "ALGG": "Gold Glove", "NLGG": "Gold Glove",
    "ALSS": "Silver Slugger", "NLSS": "Silver Slugger",
    "ALROY": "Rookie of the Year", "NLROY": "Rookie of the Year",
    "MLBAFIRST": "All-MLB", "MLBSECOND": "All-MLB",
    "ALMVP": "MVP", "NLMVP": "MVP", "ALCY": "Cy Young", "NLCY": "Cy Young",
    "ALHAA": "Hank Aaron Award", "NLHAA": "Hank Aaron Award",
    "MLBPCALOR": "Players Choice Outstanding Rookie", "MLBPCNLOR": "Players Choice Outstanding Rookie",
}
# Subset that counts as a breakout *outcome* (Gold Gloves are defense-only, so not predicted here).
BREAKOUT_AWARDS = {k for k, v in ESTABLISHED_AWARDS.items() if v != "Gold Glove"}


def _get(path: str, params: dict) -> dict:
    resp = requests.get(f"{API}{path}", params=params, timeout=60)
    resp.raise_for_status()
    return resp.json()


def fetch_awards(ids: list[int], *, refresh: bool = False) -> tuple[dict[int, list[tuple[str, int]]], dict[int, int]]:
    """Returns (player_id -> [(award_id, season)], player_id -> MLB debut year).

    Awards are limited to ESTABLISHED_AWARDS plus reliever-of-the-year honors.
    """
    path = CACHE_DIR / "awards_v2.json"
    cache: dict[str, dict] = {}
    if path.exists() and not refresh:
        cache = json.loads(path.read_text())
    missing = [i for i in ids if str(i) not in cache]
    for start in range(0, len(missing), 100):
        chunk = missing[start : start + 100]
        data = _get("/people", {"personIds": ",".join(map(str, chunk)), "hydrate": "awards"})
        for person in data.get("people", []):
            out = []
            for award in person.get("awards", []):
                aid, name = award.get("id", ""), award.get("name", "")
                if aid in ESTABLISHED_AWARDS or "Reliever of the Year" in name:
                    out.append([aid if aid in ESTABLISHED_AWARDS else "RELIEVER", int(award.get("season") or 0)])
            debut = (person.get("mlbDebutDate") or "")[:4]
            cache[str(person["id"])] = {"awards": out, "debut": int(debut) if debut.isdigit() else None}
        for pid in chunk:
            cache.setdefault(str(pid), {"awards": [], "debut": None})
        path.write_text(json.dumps(cache))
    awards = {int(k): [(a, s) for a, s in v["awards"]] for k, v in cache.items()}
    debuts = {int(k): v["debut"] for k, v in cache.items() if v.get("debut")}
    return awards, debuts


def award_label(aid: str) -> str:
    return "Reliever of the Year" if aid == "RELIEVER" else ESTABLISHED_AWARDS.get(aid, aid)


def fetch_people(ids: list[int]) -> dict[int, dict]:
    out: dict[int, dict] = {}
    for start in range(0, len(ids), 100):
        chunk = ids[start : start + 100]
        data = _get("/people", {"personIds": ",".join(map(str, chunk)), "hydrate": "currentTeam"})
        for person in data.get("people", []):
            team = person.get("currentTeam") or {}
            out[person["id"]] = {
                "name": person.get("fullName"),
                # Minor-league (and winter-league) clubs carry the MLB parent as parentOrgId.
                "teamId": team.get("parentOrgId") or team.get("id"),
                "position": (person.get("primaryPosition") or {}).get("abbreviation"),
                "bats": (person.get("batSide") or {}).get("code"),
                "throws": (person.get("pitchHand") or {}).get("code"),
            }
    return out


def fetch_half_splits(player_id: int, group: str, season: int) -> dict[str, dict]:
    """{'preas': stat, 'posas': stat} for hitting|pitching. Cached per player/season."""
    path = CACHE_DIR / "splits" / f"{group}_{season}_{player_id}.json"
    if path.exists():
        return json.loads(path.read_text())
    path.parent.mkdir(parents=True, exist_ok=True)
    data = _get(
        f"/people/{player_id}/stats",
        {"stats": "statSplits", "group": group, "season": season, "sitCodes": "preas,posas"},
    )
    out: dict[str, dict] = {}
    for block in data.get("stats", []):
        for split in block.get("splits", []):
            out[split["split"]["code"]] = split["stat"]
    path.write_text(json.dumps(out))
    return out
