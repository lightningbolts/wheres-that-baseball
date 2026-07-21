export interface PitchReview {
  isOverturned: boolean;
  reviewType: string;
  playerName?: string;
  challengeTeamId?: number;
}

/** Statcast release / flight kinematics in feet (MLB pitchData.coordinates). */
export interface PitchKinematics {
  /** Release position (ft). */
  x0: number;
  y0: number;
  z0: number;
  /** Initial velocity (ft/s). */
  vX0: number;
  vY0: number;
  vZ0: number;
  /** Acceleration (ft/s²). */
  aX: number;
  aY: number;
  aZ: number;
  pfxX?: number;
  pfxZ?: number;
}

export interface PlayPitch {
  pitchNumber: number;
  typeCode: string;
  typeDescription: string;
  callDescription: string;
  callCode: string;
  balls: number;
  strikes: number;
  startSpeed: number;
  plateX: number;
  plateZ: number;
  isStrike: boolean;
  isBall: boolean;
  isInPlay: boolean;
  isOut: boolean;
  isPitch: boolean;
  hasPlateLocation?: boolean;
  strikeZoneTop: number;
  strikeZoneBottom: number;
  review?: PitchReview;
  endSpeed?: number;
  extension?: number;
  plateTime?: number;
  zone?: number;
  spinRate?: number;
  breakHorizontal?: number;
  breakVerticalInduced?: number;
  pfxX?: number;
  pfxZ?: number;
  /** Full release kinematics when MLB ships them (most tracked parks). */
  kinematics?: PitchKinematics | null;
  /** Present when the pitch was put in play (for live field animation). */
  hit?: HitData | null;
  /** MLB pitch GUID — used for Baseball Savant sporty-video clips. */
  playId?: string;
}

export interface HitData {
  launchSpeed: number;
  launchAngle: number;
  totalDistance: number;
  trajectory: string;
  hardness: string;
  location: string;
  coordX: number;
  coordY: number;
  /** Pitch thrown on the contact event */
  pitchType?: string;
  pitchTypeCode?: string;
  pitchSpeed?: number;
  endSpeed?: number;
  extension?: number;
  plateTime?: number;
  zone?: number;
  spinRate?: number;
  spinDirection?: number;
  breakHorizontal?: number;
  breakVertical?: number;
  breakVerticalInduced?: number;
  pfxX?: number;
  pfxZ?: number;
  batSpeed?: number;
}

export interface BaseOccupancy {
  first?: string;
  second?: string;
  third?: string;
}

export interface GameSituation {
  awayScore: number;
  homeScore: number;
  outs: number;
  bases: BaseOccupancy;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
}

export interface PlayDetail {
  atBatIndex: number;
  batterId: number;
  batterName: string;
  batterHits: number;
  batterAtBats: number;
  pitcherName: string;
  pitcherId: number | null;
  event: string;
  description: string;
  inning: number;
  halfInning: string;
  awayScore: number;
  homeScore: number;
  isScoringPlay: boolean;
  pitches: PlayPitch[];
  hit: HitData | null;
  /** Terminal pitch GUID for Savant clip lookup (last playEvent with playId). */
  playId?: string;
  /** Terminal ABS review on the plate appearance (may differ from per-pitch reviews). */
  playReview?: PitchReview;
  /** Home-team win probability before the plate appearance (0–1). */
  homeWinProbBefore?: number;
  /** Home-team win probability after the plate appearance (0–1). */
  homeWinProbAfter?: number;
  /** Win probability added for the batting team (0–1 scale). */
  wpa?: number;
}

