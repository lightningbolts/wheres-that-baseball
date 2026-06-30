-- Reclaim database space: ballpark hits are aggregated into web/data/ballpark-hits/*.json
DROP TABLE IF EXISTS game_hits;

ALTER TABLE games DROP COLUMN IF EXISTS hits_indexed_at;
