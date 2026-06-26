package mlb

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

type liveStateWriteJob struct {
	status    string
	awayScore int
	homeScore int
	wrapped   []byte
}

// liveStateWriteQueue coalesces rapid polls into sequential writes, always
// persisting the latest snapshot after the current write completes.
type liveStateWriteQueue struct {
	mu      sync.Mutex
	pending map[int]liveStateWriteJob
	active  map[int]bool
	store   GameStore
	logger  *slog.Logger
}

func newLiveStateWriteQueue(store GameStore, logger *slog.Logger) *liveStateWriteQueue {
	if logger == nil {
		logger = slog.Default()
	}
	return &liveStateWriteQueue{
		pending: make(map[int]liveStateWriteJob),
		active:  make(map[int]bool),
		store:   store,
		logger:  logger,
	}
}

func (q *liveStateWriteQueue) enqueue(
	gamePK int,
	status string,
	awayScore, homeScore int,
	wrapped []byte,
) {
	q.mu.Lock()
	q.pending[gamePK] = liveStateWriteJob{
		status:    status,
		awayScore: awayScore,
		homeScore: homeScore,
		wrapped:   wrapped,
	}
	if q.active[gamePK] {
		q.mu.Unlock()
		return
	}
	q.active[gamePK] = true
	q.mu.Unlock()

	go q.drain(gamePK)
}

func (q *liveStateWriteQueue) drain(gamePK int) {
	log := q.logger.With("game_pk", gamePK)

	for {
		q.mu.Lock()
		job, ok := q.pending[gamePK]
		if ok {
			delete(q.pending, gamePK)
		} else {
			delete(q.active, gamePK)
			q.mu.Unlock()
			return
		}
		q.mu.Unlock()

		writeCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		err := q.store.UpdateLiveGameState(
			writeCtx,
			gamePK,
			job.status,
			job.awayScore,
			job.homeScore,
			job.wrapped,
		)
		cancel()

		if err != nil {
			log.Error("failed to update live game state", "error", err)
		}
	}
}
