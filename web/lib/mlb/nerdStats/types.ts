export type NerdStatCategory =
  | "traditional"
  | "drama"
  | "misfortune"
  | "baserunning"
  | "contact"
  | "pace"
  | "defense"
  | "chaos"
  | "vibes";

export const NERD_STAT_CATEGORIES: Array<{ id: NerdStatCategory; label: string }> = [
  { id: "traditional", label: "Traditional" },
  { id: "drama", label: "Drama" },
  { id: "misfortune", label: "Misfortune" },
  { id: "baserunning", label: "Baserunning" },
  { id: "contact", label: "Contact" },
  { id: "pace", label: "Pace" },
  { id: "defense", label: "Defense" },
  { id: "chaos", label: "Chaos" },
  { id: "vibes", label: "Vibes" },
];

export interface NotableNerdEvent {
  statId: string;
  gamePk: number;
  gameDate: string;
  label: string;
  detail?: string;
  value?: number;
  /** When set, links open the game replay at this plate appearance. */
  atBatIndex?: number;
}

export interface PitchTypeAccumulator {
  count: number;
  velocitySum: number;
  spinSum: number;
  hBreakSum: number;
  vBreakSum: number;
}

export interface TeamNerdCounters {
  gamesPlayed: number;
  finalGamesWithFeed: number;
  wins: number;
  losses: number;
  oneRunGames: number;
  oneRunWins: number;
  oneRunLosses: number;
  extraInningGames: number;
  extraInningWins: number;
  extraInningLosses: number;
  blowoutLosses: number;
  blowoutWins: number;
  shutoutGames: number;
  tenPlusRunGames: number;
  twoOrFewerRunGames: number;
  comebackWins: number;
  runsScored: number;
  runsWithTwoOuts: number;
  firstInningRuns: number;
  lateInningRuns: number;
  runsAllowed: number;
  firstInningRunsAllowed: number;
  lateInningRunsAllowed: number;
  /** Runs allowed in the half-inning immediately after taking a lead. */
  leadTakeNextInningRunsAllowed: number;
  /** Times a team took a lead and then faced a subsequent defensive half. */
  leadTakeNextInningOpportunities: number;
  plateAppearances: number;
  strikeouts: number;
  walks: number;
  intentWalks: number;
  hbp: number;
  sacFlies: number;
  sacBunts: number;
  gidp: number;
  rallyKillerGidp: number;
  gidpInduced: number;
  triplePlays: number;
  triplePlaysTurned: number;
  triplePlayOpportunities: number;
  walkoffBloopSingles: number;
  walkoffWins: number;
  walkoffLosses: number;
  bloopSingles: number;
  infieldSingles: number;
  homeRuns: number;
  softestHomeRunMph: number | null;
  shortestHomeRunFt: number | null;
  flarestHomeRunLa: number | null;
  hardestHitMph: number | null;
  moonshotHomeRuns: number;
  noDoubterHomeRuns: number;
  battedBallEvents: number;
  barrelBalls: number;
  chopBalls: number;
  popupBalls: number;
  /** Statcast hard-hit balls (EV ≥ 95). */
  hardHitBalls: number;
  /** Statcast sweet-spot contact (LA 8–32°). */
  sweetSpotBalls: number;
  /** launch_speed_angle buckets (How was that hit?): 1 Weak … 6 Barrel. */
  weakContactBalls: number;
  toppedContactBalls: number;
  underContactBalls: number;
  flareContactBalls: number;
  solidContactBalls: number;
  /** Sum of launch_speed_angle codes for averaging. */
  launchSpeedAngleSum: number;
  launchSpeedAngleCount: number;
  /** Heart-of-zone pitches thrown / seen. */
  meatballsThrown: number;
  meatballsSeen: number;
  /** Meatball pitches put in play. */
  meatballsInPlay: number;
  meatballsInPlayAllowed: number;
  /** Hits on meatball pitches put in play. */
  meatballsPunished: number;
  meatballsPunishedAllowed: number;
  /** Barrels on meatball pitches. */
  meatballBarrels: number;
  meatballBarrelsAllowed: number;
  /** Swinging strikes on meatballs. */
  meatballWhiffs: number;
  meatballWhiffsInduced: number;
  exitVeloSum: number;
  exitVeloCount: number;
  launchAngleSum: number;
  launchAngleCount: number;
  batSpeedSum: number;
  batSpeedCount: number;
  pitchTypesThrown: Record<string, PitchTypeAccumulator>;
  stolenBases: number;
  caughtStealing: number;
  pickoffs: number;
  balkBenefits: number;
  wildPitchBenefits: number;
  passedBallBenefits: number;
  errorRunBenefits: number;
  errorsCommitted: number;
  fieldingErrors: number;
  throwingErrors: number;
  reachedOnError: number;
  errorRunsAllowed: number;
  errorGames: number;
  multiErrorGames: number;
  errorFreeGames: number;
  basesLoadedNoRuns: number;
  /** Half-innings: bases loaded with nobody out, then zero runs scored. */
  nobletigers: number;
  /** Defensive half-innings that induced a nobletiger on the opponent. */
  nobletigersInduced: number;
  cycleGames: number;
  backToBackHrGames: number;
  backToBackToBackHrGames: number;
  goldenSombreros: number;
  multiHrGamesAllowed: number;
  immaculateInningVictims: number;
  zeroWalkGames: number;
  wallScraperHomeRuns: number;
  leftOnBase: number;
  lobNightmareGames: number;
  pinchHitAttempts: number;
  pinchHitHits: number;
  pinchHitHomeRuns: number;
  pinchHitChaos: number;
  hardestHitAllowedMph: number | null;
  playerCycleGames: number;
  maxHbpInGame: number;
  noHitterBidRuined: number;
  grandSlams: number;
  insideTheParkHomeRuns: number;
  eightPlusRunGames: number;
  whiffFestGames: number;
  leadoffHomeRuns: number;
  doubles: number;
  triples: number;
  rispHits: number;
  rispAtBats: number;
  rispPlateAppearances: number;
  fullCountHits: number;
  fullCountAtBats: number;
  fullCountWalks: number;
  fullCountHbp: number;
  fullCountSacFlies: number;
  fullCountTotalBases: number;
  /** First pitches seen / thrown (PAs with at least one tracked pitch). */
  firstPitchesSeen: number;
  firstPitchesThrown: number;
  /** Traditional first-pitch strikes (called, swinging, foul, or in play). */
  firstPitchStrikes: number;
  firstPitchStrikesThrown: number;
  firstPitchBalls: number;
  firstPitchBallsThrown: number;
  firstPitchCalledStrikes: number;
  firstPitchCalledStrikesInduced: number;
  firstPitchSwingingStrikes: number;
  firstPitchSwingingStrikesInduced: number;
  firstPitchFouls: number;
  firstPitchFoulsInduced: number;
  /** Any swing on the first pitch (whiff, foul, or in play). */
  firstPitchSwings: number;
  firstPitchSwingsInduced: number;
  firstPitchInPlay: number;
  firstPitchInPlayAllowed: number;
  firstPitchHits: number;
  firstPitchHitsAllowed: number;
  firstPitchHomeRuns: number;
  firstPitchHomeRunsAllowed: number;
  firstPitchTotalBases: number;
  firstPitchTotalBasesAllowed: number;
  pitchingStrikeouts: number;
  backToBackHrSequences: number;
  pitchesSeen: number;
  pitchesThrown: number;
  battingHalfInnings: number;
  pitchingHalfInnings: number;
  foulBalls: number;
  foulsInduced: number;
  ballsInPlay: number;
  ballsInPlayAllowed: number;
  pitchBalls: number;
  pitchStrikes: number;
  pitchBallsThrown: number;
  pitchStrikesThrown: number;
  swingingStrikes: number;
  calledStrikes: number;
  swingingStrikesInduced: number;
  calledStrikesInduced: number;
  hits: number;
  hitsAllowed: number;
  quickHalfInningsSeen: number;
  quickHalfInningsThrown: number;
  longHalfInningsSeen: number;
  longHalfInningsThrown: number;
  shortestHalfInningPitchesSeen: number | null;
  longestHalfInningPitchesSeen: number | null;
  shortestHalfInningPitchesThrown: number | null;
  longestHalfInningPitchesThrown: number | null;
  notableEvents: NotableNerdEvent[];
}