export interface PlayByPlayEntry {
  atBatIndex: number;
  inning: number;
  halfInning: string;
  batterId: number;
  batterName: string;
  batterHits: number;
  batterAtBats: number;
  event: string;
  description: string;
  awayScore: number;
  homeScore: number;
  outs: number;
  bases: BaseOccupancy;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  situationBefore: GameSituation;
  isScoringPlay: boolean;
  /** False for non-plate-appearance events (stolen bases, mound visits, etc.) */
  isAtBat: boolean;
  /** False for game events that don't change bases/outs (mound visits, timeouts, etc.). */
  affectsSituation?: boolean;
  /** Stable key for refreshing non-at-bat rows when MLB backfills runner data. */
  gameEventKey?: string;
  /** ABS challenges remaining after this play (for season history replay). */
  awayAbsChallengesRemaining?: number;
  homeAbsChallengesRemaining?: number;
  /** Home-team win probability before the plate appearance (0–1). */
  homeWinProbBefore?: number;
  /** Home-team win probability after the plate appearance (0–1). */
  homeWinProbAfter?: number;
  /** Win probability added for the batting team (0–1 scale). */
  wpa?: number;
  /** Terminal pitch GUID for Savant clip lookup (mirrors detail.playId). */
  playId?: string;
  detail: PlayDetail;
}

export interface BatterHittingLine {
  plateAppearances: number;
  atBats: number;
  hits: number;
  homeRuns: number;
  strikeOuts: number;
  walks: number;
  avg: string;
  ops: string;
}

export interface BatterVsPitcherRecord extends BatterHittingLine {
  batterId: number;
  pitcherId: number;
}

export interface BatterRispStats extends BatterHittingLine {
  batterId: number;
  season: string;
}

/** One cell from MLB hotColdZones (OPS by pitch location). */
export interface BatterHotZoneCell {
  zoneId: string;
  color: string;
  value: string;
  temp?: string;
}

/** Runner occupying a base on the live diamond. */
export interface BaseRunner {
  id: number;
  name: string;
}

export interface LiveGameState {
  gamePk: number;
  venueId: number | null;
  venueName: string | null;
  dayNight?: "day" | "night";
  gameStatus: string;
  awayTeam: string;
  awayAbbrev: string;
  homeTeam: string;
  homeAbbrev: string;
  awayRuns: number;
  homeRuns: number;
  batterId: number | null;
  batterName: string;
  onDeckId: number | null;
  onDeckName: string;
  inHoleId: number | null;
  inHoleName: string;
  offenseTeamId: number | null;
  battingOrderSlot: number | null;
  pitcherId: number | null;
  pitcherName: string;
  inning: number;
  inningHalf: string;
  inningState: string;
  balls: number;
  strikes: number;
  outs: number;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  /** Present on live parses; may be absent on older stored game_state rows. */
  runnerFirst?: BaseRunner | null;
  runnerSecond?: BaseRunner | null;
  runnerThird?: BaseRunner | null;
  awayAbsChallengesRemaining: number;
  homeAbsChallengesRemaining: number;
  atBatPitches: PlayPitch[];
  plays: PlayByPlayEntry[];
  observedAt: string;
}

interface PitchEventRaw {
  isPitch?: boolean;
  type?: string;
  index?: number;
  pitchNumber?: number;
  /** MLB pitch/play GUID used by Baseball Savant video clips. */
  playId?: string;
  startTime?: string;
  endTime?: string;
  reviewDetails?: {
    isOverturned?: boolean;
    inProgress?: boolean;
    reviewType?: string;
    challengeTeamId?: number;
    player?: { id?: number; fullName?: string };
  };
  details?: {
    description?: string;
    event?: string;
    eventType?: string;
    awayScore?: number;
    homeScore?: number;
    isScoringPlay?: boolean;
    isStrike?: boolean;
    isBall?: boolean;
    isInPlay?: boolean;
    isOut?: boolean;
    hasReview?: boolean;
    call?: { code?: string; description?: string };
    type?: { code?: string; description?: string };
  };
  count?: { balls?: number; strikes?: number; outs?: number };
  runners?: Array<{
    movement?: {
      originBase?: string | null;
      start?: string | null;
      end?: string | null;
      outBase?: string | null;
      isOut?: boolean;
      outNumber?: number | null;
    };
    details?: { runner?: { fullName?: string }; playIndex?: number };
  }>;
  pitchData?: {
    startSpeed?: number;
    endSpeed?: number;
    extension?: number;
    plateTime?: number;
    zone?: number;
    strikeZoneTop?: number;
    strikeZoneBottom?: number;
    coordinates?: {
      pX?: number;
      pZ?: number;
      pfxX?: number;
      pfxZ?: number;
      x0?: number;
      y0?: number;
      z0?: number;
      vX0?: number;
      vY0?: number;
      vZ0?: number;
      aX?: number;
      aY?: number;
      aZ?: number;
      x?: number;
      y?: number;
    };
    breaks?: {
      breakHorizontal?: number;
      breakVertical?: number;
      breakVerticalInduced?: number;
      spinRate?: number;
      spinDirection?: number;
    };
  };
  hitData?: {
    launchSpeed?: number;
    launchAngle?: number;
    totalDistance?: number;
    trajectory?: string;
    hardness?: string;
    location?: string;
    coordinates?: { coordX?: number; coordY?: number };
    batSpeed?: number;
  };
}

