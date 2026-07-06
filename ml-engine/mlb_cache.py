"""Fetch and cache MLB live feeds locally — avoids Supabase egress for training."""

from __future__ import annotations

import json
import subprocess
import time
from datetime import date
from pathlib import Path

import requests

MLB = "https://statsapi.mlb.com/api/v1"
MLB_FEED = "https://statsapi.mlb.com/api/v1.1/game/{game_pk}/feed/live"

DATA_DIR = Path(__file__).parent / "data"
FEED_CACHE_DIR = DATA_DIR / "mlb_feeds"
PARSED_CACHE_DIR = DATA_DIR / "parsed_states"
GAME_INDEX_PATH = DATA_DIR / "game_index.json"
PARSE_SCRIPT = Path(__file__).parent / "scripts" / "parse-feed.ts"
WEB_DIR = Path(__file__).parent.parent / "web"


def load_game_index() -> list[dict]:
    if not GAME_INDEX_PATH.exists():
        return []
    return json.loads(GAME_INDEX_PATH.read_text())


def save_game_index(games: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    GAME_INDEX_PATH.write_text(json.dumps(games, indent=2))


def fetch_schedule_games(
    *,
    season: int | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    final_only: bool = True,
) -> list[dict]:
    """List regular-season games from the MLB schedule API (no Supabase)."""
    if season is None:
        season = date.today().year
    if end_date is None:
        end_date = date.today().isoformat()
    if start_date is None:
        start_date = f"{season}-03-01"

    response = requests.get(
        f"{MLB}/schedule",
        params={
            "sportId": 1,
            "gameTypes": "R",
            "season": str(season),
            "startDate": start_date,
            "endDate": end_date,
            "hydrate": "team,linescore,venue",
        },
        timeout=30,
    )
    response.raise_for_status()

    games: list[dict] = []
    for day in response.json().get("dates", []):
        game_date = day.get("date")
        for game in day.get("games", []):
            status = (game.get("status") or {}).get("abstractGameState", "")
            if final_only and status != "Final":
                continue
            games.append({
                "game_pk": game["gamePk"],
                "game_date": game_date,
                "venue_id": (game.get("venue") or {}).get("id"),
                "status": status,
            })
    return games


def fetch_live_feed(game_pk: int) -> dict:
    response = requests.get(MLB_FEED.format(game_pk=game_pk), timeout=60)
    response.raise_for_status()
    return response.json()


def cache_feed(game_pk: int, feed: dict) -> Path:
    FEED_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = FEED_CACHE_DIR / f"{game_pk}.json"
    path.write_text(json.dumps(feed))
    return path


def parse_cached_feed(game_pk: int, feed_path: Path) -> Path:
    PARSED_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    out_path = PARSED_CACHE_DIR / f"{game_pk}.json"
    if out_path.exists():
        return out_path

    subprocess.run(
        [
            "npx",
            "tsx",
            str(PARSE_SCRIPT),
            str(game_pk),
            str(feed_path),
            str(out_path),
        ],
        cwd=WEB_DIR,
        check=True,
        capture_output=True,
        text=True,
    )
    return out_path


def ensure_game_cached(
    game: dict,
    *,
    sleep_s: float = 0.15,
    force: bool = False,
) -> dict | None:
    """Return parsed state dict for one game, fetching MLB API only on cache miss."""
    game_pk = int(game["game_pk"])
    feed_path = FEED_CACHE_DIR / f"{game_pk}.json"
    parsed_path = PARSED_CACHE_DIR / f"{game_pk}.json"

    if force or not feed_path.exists():
        try:
            feed = fetch_live_feed(game_pk)
            cache_feed(game_pk, feed)
            time.sleep(sleep_s)
        except Exception as exc:
            print(f"  skip feed {game_pk}: {exc}")
            return None

    if force and parsed_path.exists():
        parsed_path.unlink()

    try:
        parse_cached_feed(game_pk, feed_path)
    except subprocess.CalledProcessError as exc:
        print(f"  skip parse {game_pk}: {exc.stderr or exc}")
        return None

    parsed_wrapper = json.loads(parsed_path.read_text())
    return {
        **game,
        "game_state": parsed_wrapper,
    }


def build_local_game_cache(
    *,
    season: int | None = None,
    max_games: int | None = None,
    force: bool = False,
) -> list[dict]:
    """Populate feed + parsed caches; return games ready for extraction."""
    games = fetch_schedule_games(season=season)
    if max_games is not None:
        games = games[:max_games]
    save_game_index(games)

    ready: list[dict] = []
    print(f"Caching {len(games)} games from MLB API (local cache only)...")
    for i, game in enumerate(games, start=1):
        row = ensure_game_cached(game, force=force)
        if row is not None:
            ready.append(row)
        if i % 25 == 0:
            print(f"  cached {i}/{len(games)}")
    print(f"Ready: {len(ready)} games with parsed state")
    return ready


def load_cached_games() -> list[dict]:
    """Load games from local parsed cache without any network calls."""
    index = load_game_index()
    if not index:
        # Fall back to whatever parsed files exist on disk.
        index = [
            {"game_pk": int(path.stem), "game_date": "1970-01-01", "venue_id": None}
            for path in sorted(PARSED_CACHE_DIR.glob("*.json"))
        ]

    games: list[dict] = []
    for game in index:
        game_pk = int(game["game_pk"])
        parsed_path = PARSED_CACHE_DIR / f"{game_pk}.json"
        if not parsed_path.exists():
            continue
        games.append({
            **game,
            "game_state": json.loads(parsed_path.read_text()),
        })
    return games


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Cache MLB feeds locally for ml-engine training")
    parser.add_argument("--season", type=int, default=date.today().year)
    parser.add_argument("--max-games", type=int, default=None)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    build_local_game_cache(season=args.season, max_games=args.max_games, force=args.force)