export type SeasonNerdCounters = Record<string, TeamNerdCounters>;

/** Per-player nerd counters keyed by player ID string. */
export type SeasonPlayerNerdCounters = Record<string, PlayerNerdCounters>;

export interface PlayerNerdCounters extends TeamNerdCounters {
  playerId: number;
  name: string;
  /** Primary team (most counted increments). */
  teamId: number;
  teamAbbrev: string;
}

/** Team/game outcomes that are not attributable to a single player. */
export const TEAM_ONLY_NERD_STAT_IDS = new Set([
  "win-pct",
  "wins",
  "losses",
  "run-differential",
  "runs-scored",
  "runs-allowed",
  "one-run-games",
  "one-run-win-pct",
  "extra-inning-games",
  "extra-inning-win-pct",
  "blowout-losses",
  "blowout-wins",
  "shutout-games",
  "ten-plus-run-games",
  "two-or-fewer-run-games",
  "comeback-wins",
  "walkoff-wins",
  "walkoff-losses",
  "games-played",
]);

export interface PlayerNerdStatContribution {
  statId: string;
  title: string;
  subtitle: string;
  category: NerdStatCategory;
  unit: string;
  sort: "asc" | "desc";
  playerValue: number | null;
  teamValue: number | null;
  playerDisplay: string;
  teamDisplay: string;
  /** Player count / team count when both are positive count-like values. */
  shareOfTeam: number | null;
  playerActions: number | null;
  teamActions: number | null;
}

