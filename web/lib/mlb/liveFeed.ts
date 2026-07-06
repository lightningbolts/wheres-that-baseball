import { parseBoxScore } from "@/lib/mlb/boxScore";
import { wrapGameStateForStorage, type StoredGameState } from "@/lib/games/gameStorage";
import { buildCardPitchersFromBoxScore } from "@/lib/mlb/cardPitchers";
import {
  computeAbsChallengesRemaining,
  countAbsChallengesUsedFromPlays,
  resolveAbsChallengesRemaining,
  resolveAbsChallengesUsedFromFeed,
  type AbsChallengeCountOptions,
  type AbsChallengePlay,
} from "@/lib/mlb/absChallenges";
import { annotatePlayByPlayWithWpa } from "@/lib/mlb/wpa";
import type { GameBoxScore } from "@/types/mlb-boxscore";
import type { CardPitcher } from "@/types/mlb";
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
  awayPitcher: CardPitcher | null;
  homePitcher: CardPitcher | null;
  awayAbsChallengesUsed: number;
  homeAbsChallengesUsed: number;
  absChallenges?: MLBLiveFeedResponse["gameData"]["absChallenges"];
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
  absChallengeOptions?: AbsChallengeCountOptions;
  absUsed: { away: number; home: number };
}

type PitchEventRaw = NonNullable<AllPlayRaw["playEvents"]>[number];

const MLB_FEED_BASE = "https://statsapi.mlb.com/api/v1.1";

const HIT_EVENTS = new Set(["Single", "Double", "Triple", "Home Run"]);

const NON_AB_EVENTS = new Set([
  "Walk",
  "Intent Walk",
  "Intentional Walk",
  "Hit By Pitch",
  "Sacrifice Fly",
  "Sacrifice Bunt",
  "Sacrifice",
  "Catcher Interference",
  "Defensive Indifference",
]);

/** Terminal PA outcomes that count toward official at-bats (hits ÷ at-bats). */
export function isOfficialAtBat(event: string): boolean {
  return isPlateAppearanceEvent(event) && !NON_AB_EVENTS.has(event);
}

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

/** MLB links play.runners entries to playEvents via matching index / playIndex. */
function runnersForPlayEvent(
  event: PitchEventRaw,
  play: AllPlayRaw,
): AllPlayRaw["runners"] {
  if (event.runners?.length) return event.runners;

  const eventIndex = event.index;
  if (eventIndex == null) return undefined;

  const matched = (play.runners ?? []).filter(
    (runner) => Number(runner.details?.playIndex) === Number(eventIndex),
  );
  return matched.length > 0 ? matched : undefined;
}

function outsAfterRunnerMovements(
  previousOuts: number,
  runners: AllPlayRaw["runners"],
): number {
  let outs = previousOuts;

  for (const runner of runners ?? []) {
    const movement = runner.movement;
    if (!movement?.isOut) continue;

    const outNumber = movement.outNumber;
    if (typeof outNumber === "number") {
      outs = Math.max(outs, outNumber);
    } else {
      outs += 1;
    }
  }

  return Math.min(3, outs);
}

function parsePostSituationFromEvent(
  event: PitchEventRaw,
  play: AllPlayRaw,
  previous: GameSituation,
): GameSituation {
  const runners = runnersForPlayEvent(event, play);
  const bases = runners?.length
    ? applyRunnerMovements(previous.bases, runners)
    : previous.bases;
  const flags = basesFlags(bases);
  const outs = runners?.length
    ? outsAfterRunnerMovements(previous.outs, runners)
    : previous.outs;

  return {
    awayScore:
      event.details?.awayScore ?? play.result?.awayScore ?? previous.awayScore,
    homeScore:
      event.details?.homeScore ?? play.result?.homeScore ?? previous.homeScore,
    outs,
    bases: flags.bases,
    onFirst: flags.onFirst,
    onSecond: flags.onSecond,
    onThird: flags.onThird,
  };
}

function basesEqual(a: BaseOccupancy, b: BaseOccupancy): boolean {
  return a.first === b.first && a.second === b.second && a.third === b.third;
}

/** Game events that never change outs/bases/runners (still logged in PBP). */
const NON_SITUATION_EVENT_TYPES = new Set([
  "game_advisory",
  "mound_visit",
  "batter_timeout",
  "pitching_substitution",
  "defensive_substitution",
  "offensive_substitution",
  "defensive_switch",
  "umpire_substitution",
]);

function playEventAffectsSituation(
  event: PitchEventRaw,
  play: AllPlayRaw,
  previous: GameSituation,
  after: GameSituation,
): boolean {
  if (isNonSituationPlayEvent(event, play)) return false;

  if (after.outs !== previous.outs) return true;
  if (after.awayScore !== previous.awayScore || after.homeScore !== previous.homeScore) {
    return true;
  }
  if (!basesEqual(previous.bases, after.bases)) return true;

  return false;
}

