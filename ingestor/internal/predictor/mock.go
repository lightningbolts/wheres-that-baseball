package predictor

import (
	"context"
	"math"
	"math/rand"
	"time"

	"mlb-ingestor/internal/mlb"
)

// MockPredictor produces dynamic, count-aware probability distributions for UI
// development. It is intentionally stateless and cheap to call on every pitch.
type MockPredictor struct {
	rng *rand.Rand
}

// NewMockPredictor creates a mock predictor with a time-seeded RNG.
func NewMockPredictor() *MockPredictor {
	return &MockPredictor{
		rng: rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// Predict returns slightly randomized probabilities biased by count and base state.
func (m *MockPredictor) Predict(ctx context.Context, state mlb.GameState) (PredictionResult, error) {
	if err := ctx.Err(); err != nil {
		return PredictionResult{}, err
	}

	weights := baseWeights(state)
	m.jitter(weights)

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

	attempt := 0.04
	if state.Balls >= 2 {
		attempt += 0.03
	}
	if state.Outs >= 2 {
		attempt += 0.02
	}
	success := attempt * 0.72
	return StealResult{Attempt: attempt, Success: success}, nil
}

func baseWeights(state mlb.GameState) map[string]float64 {
	balls, strikes := state.Balls, state.Strikes
	w := map[string]float64{
		OutcomeStrikeout:  0.18,
		OutcomeWalk:       0.07,
		OutcomeHitByPitch: 0.01,
		OutcomeSingle:     0.20,
		OutcomeDouble:     0.06,
		OutcomeTriple:     0.01,
		OutcomeHomeRun:    0.08,
		OutcomeFieldOut:   0.28,
		OutcomeGIDP:       0.04,
		OutcomeSacFly:     0.03,
		OutcomeSacBunt:    0.02,
	}

	if state.OnFirst && state.Outs < 2 {
		w[OutcomeGIDP] += 0.06
		w[OutcomeFieldOut] -= 0.04
	}
	if state.OnThird && state.Outs < 2 {
		w[OutcomeSacFly] += 0.08
		w[OutcomeFieldOut] -= 0.06
	}
	if state.OnSecond || state.OnThird {
		w[OutcomeSingle] += 0.02
		w[OutcomeDouble] += 0.01
	}

	switch {
	case balls >= 3 && strikes == 0:
		w[OutcomeWalk] = 0.44
		w[OutcomeSingle] = 0.14
		w[OutcomeFieldOut] = 0.10
		w[OutcomeStrikeout] = 0.05
	case balls == 3 && strikes <= 1:
		w[OutcomeWalk] = 0.38
		w[OutcomeStrikeout] = 0.08
	case strikes >= 2 && balls == 0:
		w[OutcomeStrikeout] = 0.52
		w[OutcomeWalk] = 0.03
		w[OutcomeFieldOut] = 0.18
	case strikes == 2:
		w[OutcomeStrikeout] = 0.36
		w[OutcomeFieldOut] = 0.22
	case balls == 3 && strikes == 2:
		w[OutcomeWalk] = 0.20
		w[OutcomeStrikeout] = 0.20
		w[OutcomeSingle] = 0.16
		w[OutcomeHomeRun] = 0.10
	}

	return w
}

func (m *MockPredictor) jitter(weights map[string]float64) {
	for k, v := range weights {
		delta := (m.rng.Float64() - 0.5) * 0.06
		weights[k] = math.Max(0.001, v+delta)
	}
}

func normalize(weights map[string]float64) map[string]float64 {
	var sum float64
	for _, v := range weights {
		sum += v
	}

	out := make(map[string]float64, len(weights))
	for k, v := range weights {
		out[k] = v / sum
	}
	return out
}
