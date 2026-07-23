# Season BIP JSON storage

Ballpark spray charts and per-player BIP (balls in play) are aggregated into
JSON under [`web/data/ballpark-hits/`](../web/data/ballpark-hits/) and
[`web/data/player-bip/`](../web/data/player-bip/), then committed by the daily
nerd-stats / ballpark-hits GitHub Action.

## Why this is painful (especially on mobile)

| Layer | What happens | User / ops impact |
|---|---|---|
| GitHub | Hundreds of MB of season hit JSON are committed and redeployed | Slow clones, huge PRs, every data refresh is a fat commit |
| Vercel serverless | Next file tracing can pack whole season trees into one function | Deploys fail above the **250MB uncompressed** function limit |
| Ballparks index | Uncapped `previewHits` once made `summary.json` ~50MB+ | Mobile users download tens of MB on `/ballparks`, burn cellular data, and risk long spinners / tab crashes from JSON parse + spray memory |
| Venue / player APIs | Embedding full play `detail` (~3KB/hit) in every list file | Extra bytes on first paint even though the UI loads detail on demand |

**Bottom line:** treating GitHub JSON as the primary datastore for season BIP is hostile to mobile bandwidth and will eventually break deploys as the season grows.

## Mitigations in this repo

1. **Slim on-disk lists** — venue and player hit rows omit `detail`; play detail is loaded on demand from archived `games.game_state` via `hitKey`.
2. **Dense, slim index previews** — `summary.json` stores hit-only spray dots per park (coords + color, no pitch telemetry), capped at `PREVIEW_HITS_PER_PARK`, so cards look full-season dense without shipping 50MB of BIP detail.
3. **Split tracing** — `/api/ballparks/hits` only includes `ballpark-hits`; `/api/players/**` only includes `player-bip` ([`web/next.config.mjs`](../web/next.config.mjs)).
4. **Keep player BIP in sync** — live game archive and aggregate appends also update `player-bip`, not only ballpark venues. Daily Action looks back **7 days** so missed runs catch up.
5. **Slim player API payloads** — `/api/players/*/bip` omits duplicated `chartHits` (clients use `hits` for spray charts).

Rewrite existing season files after changing slim rules:

```bash
cd web
npm run slim-bip-json -- --season=2026
```

## Longer-term direction

Publish aggregates from the daily Action to object storage / a CDN (Vercel Blob, R2, S3, or Supabase Storage). Keep APIs returning slim, paginated payloads only, and stop committing full season trees to git.