function isNonSituationPlayEvent(event: PitchEventRaw, play: AllPlayRaw): boolean {
  const eventType = event.details?.eventType ?? "";
  if (NON_SITUATION_EVENT_TYPES.has(eventType)) return true;

  const text = `${event.details?.event ?? ""} ${event.details?.description ?? ""} ${event.type ?? ""}`.toLowerCase();

  if (
    /pickoff attempt|step\s*off|stepoff|mound visit|batter timeout|challenged|challenge|review|ejection/i.test(
      text,
    )
  ) {
    return true;
  }
  if (/substitution|new pitcher|pinch|defensive switch/i.test(text) && !runnersForPlayEvent(event, play)?.length) {
    return true;
  }

  return false;
}

/** UI fallback for cached plays missing `affectsSituation`. */
export function gameEventShowsSituation(entry: PlayByPlayEntry): boolean {
  if (entry.isAtBat !== false) return true;
  if (entry.affectsSituation != null) return entry.affectsSituation;
  return inferGameEventAffectsSituation(entry.event, entry.description);
}

function inferGameEventAffectsSituation(event: string, description: string): boolean {
  const text = `${event} ${description}`.toLowerCase();
  if (
    /mound visit|batter timeout|pickoff attempt|stepoff|substitution|challenge|review|ejection|timeout/i.test(
      text,
    )
  ) {
    return false;
  }
  return /stolen base|\bsteals?\b|caught stealing|wild pitch|passed ball|balk|error|picks?\s*off|advances|scores/i.test(
    text,
  );
}

function buildGameEventFromPlayEvent(
  event: PitchEventRaw,
  play: AllPlayRaw,
  situationBefore: GameSituation,
  situationAfter: GameSituation,
  affectsSituation: boolean,
  gameEventKey: string,
): PlayByPlayEntry | null {
  if (!play.about?.inning) return null;

  const eventName = event.details?.event ?? event.type ?? "Game Event";
  const description = event.details?.description ?? eventName;
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
    awayScore: situationAfter.awayScore,
    homeScore: situationAfter.homeScore,
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
    awayScore: situationAfter.awayScore,
    homeScore: situationAfter.homeScore,
    outs: situationAfter.outs,
    bases: { ...situationAfter.bases },
    onFirst: situationAfter.onFirst,
    onSecond: situationAfter.onSecond,
    onThird: situationAfter.onThird,
    situationBefore,
    isScoringPlay: detail.isScoringPlay,
    isAtBat: false,
    affectsSituation,
    gameEventKey,
    detail,
  };
}

/**
 * Stable dedupe key for non-at-bat play events.
 * Uses position in playEvents — type/description backfill across polls must not change the key.
 */
function gameEventDedupeKey(
  atBatIndex: number,
  _playEvents: PitchEventRaw[],
  eventPosition: number,
  _event: PitchEventRaw,
): string {
  return `${atBatIndex}:${eventPosition}`;
}

function isDuplicateGameEventEntry(
  entries: PlayByPlayEntry[],
  entry: PlayByPlayEntry,
): boolean {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const existing = entries[i];
    if (existing.isAtBat !== false) continue;
    if (
      existing.atBatIndex === entry.atBatIndex &&
      existing.description === entry.description &&
      existing.event === entry.event
    ) {
      return true;
    }
  }
  return false;
}

/** Collapse duplicate non-at-bat rows (e.g. batter timeout logged twice). */
export function dedupePlayByPlayEntries(entries: PlayByPlayEntry[]): PlayByPlayEntry[] {
  const seenAtBats = new Set<number>();
  const seenGameEvents = new Set<string>();
  const result: PlayByPlayEntry[] = [];

  for (const entry of entries) {
    if (entry.isAtBat !== false) {
      if (seenAtBats.has(entry.atBatIndex)) continue;
      seenAtBats.add(entry.atBatIndex);
      result.push(entry);
      continue;
    }

    const key = `${entry.atBatIndex}:${entry.description}`;
    if (seenGameEvents.has(key)) continue;
    seenGameEvents.add(key);
    result.push(entry);
  }

  return result;
}

interface GameEventExtraction {
  newEntries: PlayByPlayEntry[];
  entriesMutated: boolean;
  situationAfter: GameSituation;
}

function upsertGameEventEntry(
  entries: PlayByPlayEntry[],
  key: string,
  entry: PlayByPlayEntry,
): boolean {
  const index = entries.findIndex(
    (existing) => existing.isAtBat === false && existing.gameEventKey === key,
  );
  if (index === -1) return false;
  entries[index] = entry;
  return true;
}

