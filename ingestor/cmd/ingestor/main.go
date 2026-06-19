// Command ingestor polls the MLB Stats API for live games, detects at-bat state
// changes, runs ML inference via ml-engine (or mock), and writes predictions to Supabase.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"mlb-ingestor/internal/config"
	"mlb-ingestor/internal/database"
	"mlb-ingestor/internal/mlb"
	"mlb-ingestor/internal/pipeline"
	"mlb-ingestor/internal/predictor"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	if err := run(logger); err != nil {
		logger.Error("ingestor exited with error", "error", err)
		os.Exit(1)
	}
}

type workerPool struct {
	mu     sync.Mutex
	active map[int]struct{}
	wg     *sync.WaitGroup
}

func newWorkerPool(wg *sync.WaitGroup) *workerPool {
	return &workerPool{
		active: make(map[int]struct{}),
		wg:     wg,
	}
}

func (p *workerPool) startWorker(
	ctx context.Context,
	gamePK int,
	worker *mlb.Worker,
	logger *slog.Logger,
) {
	p.mu.Lock()
	if _, exists := p.active[gamePK]; exists {
		p.mu.Unlock()
		return
	}
	p.active[gamePK] = struct{}{}
	p.mu.Unlock()

	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		defer func() {
			p.mu.Lock()
			delete(p.active, gamePK)
			p.mu.Unlock()
		}()

		if err := worker.Run(ctx, gamePK); err != nil && ctx.Err() == nil {
			logger.Error("worker stopped unexpectedly",
				"game_pk", gamePK,
				"error", err,
			)
		}
	}()
}

func (p *workerPool) count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.active)
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	logger.Info("configuration loaded",
		"game_count", len(cfg.GamePKs),
		"auto_discover", cfg.AutoDiscoverGames,
		"poll_interval", cfg.PollInterval.String(),
		"schedule_refresh", cfg.ScheduleRefreshInterval.String(),
		"mlb_api", cfg.MLBAPIBaseURL,
		"predictor_backend", cfg.PredictorBackend,
		"ml_engine_url", cfg.MLEngineURL,
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		sig := <-sigCh
		logger.Info("shutdown signal received", "signal", sig.String())
		cancel()
	}()

	repo, mode, err := database.OpenStore(ctx, cfg.DatabaseURL, cfg.SupabaseURL, cfg.SupabaseServiceKey)
	if err != nil {
		return fmt.Errorf("init database: %w", err)
	}
	defer repo.Close()
	logger.Info("database connected", "mode", mode)

	mlbClient := mlb.NewClient(mlb.ClientOptions{
		BaseURL:    cfg.MLBAPIBaseURL,
		Timeout:    cfg.HTTPClientTimeout,
		MaxRetries: cfg.HTTPMaxRetries,
		BaseDelay:  cfg.HTTPRetryBaseDelay,
	})

	pred, err := predictor.NewFromConfig(cfg.PredictorBackend, cfg.MLEngineURL, cfg.MLEngineTimeout)
	if err != nil {
		return fmt.Errorf("init predictor: %w", err)
	}
	if mlPred, ok := pred.(*predictor.MLEnginePredictor); ok {
		pingCtx, cancel := context.WithTimeout(ctx, cfg.MLEngineTimeout)
		if err := mlPred.Ping(pingCtx); err != nil {
			cancel()
			return fmt.Errorf("ml-engine health check (%s): %w — start with: cd ml-engine && python serve.py", cfg.MLEngineURL, err)
		}
		cancel()
		logger.Info("ml-engine ready", "url", cfg.MLEngineURL)
	} else {
		logger.Info("using mock predictor", "hint", "set PREDICTOR_BACKEND=ml for trained model")
	}

	tracker := mlb.NewStateTracker()
	onChange := pipeline.StateChangeHandler(pred, repo, logger.With("component", "pipeline"))

	onGameEnd := func(ctx context.Context, gamePK int, status string, awayScore, homeScore int) error {
		go func() {
			syncCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			feedStore := repoFeedAdapter{store: repo}
			if err := mlb.CacheGameFeed(syncCtx, mlbClient, feedStore, gamePK, logger); err != nil {
				logger.Error("failed to cache game feed for season history",
					"game_pk", gamePK,
					"status", status,
					"error", err,
				)
				return
			}
			logger.Info("game feed cached for season history", "game_pk", gamePK)
		}()
		return nil
	}

	worker, err := mlb.NewWorker(mlb.WorkerConfig{
		Client:    mlbClient,
		Tracker:   tracker,
		Interval:  cfg.PollInterval,
		OnChange:  onChange,
		OnGameEnd: onGameEnd,
		Games:     repo,
		Logger:    logger.With("component", "poller"),
	})
	if err != nil {
		return fmt.Errorf("create worker: %w", err)
	}

	var wg sync.WaitGroup
	pool := newWorkerPool(&wg)

	startGames := func(gamePKs []int) {
		if len(gamePKs) > 15 {
			logger.Warn("truncating game list to 15 workers", "requested", len(gamePKs))
			gamePKs = gamePKs[:15]
		}
		for _, gamePK := range gamePKs {
			pool.startWorker(ctx, gamePK, worker, logger.With("component", "poller"))
		}
	}

	syncSchedule := func() error {
		date := mlb.ScheduleDateET(time.Now())
		dates := mlb.RecentScheduleDates(date, 7)
		seen := make(map[int]mlb.ScheduleGame)

		for _, scheduleDate := range dates {
			games, err := mlbClient.FetchScheduleGames(ctx, scheduleDate)
			if err != nil {
				return fmt.Errorf("fetch schedule %s: %w", scheduleDate, err)
			}
			for _, game := range games {
				seen[game.GamePK] = game
			}
		}

		allGames := make([]mlb.ScheduleGame, 0, len(seen))
		for _, game := range seen {
			allGames = append(allGames, game)
		}

		if len(allGames) > 0 {
			rows := scheduleGamesToRows(allGames)
			if err := repo.UpsertGames(ctx, rows); err != nil {
				return fmt.Errorf("upsert games: %w", err)
			}
			logger.Info("synced schedule to database", "dates", dates, "count", len(allGames))
		}

		feedStore := repoFeedAdapter{store: repo}
		reconcileDates := mlb.RecentScheduleDates(date, 7)
		reconcileSince := reconcileDates[0]
		go mlb.ReconcileMissingFeeds(
			context.Background(),
			mlbClient,
			feedStore,
			repo,
			reconcileSince,
			20,
			logger.With("component", "feed-reconcile"),
		)
		go mlb.ReconcileRecentFinalFeeds(
			context.Background(),
			mlbClient,
			feedStore,
			allGames,
			date,
			logger.With("component", "feed-reconcile-recent"),
		)

		var livePKs []int
		for _, game := range allGames {
			if mlb.IsLiveStatus(game.Status) {
				livePKs = append(livePKs, game.GamePK)
			}
		}
		logger.Info("discovered live games from MLB schedule", "date", date, "count", len(livePKs), "game_pks", livePKs)
		return nil
	}

	if cfg.AutoDiscoverGames {
		if err := syncSchedule(); err != nil {
			return fmt.Errorf("sync schedule: %w", err)
		}

		wg.Add(1)
		go func() {
			defer wg.Done()
			ticker := time.NewTicker(cfg.ScheduleRefreshInterval)
			defer ticker.Stop()

			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					if err := syncSchedule(); err != nil {
						logger.Error("schedule refresh failed", "error", err)
						continue
					}
					date := mlb.ScheduleDateET(time.Now())
					pks, err := mlbClient.DiscoverLiveGamePKs(ctx, date)
					if err != nil {
						logger.Error("discover live games failed", "error", err)
						continue
					}
					startGames(pks)
				}
			}
		}()

		date := mlb.ScheduleDateET(time.Now())
		pks, err := mlbClient.DiscoverLiveGamePKs(ctx, date)
		if err != nil {
			return fmt.Errorf("discover live games: %w", err)
		}
		startGames(pks)
	} else {
		if err := syncSchedule(); err != nil {
			logger.Warn("schedule sync failed; games may be missing from database", "error", err)
		}
		startGames(cfg.GamePKs)
	}

	logger.Info("ingestor running", "active_workers", pool.count())
	wg.Wait()
	logger.Info("all workers stopped; ingestor shutdown complete")

	return nil
}

