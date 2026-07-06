// Package predictor defines the ML inference boundary. The ingestor depends on
// the Predictor interface—not a concrete model—so we can swap mock, ONNX, or
// remote gRPC inference without touching polling or persistence code.
package predictor

import (
	"context"

	"mlb-ingestor/internal/mlb"
)

// Outcome labels match keys stored in the outcome_probabilities JSONB column.
const (
	OutcomeStrikeout   = "strikeout"
	OutcomeWalk        = "walk"
	OutcomeHitByPitch  = "hit_by_pitch"
	OutcomeSingle      = "single"
	OutcomeDouble      = "double"
	OutcomeTriple      = "triple"
	OutcomeHomeRun     = "home_run"
	OutcomeFieldOut    = "field_out"
	OutcomeGIDP        = "gidp"
	OutcomeSacFly      = "sac_fly"
	OutcomeSacBunt     = "sac_bunt"
)

// Steal labels stored in steal_probabilities JSONB column.
const (
	StealAttempt = "steal_attempt"
	StealSuccess = "steal_success"
)

// PredictionResult is a probability distribution over terminal at-bat outcomes.
// All fields are in [0,1] and must sum to 1.0 before persistence.
type PredictionResult struct {
	Strikeout   float64 `json:"strikeout"`
	Walk        float64 `json:"walk"`
	HitByPitch  float64 `json:"hit_by_pitch"`
	Single      float64 `json:"single"`
	Double      float64 `json:"double"`
	Triple      float64 `json:"triple"`
	HomeRun     float64 `json:"home_run"`
	FieldOut    float64 `json:"field_out"`
	GIDP        float64 `json:"gidp"`
	SacFly      float64 `json:"sac_fly"`
	SacBunt     float64 `json:"sac_bunt"`
}

// StealResult holds steal attempt/success probabilities for the current situation.
type StealResult struct {
	Attempt float64 `json:"steal_attempt"`
	Success float64 `json:"steal_success"`
}

// ToMap converts the struct into the JSONB-friendly map used by the repository.
func (p PredictionResult) ToMap() map[string]float64 {
	return map[string]float64{
		OutcomeStrikeout:  p.Strikeout,
		OutcomeWalk:       p.Walk,
		OutcomeHitByPitch: p.HitByPitch,
		OutcomeSingle:     p.Single,
		OutcomeDouble:     p.Double,
		OutcomeTriple:     p.Triple,
		OutcomeHomeRun:    p.HomeRun,
		OutcomeFieldOut:   p.FieldOut,
		OutcomeGIDP:       p.GIDP,
		OutcomeSacFly:     p.SacFly,
		OutcomeSacBunt:    p.SacBunt,
	}
}

// ToMap converts steal probabilities for JSONB persistence.
func (s StealResult) ToMap() map[string]float64 {
	return map[string]float64{
		StealAttempt: s.Attempt,
		StealSuccess: s.Success,
	}
}

// Validate ensures probabilities are non-negative and sum to 1.0 within tolerance.
func (p PredictionResult) Validate() error {
	probs := []float64{
		p.Strikeout, p.Walk, p.HitByPitch, p.Single, p.Double, p.Triple,
		p.HomeRun, p.FieldOut, p.GIDP, p.SacFly, p.SacBunt,
	}
	var sum float64
	for _, v := range probs {
		if v < 0 {
			return errNegativeProbability
		}
		sum += v
	}
	const epsilon = 0.001
	if sum < 1.0-epsilon || sum > 1.0+epsilon {
		return errProbabilitySum
	}
	return nil
}

// Predictor scores a live at-bat snapshot and returns outcome probabilities.
type Predictor interface {
	Predict(ctx context.Context, state mlb.GameState) (PredictionResult, error)
	PredictSteal(ctx context.Context, state mlb.GameState) (StealResult, error)
}