export interface PlayerNerdCard {
  season: number;
  playerId: number;
  name: string;
  teamId: number;
  teamAbbrev: string;
  generatedAt: string;
  contributions: PlayerNerdStatContribution[];
}

export interface PlayerNerdIndexEntry {
  playerId: number;
  name: string;
  teamId: number;
  teamAbbrev: string;
  plateAppearances: number;
  pitchesThrown: number;
}

export interface PlayerNerdIndex {
  season: number;
  generatedAt: string;
  players: PlayerNerdIndexEntry[];
}

export interface NerdStatLeader {
  teamId: number;
  abbrev: string;
  teamName: string;
  value: number;
  rank: number;
  displayValue: string;
}

export interface NerdStatLeaderboard {
  id: string;
  title: string;
  subtitle: string;
  category: NerdStatCategory;
  sort: "asc" | "desc";
  unit: string;
  formula?: string;
  leagueAverage: number | null;
  leagueAverageDisplay: string | null;
  leaders: NerdStatLeader[];
}

export interface NerdStatsSummary {
  season: number;
  generatedAt: string;
  indexedGameCount: number;
  stats: NerdStatLeaderboard[];
  statOfTheDayId: string;
  window?: string;
  windowLabel?: string;
  split?: string;
  splitLabel?: string;
  backfillPending?: boolean;
  source?: "file" | "empty";
}

export interface NerdStatDetail {
  season: number;
  stat: NerdStatLeaderboard;
  allTeams: NerdStatLeader[];
  notableEvents: NotableNerdEvent[];
  generatedAt: string;
}

export interface TeamNerdCard {
  season: number;
  teamId: number;
  abbrev: string;
  teamName: string;
  generatedAt: string;
  stats: Array<{
    statId: string;
    title: string;
    category: NerdStatCategory;
    rank: number;
    value: number;
    displayValue: string;
    sort: "asc" | "desc";
  }>;
}

export interface NerdStatsManifest {
  season: number;
  processedGamePks: number[];
  generatedAt: string;
}

export interface GameNerdSourceRow {
  game_pk: number;
  game_date: string;
  season: number;
  away_team_id: number;
  home_team_id: number;
  away_team_abbrev: string;
  home_team_abbrev: string;
  away_score: number | null;
  home_score: number | null;
  game_state: unknown;
  box_score: unknown;
  feed_synced_at: string | null;
}
