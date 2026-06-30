-- Compact indexed hit rows extracted from archived game_state at sync time.
-- Powers the Ballpark Hits feature without scanning full play-by-play JSONB.

CREATE TABLE IF NOT EXISTS game_hits (
    game_pk             INTEGER NOT NULL,
    at_bat_index        INTEGER NOT NULL,
    season              INTEGER NOT NULL,
    game_date           DATE NOT NULL,
    venue_id            INTEGER NOT NULL,
    away_team_abbrev    TEXT NOT NULL,
    home_team_abbrev    TEXT NOT NULL,
    batter_name         TEXT NOT NULL,
    event               TEXT NOT NULL,
    inning              INTEGER NOT NULL,
    half_inning         TEXT NOT NULL,
    away_score          INTEGER NOT NULL,
    home_score          INTEGER NOT NULL,
    hit_data            JSONB NOT NULL,
    play_detail         JSONB NOT NULL,
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (game_pk, at_bat_index),
    CONSTRAINT game_hits_hit_data_object CHECK (jsonb_typeof(hit_data) = 'object'),
    CONSTRAINT game_hits_play_detail_object CHECK (jsonb_typeof(play_detail) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_game_hits_season_venue
    ON game_hits (season, venue_id);

CREATE INDEX IF NOT EXISTS idx_game_hits_venue_date
    ON game_hits (venue_id, game_date DESC);

CREATE INDEX IF NOT EXISTS idx_game_hits_season
    ON game_hits (season, game_date DESC);

COMMENT ON TABLE game_hits IS 'Tracked batted-ball hits extracted from archived MLB live feeds.';

ALTER TABLE game_hits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'game_hits' AND policyname = 'anon read game_hits'
  ) THEN
    CREATE POLICY "anon read game_hits" ON game_hits FOR SELECT TO anon USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'game_hits' AND policyname = 'service role full access game_hits'
  ) THEN
    CREATE POLICY "service role full access game_hits" ON game_hits FOR ALL TO service_role USING (true);
  END IF;
END $$;
