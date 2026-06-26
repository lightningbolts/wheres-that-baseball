package mlb

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestClientConditionalFetchUses304Cache(t *testing.T) {
	body := []byte(`{"gameData":{"status":{"abstractGameState":"Live"}},"liveData":{"plays":{"currentPlay":{}},"linescore":{"teams":{"away":{},"home":{}}}}}`)
	var hits int

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.Header.Get("If-None-Match") == `"v1"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", `"v1"`)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}))
	defer server.Close()

	client := NewClient(ClientOptions{
		BaseURL:    server.URL,
		Timeout:    2 * time.Second,
		MaxRetries: 0,
		BaseDelay:  0,
	})

	ctx := context.Background()

	first, err := client.FetchLiveFeedRawFull(ctx, 99)
	if err != nil {
		t.Fatalf("first fetch: %v", err)
	}
	if string(first) != string(body) {
		t.Fatalf("unexpected first body: %s", first)
	}

	second, err := client.FetchLiveFeedRawFull(ctx, 99)
	if err != nil {
		t.Fatalf("second fetch: %v", err)
	}
	if string(second) != string(body) {
		t.Fatalf("unexpected cached body: %s", second)
	}
	if hits != 2 {
		t.Fatalf("expected 2 HTTP hits (200 + 304), got %d", hits)
	}
}
