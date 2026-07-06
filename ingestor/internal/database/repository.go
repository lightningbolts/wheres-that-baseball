// Package database is the persistence adapter for Supabase-hosted PostgreSQL.
// It uses pgx connection pooling and context-aware queries so shutdown cancels
// in-flight writes cleanly.
package database

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository executes SQL against the predictions table.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository opens a pgx pool from a Supabase/PostgreSQL connection string.
func NewRepository(ctx context.Context, databaseURL string) (*Repository, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}

	// Sized for up to 15 concurrent game workers plus headroom for bursts.
	cfg.MaxConns = 20
	cfg.MinConns = 2
	cfg.MaxConnLifetime = time.Hour
	cfg.MaxConnIdleTime = 15 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create connection pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return &Repository{pool: pool}, nil
}

// Close drains and closes the underlying connection pool.
func (r *Repository) Close() {
	r.pool.Close()
}

// GameRow is the upsert payload for a row in the games table.
type GameRow struct {
	GamePK         int
	GameDate       string
	Season         int
	GameType       string
	Status         string
	StatusDetail   string
	AwayTeamID     int
	AwayTeamName   string
	AwayTeamAbbrev string
	HomeTeamID     int
	HomeTeamName   string
	HomeTeamAbbrev string
	AwayScore      *int
	HomeScore      *int
	VenueID        *int
	VenueName      string
	OfficialDate   string
}

// PredictionRow is the insert payload for a single at-bat prediction snapshot.
type PredictionRow struct {
	GamePK               int
	Timestamp            time.Time
	BatterName           string
	PitcherName          string
	Inning               int
	Balls                int
	Strikes              int
	Outs                 int
	OnFirst              bool
	OnSecond             bool
	OnThird              bool
	OutcomeProbabilities map[string]float64
	StealProbabilities   map[string]float64
}

const insertPredictionSQL = `
INSERT INTO predictions (
    id,
    game_pk,
    timestamp,
    batter_name,
    pitcher_name,
    inning,
    balls,
    strikes,
    outs,
    on_first,
    on_second,
    on_third,
    outcome_probabilities,
    steal_probabilities
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
)
RETURNING id;
`

// InsertPrediction persists one prediction row. The context propagates cancellation
// from the polling worker so orphaned queries are not left running after shutdown.
func (r *Repository) InsertPrediction(ctx context.Context, row PredictionRow) (uuid.UUID, error) {
	if ctx.Err() != nil {
		return uuid.Nil, fmt.Errorf("context already canceled: %w", ctx.Err())
	}

	probsJSON, err := json.Marshal(row.OutcomeProbabilities)
	if err != nil {
		return uuid.Nil, fmt.Errorf("marshal outcome probabilities: %w", err)
	}

	stealJSON := []byte("null")
	if len(row.StealProbabilities) > 0 {
		stealJSON, err = json.Marshal(row.StealProbabilities)
		if err != nil {
			return uuid.Nil, fmt.Errorf("marshal steal probabilities: %w", err)
		}
	}

	id := uuid.New()
	ts := row.Timestamp
	if ts.IsZero() {
		ts = time.Now().UTC()
	}

	var returnedID uuid.UUID
	err = r.pool.QueryRow(ctx, insertPredictionSQL,
		id,
		row.GamePK,
		ts,
		row.BatterName,
		row.PitcherName,
		row.Inning,
		row.Balls,
		row.Strikes,
		row.Outs,
		row.OnFirst,
		row.OnSecond,
		row.OnThird,
		probsJSON,
		stealJSON,
	).Scan(&returnedID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("insert prediction: %w", err)
	}

	return returnedID, nil
}

const upsertGameSQL = `
INSERT INTO games (
    game_pk,
    game_date,
    season,
    game_type,
    status,
    status_detail,
    away_team_id,
    away_team_name,
    away_team_abbrev,
    home_team_id,
    home_team_name,
    home_team_abbrev,
    away_score,
    home_score,
    venue_id,
    venue_name,
    official_date,
    updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
)
ON CONFLICT (game_pk) DO UPDATE SET
    game_date = EXCLUDED.game_date,
    season = EXCLUDED.season,
    game_type = EXCLUDED.game_type,
    status = EXCLUDED.status,
    status_detail = EXCLUDED.status_detail,
    away_team_id = EXCLUDED.away_team_id,
    away_team_name = EXCLUDED.away_team_name,
    away_team_abbrev = EXCLUDED.away_team_abbrev,
    home_team_id = EXCLUDED.home_team_id,
    home_team_name = EXCLUDED.home_team_name,
    home_team_abbrev = EXCLUDED.home_team_abbrev,
    away_score = EXCLUDED.away_score,
    home_score = EXCLUDED.home_score,
    venue_id = EXCLUDED.venue_id,
    venue_name = EXCLUDED.venue_name,
    official_date = EXCLUDED.official_date,
    updated_at = EXCLUDED.updated_at;
`

