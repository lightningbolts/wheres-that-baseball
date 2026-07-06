import type { LiveGameState } from "@/types/mlb-live";

/** Body shape accepted by ml-engine POST /predict (matches ingestor JSON). */
export interface MlPredictRequest {
  inning: number;
  balls: number;
  strikes: number;
  outs: number;
  on_first: boolean;
  on_second: boolean;
  on_third: boolean;
  inning_half: string;
  pitch_count: number;
  batter_hand: string;
  pitcher_hand: string;
  batter_id: number;
  pitcher_id: number;
  season: number;
  away_score: number;
  home_score: number;
  last_pitch_speed: number;
  last_pitch_type: string;
}

export function buildPredictRequest(state: LiveGameState): MlPredictRequest {
  const lastPitch = state.atBatPitches[state.atBatPitches.length - 1];
  const season =
    (state.observedAt ? new Date(state.observedAt).getFullYear() : 0) || new Date().getFullYear();

  return {
    inning: state.inning,
    balls: state.balls,
    strikes: state.strikes,
    outs: state.outs,
    on_first: state.onFirst,
    on_second: state.onSecond,
    on_third: state.onThird,
    inning_half: state.inningHalf,
    pitch_count: state.atBatPitches.length,
    batter_hand: "",
    pitcher_hand: "",
    batter_id: state.batterId ?? 0,
    pitcher_id: state.pitcherId ?? 0,
    season,
    away_score: state.awayRuns,
    home_score: state.homeRuns,
    last_pitch_speed: lastPitch?.startSpeed ?? 0,
    last_pitch_type: lastPitch?.typeCode ?? "",
  };
}

/** Stable key — refetch ML only when pitch/situation changes. */
export function oddsStateKey(state: LiveGameState): string {
  const pitchCount = state.atBatPitches.length;
  const last = state.atBatPitches[pitchCount - 1];
  return [
    state.batterId ?? 0,
    state.balls,
    state.strikes,
    pitchCount,
    last?.typeCode ?? "",
    last?.startSpeed ?? 0,
    state.onFirst ? 1 : 0,
    state.onSecond ? 1 : 0,
    state.onThird ? 1 : 0,
    state.outs,
    state.inning,
    state.inningHalf,
  ].join("-");
}
