package mlb

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"
)

// GameFeedStore persists a completed game's full MLB live feed for replay.
type GameFeedStore interface {
	UpdateGameFeed(ctx context.Context, gamePK int, update GameFeedUpdate) error
}

// GameFeedUpdate is the persistence payload for play-by-play and box score JSONB.
type GameFeedUpdate struct {
	GameState    json.RawMessage
	BoxScore     json.RawMessage
	Status       string
	AwayScore    int
	HomeScore    int
	VenueID      *int
	VenueName    string
	FeedSyncedAt time.Time
}

type feedSummary struct {
	GameData struct {
		Status struct {
			AbstractGameState string `json:"abstractGameState"`
		} `json:"status"`
		Venue *struct {
			ID   int    `json:"id"`
			Name string `json:"name"`
		} `json:"venue"`
	} `json:"gameData"`
	LiveData struct {
		Linescore struct {
			Teams struct {
				Away struct {
					Runs int `json:"runs"`
				} `json:"away"`
				Home struct {
					Runs int `json:"runs"`
				} `json:"home"`
			} `json:"teams"`
		} `json:"linescore"`
	} `json:"liveData"`
}

func wrapMlbFeed(raw json.RawMessage) (json.RawMessage, error) {
	wrapped, err := json.Marshal(map[string]json.RawMessage{
		"mlbFeed": raw,
	})
	if err != nil {
		return nil, fmt.Errorf("wrap mlb feed: %w", err)
	}
	return wrapped, nil
}

func summarizeFeed(raw json.RawMessage) (feedSummary, error) {
	var summary feedSummary
	if err := json.Unmarshal(raw, &summary); err != nil {
		return feedSummary{}, fmt.Errorf("summarize feed: %w", err)
	}
	return summary, nil
}

// ReconcileRecentFinalFeeds re-caches play-by-play for final games on the current
// and prior ET slates. Catches mid-game snapshots that were never re-archived.
func ReconcileRecentFinalFeeds(
	ctx context.Context,
	client *Client,
	store GameFeedStore,
	games []ScheduleGame,
	today string,
	logger *slog.Logger,
) {
	if client == nil || store == nil {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}

	yesterday := PreviousScheduleDate(today)

	for _, game := range games {
		if game.Status != "Final" {
			continue
		}
		if game.GameDate != today && game.GameDate != yesterday {
			continue
		}

		gamePK := game.GamePK
		go func(pk int) {
			syncCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			if err := CacheGameFeed(syncCtx, client, store, pk, logger); err != nil {
				logger.Error("reconcile recent final feed failed", "game_pk", pk, "error", err)
			}
		}(gamePK)
	}
}

// ReconcileMissingFeeds caches play-by-play for final games that were never synced
// (e.g. the ingestor was offline when they ended).
func ReconcileMissingFeeds(
	ctx context.Context,
	client *Client,
	store GameFeedStore,
	listStore interface {
		ListGamesNeedingFeedSync(ctx context.Context, sinceDate string, limit int) ([]int, error)
	},
	sinceDate string,
	limit int,
	logger *slog.Logger,
) {
	if client == nil || store == nil || listStore == nil {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}

	pks, err := listStore.ListGamesNeedingFeedSync(ctx, sinceDate, limit)
	if err != nil {
		logger.Error("list games needing feed sync failed", "error", err)
		return
	}
	if len(pks) == 0 {
		return
	}

	logger.Info("reconciling missing game feeds", "count", len(pks), "since", sinceDate)

	for _, gamePK := range pks {
		if ctx.Err() != nil {
			return
		}
		if err := CacheGameFeed(ctx, client, store, gamePK, logger); err != nil {
			logger.Error("reconcile game feed failed", "game_pk", gamePK, "error", err)
		}
	}
}

// CacheGameFeed fetches the MLB live feed after a game ends and stores it for
// Season History replay. Retries while MLB finalizes the feed (status != Final).
func CacheGameFeed(
	ctx context.Context,
	client *Client,
	store GameFeedStore,
	gamePK int,
	logger *slog.Logger,
) error {
	if client == nil || store == nil {
		return fmt.Errorf("client and store are required")
	}
	if logger == nil {
		logger = slog.Default()
	}

	const maxAttempts = 6
	backoff := 15 * time.Second

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		raw, err := client.FetchLiveFeedRawFull(ctx, gamePK)
		if err != nil {
			return fmt.Errorf("fetch live feed: %w", err)
		}

		summary, err := summarizeFeed(raw)
		if err != nil {
			return err
		}

		wrapped, err := wrapMlbFeed(raw)
		if err != nil {
			return err
		}

		update := GameFeedUpdate{
			GameState:    wrapped,
			BoxScore:     wrapped,
			Status:       summary.GameData.Status.AbstractGameState,
			AwayScore:    summary.LiveData.Linescore.Teams.Away.Runs,
			HomeScore:    summary.LiveData.Linescore.Teams.Home.Runs,
			FeedSyncedAt: time.Now().UTC(),
		}
		if summary.GameData.Venue != nil {
			id := summary.GameData.Venue.ID
			update.VenueID = &id
			update.VenueName = summary.GameData.Venue.Name
		}

		if err := store.UpdateGameFeed(ctx, gamePK, update); err != nil {
			return fmt.Errorf("update game feed: %w", err)
		}

		status := update.Status
		if status == "Final" {
			logger.Info("cached final game feed",
				"game_pk", gamePK,
				"away_score", update.AwayScore,
				"home_score", update.HomeScore,
				"attempt", attempt,
			)
			return nil
		}

		if attempt == maxAttempts {
			logger.Warn("cached game feed before MLB marked Final",
				"game_pk", gamePK,
				"status", status,
			)
			return nil
		}

		logger.Info("waiting for MLB to finalize feed",
			"game_pk", gamePK,
			"status", status,
			"attempt", attempt,
		)

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
	}

	return nil
}
