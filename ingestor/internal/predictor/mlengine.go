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
	Inning          int     `json:"inning"`
	Balls           int     `json:"balls"`
	Strikes         int     `json:"strikes"`
	Outs            int     `json:"outs"`
	OnFirst         bool    `json:"on_first"`
	OnSecond        bool    `json:"on_second"`
	OnThird         bool    `json:"on_third"`
	InningHalf      string  `json:"inning_half"`
	PitchCount      int     `json:"pitch_count"`
	BatterHand      string  `json:"batter_hand"`
	PitcherHand     string  `json:"pitcher_hand"`
	BatterID        int     `json:"batter_id"`
	PitcherID       int     `json:"pitcher_id"`
	Season          int     `json:"season"`
	AwayScore       int     `json:"away_score"`
	HomeScore       int     `json:"home_score"`
	LastPitchSpeed  float64 `json:"last_pitch_speed"`
	LastPitchType   string  `json:"last_pitch_type"`
}

type mlPredictResponse struct {
	Probabilities map[string]float64 `json:"probabilities"`
	Error         string             `json:"error"`
}

func (p *MLEnginePredictor) buildRequest(state mlb.GameState) ([]byte, error) {
	season := state.GameDateTime.Year()
	if season <= 0 {
		season = time.Now().Year()
	}

	req := mlPredictRequest{
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
		AwayScore:   state.AwayScore,
		HomeScore:   state.HomeScore,
	}
	if state.LastPitch != nil {
		req.LastPitchSpeed = state.LastPitch.StartSpeed
		req.LastPitchType = state.LastPitch.TypeCode
	}
	return json.Marshal(req)
}

func (p *MLEnginePredictor) postJSON(ctx context.Context, path string, body []byte) (mlPredictResponse, error) {
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		p.baseURL+path,
		bytes.NewReader(body),
	)
	if err != nil {
		return mlPredictResponse{}, fmt.Errorf("create predict request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return mlPredictResponse{}, fmt.Errorf("ml-engine predict: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return mlPredictResponse{}, fmt.Errorf("read ml-engine response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		var errPayload mlPredictResponse
		if json.Unmarshal(respBody, &errPayload) == nil && errPayload.Error != "" {
			return mlPredictResponse{}, fmt.Errorf("ml-engine status %d: %s", resp.StatusCode, errPayload.Error)
		}
		return mlPredictResponse{}, fmt.Errorf("ml-engine status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	var payload mlPredictResponse
	if err := json.Unmarshal(respBody, &payload); err != nil {
		return mlPredictResponse{}, fmt.Errorf("decode ml-engine response: %w", err)
	}
	return payload, nil
}

// Predict maps GameState to ml-engine features and returns outcome probabilities.
func (p *MLEnginePredictor) Predict(ctx context.Context, state mlb.GameState) (PredictionResult, error) {
	if err := ctx.Err(); err != nil {
		return PredictionResult{}, err
	}

	body, err := p.buildRequest(state)
	if err != nil {
		return PredictionResult{}, fmt.Errorf("marshal predict request: %w", err)
	}

	payload, err := p.postJSON(ctx, "/predict", body)
	if err != nil {
		return PredictionResult{}, err
	}

	return predictionFromMap(payload.Probabilities)
}

// PredictSteal calls POST /predict_steal when the steal model is deployed.
func (p *MLEnginePredictor) PredictSteal(ctx context.Context, state mlb.GameState) (StealResult, error) {
	if err := ctx.Err(); err != nil {
		return StealResult{}, err
	}
	if !state.OnFirst && !state.OnSecond {
		return StealResult{}, nil
	}

	body, err := p.buildRequest(state)
	if err != nil {
		return StealResult{}, fmt.Errorf("marshal steal request: %w", err)
	}

	payload, err := p.postJSON(ctx, "/predict_steal", body)
	if err != nil {
		return StealResult{}, err
	}

	return stealFromMap(payload.Probabilities)
}

func predictionFromMap(probs map[string]float64) (PredictionResult, error) {
	if len(probs) == 0 {
		return PredictionResult{}, fmt.Errorf("ml-engine returned empty probabilities")
	}

	result := PredictionResult{
		Strikeout:  probs[OutcomeStrikeout],
		Walk:       probs[OutcomeWalk],
		HitByPitch: probs[OutcomeHitByPitch],
		Single:     probs[OutcomeSingle],
		Double:     probs[OutcomeDouble],
		Triple:     probs[OutcomeTriple],
		HomeRun:    probs[OutcomeHomeRun],
		FieldOut:   probs[OutcomeFieldOut],
		GIDP:       probs[OutcomeGIDP],
		SacFly:     probs[OutcomeSacFly],
		SacBunt:    probs[OutcomeSacBunt],
	}

	if err := result.Validate(); err != nil {
		return PredictionResult{}, fmt.Errorf("ml-engine probabilities: %w", err)
	}

	return result, nil
}

func stealFromMap(probs map[string]float64) (StealResult, error) {
	return StealResult{
		Attempt: probs[StealAttempt],
		Success: probs[StealSuccess],
	}, nil
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
