import { parseBoxScore } from "@/lib/mlb/boxScore";
import type { GameBoxScore } from "@/types/mlb-boxscore";
import type {
  AllPlayRaw,
  BaseOccupancy,
  GameSituation,
  HitData,
  LiveGameState,
  MLBLiveFeedResponse,
  PlayByPlayEntry,
  PlayDetail,
  PlayPitch,
  PitchReview,
} from "@/types/mlb-live";

export interface GameFeed {
  gameState: LiveGameState;
  boxScore: GameBoxScore | null;
}

/** Lightweight live payload for fast pitch polling (no allPlays / boxscore). */
export interface LiveFeedSnapshot {
  gamePk: number;
  gameStatus: string;
  awayTeam: string;
  homeTeam: string;
  awayAbbrev: string;
  homeAbbrev: string;
  venueId: number | null;
  venueName: string | null;
  linescore: MLBLiveFeedResponse["liveData"]["linescore"];
  currentPlay: MLBLiveFeedResponse["liveData"]["plays"]["currentPlay"];
  allPlaysCount: number;
}

export interface PlayByPlayParseState {
  entries: PlayByPlayEntry[];
  batterStats: Map<number, BatterLine>;
  situation: GameSituation;
  currentHalf: string;
  /** Next allPlays index to process (0-based). */
  rawPlayCount: number;
  loggedGameEventKeys: Set<string>;
  loggedAtBatIndices: Set<number>;
}

const MLB_FEED_BASE = "https://statsapi.mlb.com/api/v1.1";

const HIT_EVENTS = new Set(["Single", "Double", "Triple", "Home Run"]);

const NON_AB_EVENTS = new Set([
  "Walk",
  "Hit By Pitch",
  "Sacrifice Fly",
  "Sacrifice Bunt",
  "Sacrifice",
  "Catcher Interference",
  "Defensive Indifference",
]);

/** Events that represent terminal plate appearance outcomes (shown in play-by-play). */
const PLATE_APPEARANCE_EVENTS = new Set([
  "Single",
  "Double",
  "Triple",
  "Home Run",
  "Strikeout",
  "Walk",
  "Hit By Pitch",
  "Groundout",
  "Flyout",
  "Pop Out",
  "Lineout",
  "Forceout",
  "Fielders Choice",
  "Fielders Choice Out",
  "Field Error",
  "Sacrifice Fly",
  "Sacrifice Bunt",
  "Sacrifice",
  "Grounded Into DP",
  "Double Play",
  "Triple Play",
  "Strikeout Double Play",
  "Catcher Interference",
  "Batter Interference",
  "Fan Interference",
  "Sac Fly",
  "Sac Bunt",
  "Sac Fly Double Play",
  "Intent Walk",
  "Intentional Walk",
  "Fielders Choice",
  "Runner Double Play",
  "Strikeout - DP",
]);

const SKIP_ACTION_EVENT_TYPES = new Set([
  "game_advisory",
  "mound_visit",
  "batter_timeout",
  "pitching_substitution",
  "defensive_substitution",
  "offensive_substitution",
  "defensive_switch",
  "umpire_substitution",
]);

/** Action types omitted from the play-by-play log (pitches are handled separately). */
const PLAY_LOG_SKIP_ACTION_TYPES = new Set(["game_advisory"]);

function shouldLogPlayEvent(event: PitchEventRaw): boolean {
  if (event.isPitch) return false;
  const eventType = event.details?.eventType ?? "";
  if (PLAY_LOG_SKIP_ACTION_TYPES.has(eventType)) return false;

  const description = event.details?.description ?? event.details?.event ?? "";
  if (!description) return false;

  return (
    event.type === "action" ||
    event.type === "pickoff" ||
    event.type === "stepoff" ||
    event.type === "runner_event"
  );
}

function terminalCoveredByPlayEvents(play: AllPlayRaw): boolean {
  const resultEvent = (play.result?.event ?? "").toLowerCase();
  if (!resultEvent) return false;

  for (const playEvent of play.playEvents ?? []) {
    if (!shouldLogPlayEvent(playEvent)) continue;
    const playEventText = `${playEvent.details?.event ?? ""} ${playEvent.details?.description ?? ""} ${playEvent.type ?? ""}`.toLowerCase();
    if (resultEvent.includes("pickoff") && playEventText.includes("pickoff")) return true;
    if (/stolen base/.test(resultEvent) && /steal/.test(playEventText)) return true;
    if (/caught stealing/.test(resultEvent) && /caught stealing/.test(playEventText)) return true;
  }

  return false;
}