function extractGameEventsFromPlay(
  play: AllPlayRaw,
  playIndex: number,
  situationBefore: GameSituation,
  loggedKeys: Set<string>,
  existingEntries: PlayByPlayEntry[] = [],
): GameEventExtraction {
  const newEntries: PlayByPlayEntry[] = [];
  let entriesMutated = false;
  const playEvents = play.playEvents ?? [];
  const atBatIndex = play.about?.atBatIndex ?? playIndex;
  let rolling = cloneSituation(situationBefore);

  for (let i = 0; i < playEvents.length; i += 1) {
    const playEvent = playEvents[i];
    if (!shouldLogPlayEvent(playEvent)) continue;

    const key = gameEventDedupeKey(atBatIndex, playEvents, i, playEvent);
    const eventSituationBefore = cloneSituation(rolling);
    const parsedAfter = parsePostSituationFromEvent(playEvent, play, rolling);
    const affectsSituation = playEventAffectsSituation(
      playEvent,
      play,
      eventSituationBefore,
      parsedAfter,
    );
    const entry = buildGameEventFromPlayEvent(
      playEvent,
      play,
      eventSituationBefore,
      parsedAfter,
      affectsSituation,
      key,
    );
    if (!entry) continue;

    if (loggedKeys.has(key)) {
      if (upsertGameEventEntry(existingEntries, key, entry)) {
        entriesMutated = true;
      }
      if (affectsSituation) {
        rolling = parsedAfter;
      }
      continue;
    }

    if (isDuplicateGameEventEntry(existingEntries, entry)) continue;
    if (isDuplicateGameEventEntry(newEntries, entry)) continue;

    loggedKeys.add(key);
    newEntries.push(entry);
    if (affectsSituation) {
      rolling = parsedAfter;
    }
  }

  return { newEntries, entriesMutated, situationAfter: rolling };
}

function extractOngoingGameEvents(
  play: AllPlayRaw,
  playIndex: number,
  state: PlayByPlayParseState,
): PlayByPlayParseState {
  const halfKey = `${play.about?.inning ?? 0}-${play.about?.halfInning ?? ""}`;
  let situation = state.situation;
  let currentHalf = state.currentHalf;
  if (halfKey !== currentHalf) {
    currentHalf = halfKey;
    situation = resetHalfInningSituation(situation);
  }

  const entries = [...state.entries];
  const { newEntries, entriesMutated, situationAfter } = extractGameEventsFromPlay(
    play,
    playIndex,
    situation,
    state.loggedGameEventKeys,
    entries,
  );

  if (newEntries.length === 0 && !entriesMutated) {
    if (currentHalf === state.currentHalf) return state;
    return { ...state, currentHalf, situation };
  }

  if (newEntries.length > 0) {
    entries.push(...newEntries);
  }

  return {
    ...state,
    entries: dedupePlayByPlayEntries(entries),
    situation: situationAfter,
    currentHalf,
  };
}

/** True when `currentPlay` is a fresher copy of the same plate appearance as `tailPlay`. */
function shouldMergeCurrentPlayIntoTail(
  tailPlay: AllPlayRaw,
  currentPlay: AllPlayRaw,
): boolean {
  const tailAb = tailPlay.about?.atBatIndex;
  const currentAb = currentPlay.about?.atBatIndex;
  if (tailAb != null && currentAb != null) {
    return tailAb === currentAb;
  }

  // Without indices, only merge when the tail row is still in progress.
  return (
    tailPlay.about?.isComplete !== true &&
    !tailPlay.result?.event?.trim()
  );
}

export function mergeCurrentPlayTail(
  allPlays: AllPlayRaw[],
  currentPlay: AllPlayRaw | null | undefined,
  from: number,
): AllPlayRaw[] {
  const tail = allPlays.slice(from);
  if (!currentPlay || allPlays.length === 0) return tail;

  const ongoingIndex = allPlays.length - 1;
  if (from > ongoingIndex) return tail;

  if (tail.length === 0) return [currentPlay];
  if (from + tail.length - 1 === ongoingIndex) {
    const tailPlay = tail[tail.length - 1];
    if (tailPlay && shouldMergeCurrentPlayIntoTail(tailPlay, currentPlay)) {
      return [...tail.slice(0, -1), currentPlay];
    }
    return tail;
  }

  return tail;
}

interface InferredPlayResult {
  event: string;
  description: string;
}

function normalizeInferredEvent(name: string): string {
  const trimmed = name.trim();
  if (/^intent(ional)?\s+walk$/i.test(trimmed)) return "Intent Walk";
  if (/^walk$/i.test(trimmed)) return "Walk";
  return trimmed;
}

/** Infer walk/strikeout/etc. from playEvents when MLB hasn't set play.result yet. */
function inferTerminalEventFromPlayEvents(play: AllPlayRaw): InferredPlayResult | null {
  const events = play.playEvents ?? [];

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const pe = events[i];
    const eventType = (pe.details?.eventType ?? "").toLowerCase();
    if (eventType.includes("walk")) {
      return {
        event: eventType.includes("intent") ? "Intent Walk" : "Walk",
        description: pe.details?.description ?? pe.details?.event ?? "Walk",
      };
    }

    for (const candidate of [pe.details?.event, pe.details?.description]) {
      if (!candidate) continue;
      if (/walk/i.test(candidate)) {
        return {
          event: /intent/i.test(candidate) ? "Intent Walk" : "Walk",
          description: pe.details?.description ?? candidate,
        };
      }
      const normalized = normalizeInferredEvent(candidate);
      if (isPlateAppearanceEvent(normalized)) {
        return {
          event: normalized,
          description: pe.details?.description ?? candidate,
        };
      }
    }
  }

  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (!events[i].isPitch) continue;
    const pe = events[i];
    const balls = pe.count?.balls;
    const desc = pe.details?.description ?? "";
    if (balls != null && balls >= 4) {
      return { event: "Walk", description: desc || "Walk" };
    }
    const pitchEvent = pe.details?.event?.trim() ?? "";
    if (pitchEvent && isPlateAppearanceEvent(pitchEvent)) {
      return { event: pitchEvent, description: desc || pitchEvent };
    }
  }

  return null;
}

