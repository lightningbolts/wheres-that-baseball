package database

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

// RestRepository writes to Supabase via PostgREST (HTTPS). Use this when the
// direct Postgres host is unreachable (e.g. IPv6-only db.*.supabase.co).
type RestRepository struct {
	baseURL    string
	serviceKey string
	client     *http.Client
}

// NewRestRepository connects to Supabase REST using the service role key.
func NewRestRepository(supabaseURL, serviceKey string) (*RestRepository, error) {
	supabaseURL = strings.TrimRight(strings.TrimSpace(supabaseURL), "/")
	serviceKey = strings.TrimSpace(serviceKey)
	if supabaseURL == "" || serviceKey == "" {
		return nil, fmt.Errorf("supabase url and service role key are required")
	}

	return &RestRepository{
		baseURL:    supabaseURL,
		serviceKey: serviceKey,
		client:     &http.Client{Timeout: 30 * time.Second},
	}, nil
}

// Close is a no-op for the REST client.
func (r *RestRepository) Close() {}

func (r *RestRepository) InsertPrediction(ctx context.Context, row PredictionRow) (uuid.UUID, error) {
	if ctx.Err() != nil {
		return uuid.Nil, fmt.Errorf("context already canceled: %w", ctx.Err())
	}

	id := uuid.New()
	ts := row.Timestamp
	if ts.IsZero() {
		ts = time.Now().UTC()
	}

	payload := map[string]any{
		"id":                    id.String(),
		"game_pk":               row.GamePK,
		"timestamp":             ts.UTC().Format(time.RFC3339Nano),
		"batter_name":           row.BatterName,
		"pitcher_name":          row.PitcherName,
		"inning":                row.Inning,
		"balls":                 row.Balls,
		"strikes":               row.Strikes,
		"outs":                  row.Outs,
		"on_first":              row.OnFirst,
		"on_second":             row.OnSecond,
		"on_third":              row.OnThird,
		"outcome_probabilities": row.OutcomeProbabilities,
	}
	if len(row.StealProbabilities) > 0 {
		payload["steal_probabilities"] = row.StealProbabilities
	}

	var returned []struct {
		ID uuid.UUID `json:"id"`
	}
	if err := r.do(ctx, http.MethodPost, "/rest/v1/predictions", payload, "return=representation", &returned); err != nil {
		return uuid.Nil, err
	}
	if len(returned) > 0 {
		return returned[0].ID, nil
	}
	return id, nil
}

func (r *RestRepository) UpsertGames(ctx context.Context, rows []GameRow) error {
	if ctx.Err() != nil {
		return fmt.Errorf("context already canceled: %w", ctx.Err())
	}
	if len(rows) == 0 {
		return nil
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	payload := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		item := map[string]any{
			"game_pk":          row.GamePK,
			"game_date":        row.GameDate,
			"season":           row.Season,
			"game_type":        row.GameType,
			"status":           row.Status,
			"away_team_id":     row.AwayTeamID,
			"away_team_name":   row.AwayTeamName,
			"away_team_abbrev": row.AwayTeamAbbrev,
			"home_team_id":     row.HomeTeamID,
			"home_team_name":   row.HomeTeamName,
			"home_team_abbrev": row.HomeTeamAbbrev,
			"away_score":       row.AwayScore,
			"home_score":       row.HomeScore,
			"venue_id":         row.VenueID,
			"official_date":    row.OfficialDate,
			"updated_at":       now,
		}
		if row.StatusDetail != "" {
			item["status_detail"] = row.StatusDetail
		}
		if row.VenueName != "" {
			item["venue_name"] = row.VenueName
		}
		payload = append(payload, item)
	}

	path := "/rest/v1/games?on_conflict=game_pk"
	return r.do(ctx, http.MethodPost, path, payload, "return=minimal,resolution=merge-duplicates", nil)
}

func (r *RestRepository) UpdateGameFromPoll(
	ctx context.Context,
	gamePK int,
	status string,
	awayScore, homeScore int,
) error {
	if ctx.Err() != nil {
		return fmt.Errorf("context already canceled: %w", ctx.Err())
	}

	payload := map[string]any{
		"away_score":  awayScore,
		"home_score":  homeScore,
		"updated_at":  time.Now().UTC().Format(time.RFC3339Nano),
	}
	if status != "" {
		payload["status"] = status
	}
	path := fmt.Sprintf("/rest/v1/games?game_pk=eq.%d", gamePK)
	return r.do(ctx, http.MethodPatch, path, payload, "return=minimal", nil)
}

func (r *RestRepository) UpdateLiveGameState(
	ctx context.Context,
	gamePK int,
	status string,
	awayScore, homeScore int,
	gameState []byte,
) error {
	if ctx.Err() != nil {
		return fmt.Errorf("context already canceled: %w", ctx.Err())
	}

	payload := map[string]any{
		"away_score": awayScore,
		"home_score": homeScore,
		"game_state": json.RawMessage(gameState),
		"updated_at": time.Now().UTC().Format(time.RFC3339Nano),
	}
	if status != "" {
		payload["status"] = status
	}

	path := fmt.Sprintf("/rest/v1/games?game_pk=eq.%d", gamePK)
	return r.do(ctx, http.MethodPatch, path, payload, "return=minimal", nil)
}