function buildGameEventFromPlayEvent(
  event: PitchEventRaw,
  play: AllPlayRaw,
  situationBefore: GameSituation,
): PlayByPlayEntry | null {
  if (!play.about?.inning) return null;

  const eventName = event.details?.event ?? event.type ?? "Game Event";
  const description = event.details?.description ?? eventName;
  const count = event.count ?? play.count;
  const awayScore =
    event.details?.awayScore ?? play.result?.awayScore ?? situationBefore.awayScore;
  const homeScore =
    event.details?.homeScore ?? play.result?.homeScore ?? situationBefore.homeScore;
  const outs = count?.outs ?? situationBefore.outs;
  const batterId = play.matchup?.batter?.id ?? 0;

  const detail: PlayDetail = {
    atBatIndex: play.about.atBatIndex ?? 0,
    batterId,
    batterName: play.matchup?.batter?.fullName ?? "—",
    batterHits: 0,
    batterAtBats: 0,
    pitcherName: play.matchup?.pitcher?.fullName ?? "—",
    pitcherId: play.matchup?.pitcher?.id ?? null,
    event: eventName,
    description,
    inning: play.about.inning,
    halfInning: play.about.halfInning ?? "top",
    awayScore,
    homeScore,
    isScoringPlay: Boolean(event.details?.isScoringPlay),
    pitches: [],
    hit: null,
  };

  return {
    atBatIndex: detail.atBatIndex,
    inning: detail.inning,
    halfInning: detail.halfInning,
    batterId: detail.batterId,
    batterName: detail.batterName,
    batterHits: 0,
    batterAtBats: 0,
    event: eventName,
    description,
    awayScore,
    homeScore,
    outs,
    bases: { ...situationBefore.bases },
    onFirst: situationBefore.onFirst,
    onSecond: situationBefore.onSecond,
    onThird: situationBefore.onThird,
    situationBefore,
    isScoringPlay: detail.isScoringPlay,
    isAtBat: false,
    detail,
  };
}

function extractGameEventsFromPlay(
  play: AllPlayRaw,
  playIndex: number,
  situationBefore: GameSituation,
  loggedKeys: Set<string>,
): PlayByPlayEntry[] {
  const entries: PlayByPlayEntry[] = [];
  const playEvents = play.playEvents ?? [];
  const atBatIndex = play.about?.atBatIndex ?? playIndex;

  for (let i = 0; i < playEvents.length; i += 1) {
    const playEvent = playEvents[i];
    if (!shouldLogPlayEvent(playEvent)) continue;

    const key = gameEventDedupeKey(atBatIndex, playEvents, i, playEvent);
    if (loggedKeys.has(key)) continue;

    const entry = buildGameEventFromPlayEvent(playEvent, play, situationBefore);
    if (!entry) continue;

    loggedKeys.add(key);
    entries.push(entry);
  }

  return entries;
}

/**
 * Stable dedupe key for non-at-bat play events.
 * Uses position in playEvents (not MLB's event.index) so keys stay consistent
 * as the feed fills in metadata across polls.
 */
function gameEventDedupeKey(
  atBatIndex: number,
  playEvents: PitchEventRaw[],
  eventPosition: number,
  event: PitchEventRaw,
): string {
  const type = event.details?.eventType ?? event.type ?? "";
  const desc = event.details?.description ?? event.details?.event ?? "";
  const time = event.endTime ?? event.startTime ?? "";
  return `${atBatIndex}:${eventPosition}:${type}:${desc}:${time}`;
}

/** True when an allPlays row has its terminal outcome and won't gain more playEvents. */
function isPlayFinalized(play: AllPlayRaw): boolean {
  const event = play.result?.event?.trim() ?? "";
  if (!event) return false;

  if (!isPlateAppearanceEvent(event)) return true;

  if (play.about?.isComplete === true) return true;

  // MLB often sets description before isComplete; accept so PBP doesn't lag a poll.
  return Boolean(play.result?.description?.trim());
}

type PitchEventRaw = NonNullable<AllPlayRaw["playEvents"]>[number];

interface PitcherRef {
  id?: number;
  fullName?: string;
}

function pitcherTeamId(feed: MLBLiveFeedResponse, pitcherId: number): number | null {
  const boxTeams = feed.liveData.boxscore?.teams;
  if (boxTeams) {
    for (const side of ["away", "home"] as const) {
      const team = boxTeams[side];
      if (team?.pitchers?.includes(pitcherId)) {
        return team.team?.id ?? null;
      }
    }
  }

  const player = feed.gameData.players?.[`ID${pitcherId}`];
  return player?.teamId ?? null;
}

function pitcherNameFromBoxScore(feed: MLBLiveFeedResponse, pitcherId: number): string | null {
  const boxTeams = feed.liveData.boxscore?.teams;
  if (!boxTeams) return null;

  for (const side of ["away", "home"] as const) {
    const team = boxTeams[side];
    const player = team?.players?.[`ID${pitcherId}`]?.person;
    if (player?.fullName) return player.fullName;
  }

  return null;
}

function defensivePitcherFromBoxScore(
  feed: MLBLiveFeedResponse,
  battingTeamId: number | null,
): PitcherRef | null {
  const boxTeams = feed.liveData.boxscore?.teams;
  if (!boxTeams || battingTeamId == null) return null;

  for (const side of ["away", "home"] as const) {
    const team = boxTeams[side];
    if (team?.team?.id === battingTeamId) continue;

    const pitcherIds = team?.pitchers ?? [];
    const activePitcherId = pitcherIds[pitcherIds.length - 1];
    if (!activePitcherId) continue;

    return {
      id: activePitcherId,
      fullName: pitcherNameFromBoxScore(feed, activePitcherId) ?? undefined,
    };
  }

  return null;
}

