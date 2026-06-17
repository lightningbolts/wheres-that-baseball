// Package pipeline wires domain packages together: on each state change it runs
// inference and persists results. Living outside mlb/ avoids import cycles
// (predictor depends on mlb.GameState; mlb must not depend on predictor).
package pipeline

import (
	"context"
	"fmt"
	"log/slog"

	"mlb-ingestor/internal/database"
	"mlb-ingestor/internal/mlb"
	"mlb-ingestor/internal/predictor"
)

// StateChangeHandler returns an mlb.OnStateChange callback that predicts and saves.
func StateChangeHandler(pred predictor.Predictor, repo database.Store, logger *slog.Logger) mlb.OnStateChange {
	return func(ctx context.Context, state mlb.GameState) error {
		result, err := pred.Predict(ctx, state)
		if err != nil {
			return fmt.Errorf("predict: %w", err)
		}

		if err := result.Validate(); err != nil {
			return fmt.Errorf("invalid prediction: %w", err)
		}

		row := database.PredictionRow{
			GamePK:               state.GamePK,
			Timestamp:            state.ObservedAt,
			BatterName:           state.BatterName,
			PitcherName:          state.PitcherName,
			Inning:               state.Inning,
			Balls:                state.Balls,
			Strikes:              state.Strikes,
			Outs:                 state.Outs,
			OnFirst:              state.OnFirst,
			OnSecond:             state.OnSecond,
			OnThird:              state.OnThird,
			OutcomeProbabilities: result.ToMap(),
		}

		id, err := repo.InsertPrediction(ctx, row)
		if err != nil {
			return fmt.Errorf("insert prediction: %w", err)
		}

		logger.Info("prediction persisted",
			"game_pk", state.GamePK,
			"id", id,
			"strikeout", result.Strikeout,
			"walk", result.Walk,
			"single", result.Single,
		)

		return nil
	}
}
