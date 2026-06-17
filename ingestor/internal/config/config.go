// Package config centralizes runtime configuration loaded from environment
// variables. Keeping configuration isolated from business logic follows DDD
// boundaries: the ingestor domain never reads os.Getenv directly, which makes
// testing and deployment across environments predictable.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds all tunables for the MLB at-bat prediction ingestor.
type Config struct {
	// MLBAPIBaseURL is the root URL for the MLB Stats API (no trailing slash).
	MLBAPIBaseURL string

	// GamePKs lists game primary keys to poll. Optional when AutoDiscoverGames is true.
	GamePKs []int

	// AutoDiscoverGames polls the MLB schedule for live game PKs when GamePKs is empty.
	AutoDiscoverGames bool

	// ScheduleRefreshInterval re-checks the MLB schedule for newly live games.
	ScheduleRefreshInterval time.Duration

	// PollInterval controls how often each game worker fetches the live feed.
	PollInterval time.Duration

	// DatabaseURL is the Supabase/PostgreSQL connection string (postgres://...).
	DatabaseURL string

	// SupabaseURL is the project URL for REST fallback (https://xxx.supabase.co).
	SupabaseURL string

	// SupabaseServiceKey is the service role key for REST fallback writes.
	SupabaseServiceKey string

	// HTTPClientTimeout bounds a single request including TLS and body read.
	HTTPClientTimeout time.Duration

	// HTTPMaxRetries is the number of retry attempts after the initial request.
	HTTPMaxRetries int

	// HTTPRetryBaseDelay is the starting delay for exponential backoff.
	HTTPRetryBaseDelay time.Duration
}

// Load reads configuration from the process environment and applies sensible
// defaults where variables are omitted.
func Load() (*Config, error) {
	loadEnvFiles()

	cfg := &Config{
		MLBAPIBaseURL:      envOrDefault("MLB_API_BASE_URL", "https://statsapi.mlb.com/api/v1.1"),
		PollInterval:       durationFromEnv("POLL_INTERVAL", 1*time.Second),
		DatabaseURL:        os.Getenv("DATABASE_URL"),
		SupabaseURL:        firstEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
		SupabaseServiceKey: os.Getenv("SUPABASE_SERVICE_ROLE_KEY"),
		HTTPClientTimeout:  durationFromEnv("HTTP_CLIENT_TIMEOUT", 10*time.Second),
		HTTPMaxRetries:     intFromEnv("HTTP_MAX_RETRIES", 3),
		HTTPRetryBaseDelay: durationFromEnv("HTTP_RETRY_BASE_DELAY", 500*time.Millisecond),
	}

	gamePKs, err := parseGamePKs(os.Getenv("GAME_PKS"))
	if err != nil {
		return nil, fmt.Errorf("parse GAME_PKS: %w", err)
	}
	cfg.GamePKs = gamePKs

	cfg.AutoDiscoverGames = boolFromEnv("AUTO_DISCOVER_GAMES", len(cfg.GamePKs) == 0)
	cfg.ScheduleRefreshInterval = durationFromEnv("SCHEDULE_REFRESH_INTERVAL", 5*time.Minute)

	if cfg.DatabaseURL == "" && (cfg.SupabaseURL == "" || cfg.SupabaseServiceKey == "") {
		return nil, fmt.Errorf("DATABASE_URL or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY is required")
	}
	if !cfg.AutoDiscoverGames && len(cfg.GamePKs) == 0 {
		return nil, fmt.Errorf("GAME_PKS is required unless AUTO_DISCOVER_GAMES=true")
	}
	if len(cfg.GamePKs) > 15 {
		return nil, fmt.Errorf("GAME_PKS supports at most 15 concurrent games, got %d", len(cfg.GamePKs))
	}

	return cfg, nil
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func firstEnv(keys ...string) string {
	for _, key := range keys {
		if v := os.Getenv(key); v != "" {
			return v
		}
	}
	return ""
}

func durationFromEnv(key string, fallback time.Duration) time.Duration {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return fallback
	}
	return d
}

func intFromEnv(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return n
}

func boolFromEnv(key string, fallback bool) bool {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	switch strings.ToLower(raw) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

// parseGamePKs splits a comma-separated list of integer game IDs.
func parseGamePKs(raw string) ([]int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}

	parts := strings.Split(raw, ",")
	pks := make([]int, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		pk, err := strconv.Atoi(part)
		if err != nil {
			return nil, fmt.Errorf("invalid game pk %q: %w", part, err)
		}
		pks = append(pks, pk)
	}
	return pks, nil
}
