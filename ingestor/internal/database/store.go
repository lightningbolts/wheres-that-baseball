package database

import (
	"context"

	"github.com/google/uuid"
)

// Store persists predictions and game metadata.
type Store interface {
	InsertPrediction(ctx context.Context, row PredictionRow) (uuid.UUID, error)
	UpsertGames(ctx context.Context, rows []GameRow) error
	UpdateGameFromPoll(ctx context.Context, gamePK int, status string, awayScore, homeScore int) error
	Close()
}