// UpsertGames inserts or updates schedule metadata for one or more games.
func (r *Repository) UpsertGames(ctx context.Context, rows []GameRow) error {
	if ctx.Err() != nil {
		return fmt.Errorf("context already canceled: %w", ctx.Err())
	}
	if len(rows) == 0 {
		return nil
	}

	now := time.Now().UTC()
	for _, row := range rows {
		_, err := r.pool.Exec(ctx, upsertGameSQL,
			row.GamePK,
			row.GameDate,
			row.Season,
			row.GameType,
			row.Status,
			nullIfEmpty(row.StatusDetail),
			row.AwayTeamID,
			row.AwayTeamName,
			row.AwayTeamAbbrev,
			row.HomeTeamID,
			row.HomeTeamName,
			row.HomeTeamAbbrev,
			row.AwayScore,
			row.HomeScore,
			row.VenueID,
			nullIfEmpty(row.VenueName),
			row.OfficialDate,
			now,
		)
		if err != nil {
			return fmt.Errorf("upsert game %d: %w", row.GamePK, err)
		}
	}

	return nil
}

const updateGameFromPollSQL = `
UPDATE games SET
    away_score = $3,
    home_score = $4,
    updated_at = $5,
    status = COALESCE(NULLIF($2, ''), status)
WHERE game_pk = $1;
`

// UpdateGameFromPoll refreshes status and score from a live feed poll.
func (r *Repository) UpdateGameFromPoll(
	ctx context.Context,
	gamePK int,
	status string,
	awayScore, homeScore int,
) error {
	if ctx.Err() != nil {
		return fmt.Errorf("context already canceled: %w", ctx.Err())
	}

	_, err := r.pool.Exec(ctx, updateGameFromPollSQL,
		gamePK,
		status,
		awayScore,
		homeScore,
		time.Now().UTC(),
	)
	if err != nil {
		return fmt.Errorf("update game %d from poll: %w", gamePK, err)
	}

	return nil
}

const updateLiveGameStateSQL = `
UPDATE games SET
    away_score = $3,
    home_score = $4,
    game_state = $5::jsonb,
    updated_at = $6,
    status = COALESCE(NULLIF($2, ''), status)
WHERE game_pk = $1;
`

// UpdateLiveGameState writes the current live feed snapshot for real-time consumers.
func (r *Repository) UpdateLiveGameState(
	ctx context.Context,
	gamePK int,
	status string,
	awayScore, homeScore int,
	gameState []byte,
) error {
	if ctx.Err() != nil {
		return fmt.Errorf("context already canceled: %w", ctx.Err())
	}

	_, err := r.pool.Exec(ctx, updateLiveGameStateSQL,
		gamePK,
		status,
		awayScore,
		homeScore,
		gameState,
		time.Now().UTC(),
	)
	if err != nil {
		return fmt.Errorf("update live game state %d: %w", gamePK, err)
	}

	return nil
}

const updateGameFeedSQL = `
UPDATE games SET
    game_state = $2::jsonb,
    box_score = $3::jsonb,
    feed_synced_at = $4,
    away_score = $5,
    home_score = $6,
    status = $7,
    venue_id = $8,
    venue_name = $9,
    updated_at = $4
WHERE game_pk = $1;
`

// UpdateGameFeed stores the full MLB live feed for Season History replay.
func (r *Repository) UpdateGameFeed(ctx context.Context, gamePK int, update GameFeedUpdate) error {
	if ctx.Err() != nil {
		return fmt.Errorf("context already canceled: %w", ctx.Err())
	}

	syncedAt := update.FeedSyncedAt
	if syncedAt.IsZero() {
		syncedAt = time.Now().UTC()
	}

	_, err := r.pool.Exec(ctx, updateGameFeedSQL,
		gamePK,
		update.GameState,
		update.BoxScore,
		syncedAt,
		update.AwayScore,
		update.HomeScore,
		update.Status,
		update.VenueID,
		nullIfEmpty(update.VenueName),
	)
	if err != nil {
		return fmt.Errorf("update game feed %d: %w", gamePK, err)
	}

	return nil
}

const listGamesNeedingFeedSyncSQL = `
SELECT game_pk
FROM games
WHERE feed_synced_at IS NULL
  AND status = 'Final'
  AND game_date >= $1
ORDER BY game_date DESC
LIMIT $2;
`

// ListGamesNeedingFeedSync returns final games missing cached play-by-play feeds.
func (r *Repository) ListGamesNeedingFeedSync(ctx context.Context, sinceDate string, limit int) ([]int, error) {
	if ctx.Err() != nil {
		return nil, fmt.Errorf("context already canceled: %w", ctx.Err())
	}
	if limit <= 0 {
		limit = 10
	}

	rows, err := r.pool.Query(ctx, listGamesNeedingFeedSyncSQL, sinceDate, limit)
	if err != nil {
		return nil, fmt.Errorf("list games needing feed sync: %w", err)
	}
	defer rows.Close()

	var pks []int
	for rows.Next() {
		var pk int
		if err := rows.Scan(&pk); err != nil {
			return nil, fmt.Errorf("scan game pk: %w", err)
		}
		pks = append(pks, pk)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate games needing feed sync: %w", err)
	}

	return pks, nil
}

func nullIfEmpty(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