func scheduleGamesToRows(games []mlb.ScheduleGame) []database.GameRow {
	rows := make([]database.GameRow, 0, len(games))
	for _, game := range games {
		rows = append(rows, database.GameRow{
			GamePK:         game.GamePK,
			GameDate:       game.GameDate,
			Season:         game.Season,
			GameType:       game.GameType,
			Status:         game.Status,
			StatusDetail:   game.StatusDetail,
			AwayTeamID:     game.AwayTeamID,
			AwayTeamName:   game.AwayTeamName,
			AwayTeamAbbrev: game.AwayTeamAbbrev,
			HomeTeamID:     game.HomeTeamID,
			HomeTeamName:   game.HomeTeamName,
			HomeTeamAbbrev: game.HomeTeamAbbrev,
			AwayScore:      game.AwayScore,
			HomeScore:      game.HomeScore,
			VenueID:        game.VenueID,
			VenueName:      game.VenueName,
			OfficialDate:   game.OfficialDate,
		})
	}
	return rows
}

type repoFeedAdapter struct {
	store database.Store
}

func (a repoFeedAdapter) UpdateGameFeed(ctx context.Context, gamePK int, update mlb.GameFeedUpdate) error {
	return a.store.UpdateGameFeed(ctx, gamePK, database.GameFeedUpdate{
		GameState:    update.GameState,
		BoxScore:     update.BoxScore,
		Status:       update.Status,
		AwayScore:    update.AwayScore,
		HomeScore:    update.HomeScore,
		VenueID:      update.VenueID,
		VenueName:    update.VenueName,
		FeedSyncedAt: update.FeedSyncedAt,
	})
}
