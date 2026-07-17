package predictor

import (
	"context"
	"fmt"
	"math"

	"mlb-ingestor/internal/mlb"
)

// MockPredictor produces count-aware probability distributions for UI
// development. It mirrors the web clientPredictor priors so mock odds stay
// coherent when the ML engine is offline.
type MockPredictor struct{}

// NewMockPredictor creates a deterministic mock predictor.
func NewMockPredictor() *MockPredictor {
	return &MockPredictor{}
}

// Predict returns count-prior probabilities adjusted by base/out state.
func (m *MockPredictor) Predict(ctx context.Context, state mlb.GameState) (PredictionResult, error) {
	if err := ctx.Err(); err != nil {
		return PredictionResult{}, err
	}

	weights := baseWeights(state)
	applySituation(weights, state)
	applyPitchDrift(weights, state)
	zeroImpossible(weights, state)

	normalized := normalize(weights)
	return PredictionResult{
		Strikeout:  normalized[OutcomeStrikeout],
		Walk:       normalized[OutcomeWalk],
		HitByPitch: normalized[OutcomeHitByPitch],
		Single:     normalized[OutcomeSingle],
		Double:     normalized[OutcomeDouble],
		Triple:     normalized[OutcomeTriple],
		HomeRun:    normalized[OutcomeHomeRun],
		FieldOut:   normalized[OutcomeFieldOut],
		GIDP:       normalized[OutcomeGIDP],
		SacFly:     normalized[OutcomeSacFly],
		SacBunt:    normalized[OutcomeSacBunt],
	}, nil
}

// PredictSteal returns heuristic steal odds when runners are on base.
func (m *MockPredictor) PredictSteal(ctx context.Context, state mlb.GameState) (StealResult, error) {
	if err := ctx.Err(); err != nil {
		return StealResult{}, err
	}
	if !state.OnFirst && !state.OnSecond {
		return StealResult{}, nil
	}

	attempt := 0.045
	if state.OnFirst && !state.OnSecond {
		attempt = 0.055
	}
	if state.OnSecond && !state.OnFirst {
		attempt = 0.03
	}
	if state.Outs >= 2 {
		attempt += 0.015
	}
	return StealResult{Attempt: attempt, Success: attempt * 0.74}, nil
}

func countKey(balls, strikes int) string {
	if balls < 0 {
		balls = 0
	}
	if balls > 3 {
		balls = 3
	}
	if strikes < 0 {
		strikes = 0
	}
	if strikes > 2 {
		strikes = 2
	}
	return fmt.Sprintf("%d-%d", balls, strikes)
}

func baseWeights(state mlb.GameState) map[string]float64 {
	priors := map[string]map[string]float64{
		"0-0": {OutcomeStrikeout: 0.187, OutcomeWalk: 0.083, OutcomeHitByPitch: 0.009, OutcomeSingle: 0.143, OutcomeDouble: 0.045, OutcomeTriple: 0.004, OutcomeHomeRun: 0.031, OutcomeFieldOut: 0.498},
		"0-1": {OutcomeStrikeout: 0.252, OutcomeWalk: 0.055, OutcomeHitByPitch: 0.007, OutcomeSingle: 0.132, OutcomeDouble: 0.041, OutcomeTriple: 0.004, OutcomeHomeRun: 0.027, OutcomeFieldOut: 0.482},
		"0-2": {OutcomeStrikeout: 0.396, OutcomeWalk: 0.035, OutcomeHitByPitch: 0.005, OutcomeSingle: 0.105, OutcomeDouble: 0.032, OutcomeTriple: 0.003, OutcomeHomeRun: 0.020, OutcomeFieldOut: 0.404},
		"1-0": {OutcomeStrikeout: 0.152, OutcomeWalk: 0.125, OutcomeHitByPitch: 0.011, OutcomeSingle: 0.150, OutcomeDouble: 0.047, OutcomeTriple: 0.004, OutcomeHomeRun: 0.035, OutcomeFieldOut: 0.476},
		"1-1": {OutcomeStrikeout: 0.213, OutcomeWalk: 0.078, OutcomeHitByPitch: 0.008, OutcomeSingle: 0.140, OutcomeDouble: 0.044, OutcomeTriple: 0.004, OutcomeHomeRun: 0.030, OutcomeFieldOut: 0.483},
		"1-2": {OutcomeStrikeout: 0.348, OutcomeWalk: 0.049, OutcomeHitByPitch: 0.006, OutcomeSingle: 0.112, OutcomeDouble: 0.035, OutcomeTriple: 0.003, OutcomeHomeRun: 0.022, OutcomeFieldOut: 0.425},
		"2-0": {OutcomeStrikeout: 0.116, OutcomeWalk: 0.204, OutcomeHitByPitch: 0.013, OutcomeSingle: 0.148, OutcomeDouble: 0.047, OutcomeTriple: 0.004, OutcomeHomeRun: 0.038, OutcomeFieldOut: 0.430},
		"2-1": {OutcomeStrikeout: 0.168, OutcomeWalk: 0.125, OutcomeHitByPitch: 0.010, OutcomeSingle: 0.145, OutcomeDouble: 0.046, OutcomeTriple: 0.004, OutcomeHomeRun: 0.034, OutcomeFieldOut: 0.468},
		"2-2": {OutcomeStrikeout: 0.286, OutcomeWalk: 0.081, OutcomeHitByPitch: 0.007, OutcomeSingle: 0.122, OutcomeDouble: 0.038, OutcomeTriple: 0.003, OutcomeHomeRun: 0.026, OutcomeFieldOut: 0.437},
		"3-0": {OutcomeStrikeout: 0.057, OutcomeWalk: 0.533, OutcomeHitByPitch: 0.014, OutcomeSingle: 0.100, OutcomeDouble: 0.032, OutcomeTriple: 0.003, OutcomeHomeRun: 0.028, OutcomeFieldOut: 0.233},
		"3-1": {OutcomeStrikeout: 0.094, OutcomeWalk: 0.316, OutcomeHitByPitch: 0.012, OutcomeSingle: 0.130, OutcomeDouble: 0.041, OutcomeTriple: 0.004, OutcomeHomeRun: 0.035, OutcomeFieldOut: 0.368},
		"3-2": {OutcomeStrikeout: 0.205, OutcomeWalk: 0.164, OutcomeHitByPitch: 0.009, OutcomeSingle: 0.140, OutcomeDouble: 0.044, OutcomeTriple: 0.004, OutcomeHomeRun: 0.033, OutcomeFieldOut: 0.401},
	}

	src := priors[countKey(state.Balls, state.Strikes)]
	if src == nil {
		src = priors["0-0"]
	}

	w := map[string]float64{
		OutcomeStrikeout:  src[OutcomeStrikeout],
		OutcomeWalk:       src[OutcomeWalk],
		OutcomeHitByPitch: src[OutcomeHitByPitch],
		OutcomeSingle:     src[OutcomeSingle],
		OutcomeDouble:     src[OutcomeDouble],
		OutcomeTriple:     src[OutcomeTriple],
		OutcomeHomeRun:    src[OutcomeHomeRun],
		OutcomeFieldOut:   src[OutcomeFieldOut],
		OutcomeGIDP:       0,
		OutcomeSacFly:     0,
		OutcomeSacBunt:    0,
	}
	return w
}