/** Pick the pitcher facing the batter — never the batting team's own pitcher. */
function resolveDefensePitcher(
  feed: MLBLiveFeedResponse,
  battingTeamId: number | null,
  currentPlayPitcher?: PitcherRef,
  offensePitcher?: PitcherRef,
): { id: number | null; name: string } {
  const candidates = [currentPlayPitcher, offensePitcher].filter(
    (pitcher): pitcher is PitcherRef => pitcher?.id != null,
  );

  for (const pitcher of candidates) {
    const teamId = pitcherTeamId(feed, pitcher.id!);
    const onDefense =
      battingTeamId == null || teamId == null || teamId !== battingTeamId;
    if (onDefense) {
      return {
        id: pitcher.id ?? null,
        name: pitcher.fullName ?? pitcherNameFromBoxScore(feed, pitcher.id!) ?? "—",
      };
    }
  }

  const fallback = defensivePitcherFromBoxScore(feed, battingTeamId);
  if (fallback?.id) {
    return {
      id: fallback.id,
      name: fallback.fullName ?? pitcherNameFromBoxScore(feed, fallback.id) ?? "—",
    };
  }

  return {
    id: currentPlayPitcher?.id ?? null,
    name: currentPlayPitcher?.fullName ?? "—",
  };
}

interface BatterLine {
  hits: number;
  atBats: number;
}

function parseHitData(
  raw: PitchEventRaw["hitData"],
  pitch?: PitchEventRaw["pitchData"],
  pitchType?: PitchEventRaw["details"],
): HitData | null {
  if (!raw?.coordinates) return null;
  const { coordX, coordY } = raw.coordinates;
  if (typeof coordX !== "number" || typeof coordY !== "number") return null;

  const breaks = pitch?.breaks;
  const coords = pitch?.coordinates;

  return {
    launchSpeed: raw.launchSpeed ?? 0,
    launchAngle: raw.launchAngle ?? 0,
    totalDistance: raw.totalDistance ?? 0,
    trajectory: raw.trajectory ?? "",
    hardness: raw.hardness ?? "",
    location: raw.location ?? "",
    coordX,
    coordY,
    pitchType: pitchType?.type?.description,
    pitchTypeCode: pitchType?.type?.code,
    pitchSpeed: pitch?.startSpeed,
    endSpeed: pitch?.endSpeed,
    extension: pitch?.extension,
    plateTime: pitch?.plateTime,
    zone: pitch?.zone,
    spinRate: breaks?.spinRate,
    spinDirection: breaks?.spinDirection,
    breakHorizontal: breaks?.breakHorizontal,
    breakVertical: breaks?.breakVertical,
    breakVerticalInduced: breaks?.breakVerticalInduced,
    pfxX: coords?.pfxX,
    pfxZ: coords?.pfxZ,
  };
}

function emptyBases(): BaseOccupancy {
  return {};
}

const BASE_CODES = new Set(["1B", "2B", "3B"]);

function clearRunnerFromBases(bases: BaseOccupancy, name: string): void {
  if (bases.first === name) delete bases.first;
  if (bases.second === name) delete bases.second;
  if (bases.third === name) delete bases.third;
}

/** Apply runner movements from one play onto the previous base state. */
function applyRunnerMovements(
  previousBases: BaseOccupancy,
  runners: AllPlayRaw["runners"],
): BaseOccupancy {
  const bases: BaseOccupancy = { ...previousBases };
  const placements: Array<{ base: "1B" | "2B" | "3B"; name: string }> = [];

  for (const runner of runners ?? []) {
    const name = runner.details?.runner?.fullName;
    if (!name) continue;

    const movement = runner.movement;
    const start = movement?.start ?? movement?.originBase ?? null;
    const end = movement?.end ?? null;
    const isOut = movement?.isOut ?? false;

    if (start === "1B" && bases.first === name) delete bases.first;
    if (start === "2B" && bases.second === name) delete bases.second;
    if (start === "3B" && bases.third === name) delete bases.third;

    if (!start && (isOut || !end || end === "score")) {
      clearRunnerFromBases(bases, name);
    }

    if (!isOut && end && BASE_CODES.has(end)) {
      placements.push({ base: end as "1B" | "2B" | "3B", name });
    }
  }

  for (const { base, name } of placements) {
    if (base === "1B") bases.first = name;
    if (base === "2B") bases.second = name;
    if (base === "3B") bases.third = name;
  }

  return bases;
}

function basesFlags(bases: BaseOccupancy): {
  bases: BaseOccupancy;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
} {
  return {
    bases,
    onFirst: Boolean(bases.first),
    onSecond: Boolean(bases.second),
    onThird: Boolean(bases.third),
  };
}

