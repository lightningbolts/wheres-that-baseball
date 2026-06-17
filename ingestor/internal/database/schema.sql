-- Predictions written by the ingestor for real-time frontend consumption.
-- Apply in Supabase SQL editor or via migration tooling.

CREATE TABLE IF NOT EXISTS predictions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_pk                 INTEGER NOT NULL,
    timestamp               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    batter_name             TEXT NOT NULL,
    pitcher_name            TEXT NOT NULL,
    inning                  INTEGER NOT NULL,
    balls                   INTEGER NOT NULL,
    strikes                 INTEGER NOT NULL,
    outs                    INTEGER NOT NULL,
    on_first                BOOLEAN NOT NULL DEFAULT FALSE,
    on_second               BOOLEAN NOT NULL DEFAULT FALSE,
    on_third                BOOLEAN NOT NULL DEFAULT FALSE,
    outcome_probabilities   JSONB NOT NULL,

    CONSTRAINT predictions_outcome_probabilities_object
        CHECK (jsonb_typeof(outcome_probabilities) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_predictions_game_pk_timestamp
    ON predictions (game_pk, timestamp DESC);

COMMENT ON TABLE predictions IS 'Live at-bat outcome probabilities produced by the ingestor.';
COMMENT ON COLUMN predictions.outcome_probabilities IS 'Map of outcome -> probability; keys: strikeout, walk, single, double, triple, home_run, field_out';

-- Season game history synced by the ingestor (live schedule) and scripts/fetch-season-games.mjs
CREATE TABLE IF NOT EXISTS games (
    game_pk             INTEGER PRIMARY KEY,
    game_date           DATE NOT NULL,
    season              INTEGER NOT NULL,
    game_type           TEXT NOT NULL DEFAULT 'R',
    status              TEXT NOT NULL,
    status_detail       TEXT,
    away_team_id        INTEGER NOT NULL,
    away_team_name      TEXT NOT NULL,
    away_team_abbrev    TEXT NOT NULL,
    home_team_id        INTEGER NOT NULL,
    home_team_name      TEXT NOT NULL,
    home_team_abbrev    TEXT NOT NULL,
    away_score          INTEGER,
    home_score          INTEGER,
    venue_id            INTEGER,
    venue_name          TEXT,
    official_date       DATE,
    game_state          JSONB,
    box_score           JSONB,
    feed_synced_at      TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_games_game_date ON games (game_date);
CREATE INDEX IF NOT EXISTS idx_games_away_team ON games (away_team_id, game_date DESC);
CREATE INDEX IF NOT EXISTS idx_games_home_team ON games (home_team_id, game_date DESC);
CREATE INDEX IF NOT EXISTS idx_games_season ON games (season, game_date DESC);

COMMENT ON TABLE games IS 'Regular-season MLB games synced from the Stats API schedule endpoint.';
COMMENT ON COLUMN games.game_state IS 'Parsed live feed (play-by-play, pitches, hit data) from MLB feed/live endpoint.';
COMMENT ON COLUMN games.box_score IS 'Parsed box score (linescore, batting/pitching lines, game info) from MLB feed/live endpoint.';

-- Migration for existing databases:
-- ALTER TABLE games ADD COLUMN IF NOT EXISTS box_score JSONB;

-- RLS (run in Supabase SQL editor after creating the table):
-- ALTER TABLE games ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "anon read games" ON games FOR SELECT TO anon USING (true);
-- CREATE POLICY "service role full access games" ON games FOR ALL TO service_role USING (true);