func applySituation(w map[string]float64, state mlb.GameState) {
	if state.OnFirst {
		gidp := 0.095
		if state.Outs >= 2 {
			gidp = 0.035
		}
		w[OutcomeGIDP] = gidp
		w[OutcomeFieldOut] = math.Max(0.05, w[OutcomeFieldOut]-gidp*0.85)
	}
	if state.OnThird && state.Outs < 2 {
		w[OutcomeSacFly] = 0.055
		w[OutcomeFieldOut] = math.Max(0.05, w[OutcomeFieldOut]-0.045)
	}
	if (state.OnFirst || state.OnSecond) && state.Outs < 2 {
		sac := 0.006
		if state.OnFirst && !state.OnSecond && !state.OnThird {
			sac = 0.012
		}
		w[OutcomeSacBunt] = sac
		w[OutcomeFieldOut] = math.Max(0.05, w[OutcomeFieldOut]-sac)
	}
	if state.OnSecond || state.OnThird {
		w[OutcomeSingle] += 0.015
		w[OutcomeDouble] += 0.008
		w[OutcomeFieldOut] = math.Max(0.05, w[OutcomeFieldOut]-0.02)
	}
	if state.Outs >= 2 {
		w[OutcomeSingle] += 0.01
		w[OutcomeHomeRun] += 0.005
		w[OutcomeFieldOut] = math.Max(0.05, w[OutcomeFieldOut]-0.015)
	}
}

func applyPitchDrift(w map[string]float64, state mlb.GameState) {
	baseline := 4
	if w[OutcomeWalk] > 0.3 {
		baseline = 3
	}
	foulExtra := state.PitchCount - baseline
	if foulExtra <= 0 {
		return
	}
	fatigue := math.Min(0.04, float64(foulExtra)*0.008)
	w[OutcomeStrikeout] += fatigue * 0.55
	w[OutcomeFieldOut] += fatigue * 0.25
	w[OutcomeWalk] = math.Max(0.01, w[OutcomeWalk]-fatigue*0.35)
	w[OutcomeSingle] = math.Max(0.02, w[OutcomeSingle]-fatigue*0.2)
}

func zeroImpossible(w map[string]float64, state mlb.GameState) {
	for k := range w {
		if isImpossibleOutcome(k, state) {
			w[k] = 0
		}
	}
}

func isImpossibleOutcome(outcome string, state mlb.GameState) bool {
	switch outcome {
	case OutcomeGIDP:
		return !state.OnFirst
	case OutcomeSacFly:
		return !state.OnThird || state.Outs >= 2
	case OutcomeSacBunt:
		return !state.OnFirst && !state.OnSecond && !state.OnThird
	default:
		return false
	}
}

func normalize(weights map[string]float64) map[string]float64 {
	var sum float64
	for _, v := range weights {
		sum += v
	}

	out := make(map[string]float64, len(weights))
	if sum <= 0 {
		return out
	}
	for k, v := range weights {
		out[k] = v / sum
	}
	return out
}