function parsePostSituation(play: AllPlayRaw, previousBases: BaseOccupancy): GameSituation {
  const bases = applyRunnerMovements(previousBases, play.runners);
  const flags = basesFlags(bases);

  return {
    awayScore: play.result?.awayScore ?? 0,
    homeScore: play.result?.homeScore ?? 0,
    outs: play.count?.outs ?? 0,
    bases: flags.bases,
    onFirst: flags.onFirst,
    onSecond: flags.onSecond,
    onThird: flags.onThird,
  };
}

function cloneSituation(situation: GameSituation): GameSituation {
  return {
    ...situation,
    bases: { ...situation.bases },
  };
}

function resetHalfInningSituation(situation: GameSituation): GameSituation {
  return {
    ...situation,
    outs: 0,
    bases: emptyBases(),
    onFirst: false,
    onSecond: false,
    onThird: false,
  };
}

function parseReview(event: PitchEventRaw): PitchReview | undefined {
  const review = event.reviewDetails;
  if (!review && !event.details?.hasReview) return undefined;

  return {
    isOverturned: review?.isOverturned ?? false,
    reviewType: review?.reviewType ?? "ABS",
    playerName: review?.player?.fullName,
  };
}

function reviewLabel(review: PitchReview): string {
  const verdict = review.isOverturned ? "overturned" : "confirmed";
  return `ABS ${verdict}`;
}

function attachChallengeFromDescription(
  pitches: PlayPitch[],
  description?: string,
): PlayPitch[] {
  if (!description || /challenged/i.test(description) === false) return pitches;
  if (pitches.some((p) => p.review)) return pitches;

  const isOverturned = /call on the field was overturned/i.test(description);
  const isConfirmed = /call on the field was confirmed/i.test(description);
  if (!isOverturned && !isConfirmed) return pitches;

  const review: PitchReview = {
    isOverturned,
    reviewType: "ABS",
  };

  let lastPitchIndex = -1;
  for (let i = pitches.length - 1; i >= 0; i -= 1) {
    if (pitches[i].isPitch) {
      lastPitchIndex = i;
      break;
    }
  }

  if (lastPitchIndex === -1) {
    return [
      ...pitches,
      {
        pitchNumber: -(pitches.length + 1),
        typeCode: "REV",
        typeDescription: "ABS Challenge",
        callDescription: reviewLabel(review),
        callCode: "R",
        balls: pitches.at(-1)?.balls ?? 0,
        strikes: pitches.at(-1)?.strikes ?? 0,
        startSpeed: 0,
        plateX: 0,
        plateZ: 0,
        isStrike: false,
        isBall: false,
        isInPlay: false,
        isOut: false,
        isPitch: false,
        strikeZoneTop: 3.5,
        strikeZoneBottom: 1.5,
        review,
      },
    ];
  }

  return pitches.map((pitch, index) =>
    index === lastPitchIndex ? { ...pitch, review } : pitch,
  );
}

function outcomeLabel(event: PitchEventRaw): string {
  return (
    event.details?.description ??
    event.details?.call?.description ??
    "—"
  );
}

function callCode(event: PitchEventRaw): string {
  return event.details?.call?.code ?? event.details?.description?.charAt(0) ?? "—";
}

function inferInPlayOut(
  isOut: boolean | undefined,
  description: string | undefined,
): boolean {
  if (isOut) return true;
  const desc = (description ?? "").toLowerCase();
  return desc.includes("in play, out");
}

function parsePitchEvent(event: PitchEventRaw, pitchNumber: number): PlayPitch | null {
  if (!event.isPitch) return null;

  const coords = event.pitchData?.coordinates;
  const hasPlateLocation =
    typeof coords?.pX === "number" && typeof coords?.pZ === "number";

  const description = outcomeLabel(event);

  return {
    pitchNumber,
    typeCode: event.details?.type?.code ?? "—",
    typeDescription: event.details?.type?.description ?? "Unknown",
    callDescription: description,
    callCode: callCode(event),
    balls: event.count?.balls ?? 0,
    strikes: event.count?.strikes ?? 0,
    startSpeed: event.pitchData?.startSpeed ?? 0,
    plateX: hasPlateLocation ? coords!.pX! : 0,
    plateZ: hasPlateLocation ? coords!.pZ! : 0,
    isStrike: Boolean(event.details?.isStrike),
    isBall: Boolean(event.details?.isBall),
    isInPlay: Boolean(event.details?.isInPlay),
    isOut: inferInPlayOut(event.details?.isOut, description),
    isPitch: true,
    hasPlateLocation,
    strikeZoneTop: event.pitchData?.strikeZoneTop ?? 3.5,
    strikeZoneBottom: event.pitchData?.strikeZoneBottom ?? 1.5,
    review: parseReview(event),
    endSpeed: event.pitchData?.endSpeed,
    extension: event.pitchData?.extension,
    plateTime: event.pitchData?.plateTime,
    zone: event.pitchData?.zone,
    spinRate: event.pitchData?.breaks?.spinRate,
    breakHorizontal: event.pitchData?.breaks?.breakHorizontal,
    breakVerticalInduced: event.pitchData?.breaks?.breakVerticalInduced,
  };
}