func (r *RestRepository) UpdateGameFeed(ctx context.Context, gamePK int, update GameFeedUpdate) error {
	if ctx.Err() != nil {
		return fmt.Errorf("context already canceled: %w", ctx.Err())
	}

	syncedAt := update.FeedSyncedAt
	if syncedAt.IsZero() {
		syncedAt = time.Now().UTC()
	}

	payload := map[string]any{
		"game_state":     json.RawMessage(update.GameState),
		"box_score":      json.RawMessage(update.BoxScore),
		"feed_synced_at": syncedAt.UTC().Format(time.RFC3339Nano),
		"away_score":     update.AwayScore,
		"home_score":     update.HomeScore,
		"status":         update.Status,
		"updated_at":     syncedAt.UTC().Format(time.RFC3339Nano),
	}
	if update.VenueID != nil {
		payload["venue_id"] = *update.VenueID
	}
	if update.VenueName != "" {
		payload["venue_name"] = update.VenueName
	}

	path := fmt.Sprintf("/rest/v1/games?game_pk=eq.%d", gamePK)
	return r.do(ctx, http.MethodPatch, path, payload, "return=minimal", nil)
}

func (r *RestRepository) ListGamesNeedingFeedSync(ctx context.Context, sinceDate string, limit int) ([]int, error) {
	if ctx.Err() != nil {
		return nil, fmt.Errorf("context already canceled: %w", ctx.Err())
	}
	if limit <= 0 {
		limit = 10
	}

	endpoint := fmt.Sprintf(
		"%s/rest/v1/games?select=game_pk&feed_synced_at=is.null&status=eq.Final&game_date=gte.%s&order=game_date.desc&limit=%d",
		r.baseURL,
		sinceDate,
		limit,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("apikey", r.serviceKey)
	req.Header.Set("Authorization", "Bearer "+r.serviceKey)

	resp, err := r.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("list games needing feed sync: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("list games needing feed sync failed (%d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var rows []struct {
		GamePK int `json:"game_pk"`
	}
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, fmt.Errorf("decode games needing feed sync: %w", err)
	}

	pks := make([]int, 0, len(rows))
	for _, row := range rows {
		pks = append(pks, row.GamePK)
	}
	return pks, nil
}

func (r *RestRepository) do(
	ctx context.Context,
	method, path string,
	body any,
	prefer string,
	out any,
) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request body: %w", err)
		}
		reader = bytes.NewReader(encoded)
	}

	endpoint := r.baseURL + path
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("apikey", r.serviceKey)
	req.Header.Set("Authorization", "Bearer "+r.serviceKey)
	req.Header.Set("Content-Type", "application/json")
	if prefer != "" {
		req.Header.Set("Prefer", prefer)
	}

	resp, err := r.client.Do(req)
	if err != nil {
		return fmt.Errorf("%s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("%s %s failed (%d): %s", method, path, resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	if out != nil && len(respBody) > 0 && string(respBody) != "null" {
		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
	}

	return nil
}

// Ping verifies REST credentials with a lightweight request.
func (r *RestRepository) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodHead,
		r.baseURL+"/rest/v1/games?select=game_pk&limit=1",
		nil,
	)
	if err != nil {
		return err
	}
	req.Header.Set("apikey", r.serviceKey)
	req.Header.Set("Authorization", "Bearer "+r.serviceKey)

	resp, err := r.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	return fmt.Errorf("supabase rest ping status %d", resp.StatusCode)
}

// OpenStore connects via Postgres when possible, otherwise Supabase REST.
func OpenStore(ctx context.Context, databaseURL, supabaseURL, serviceKey string) (Store, string, error) {
	if databaseURL != "" {
		repo, err := NewRepository(ctx, databaseURL)
		if err == nil {
			return repo, "postgres", nil
		}

		if supabaseURL != "" && serviceKey != "" {
			rest, restErr := NewRestRepository(supabaseURL, serviceKey)
			if restErr != nil {
				return nil, "", fmt.Errorf("postgres failed (%v) and rest init failed: %w", err, restErr)
			}
			if pingErr := rest.Ping(ctx); pingErr != nil {
				return nil, "", fmt.Errorf("postgres failed (%v) and rest ping failed: %w", err, pingErr)
			}
			return rest, "supabase-rest", nil
		}

		return nil, "", fmt.Errorf("postgres: %w", err)
	}

	if supabaseURL == "" || serviceKey == "" {
		return nil, "", fmt.Errorf("DATABASE_URL or SUPABASE credentials are required")
	}

	rest, err := NewRestRepository(supabaseURL, serviceKey)
	if err != nil {
		return nil, "", err
	}
	if err := rest.Ping(ctx); err != nil {
		return nil, "", fmt.Errorf("supabase rest ping: %w", err)
	}
	return rest, "supabase-rest", nil
}

var (
	_ Store = (*Repository)(nil)
	_ Store = (*RestRepository)(nil)
)
