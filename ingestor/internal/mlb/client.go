package mlb

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"
)

// Client fetches live game feeds from the MLB Stats API with connection reuse
// and exponential backoff on transient failures.
type Client struct {
	baseURL    string
	httpClient *http.Client
	maxRetries int
	baseDelay  time.Duration

	feedMu    sync.Mutex
	feedCache map[int]feedCacheEntry
}

type feedCacheEntry struct {
	body []byte
	etag string
}

// ClientOptions tunes HTTP behavior for the MLB API client.
type ClientOptions struct {
	BaseURL    string
	Timeout    time.Duration
	MaxRetries int
	BaseDelay  time.Duration
}

// NewClient builds an MLB API client with a tuned Transport for high-frequency
// polling: idle connections are kept warm per host to avoid TLS handshakes on
// every 3-second poll across multiple concurrent games.
func NewClient(opts ClientOptions) *Client {
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   5 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   15, // one idle conn per concurrent game worker
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	return &Client{
		baseURL: opts.BaseURL,
		httpClient: &http.Client{
			Timeout:   opts.Timeout,
			Transport: transport,
		},
		maxRetries: opts.MaxRetries,
		baseDelay:  opts.BaseDelay,
		feedCache:  make(map[int]feedCacheEntry),
	}
}

// FetchLiveFeed retrieves and unmarshals the live feed for a single game.
func (c *Client) FetchLiveFeed(ctx context.Context, gamePK int) (*LiveFeed, error) {
	raw, err := c.FetchLiveFeedRaw(ctx, gamePK)
	if err != nil {
		return nil, err
	}

	var feed LiveFeed
	if err := json.Unmarshal(raw, &feed); err != nil {
		return nil, fmt.Errorf("unmarshal live feed gamePk=%d: %w", gamePK, err)
	}

	return &feed, nil
}

// FetchLiveFeedFull retrieves the complete live feed (used when caching after game end).
func (c *Client) FetchLiveFeedFull(ctx context.Context, gamePK int) (*LiveFeed, error) {
	raw, err := c.FetchLiveFeedRawFull(ctx, gamePK)
	if err != nil {
		return nil, err
	}

	var feed LiveFeed
	if err := json.Unmarshal(raw, &feed); err != nil {
		return nil, fmt.Errorf("unmarshal live feed gamePk=%d: %w", gamePK, err)
	}

	return &feed, nil
}

// FetchLiveFeedRaw returns the full JSON body from the live feed endpoint.
func (c *Client) FetchLiveFeedRaw(ctx context.Context, gamePK int) (json.RawMessage, error) {
	return c.FetchLiveFeedRawFull(ctx, gamePK)
}

// FetchLiveFeedRawFull returns the untouched full JSON body from the live feed endpoint.
func (c *Client) FetchLiveFeedRawFull(ctx context.Context, gamePK int) (json.RawMessage, error) {
	url := fmt.Sprintf("%s/game/%d/feed/live", c.baseURL, gamePK)

	c.feedMu.Lock()
	cached, hasCached := c.feedCache[gamePK]
	c.feedMu.Unlock()

	body, status, etag, err := c.getWithRetryConditional(ctx, url, cached.etag)
	if err != nil {
		return nil, fmt.Errorf("fetch live feed gamePk=%d: %w", gamePK, err)
	}

	if status == http.StatusNotModified && hasCached {
		return json.RawMessage(cached.body), nil
	}

	c.feedMu.Lock()
	c.feedCache[gamePK] = feedCacheEntry{body: body, etag: etag}
	c.feedMu.Unlock()

	return json.RawMessage(body), nil
}

// getWithRetry executes GET with exponential backoff. Context cancellation
// aborts between retries so shutdown is not blocked by backoff sleeps.
func (c *Client) getWithRetry(ctx context.Context, url string) ([]byte, error) {
	body, _, _, err := c.getWithRetryConditional(ctx, url, "")
	return body, err
}

func (c *Client) getWithRetryConditional(ctx context.Context, url, etag string) ([]byte, int, string, error) {
	var lastErr error

	for attempt := 0; attempt <= c.maxRetries; attempt++ {
		if attempt > 0 {
			delay := c.backoffDelay(attempt)
			select {
			case <-ctx.Done():
				return nil, 0, "", fmt.Errorf("context canceled during retry backoff: %w", ctx.Err())
			case <-time.After(delay):
			}
		}

		body, status, respEtag, err := c.doGetConditional(ctx, url, etag)
		if err == nil {
			return body, status, respEtag, nil
		}
		lastErr = err

		if !isRetryable(err) {
			break
		}
	}

	return nil, 0, "", fmt.Errorf("exhausted retries for %s: %w", url, lastErr)
}

func (c *Client) doGet(ctx context.Context, url string) ([]byte, error) {
	body, _, _, err := c.doGetConditional(ctx, url, "")
	return body, err
}

func (c *Client) doGetConditional(ctx context.Context, url, etag string) ([]byte, int, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, 0, "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "mlb-atbat-predictor-ingestor/1.0")
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}

	started := time.Now()
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, 0, "", fmt.Errorf("http do: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, "", fmt.Errorf("read body: %w", err)
	}

	elapsed := time.Since(started)
	respEtag := resp.Header.Get("ETag")

	if resp.StatusCode == http.StatusNotModified {
		return nil, resp.StatusCode, respEtag, nil
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, resp.StatusCode, respEtag, &httpStatusError{StatusCode: resp.StatusCode, Body: string(body)}
	}

	_ = elapsed // reserved for structured metrics hooks
	return body, resp.StatusCode, respEtag, nil
}

func (c *Client) backoffDelay(attempt int) time.Duration {
	// attempt 1 -> baseDelay, attempt 2 -> 2*baseDelay, etc.
	multiplier := 1 << (attempt - 1)
	return time.Duration(multiplier) * c.baseDelay
}

// httpStatusError represents a non-2xx response; 5xx and 429 are retryable.
type httpStatusError struct {
	StatusCode int
	Body       string
}

func (e *httpStatusError) Error() string {
	return fmt.Sprintf("unexpected status %d: %s", e.StatusCode, e.Body)
}

func isRetryable(err error) bool {
	if err == nil {
		return false
	}
	if statusErr, ok := err.(*httpStatusError); ok {
		return statusErr.StatusCode >= 500 || statusErr.StatusCode == http.StatusTooManyRequests
	}
	// Network timeouts and temporary errors are worth retrying.
	if netErr, ok := err.(net.Error); ok && (netErr.Timeout() || netErr.Temporary()) {
		return true
	}
	return false
}