function parseActionEvent(event: PitchEventRaw, rowNumber: number): PlayPitch | null {
  if (event.isPitch) return null;

  const eventType = event.details?.eventType ?? "";
  if (SKIP_ACTION_EVENT_TYPES.has(eventType)) return null;

  const outcome = outcomeLabel(event);
  if (!outcome || outcome === "—") return null;

  return {
    pitchNumber: rowNumber,
    typeCode: event.details?.type?.code ?? "—",
    typeDescription: event.details?.type?.description ?? outcome,
    callDescription: outcome,
    callCode: callCode(event),
    balls: event.count?.balls ?? 0,
    strikes: event.count?.strikes ?? 0,
    startSpeed: 0,
    plateX: 0,
    plateZ: 0,
    isStrike: false,
    isBall: false,
    isInPlay: false,
    isOut: false,
    isPitch: false,
    strikeZoneTop: 3.5,
    strikeZoneBottom: 1.5,
  };
}

function parsePitchesFromEvents(
  playEvents: PitchEventRaw[] | undefined,
  playDescription?: string,
): PlayPitch[] {
  if (!playEvents?.length) return [];

  const rows: PlayPitch[] = [];
  let pitchNum = 0;
  let actionNum = 0;

  for (const event of playEvents) {
    if (event.isPitch) {
      pitchNum += 1;
      const parsed = parsePitchEvent(event, pitchNum);
      if (parsed) rows.push(parsed);
    } else {
      actionNum += 1;
      const parsed = parseActionEvent(event, -actionNum);
      if (parsed) rows.push(parsed);
    }
  }

  return attachChallengeFromDescription(rows, playDescription);
}

function parseHitFromEvents(playEvents: PitchEventRaw[] | undefined): HitData | null {
  if (!playEvents?.length) return null;

  for (const event of playEvents) {
    if (event.hitData) {
      const hit = parseHitData(event.hitData, event.pitchData, event.details);
      if (hit) return hit;
    }
  }
  return null;
}

function applyBatterLine(
  stats: Map<number, BatterLine>,
  batterId: number,
  event: string,
): BatterLine {
  const line = stats.get(batterId) ?? { hits: 0, atBats: 0 };

  if (!NON_AB_EVENTS.has(event)) {
    line.atBats += 1;
    if (HIT_EVENTS.has(event)) {
      line.hits += 1;
    }
  }

  stats.set(batterId, line);
  return line;
}

export function isPlateAppearanceEvent(event: string): boolean {
  return Boolean(event) && PLATE_APPEARANCE_EVENTS.has(event);
}

/** Ensure legacy cached plays have a correct isAtBat flag. */
export function normalizePlayByPlayEntry(play: PlayByPlayEntry): PlayByPlayEntry {
  if (play.isAtBat === false) return play;
  const isAtBat = isPlateAppearanceEvent(play.event);
  if (play.isAtBat === isAtBat) return play;
  return { ...play, isAtBat };
}

export function normalizePlayByPlay(plays: PlayByPlayEntry[]): PlayByPlayEntry[] {
  return plays.map(normalizePlayByPlayEntry);
}

/** True for plate appearances — false for steals, mound visits, subs, etc. */
export function isPlayByPlayAtBat(play: PlayByPlayEntry): boolean {
  return play.isAtBat !== false;
}

export function wrapMlbFeedForStorage(feed: MLBLiveFeedResponse): { mlbFeed: MLBLiveFeedResponse } {
  return { mlbFeed: feed };
}

function parsePlayDetail(
  play: AllPlayRaw,
  batterLine: BatterLine,
  batterId: number,
): PlayDetail | null {
  const desc = play.result?.description?.trim();
  const rawEvent = play.result?.event?.trim();
  if ((!desc && !rawEvent) || !play.about?.inning) return null;

  const event = rawEvent ?? desc ?? "";
  const description = desc ?? rawEvent ?? event;
  const pitches = parsePitchesFromEvents(play.playEvents, description);

  return {
    atBatIndex: play.about.atBatIndex ?? 0,
    batterId,
    batterName: play.matchup?.batter?.fullName ?? "Unknown",
    batterHits: batterLine.hits,
    batterAtBats: batterLine.atBats,
    pitcherName: play.matchup?.pitcher?.fullName ?? "Unknown",
    pitcherId: play.matchup?.pitcher?.id ?? null,
    event,
    description,
    inning: play.about.inning,
    halfInning: play.about.halfInning ?? "top",
    awayScore: play.result?.awayScore ?? 0,
    homeScore: play.result?.homeScore ?? 0,
    isScoringPlay: Boolean(play.about.isScoringPlay),
    pitches,
    hit: parseHitFromEvents(play.playEvents),
  };
}

function initialGameSituation(): GameSituation {
  return {
    awayScore: 0,
    homeScore: 0,
    outs: 0,
    bases: emptyBases(),
    onFirst: false,
    onSecond: false,
    onThird: false,
  };
}

