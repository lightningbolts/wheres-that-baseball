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

function parseBasesFromRunners(
  runners: AllPlayRaw["runners"],
): { bases: BaseOccupancy; onFirst: boolean; onSecond: boolean; onThird: boolean } {
  const bases: BaseOccupancy = {};

  for (const runner of runners ?? []) {
    const end = runner.movement?.end;
    const name = runner.details?.runner?.fullName;
    if (!name || !end) continue;
    if (end === "1B") bases.first = name;
    if (end === "2B") bases.second = name;
    if (end === "3B") bases.third = name;
  }

  return {
    bases,
    onFirst: Boolean(bases.first),
    onSecond: Boolean(bases.second),
    onThird: Boolean(bases.third),
  };
}

function parsePostSituation(play: AllPlayRaw): GameSituation {
  const { bases, onFirst, onSecond, onThird } = parseBasesFromRunners(play.runners);

  return {
    awayScore: play.result?.awayScore ?? 0,
    homeScore: play.result?.homeScore ?? 0,
    outs: play.count?.outs ?? 0,
    bases,
    onFirst,
    onSecond,
    onThird,
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

function parsePlayDetail(
  play: AllPlayRaw,
  batterLine: BatterLine,
  batterId: number,
): PlayDetail | null {
  const desc = play.result?.description;
  const event = play.result?.event;
  if (!desc || !event || !play.about?.inning) return null;

  const pitches = parsePitchesFromEvents(play.playEvents, desc);

  return {
    atBatIndex: play.about.atBatIndex ?? 0,
    batterId,
    batterName: play.matchup?.batter?.fullName ?? "Unknown",
    batterHits: batterLine.hits,
    batterAtBats: batterLine.atBats,
    pitcherName: play.matchup?.pitcher?.fullName ?? "Unknown",
    pitcherId: play.matchup?.pitcher?.id ?? null,
    event,
    description: desc,
    inning: play.about.inning,
    halfInning: play.about.halfInning ?? "top",
    awayScore: play.result?.awayScore ?? 0,
    homeScore: play.result?.homeScore ?? 0,
    isScoringPlay: Boolean(play.about.isScoringPlay),
    pitches,
    hit: parseHitFromEvents(play.playEvents),
  };
}

function parsePlayByPlay(allPlays: AllPlayRaw[] | undefined): PlayByPlayEntry[] {
  if (!allPlays?.length) return [];

  const entries: PlayByPlayEntry[] = [];
  const batterStats = new Map<number, BatterLine>();
  let situation: GameSituation = {
    awayScore: 0,
    homeScore: 0,
    outs: 0,
    bases: emptyBases(),
    onFirst: false,
    onSecond: false,
    onThird: false,
  };
  let currentHalf = "";

  for (const play of allPlays) {
    const halfKey = `${play.about?.inning ?? 0}-${play.about?.halfInning ?? ""}`;
    if (halfKey !== currentHalf) {
      currentHalf = halfKey;
      situation = resetHalfInningSituation(situation);
    }

    const situationBefore = cloneSituation(situation);
    const postSituation = parsePostSituation(play);
    situation = postSituation;

    const event = play.result?.event ?? "";
    const batterId = play.matchup?.batter?.id ?? 0;
    const batterLine =
      batterId > 0 ? applyBatterLine(batterStats, batterId, event) : { hits: 0, atBats: 0 };

    const detail = parsePlayDetail(play, batterLine, batterId);
    if (!detail) continue;

    entries.push({
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
      detail,
    });
  }

  return entries;
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
    lastPitch?.balls,
    lastPitch?.strikes,
    state.plays.length,
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

/** Parse a live snapshot while reusing an existing play-by-play list (fast path). */
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
