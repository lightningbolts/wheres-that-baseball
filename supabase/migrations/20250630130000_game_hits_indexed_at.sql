-- Marks when a game's hits have been extracted into game_hits (even if zero hits).
ALTER TABLE games ADD COLUMN IF NOT EXISTS hits_indexed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_games_hits_indexed
    ON games (season, hits_indexed_at)
    WHERE feed_synced_at IS NOT NULL;