export function createPlayByPlayParseState(): PlayByPlayParseState {
  return {
    entries: [],
    batterStats: new Map(),
    situation: initialGameSituation(),
    currentHalf: "",
    rawPlayCount: 0,
    loggedGameEventKeys: new Set(),
    loggedAtBatIndices: new Set(),
  };
}

function parsePlayEntry(
  play: AllPlayRaw,
  state: PlayByPlayParseState,
  playIndex: number,
  totalPlays: number,
): PlayByPlayParseState {
  if (playIndex < state.rawPlayCount) {
    return state;
  }

  const isOngoingPlay = playIndex === totalPlays - 1;
  if (isOngoingPlay && !isPlayFinalized(play)) {
    return state;
  }

  const halfKey = `${play.about?.inning ?? 0}-${play.about?.halfInning ?? ""}`;
  let situation = state.situation;
  let currentHalf = state.currentHalf;

  if (halfKey !== currentHalf) {
    currentHalf = halfKey;
    situation = resetHalfInningSituation(situation);
  }

  const event = play.result?.event ?? "";

  const situationBefore = cloneSituation(situation);
  const gameEventEntries = extractGameEventsFromPlay(
    play,
    playIndex,
    situationBefore,
    state.loggedGameEventKeys,
  );
  const postSituation = parsePostSituation(play, situation.bases);
  situation = postSituation;

  const isAtBat = isPlateAppearanceEvent(event);
  const atBatIndex = play.about?.atBatIndex ?? playIndex;

  if (!isAtBat && event && terminalCoveredByPlayEvents(play)) {
    return {
      entries: [...state.entries, ...gameEventEntries],
      batterStats: state.batterStats,
      situation,
      currentHalf,
      rawPlayCount: playIndex + 1,
      loggedGameEventKeys: state.loggedGameEventKeys,
      loggedAtBatIndices: state.loggedAtBatIndices,
    };
  }

  if (isAtBat && state.loggedAtBatIndices.has(atBatIndex)) {
    return {
      entries: [...state.entries, ...gameEventEntries],
      batterStats: state.batterStats,
      situation,
      currentHalf,
      rawPlayCount: playIndex + 1,
      loggedGameEventKeys: state.loggedGameEventKeys,
      loggedAtBatIndices: state.loggedAtBatIndices,
    };
  }

  const batterId = play.matchup?.batter?.id ?? 0;
  const batterLine =
    batterId > 0 && isAtBat ? applyBatterLine(state.batterStats, batterId, event) : { hits: 0, atBats: 0 };

  const detail = parsePlayDetail(play, batterLine, batterId);
  if (!detail) {
    return {
      entries: [...state.entries, ...gameEventEntries],
      batterStats: state.batterStats,
      situation,
      currentHalf,
      rawPlayCount: playIndex + 1,
      loggedGameEventKeys: state.loggedGameEventKeys,
      loggedAtBatIndices: state.loggedAtBatIndices,
    };
  }

  const entry: PlayByPlayEntry = {
    atBatIndex: detail.atBatIndex,
    inning: detail.inning,
    halfInning: detail.halfInning,
    batterId: detail.batterId,
    batterName: detail.batterName,
    batterHits: detail.batterHits,
    batterAtBats: detail.batterAtBats,
    event: detail.event,
    description: detail.description,
    awayScore: postSituation.awayScore,
    homeScore: postSituation.homeScore,
    outs: postSituation.outs,
    bases: postSituation.bases,
    onFirst: postSituation.onFirst,
    onSecond: postSituation.onSecond,
    onThird: postSituation.onThird,
    situationBefore,
    isScoringPlay: detail.isScoringPlay,
    isAtBat,
    detail,
  };

  const loggedAtBatIndices = new Set(state.loggedAtBatIndices);
  if (isAtBat) loggedAtBatIndices.add(atBatIndex);

  return {
    entries: [...state.entries, ...gameEventEntries, entry],
    batterStats: state.batterStats,
    situation,
    currentHalf,
    rawPlayCount: playIndex + 1,
    loggedGameEventKeys: state.loggedGameEventKeys,
    loggedAtBatIndices,
  };
}

export function appendPlayByPlay(
  state: PlayByPlayParseState,
  rawPlays: AllPlayRaw[],
  fromIndex: number,
  totalPlays: number,
): PlayByPlayParseState {
  let next = state;
  for (let i = 0; i < rawPlays.length; i++) {
    next = parsePlayEntry(rawPlays[i], next, fromIndex + i, totalPlays);
  }
  return next;
}

function parsePlayByPlay(allPlays: AllPlayRaw[] | undefined): PlayByPlayEntry[] {
  if (!allPlays?.length) return [];
  return normalizePlayByPlay(
    appendPlayByPlay(createPlayByPlayParseState(), allPlays, 0, allPlays.length).entries,
  );
}