function resolvePlayResult(play: AllPlayRaw): AllPlayRaw {
  if (play.result?.event?.trim()) return play;

  const inferred = inferTerminalEventFromPlayEvents(play);
  if (!inferred) return play;

  return {
    ...play,
    result: {
      ...play.result,
      event: inferred.event,
      description: play.result?.description?.trim() || inferred.description,
      awayScore: play.result?.awayScore,
      homeScore: play.result?.homeScore,
    },
  };
}

function isSupersededByNext(play: AllPlayRaw, nextPlay?: AllPlayRaw): boolean {
  const playAb = play.about?.atBatIndex;
  const nextAb = nextPlay?.about?.atBatIndex;
  if (playAb == null || nextAb == null) return false;
  return nextAb > playAb;
}

/** Index to start incremental PBP sync — rewinds to re-process the open allPlays tail. */
export function playByPlaySyncFromIndex(
  state: PlayByPlayParseState,
  allPlaysCount: number,
): number {
  if (allPlaysCount === 0) return 0;
  if (state.rawPlayCount >= allPlaysCount) {
    return allPlaysCount - 1;
  }
  return state.rawPlayCount;
}

/**
 * Incremental play-by-play sync on every live poll.
 * `currentPlay` is fresher than `allPlays.at(-1)` — merge it so outcomes finalize
 * as soon as MLB publishes them, not one poll later.
 */
export function syncPlayByPlayFromFeed(
  state: PlayByPlayParseState,
  allPlays: AllPlayRaw[],
  currentPlay: AllPlayRaw | null | undefined,
): PlayByPlayParseState {
  const total = allPlays.length;
  if (total === 0) return state;

  const from = playByPlaySyncFromIndex(state, total);
  const tail = mergeCurrentPlayTail(allPlays, currentPlay, from);
  if (tail.length === 0) return state;

  const syncState =
    from < state.rawPlayCount ? { ...state, rawPlayCount: from } : state;
  const next = appendPlayByPlay(syncState, tail, from, total);
  return {
    ...next,
    entries: dedupePlayByPlayEntries(next.entries),
  };
}

/** Full rebuild from allPlays + currentPlay (used after background tab catch-up). */
export function rebuildPlayByPlayFromFeed(
  allPlays: AllPlayRaw[],
  currentPlay: AllPlayRaw | null | undefined,
): PlayByPlayParseState {
  if (allPlays.length === 0) return createPlayByPlayParseState();

  const merged = mergeCurrentPlayTail(allPlays, currentPlay, 0);
  const rebuilt = appendPlayByPlay(
    createPlayByPlayParseState(),
    merged,
    0,
    allPlays.length,
  );

  return {
    ...rebuilt,
    entries: dedupePlayByPlayEntries(rebuilt.entries),
  };
}

function countExpectedLoggedAtBats(
  allPlays: AllPlayRaw[],
  currentPlay: AllPlayRaw | null | undefined,
): number {
  const merged = mergeCurrentPlayTail(allPlays, currentPlay, 0);
  let count = 0;

  for (let i = 0; i < merged.length; i += 1) {
    const raw = merged[i]!;
    const isOngoing = i === merged.length - 1;
    if (isOngoing && !isPlayFinalized(raw)) continue;

    const play = resolvePlayResult(raw);
    const event = play.result?.event?.trim() ?? "";
    if (!event) continue;
    if (isPlateAppearanceEvent(event)) count += 1;
  }

  return count;
}

/** True when incremental parse state is missing finalized plate appearances. */
export function playByPlayNeedsResync(
  state: PlayByPlayParseState,
  allPlays: AllPlayRaw[],
  currentPlay: AllPlayRaw | null | undefined,
): boolean {
  if (allPlays.length === 0) return false;
  if (state.rawPlayCount < allPlays.length) return true;

  const expected = countExpectedLoggedAtBats(allPlays, currentPlay);
  const logged = state.entries.filter((entry) => entry.isAtBat !== false).length;
  return logged < expected;
}

/** True when an allPlays row has its terminal outcome and won't gain more playEvents. */
function isPlayFinalized(play: AllPlayRaw): boolean {
  const explicitEvent = play.result?.event?.trim() ?? "";
  if (play.about?.isComplete !== true && !explicitEvent) return false;

  const resolved = resolvePlayResult(play);
  const event = resolved.result?.event?.trim() ?? "";
  if (!event) return false;

  if (!isPlateAppearanceEvent(event)) return true;

  return true;
}

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
    batSpeed: raw.batSpeed,
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

