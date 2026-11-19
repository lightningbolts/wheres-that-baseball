"""Sample each Play Ball player's skin tone from his official MLB headshot.

The 3D players in Play Ball are painted with a skin colour; rather than assigning one
at random, this reads the cheeks and nose of the player's mlbstatic headshot (cached
under data/headshots/), keeps the pixels that look like lit skin (no hair, beard,
cap shadow or background), and stores their median as "skin": "#rrggbb" on each player
in web/data/game/rosters.json and on each 40-man "extra" in web/data/game/franchise-proj.json
(the real players franchise mode adds who are missing from the rosters snapshot: without
this they had no tone at all). Players without a photo (the generic silhouette) are left
without one and the game falls back to a neutral mid-tone.

Run by build_game_rosters.py and build_franchise_projections.py after they write their files.

Usage:  ./venv/bin/python scripts/sample_skin_tones.py [--refresh]
Needs Pillow (pip install pillow).
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "headshots"
OUT = ROOT.parent / "web" / "data" / "game" / "rosters.json"
PROJ = ROOT.parent / "web" / "data" / "game" / "franchise-proj.json"
URL = "https://img.mlbstatic.com/mlb-photos/image/upload/w_180,q_auto:good/v1/people/{pid}/headshot/67/current"
UA = {"User-Agent": "Mozilla/5.0"}


def headshot(pid: int, refresh: bool) -> Image.Image | None:
    path = CACHE / f"{pid}.jpg"
    if refresh or not path.exists():
        for attempt in range(3):
            try:
                resp = requests.get(URL.format(pid=pid), timeout=30, headers=UA)
                resp.raise_for_status()
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(resp.content)
                break
            except Exception as exc:  # network is optional: keep whatever is cached
                print(f"  headshot {pid} failed ({exc}); retry {attempt + 1}", file=sys.stderr)
                time.sleep(1)
    if not path.exists():
        return None
    try:
        return Image.open(io.BytesIO(path.read_bytes())).convert("RGB")
    except Exception:
        return None


def is_skin(r: int, g: int, b: int) -> bool:
    """Lit skin across the whole range of complexions (YCbCr box), not hair, cloth or backdrop."""
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
    cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
    return 35 < y < 245 and 77 <= cb <= 127 and 133 <= cr <= 175 and r > b and r >= g


def sample(img: Image.Image) -> str | None:
    w, h = img.size
    # Cheeks, nose and upper lip: below the cap brim and the eyes, above the chin and beard line.
    box = img.crop((int(w * 0.3), int(h * 0.4), int(w * 0.7), int(h * 0.56)))
    raw = box.tobytes()
    px = [p for p in zip(raw[0::3], raw[1::3], raw[2::3]) if is_skin(*p)]
    if len(px) < box.size[0] * box.size[1] * 0.2:
        return None  # generic silhouette or a face we cannot read
    # Drop shadows and highlights: keep the middle of the brightness range.
    px.sort(key=lambda p: 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2])
    mid = px[len(px) // 4 : len(px) * 3 // 4]
    n = len(mid)
    r = sorted(p[0] for p in mid)[n // 2]
    g = sorted(p[1] for p in mid)[n // 2]
    b = sorted(p[2] for p in mid)[n // 2]
    return f"#{r:02x}{g:02x}{b:02x}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    files: list[tuple[Path, dict, list[dict]]] = []
    if OUT.exists():
        payload = json.loads(OUT.read_text())
        files.append((OUT, payload, [p for team in payload["teams"].values() for group in ("lineup", "bench", "rotation", "bullpen") for p in team.get(group, [])]))
    if PROJ.exists():
        proj = json.loads(PROJ.read_text())
        files.append((PROJ, proj, [p for lst in proj.get("extras", {}).values() for p in lst]))
    ids = sorted({int(p["id"]) for _, _, players in files for p in players})
    with ThreadPoolExecutor(max_workers=8) as pool:
        tones = dict(zip(ids, pool.map(lambda pid: (lambda im: sample(im) if im else None)(headshot(pid, args.refresh)), ids)))
    for path, payload, players in files:
        hits = 0
        for p in players:
            tone = tones.get(int(p["id"]))
            if tone:
                p["skin"] = tone
                hits += 1
            else:
                p.pop("skin", None)
        path.write_text(json.dumps(payload, separators=(",", ":")))
        print(f"skin tones: {hits}/{len(players)} players in {path.name} from headshots", file=sys.stderr)

if __name__ == "__main__":
    main()