export function parseLiveFeed(
  gamePk: number,
  feed: MLBLiveFeedResponse,
  plays?: PlayByPlayEntry[],
): LiveGameState {
  const play = feed.liveData.plays.currentPlay;
  const linescore = feed.liveData.linescore;
  const offense = linescore.offense ?? {};
  const teams = feed.gameData.teams;
  const lineTeams = linescore.teams;
  const awayRuns = lineTeams?.away?.runs ?? 0;
  const homeRuns = lineTeams?.home?.runs ?? 0;

  const inningState = linescore.inningState ?? "";
  const isBreak = /^(middle|end)$/i.test(inningState);
  const inning = play?.about?.inning ?? linescore.currentInning ?? 1;
  const inningHalf = isBreak
    ? inningState.toLowerCase()
    : (play?.about?.halfInning ?? inningState.replace(/\s+/g, "") ?? "");

  const batter = offense.batter;
  const onDeck = offense.onDeck;
  const inHole = offense.inHole;
  const battingTeamId = offense.team?.id ?? null;
  const defensePitcher = resolveDefensePitcher(
    feed,
    battingTeamId,
    play?.matchup?.pitcher,
    offense.pitcher,
  );

  return {
    gamePk,
    venueId: feed.gameData.venue?.id ?? null,
    venueName: feed.gameData.venue?.name ?? null,
    gameStatus: feed.gameData.status.abstractGameState,
    awayTeam: teams.away.name,
    awayAbbrev: teams.away.abbreviation ?? teams.away.name.slice(0, 3).toUpperCase(),
    homeTeam: teams.home.name,
    homeAbbrev: teams.home.abbreviation ?? teams.home.name.slice(0, 3).toUpperCase(),
    awayRuns,
    homeRuns,
    batterId: batter?.id ?? play?.matchup?.batter?.id ?? null,
    batterName: batter?.fullName ?? play?.matchup?.batter?.fullName ?? "—",
    onDeckId: onDeck?.id ?? null,
    onDeckName: onDeck?.fullName ?? "—",
    inHoleId: inHole?.id ?? null,
    inHoleName: inHole?.fullName ?? "—",
    offenseTeamId: battingTeamId,
    battingOrderSlot: offense.battingOrder ?? null,
    pitcherId: defensePitcher.id,
    pitcherName: defensePitcher.name,
    inning,
    inningHalf,
    inningState,
    balls: isBreak ? 0 : (play?.count?.balls ?? 0),
    strikes: isBreak ? 0 : (play?.count?.strikes ?? 0),
    outs: isBreak ? 0 : (play?.count?.outs ?? 0),
    onFirst: isBreak ? false : offense.first != null,
    onSecond: isBreak ? false : offense.second != null,
    onThird: isBreak ? false : offense.third != null,
    atBatPitches: isBreak
      ? []
      : parsePitchesFromEvents(play?.playEvents, play?.result?.description),
    plays: plays ?? parsePlayByPlay(feed.liveData.plays.allPlays),
    observedAt: new Date().toISOString(),
  };
}

/** Cheap fingerprint to skip React updates when the live snapshot is unchanged. */
export function liveStateFingerprint(state: LiveGameState): string {
  const lastPitch = state.atBatPitches.at(-1);
  const lastPlay = state.plays.at(-1);
  return [
    state.gameStatus,
    state.inning,
    state.inningState,
    state.balls,
    state.strikes,
    state.outs,
    state.awayRuns,
    state.homeRuns,
    state.batterId,
    state.pitcherId,
    state.onFirst,
    state.onSecond,
    state.onThird,
    state.atBatPitches.length,
    lastPitch?.pitchNumber,
    lastPitch?.callCode,
    lastPitch?.callDescription,
    lastPitch?.balls,
    lastPitch?.strikes,
    lastPitch?.startSpeed,
    state.plays.length,
    lastPlay?.atBatIndex,
    lastPlay?.event,
    lastPlay?.isAtBat,
  ].join("|");
}

/** Browser-side MLB live feed fetch (CORS-enabled, skips the Next.js proxy hop). */
export async function fetchMLBLiveFeed(
  gamePk: number,
  signal?: AbortSignal,
): Promise<MLBLiveFeedResponse> {
  const response = await fetch(`${MLB_FEED_BASE}/game/${gamePk}/feed/live`, {
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`MLB live feed failed: ${response.status}`);
  }

  return (await response.json()) as MLBLiveFeedResponse;
}

export interface LivePlayChunk {
  from: number;
  total: number;
  plays: AllPlayRaw[];
}

export interface LiveSnapshotWithPlays extends LiveFeedSnapshot {
  plays?: LivePlayChunk;
}

/**
 * Fetch a compact snapshot + optional incremental play chunk in a single request.
 * Pass `playsFrom` to include new plays since that index (one round-trip).
 */
