export interface MlbFeedWorkerRequest {
  requestId: number;
  gamePk: number;
  /** When set, include raw allPlays rows from this index onward. */
  playsFrom: number | null;
}

export interface MlbFeedWorkerPayload {
  requestId: number;
  gamePk: number;
  gameStatus: string;
  awayTeam: string;
  homeTeam: string;
  awayAbbrev: string;
  homeAbbrev: string;
  venueId: number | null;
  venueName: string | null;
  linescore: unknown;
  currentPlay: unknown;
  allPlaysCount: number;
  feedTimeStamp: string | null;
  newPlays?: unknown[];
  playsFrom?: number;
}

export interface MlbFeedWorkerSuccess {
  ok: true;
  payload: MlbFeedWorkerPayload;
}

export interface MlbFeedWorkerFailure {
  ok: false;
  requestId: number;
  error: string;
}

export type MlbFeedWorkerResponse = MlbFeedWorkerSuccess | MlbFeedWorkerFailure;