export interface AllPlayRaw {
  result?: {
    event?: string;
    description?: string;
    eventType?: string;
    awayScore?: number;
    homeScore?: number;
  };
  about?: {
    atBatIndex?: number;
    inning?: number;
    halfInning?: string;
    isScoringPlay?: boolean;
    isComplete?: boolean;
  };
  matchup?: {
    batter?: { id?: number; fullName?: string };
    pitcher?: { id?: number; fullName?: string };
  };
  playEvents?: PitchEventRaw[];
  reviewDetails?: {
    inProgress?: boolean;
    isOverturned?: boolean;
    reviewType?: string;
    challengeTeamId?: number;
    player?: { id?: number; fullName?: string };
  };
  count?: { balls?: number; strikes?: number; outs?: number };
  runners?: Array<{
    movement?: {
      originBase?: string | null;
      start?: string | null;
      end?: string | null;
      outBase?: string | null;
      isOut?: boolean;
      outNumber?: number | null;
    };
    details?: { runner?: { fullName?: string }; playIndex?: number };
  }>;
}

export interface MLBLiveFeedResponse {
  gameData: {
    status: { abstractGameState: string };
    datetime?: { dayNight?: string; originalDate?: string };
    venue?: { id?: number; name?: string };
    review?: {
      hasChallenges?: boolean;
      away?: { used?: number; remaining?: number };
      home?: { used?: number; remaining?: number };
    };
    absChallenges?: {
      hasChallenges?: boolean;
      away?: { usedSuccessful?: number; usedFailed?: number; remaining?: number };
      home?: { usedSuccessful?: number; usedFailed?: number; remaining?: number };
    };
    teams: {
      away: { id?: number; name: string; abbreviation?: string };
      home: { id?: number; name: string; abbreviation?: string };
    };
    players?: Record<
      string,
      { id?: number; teamId?: number; fullName?: string; boxscoreName?: string }
    >;
  };
  liveData: {
    linescore: {
      currentInning?: number;
      inningState?: string;
      teams?: {
        away: { runs?: number };
        home: { runs?: number };
      };
      offense?: {
        batter?: { id?: number; fullName?: string };
        onDeck?: { id?: number; fullName?: string };
        inHole?: { id?: number; fullName?: string };
        pitcher?: { id?: number; fullName?: string };
        battingOrder?: number;
        team?: { id?: number; name?: string };
        first?: { id: number; fullName?: string } | null;
        second?: { id: number; fullName?: string } | null;
        third?: { id: number; fullName?: string } | null;
      };
    };
    boxscore?: {
      teams?: {
        away?: { team?: { id?: number }; pitchers?: number[]; players?: Record<string, { person?: { id?: number; fullName?: string } }> };
        home?: { team?: { id?: number }; pitchers?: number[]; players?: Record<string, { person?: { id?: number; fullName?: string } }> };
      };
    };
    plays: {
      allPlays?: AllPlayRaw[];
      currentPlay: {
        matchup: {
          batter: { id?: number; fullName: string };
          pitcher: { id?: number; fullName: string };
        };
        count: { balls: number; strikes: number; outs: number };
        about: { inning?: number; halfInning?: string };
        result?: { description?: string };
        playEvents?: PitchEventRaw[];
      };
    };
  };
}