export async function fetchLiveSnapshotWithPlays(
  gamePk: number,
  playsFrom: number | null,
  signal?: AbortSignal,
): Promise<LiveSnapshotWithPlays> {
  const url =
    playsFrom != null
      ? `/api/game/${gamePk}/live/snapshot?playsFrom=${playsFrom}`
      : `/api/game/${gamePk}/live/snapshot`;

  const response = await fetch(url, { cache: "no-store", signal });

  if (!response.ok) {
    throw new Error(`Live snapshot failed: ${response.status}`);
  }

  return (await response.json()) as LiveSnapshotWithPlays;
}

/** Small live snapshot for fast pitch polling (served from cached MLB feed). */
export async function fetchLiveSnapshot(
  gamePk: number,
  signal?: AbortSignal,
): Promise<LiveFeedSnapshot> {
  return fetchLiveSnapshotWithPlays(gamePk, null, signal);
}

/** Fetch only new raw plays since `from` (incremental play-by-play). */
export async function fetchLivePlayChunk(
  gamePk: number,
  from: number,
  signal?: AbortSignal,
): Promise<LivePlayChunk> {
  const response = await fetch(`/api/game/${gamePk}/live/plays?from=${from}`, {
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`Live plays chunk failed: ${response.status}`);
  }

  return (await response.json()) as LivePlayChunk;
}

/**
 * Direct-to-MLB snapshot builder for when we want to bypass the proxy.
 * Fetches the full feed from MLB CDN and extracts a snapshot client-side.
 */
export async function fetchDirectSnapshot(
  gamePk: number,
  playsFrom: number | null,
  signal?: AbortSignal,
): Promise<LiveSnapshotWithPlays> {
  const feed = await fetchMLBLiveFeed(gamePk, signal);
  const snapshot = buildLiveFeedSnapshot(gamePk, feed);

  if (playsFrom != null) {
    const allPlays = feed.liveData.plays.allPlays ?? [];
    return {
      ...snapshot,
      plays: { from: playsFrom, total: allPlays.length, plays: allPlays.slice(playsFrom) },
    };
  }

  return snapshot;
}

/** Build a compact snapshot from a full MLB feed. */
export function buildLiveFeedSnapshot(
  gamePk: number,
  feed: MLBLiveFeedResponse,
): LiveFeedSnapshot {
  const teams = feed.gameData.teams;
  return {
    gamePk,
    gameStatus: feed.gameData.status.abstractGameState,
    awayTeam: teams.away.name,
    homeTeam: teams.home.name,
    awayAbbrev: teams.away.abbreviation ?? teams.away.name.slice(0, 3).toUpperCase(),
    homeAbbrev: teams.home.abbreviation ?? teams.home.name.slice(0, 3).toUpperCase(),
    venueId: feed.gameData.venue?.id ?? null,
    venueName: feed.gameData.venue?.name ?? null,
    linescore: feed.liveData.linescore,
    currentPlay: feed.liveData.plays.currentPlay,
    allPlaysCount: feed.liveData.plays.allPlays?.length ?? 0,
  };
}

function feedFromSnapshot(snapshot: LiveFeedSnapshot): MLBLiveFeedResponse {
  return {
    gameData: {
      status: { abstractGameState: snapshot.gameStatus },
      venue:
        snapshot.venueId != null
          ? { id: snapshot.venueId, name: snapshot.venueName ?? undefined }
          : undefined,
      teams: {
        away: { name: snapshot.awayTeam, abbreviation: snapshot.awayAbbrev },
        home: { name: snapshot.homeTeam, abbreviation: snapshot.homeAbbrev },
      },
    },
    liveData: {
      linescore: snapshot.linescore,
      plays: {
        currentPlay: snapshot.currentPlay,
      },
    },
  };
}

export function parseStateFromSnapshot(
  snapshot: LiveFeedSnapshot,
  existingPlays: PlayByPlayEntry[],
): LiveGameState {
  return parseLiveFeed(snapshot.gamePk, feedFromSnapshot(snapshot), existingPlays);
}

/** Parse a full feed while reusing an existing play-by-play list. */
export function parseLiveFeedSnapshot(
  gamePk: number,
  feed: MLBLiveFeedResponse,
  existingPlays: PlayByPlayEntry[],
): LiveGameState {
  return parseLiveFeed(gamePk, feed, existingPlays);
}

/** Full live game state from the browser (includes play-by-play parse). */
export async function fetchClientLiveGameState(
  gamePk: number,
  signal?: AbortSignal,
): Promise<LiveGameState> {
  const feed = await fetchMLBLiveFeed(gamePk, signal);
  return parseLiveFeed(gamePk, feed);
}

export async function fetchGameFeed(gamePk: number): Promise<GameFeed> {
  const response = await fetch(`${MLB_FEED_BASE}/game/${gamePk}/feed/live`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`MLB live feed failed: ${response.status}`);
  }

  const feed = (await response.json()) as MLBLiveFeedResponse;
  return {
    gameState: parseLiveFeed(gamePk, feed),
    boxScore: parseBoxScore(gamePk, feed),
  };
}

export async function fetchLiveGameState(gamePk: number): Promise<LiveGameState> {
  const { gameState } = await fetchGameFeed(gamePk);
  return gameState;
}
