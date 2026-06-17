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
    outcome_probabilities
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
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
    status = $2,
    away_score = $3,
    home_score = $4,
    updated_at = $5
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

func nullIfEmpty(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
