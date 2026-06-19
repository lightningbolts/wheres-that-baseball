package predictor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"mlb-ingestor/internal/mlb"
)

// MLEnginePredictor calls the ml-engine HTTP server for sklearn inference.
type MLEnginePredictor struct {
	baseURL string
	client  *http.Client
}

// MLEngineOptions configures the remote predictor client.
type MLEngineOptions struct {
	BaseURL string
	Timeout time.Duration
}

// NewMLEnginePredictor creates a client for POST {baseURL}/predict.
func NewMLEnginePredictor(opts MLEngineOptions) (*MLEnginePredictor, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(opts.BaseURL), "/")
	if baseURL == "" {
		return nil, fmt.Errorf("ml-engine base URL is required")
	}

	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 2 * time.Second
	}

	return &MLEnginePredictor{
		baseURL: baseURL,
		client: &http.Client{
			Timeout: timeout,
		},
	}, nil
}

type mlPredictRequest struct {
	Inning      int    `json:"inning"`
	Balls       int    `json:"balls"`
	Strikes     int    `json:"strikes"`
	Outs        int    `json:"outs"`
	OnFirst     bool   `json:"on_first"`
	OnSecond    bool   `json:"on_second"`
	OnThird     bool   `json:"on_third"`
	InningHalf  string `json:"inning_half"`
	PitchCount  int    `json:"pitch_count"`
	BatterHand  string `json:"batter_hand"`
	PitcherHand string `json:"pitcher_hand"`
	BatterID    int    `json:"batter_id"`
	PitcherID   int    `json:"pitcher_id"`
	Season      int    `json:"season"`
}

type mlPredictResponse struct {
	Probabilities map[string]float64 `json:"probabilities"`
	Error         string             `json:"error"`
}

// Predict maps GameState to ml-engine features and returns outcome probabilities.
func (p *MLEnginePredictor) Predict(ctx context.Context, state mlb.GameState) (PredictionResult, error) {
	if err := ctx.Err(); err != nil {
		return PredictionResult{}, err
	}

	season := state.GameDateTime.Year()
	if season <= 0 {
		season = time.Now().Year()
	}

	body, err := json.Marshal(mlPredictRequest{
		Inning:      state.Inning,
		Balls:       state.Balls,
		Strikes:     state.Strikes,
		Outs:        state.Outs,
		OnFirst:     state.OnFirst,
		OnSecond:    state.OnSecond,
		OnThird:     state.OnThird,
		InningHalf:  state.InningHalf,
		PitchCount:  state.PitchCount,
		BatterHand:  state.BatterHand,
		PitcherHand: state.PitcherHand,
		BatterID:    state.BatterID,
		PitcherID:   state.PitcherID,
		Season:      season,
	})
	if err != nil {
		return PredictionResult{}, fmt.Errorf("marshal predict request: %w", err)
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		p.baseURL+"/predict",
		bytes.NewReader(body),
	)
	if err != nil {
		return PredictionResult{}, fmt.Errorf("create predict request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return PredictionResult{}, fmt.Errorf("ml-engine predict: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return PredictionResult{}, fmt.Errorf("read ml-engine response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		var errPayload mlPredictResponse
		if json.Unmarshal(respBody, &errPayload) == nil && errPayload.Error != "" {
			return PredictionResult{}, fmt.Errorf("ml-engine status %d: %s", resp.StatusCode, errPayload.Error)
		}
		return PredictionResult{}, fmt.Errorf("ml-engine status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	var payload mlPredictResponse
	if err := json.Unmarshal(respBody, &payload); err != nil {
		return PredictionResult{}, fmt.Errorf("decode ml-engine response: %w", err)
	}

	return predictionFromMap(payload.Probabilities)
}

func predictionFromMap(probs map[string]float64) (PredictionResult, error) {
	if len(probs) == 0 {
		return PredictionResult{}, fmt.Errorf("ml-engine returned empty probabilities")
	}

	result := PredictionResult{
		Strikeout: probs[OutcomeStrikeout],
		Walk:      probs[OutcomeWalk],
		Single:    probs[OutcomeSingle],
		Double:    probs[OutcomeDouble],
		Triple:    probs[OutcomeTriple],
		HomeRun:   probs[OutcomeHomeRun],
		FieldOut:  probs[OutcomeFieldOut],
	}

	if err := result.Validate(); err != nil {
		return PredictionResult{}, fmt.Errorf("ml-engine probabilities: %w", err)
	}

	return result, nil
}

// Ping checks GET /health before the ingestor starts polling.
func (p *MLEnginePredictor) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.baseURL+"/health", nil)
	if err != nil {
		return fmt.Errorf("create health request: %w", err)
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("ml-engine health: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("ml-engine health status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}
