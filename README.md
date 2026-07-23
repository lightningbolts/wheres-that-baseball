# Where's That Baseball

Live MLB companion app: today's slate with pitch-by-pitch feeds, at-bat outcome probabilities, ballpark spray charts, and team "nerd" standings.

Not affiliated with Major League Baseball.

## Architecture

```
┌─────────────┐     poll MLB Stats API      ┌─────────────┐
│  ingestor   │ ──────────────────────────► │  MLB API    │
│    (Go)     │                             └─────────────┘
└──────┬──────┘
       │ POST /predict, /predict_steal
       ▼
┌─────────────┐     predictions             ┌─────────────┐
│  ml-engine  │ ──────────────────────────► │  Supabase   │
│  (Python)   │                             │  (Postgres) │
└─────────────┘                             └──────┬──────┘
                                                   │ realtime / REST
                                                   ▼
                                            ┌─────────────┐
                                            │    web      │
                                            │  (Next.js)  │
                                            └─────────────┘
```

| Package | Role |
|---|---|
| [`web/`](web/) | Next.js app — live/historical games, spray charts, nerd stats, UI |
| [`ingestor/`](ingestor/) | Go worker — polls live games, calls ml-engine, writes predictions |
| [`ml-engine/`](ml-engine/) | sklearn models + HTTP inference (`/predict`, `/predict_steal`) |
| [`supabase/`](supabase/) | Schema migrations + `sync-schedule` Edge Function |
| [`scripts/`](scripts/) | Ballpark / season-game fetch helpers |

**Predicted at-bat outcomes:** strikeout, walk, HBP, single, double, triple, home run, field out, GIDP, sac fly, sac bunt. Steal attempt/success probabilities are modeled separately.

## Prerequisites

- Node.js 22+
- Go 1.26+
- Python 3.12+
- A [Supabase](https://supabase.com) project (Postgres + optional Edge Functions)

## Quick start (web only)

The frontend can run against public MLB schedule/feeds without the ingestor or ml-engine. Live prediction overlays need the full stack.

```bash
cd web
cp .env.example .env.local   # set NEXT_PUBLIC_SUPABASE_* keys
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Useful scripts:

```bash
npm run lint
npm run typecheck
npm run test
```

## Full stack (predictions)

### 1. ml-engine

```bash
cd ml-engine
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Train (needs Supabase credentials in `ml-engine/.env` for extract steps):

```bash
python 04_fetch_player_stats.py
python 01_extract_data.py
python 01b_extract_steal_events.py
python 02_train_model.py
python 02b_train_steal_model.py
python 03_predict.py          # sanity-check scenarios
python serve.py               # http://127.0.0.1:8765
```

Endpoints:

- `GET /health`
- `POST /predict` — at-bat outcome probabilities
- `POST /predict_steal` — steal attempt / success

Models and parquet data under `ml-engine/models/` and `ml-engine/data/` are gitignored. For Render deploys, upload `at_bat_model.joblib`, `steal_model.joblib`, and `player_stats.parquet` before first launch (see [`render.yaml`](render.yaml)).

### 2. ingestor

```bash
cd ingestor
cp .env.example .env          # DATABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY
# ML_ENGINE_URL=http://127.0.0.1:8765
go run ./cmd/ingestor
```

By default it auto-discovers live games from the MLB schedule, polls every few seconds, and persists predictions to Supabase. Set `USE_MOCK_PREDICTOR=true` to skip ml-engine.

### 3. Supabase

```bash
# From repo root, with the Supabase CLI linked to your project
supabase db push
supabase functions deploy sync-schedule
```

Then follow [`supabase/setup-cron.sql`](supabase/setup-cron.sql) to schedule schedule sync.

## Deploy notes

- **Web** — Vercel (set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; optionally `ML_ENGINE_URL` / `NEXT_PUBLIC_ML_ENGINE_URL`).
- **ml-engine** — Render free tier via Docker ([`render.yaml`](render.yaml)); cold starts can exceed Vercel's proxy timeout, so browser-direct `NEXT_PUBLIC_ML_ENGINE_URL` is useful.
- **Nerd stats** — daily GitHub Action [`.github/workflows/daily-nerd-stats.yml`](.github/workflows/daily-nerd-stats.yml) aggregates and commits season counters.

## Repo layout

```
mlb-atbat-predictor/
├── web/                 # Next.js 16 + React 19 + Tailwind
├── ingestor/            # Go live-game poller
├── ml-engine/           # training pipeline + inference server
├── supabase/            # migrations, Edge Functions, cron setup
├── scripts/             # shared Node data fetchers
├── docs/                # API / fetch notes
└── render.yaml          # ml-engine Render service
```

## Attribution & thanks

This project is not affiliated with Major League Baseball. All MLB trademarks, logos, and media remain the property of MLB and its clubs. Predictions are experimental model output for curiosity — not betting advice.

**Data & media**

- Schedules, live feeds, box scores, and related stats from the public [MLB Stats API](https://statsapi.mlb.com/) (`statsapi.mlb.com`)
- Play video clips via [Baseball Savant](https://baseballsavant.mlb.com/) when a play GUID is available
- Stadium geometry and ballpark context from MLB-published field data and community resources such as [GeomMLBStadiums](https://github.com/bdilday/GeomMLBStadiums)
- Gameday-style images (stadium backgrounds, uniforms) and player headshots from MLB static asset CDNs / MLB.com

Public endpoints are used for informational and educational purposes; accuracy and availability are not guaranteed. Rights holders who need something adjusted can reach out at [timberlake2025@gmail.com](mailto:timberlake2025@gmail.com).

**Thanks**

Huge thanks to MLB and Baseball Savant for publishing the data that makes this possible, to Bill Dilday and contributors of GeomMLBStadiums, and to the open-source stacks behind the app (Next.js, React, Supabase, scikit-learn, Go, and friends). Built by [Kairui](https://kairui-cheng.vercel.app/) — if WTBB is useful, you can [buy me a coffee](https://buymeacoffee.com/timberlake2025).

## License

[MIT](LICENSE) © 2026 Kairui Cheng