function runnerScored(end: string | null): boolean {
  return end === "score" || end === "Home";
}

/** Apply runner movements from one play onto the previous base state. */
function applyRunnerMovements(
  previousBases: BaseOccupancy,
  runners: AllPlayRaw["runners"],
): BaseOccupancy {
  const bases: BaseOccupancy = { ...previousBases };

  for (const runner of runners ?? []) {
    const name = runner.details?.runner?.fullName;
    if (!name) continue;

    const movement = runner.movement;
    const start = movement?.start ?? movement?.originBase ?? null;
    const end = movement?.end ?? null;
    const isOut = movement?.isOut ?? false;
    const scored = runnerScored(end);

    // Vacate the origin base only when this runner is the one occupying it.
    // Avoids clearing another runner when MLB lists movements out of order.
    if (start === "1B" && bases.first === name) delete bases.first;
    if (start === "2B" && bases.second === name) delete bases.second;
    if (start === "3B" && bases.third === name) delete bases.third;

    if (isOut || scored || !end) {
      clearRunnerFromBases(bases, name);
      continue;
    }

    if (BASE_CODES.has(end)) {
      // Same play can list Home→1B then 1B→2B for the batter; apply each leg immediately.
      clearRunnerFromBases(bases, name);
      if (end === "1B") bases.first = name;
      if (end === "2B") bases.second = name;
      if (end === "3B") bases.third = name;
    }
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

function parsePostSituation(
  play: AllPlayRaw,
  previous: Pick<GameSituation, "bases" | "outs" | "awayScore" | "homeScore">,
): GameSituation {
  const bases = applyRunnerMovements(previous.bases, play.runners);
  const flags = basesFlags(bases);
  const outs = play.runners?.length
    ? outsAfterRunnerMovements(previous.outs, play.runners)
    : (play.count?.outs ?? previous.outs);

  return {
    awayScore: play.result?.awayScore ?? previous.awayScore,
    homeScore: play.result?.homeScore ?? previous.homeScore,
    outs,
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

/** Prefer play-level runner resolution; game events only fill in outs/score when ahead. */
function mergeSituations(primary: GameSituation, fromGameEvents: GameSituation): GameSituation {
  const basesChanged =
    !basesEqual(primary.bases, fromGameEvents.bases) ||
    primary.onFirst !== fromGameEvents.onFirst ||
    primary.onSecond !== fromGameEvents.onSecond ||
    primary.onThird !== fromGameEvents.onThird;

  if (!basesChanged) return primary;

  return {
    ...primary,
    outs: Math.max(primary.outs, fromGameEvents.outs),
    awayScore: Math.max(primary.awayScore, fromGameEvents.awayScore),
    homeScore: Math.max(primary.homeScore, fromGameEvents.homeScore),
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
    challengeTeamId: review?.challengeTeamId,
  };
}

function reviewLabel(review: PitchReview): string {
  const verdict = review.isOverturned ? "overturned" : "confirmed";
  return `ABS ${verdict}`;
}

function attachChallengeFromDescription(
  pitches: PlayPitch[],
  description?: string,
  playReviewDetails?: AllPlayRaw["reviewDetails"],
): PlayPitch[] {
  if (!description || /challenged/i.test(description) === false) return pitches;
  if (pitches.some((p) => p.review)) return pitches;

  const isOverturned = /call on the field was overturned/i.test(description);
  const isConfirmed = /call on the field was confirmed/i.test(description);
  if (!isOverturned && !isConfirmed) return pitches;

  const review: PitchReview = {
    isOverturned,
    reviewType: playReviewDetails?.reviewType ?? "ABS",
    playerName: playReviewDetails?.player?.fullName,
    challengeTeamId: playReviewDetails?.challengeTeamId,
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
  playReviewDetails?: AllPlayRaw["reviewDetails"],
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

  return attachChallengeFromDescription(rows, playDescription, playReviewDetails);
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
  if (play.isAtBat === false) {
    if (play.affectsSituation != null) return play;
    return {
      ...play,
      affectsSituation: inferGameEventAffectsSituation(play.event, play.description),
    };
  }
  const isAtBat = isPlateAppearanceEvent(play.event);
  if (play.isAtBat === isAtBat) return play;
  return { ...play, isAtBat };
}

export function normalizePlayByPlay(plays: PlayByPlayEntry[]): PlayByPlayEntry[] {
  return annotatePlayByPlayWithWpa(plays.map(normalizePlayByPlayEntry));
}

/** True for plate appearances — false for steals, mound visits, subs, etc. */
export function isPlayByPlayAtBat(play: PlayByPlayEntry): boolean {
  return play.isAtBat !== false;
}

export function wrapMlbFeedForStorage(
  feed: MLBLiveFeedResponse,
  gamePk?: number,
  status?: string,
): StoredGameState {
  if (gamePk != null && status) {
    return wrapGameStateForStorage(gamePk, feed, status);
  }
  return { mlbFeed: stripMlbFeedForStorage(feed) };
}

/** Drop bulky feed sections already stored elsewhere (box score) or unused for replay. */
export function stripMlbFeedForStorage(feed: MLBLiveFeedResponse): MLBLiveFeedResponse {
  return {
    gameData: {
      status: feed.gameData.status,
      venue: feed.gameData.venue,
      teams: {
        away: {
          id: feed.gameData.teams.away.id,
          name: feed.gameData.teams.away.name,
          abbreviation: feed.gameData.teams.away.abbreviation,
        },
        home: {
          id: feed.gameData.teams.home.id,
          name: feed.gameData.teams.home.name,
          abbreviation: feed.gameData.teams.home.abbreviation,
        },
      },
      review: feed.gameData.review,
      absChallenges: feed.gameData.absChallenges,
    },
    liveData: {
      linescore: feed.liveData.linescore,
      plays: feed.liveData.plays,
    },
  };
}

function parsePlayReview(
  review: AllPlayRaw["reviewDetails"],
): PitchReview | undefined {
  if (!review) return undefined;

  return {
    isOverturned: review.isOverturned ?? false,
    reviewType: review.reviewType ?? "ABS",
    playerName: review.player?.fullName,
    challengeTeamId: review.challengeTeamId,
  };
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
  const pitches = parsePitchesFromEvents(play.playEvents, description, play.reviewDetails);

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
    playReview: parsePlayReview(play.reviewDetails),
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

export function createPlayByPlayParseState(
  absChallengeOptions?: AbsChallengeCountOptions,
): PlayByPlayParseState {
  return {
    entries: [],
    batterStats: new Map(),
    situation: initialGameSituation(),
    currentHalf: "",
    rawPlayCount: 0,
    loggedGameEventKeys: new Set(),
    loggedAtBatIndices: new Set(),
    absChallengeOptions,
    absUsed: { away: 0, home: 0 },
  };
}

function absRemainingSnapshot(
  absUsed: { away: number; home: number },
  inning: number,
): { away: number; home: number } {
  return {
    away: computeAbsChallengesRemaining(absUsed.away, inning),
    home: computeAbsChallengesRemaining(absUsed.home, inning),
  };
}

function advanceAbsUsedForRawPlay(
  state: PlayByPlayParseState,
  play: AllPlayRaw,
): { away: number; home: number } {
  if (!state.absChallengeOptions) return state.absUsed;
  const playUsed = countAbsChallengesUsedFromPlays(
    [play as AbsChallengePlay],
    state.absChallengeOptions,
  );
  return {
    away: state.absUsed.away + playUsed.away,
    home: state.absUsed.home + playUsed.home,
  };
}

function withCompletedRawPlayAbs(
  state: PlayByPlayParseState,
  play: AllPlayRaw,
): PlayByPlayParseState {
  return {
    ...state,
    absUsed: advanceAbsUsedForRawPlay(state, play),
  };
}

function parsePlayEntry(
  play: AllPlayRaw,
  state: PlayByPlayParseState,
  playIndex: number,
  totalPlays: number,
  nextPlay?: AllPlayRaw,
): PlayByPlayParseState {
  if (playIndex < state.rawPlayCount) {
    return state;
  }

  const resolvedPlay = resolvePlayResult(play);
  const isOngoingPlay = playIndex === totalPlays - 1;
  const superseded = isSupersededByNext(play, nextPlay);

  if (isOngoingPlay && !isPlayFinalized(play)) {
    return extractOngoingGameEvents(resolvedPlay, playIndex, state);
  }

  const halfKey = `${resolvedPlay.about?.inning ?? 0}-${resolvedPlay.about?.halfInning ?? ""}`;
  let situation = state.situation;
  let currentHalf = state.currentHalf;

  if (halfKey !== currentHalf) {
    currentHalf = halfKey;
    situation = resetHalfInningSituation(situation);
  }

  const event = resolvedPlay.result?.event ?? "";

  const situationAtPlayStart = cloneSituation(situation);
  const workingEntries = [...state.entries];
  const { newEntries: gameEventEntries, entriesMutated, situationAfter: situationAfterGameEvents } =
    extractGameEventsFromPlay(
      resolvedPlay,
      playIndex,
      situationAtPlayStart,
      state.loggedGameEventKeys,
      workingEntries,
    );
  if (gameEventEntries.length > 0) {
    workingEntries.push(...gameEventEntries);
  }
  const postSituation = parsePostSituation(resolvedPlay, situationAtPlayStart);
  situation =
    gameEventEntries.length > 0 || entriesMutated
      ? mergeSituations(postSituation, situationAfterGameEvents)
      : postSituation;
  const mergedEntries =
    gameEventEntries.length > 0 || entriesMutated ? workingEntries : state.entries;

  const isAtBat = isPlateAppearanceEvent(event);
  const atBatIndex = resolvedPlay.about?.atBatIndex ?? playIndex;

  if (!isAtBat && event && (terminalCoveredByPlayEvents(resolvedPlay) || gameEventEntries.length > 0)) {
    const stateAfterAbs = withCompletedRawPlayAbs(state, resolvedPlay);
    return {
      entries: dedupePlayByPlayEntries(mergedEntries),
      batterStats: stateAfterAbs.batterStats,
      situation,
      currentHalf,
      rawPlayCount: playIndex + 1,
      loggedGameEventKeys: stateAfterAbs.loggedGameEventKeys,
      loggedAtBatIndices: stateAfterAbs.loggedAtBatIndices,
      absChallengeOptions: stateAfterAbs.absChallengeOptions,
      absUsed: stateAfterAbs.absUsed,
    };
  }

  if (isAtBat && state.loggedAtBatIndices.has(atBatIndex)) {
    const stateAfterAbs = withCompletedRawPlayAbs(state, resolvedPlay);
    return {
      entries: dedupePlayByPlayEntries(mergedEntries),
      batterStats: stateAfterAbs.batterStats,
      situation,
      currentHalf,
      rawPlayCount: playIndex + 1,
      loggedGameEventKeys: stateAfterAbs.loggedGameEventKeys,
      loggedAtBatIndices: stateAfterAbs.loggedAtBatIndices,
      absChallengeOptions: stateAfterAbs.absChallengeOptions,
      absUsed: stateAfterAbs.absUsed,
    };
  }

  const batterId = resolvedPlay.matchup?.batter?.id ?? 0;
  const batterLine =
    batterId > 0 && isAtBat ? applyBatterLine(state.batterStats, batterId, event) : { hits: 0, atBats: 0 };

  const detail = parsePlayDetail(resolvedPlay, batterLine, batterId);
  if (!detail) {
    if (gameEventEntries.length > 0 || entriesMutated) {
      const stateAfterAbs = superseded ? withCompletedRawPlayAbs(state, resolvedPlay) : state;
      return {
        entries: dedupePlayByPlayEntries(mergedEntries),
        batterStats: stateAfterAbs.batterStats,
        situation,
        currentHalf,
        rawPlayCount: superseded ? playIndex + 1 : state.rawPlayCount,
        loggedGameEventKeys: stateAfterAbs.loggedGameEventKeys,
        loggedAtBatIndices: stateAfterAbs.loggedAtBatIndices,
        absChallengeOptions: stateAfterAbs.absChallengeOptions,
        absUsed: stateAfterAbs.absUsed,
      };
    }
    if (!superseded) {
      return state;
    }
    const stateAfterAbs = withCompletedRawPlayAbs(state, resolvedPlay);
    return {
      entries: mergedEntries,
      batterStats: stateAfterAbs.batterStats,
      situation,
      currentHalf,
      rawPlayCount: state.rawPlayCount,
      loggedGameEventKeys: stateAfterAbs.loggedGameEventKeys,
      loggedAtBatIndices: stateAfterAbs.loggedAtBatIndices,
      absChallengeOptions: stateAfterAbs.absChallengeOptions,
      absUsed: stateAfterAbs.absUsed,
    };
  }

  const stateAfterAbs = withCompletedRawPlayAbs(state, resolvedPlay);
  const absRemaining = absRemainingSnapshot(stateAfterAbs.absUsed, detail.inning);

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
    awayScore: situation.awayScore,
    homeScore: situation.homeScore,
    outs: situation.outs,
    bases: situation.bases,
    onFirst: situation.onFirst,
    onSecond: situation.onSecond,
    onThird: situation.onThird,
    situationBefore: situationAtPlayStart,
    isScoringPlay: detail.isScoringPlay,
    isAtBat,
    awayAbsChallengesRemaining: absRemaining.away,
    homeAbsChallengesRemaining: absRemaining.home,
    detail,
  };

  const loggedAtBatIndices = new Set(stateAfterAbs.loggedAtBatIndices);
  if (isAtBat) loggedAtBatIndices.add(atBatIndex);

  return {
    entries: dedupePlayByPlayEntries([...mergedEntries, entry]),
    batterStats: state.batterStats,
    situation,
    currentHalf,
    rawPlayCount: playIndex + 1,
    loggedGameEventKeys: stateAfterAbs.loggedGameEventKeys,
    loggedAtBatIndices,
    absChallengeOptions: stateAfterAbs.absChallengeOptions,
    absUsed: stateAfterAbs.absUsed,
  };
}

export function appendPlayByPlay(
  state: PlayByPlayParseState,
  rawPlays: AllPlayRaw[],
  fromIndex: number,
  totalPlays: number,
): PlayByPlayParseState {
  let next = state;
  for (let i = 0; i < rawPlays.length; i += 1) {
    next = parsePlayEntry(
      rawPlays[i],
      next,
      fromIndex + i,
      totalPlays,
      rawPlays[i + 1],
    );
  }
  return next;
}

function parsePlayByPlay(
  allPlays: AllPlayRaw[] | undefined,
  absChallengeOptions?: AbsChallengeCountOptions,
): PlayByPlayEntry[] {
  if (!allPlays?.length) return [];
  return normalizePlayByPlay(
    appendPlayByPlay(
      createPlayByPlayParseState(absChallengeOptions),
      allPlays,
      0,
      allPlays.length,
    ).entries,
  );
}

/** Prefer merged allPlays tail when it has fresher pitch events for the current AB. */
function parseAtBatPitchesFromFeed(
  feed: MLBLiveFeedResponse,
  isBreak: boolean,
): PlayPitch[] {
  if (isBreak) return [];

  const allPlays = feed.liveData.plays.allPlays ?? [];
  const currentPlay = feed.liveData.plays.currentPlay as AllPlayRaw | undefined;
  const fromCurrent = parsePitchesFromEvents(
    currentPlay?.playEvents,
    currentPlay?.result?.description,
  );

  if (allPlays.length === 0) return fromCurrent;

  const merged = mergeCurrentPlayTail(allPlays, currentPlay, allPlays.length - 1);
  const freshest = merged[merged.length - 1];
  if (!freshest) return fromCurrent;

  const currentAtBatIndex = currentPlay?.about?.atBatIndex;
  if (
    currentAtBatIndex != null &&
    freshest.about?.atBatIndex === currentAtBatIndex
  ) {
    const fromMerged = parsePitchesFromEvents(
      freshest.playEvents,
      freshest.result?.description,
    );
    if (fromMerged.length >= fromCurrent.length) return fromMerged;
  }

  return fromCurrent;
}

function observedAtFromFeed(feed: MLBLiveFeedResponse): string {
  const events = feed.liveData.plays.currentPlay?.playEvents;
  if (events?.length) {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = events[i];
      if (ev?.endTime) return ev.endTime;
      if (ev?.startTime) return ev.startTime;
    }
  }
  return new Date().toISOString();
}

function parseAbsChallengesRemaining(
  feed: MLBLiveFeedResponse,
  inning: number,
): { away: number; home: number } {
  return resolveAbsChallengesRemaining(
    feed.gameData,
    feed.liveData.plays.allPlays,
    inning,
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
  const currentPlay = play as AllPlayRaw | undefined;
  const currentPlayLooksActive =
    currentPlay?.about?.isComplete !== true &&
    !currentPlay?.result?.event &&
    Boolean(play?.matchup?.batter?.id || play?.matchup?.batter?.fullName);
  const isBreak = /^(middle|end)$/i.test(inningState) && !currentPlayLooksActive;
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
  const absChallenges = parseAbsChallengesRemaining(feed, inning);

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
    awayAbsChallengesRemaining: absChallenges.away,
    homeAbsChallengesRemaining: absChallenges.home,
    atBatPitches: parseAtBatPitchesFromFeed(feed, isBreak),
    plays:
      plays ??
      parsePlayByPlay(feed.liveData.plays.allPlays, {
        awayTeamId: teams.away.id,
        homeTeamId: teams.home.id,
        awayTeamName: teams.away.name,
        homeTeamName: teams.home.name,
        awayAbbrev: teams.away.abbreviation,
        homeAbbrev: teams.home.abbreviation,
      }),
    observedAt: observedAtFromFeed(feed),
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
    state.awayAbsChallengesRemaining,
    state.homeAbsChallengesRemaining,
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
    lastPlay?.description,
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
  boxScore?: GameBoxScore | null;
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
    const currentPlay = feed.liveData.plays.currentPlay as AllPlayRaw | undefined;
    const merged = mergeCurrentPlayTail(allPlays, currentPlay, playsFrom);
    return {
      ...snapshot,
      plays: { from: playsFrom, total: allPlays.length, plays: merged },
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
  const boxScore = parseBoxScore(gamePk, feed);
  const pitchers = boxScore
    ? buildCardPitchersFromBoxScore(boxScore)
    : { away: null, home: null };
  const absUsed = resolveAbsChallengesUsedFromFeed(
    feed.gameData,
    feed.liveData.plays.allPlays,
  );

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
    awayPitcher: pitchers.away,
    homePitcher: pitchers.home,
    awayAbsChallengesUsed: absUsed.away,
    homeAbsChallengesUsed: absUsed.home,
    absChallenges: feed.gameData.absChallenges,
  };
}

export function reconstructFeedFromParts(
  snapshot: LiveFeedSnapshot,
  allPlays: AllPlayRaw[],
): MLBLiveFeedResponse {
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
      review: {
        away: { used: snapshot.awayAbsChallengesUsed },
        home: { used: snapshot.homeAbsChallengesUsed },
      },
      absChallenges: snapshot.absChallenges,
    },
    liveData: {
      linescore: snapshot.linescore,
      plays: {
        allPlays,
        currentPlay: snapshot.currentPlay,
      },
    },
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
      review: {
        away: { used: snapshot.awayAbsChallengesUsed },
        home: { used: snapshot.homeAbsChallengesUsed },
      },
      absChallenges: snapshot.absChallenges,
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
