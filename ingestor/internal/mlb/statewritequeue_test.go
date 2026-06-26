package mlb

import (
	"context"
	"sync"
	"testing"
	"time"
)

type mockGameStore struct {
	mu        sync.Mutex
	writes    int
	lastBytes []byte
	delay     time.Duration
}

func (m *mockGameStore) UpdateGameFromPoll(context.Context, int, string, int, int) error {
	return nil
}

func (m *mockGameStore) UpdateLiveGameState(_ context.Context, _ int, _ string, _, _ int, state []byte) error {
	if m.delay > 0 {
		time.Sleep(m.delay)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.writes++
	m.lastBytes = append([]byte(nil), state...)
	return nil
}

func TestLiveStateWriteQueueCoalescesLatest(t *testing.T) {
	store := &mockGameStore{delay: 40 * time.Millisecond}
	q := newLiveStateWriteQueue(store, nil)

	q.enqueue(1, "Live", 0, 0, []byte("first"))
	q.enqueue(1, "Live", 1, 0, []byte("second"))
	q.enqueue(1, "Live", 2, 0, []byte("third"))

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		store.mu.Lock()
		writes := store.writes
		last := string(store.lastBytes)
		store.mu.Unlock()
		if writes >= 1 && last == "third" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	t.Fatalf("expected latest coalesced payload, writes=%d last=%q", store.writes, string(store.lastBytes))
}

func TestLiveStateWriteQueueParallelGames(t *testing.T) {
	store := &mockGameStore{}
	q := newLiveStateWriteQueue(store, nil)

	var wg sync.WaitGroup

	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(pk int) {
			defer wg.Done()
			for j := 0; j < 5; j++ {
				q.enqueue(pk, "Live", j, j, []byte{byte(j)})
			}
		}(i + 1)
	}

	wg.Wait()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		store.mu.Lock()
		writes := store.writes
		store.mu.Unlock()
		if writes >= 4 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	t.Fatalf("expected at least one write per game, got %d", store.writes)
}
