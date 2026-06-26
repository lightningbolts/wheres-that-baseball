import { recordFetchMetric } from "@/lib/mlb/fetchMetrics";
import {
  adaptivePollIntervalMs,
  MAX_IN_FLIGHT,
} from "@/lib/mlb/pollIntervals";
import {
  createPlayByPlayParseState,
  fetchLiveSnapshotWithPlays,
  liveStateFingerprint,
  mergeCurrentPlayTail,
  parseLiveFeedSnapshot,
  playByPlayNeedsResync,
  rebuildPlayByPlayFromFeed,
  reconstructFeedFromParts,
  syncPlayByPlayFromFeed,
  type LiveFeedSnapshot,
  type PlayByPlayParseState,
} from "@/lib/mlb/liveFeed";
import type { GameBoxScore } from "@/types/mlb-boxscore";
import type { AllPlayRaw, LiveGameState } from "@/types/mlb-live";

export interface LiveFeedCoordinatorState {
  gameState: LiveGameState | null;
  boxScore: GameBoxScore | null;
  isLoading: boolean;
  error: string | null;
  consecutiveErrors: number;
}

type Subscriber = (state: LiveFeedCoordinatorState) => void;

interface CoordinatorInstance {
  gamePk: number;
  subscribers: Set<Subscriber>;
  refCount: number;
  parseState: PlayByPlayParseState;
  localAllPlays: AllPlayRaw[];
  lastSnapshot: LiveFeedSnapshot | null;
  state: LiveFeedCoordinatorState;
  pollTimer: ReturnType<typeof setTimeout> | null;
  inFlight: number;
  cancelled: boolean;
  tabWasHidden: boolean;
  generation: number;
}

const instances = new Map<number, CoordinatorInstance>();

function defaultState(): LiveFeedCoordinatorState {
  return {
    gameState: null,
    boxScore: null,
    isLoading: true,
    error: null,
    consecutiveErrors: 0,
  };
}

function notify(instance: CoordinatorInstance): void {
  for (const sub of instance.subscribers) {
    sub(instance.state);
  }
}

function mergeAllPlays(
  local: AllPlayRaw[],
  from: number,
  chunk: AllPlayRaw[],
  total: number,
): AllPlayRaw[] {
  if (from === 0 && chunk.length >= total) {
    return chunk;
  }
  if (from > local.length) {
    return [...local, ...chunk];
  }
  if (from === local.length) {
    if (chunk.length === 0) return local;
    return [...local, ...chunk];
  }
  const head = local.slice(0, from);
  return [...head, ...chunk];
}

function applyGameState(
  prev: LiveGameState | null,
  next: LiveGameState,
  force: boolean,
): LiveGameState {
  if (!force && prev && next.plays.length < prev.plays.length) {
    return prev;
  }
  if (!force && prev && liveStateFingerprint(prev) === liveStateFingerprint(next)) {
    return prev;
  }
  return next;
}

function resyncPlayByPlayState(
  state: PlayByPlayParseState,
  allPlays: AllPlayRaw[],
  currentPlay: AllPlayRaw | undefined,
  forceRebuild: boolean,
): PlayByPlayParseState {
  if (allPlays.length === 0) return state;
  if (forceRebuild || playByPlayNeedsResync(state, allPlays, currentPlay)) {
    return rebuildPlayByPlayFromFeed(allPlays, currentPlay);
  }
  return syncPlayByPlayFromFeed(state, allPlays, currentPlay);
}

async function pollOnce(instance: CoordinatorInstance): Promise<void> {
  const generation = instance.generation;
  const catchingUp =
    instance.tabWasHidden && typeof document !== "undefined" && document.visibilityState === "visible";

  const playsFrom = instance.localAllPlays.length > 0 ? instance.localAllPlays.length : 0;
  const started = performance.now();

  try {
    const snapshot = await fetchLiveSnapshotWithPlays(
      instance.gamePk,
      instance.state.gameState ? playsFrom : 0,
    );

    if (generation !== instance.generation || instance.cancelled) return;

    recordFetchMetric({
      gamePk: instance.gamePk,
      source: "snapshot",
      latencyMs: performance.now() - started,
      payloadBytes: 0,
      status: 200,
      notModified: false,
      at: new Date().toISOString(),
    });

    instance.lastSnapshot = snapshot;

    if (snapshot.plays) {
      instance.localAllPlays = mergeAllPlays(
        instance.localAllPlays,
        snapshot.plays.from,
        snapshot.plays.plays,
        snapshot.plays.total,
      );
    } else if (snapshot.allPlaysCount > instance.localAllPlays.length) {
      const refetch = await fetchLiveSnapshotWithPlays(instance.gamePk, 0);
      if (refetch.plays) {
        instance.localAllPlays = mergeAllPlays(
          [],
          refetch.plays.from,
          refetch.plays.plays,
          refetch.plays.total,
        );
      }
    }

    const currentPlay = snapshot.currentPlay as AllPlayRaw | undefined;
    const feed = reconstructFeedFromParts(snapshot, instance.localAllPlays);

    const fastNext = parseLiveFeedSnapshot(
      instance.gamePk,
      feed,
      instance.parseState.entries,
    );
    instance.state = {
      ...instance.state,
      gameState: applyGameState(instance.state.gameState, fastNext, catchingUp),
      boxScore: snapshot.boxScore ?? instance.state.boxScore,
      error: null,
      consecutiveErrors: 0,
      isLoading: false,
    };
    notify(instance);

    instance.parseState = resyncPlayByPlayState(
      instance.parseState,
      instance.localAllPlays,
      currentPlay,
      catchingUp,
    );

    if (!playByPlayNeedsResync(instance.parseState, instance.localAllPlays, currentPlay)) {
      instance.tabWasHidden = false;
    }

    if (generation !== instance.generation || instance.cancelled) return;

    const next = parseLiveFeedSnapshot(
      instance.gamePk,
      reconstructFeedFromParts(snapshot, instance.localAllPlays),
      instance.parseState.entries,
    );

    instance.state = {
      ...instance.state,
      gameState: applyGameState(instance.state.gameState, next, catchingUp),
      boxScore: snapshot.boxScore ?? instance.state.boxScore,
      isLoading: false,
    };
    notify(instance);
  } catch (err) {
    if (generation !== instance.generation || instance.cancelled) return;
    const message = err instanceof Error ? err.message : "Failed to fetch live game state";
    instance.state = {
      ...instance.state,
      error: message,
      consecutiveErrors: instance.state.consecutiveErrors + 1,
      isLoading: false,
    };
    notify(instance);
  }
}

function scheduleNextPoll(instance: CoordinatorInstance): void {
  if (instance.cancelled || instance.subscribers.size === 0) return;

  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  const feed = instance.lastSnapshot
    ? reconstructFeedFromParts(instance.lastSnapshot, instance.localAllPlays)
    : null;
  const delay = adaptivePollIntervalMs(feed, hidden);

  instance.pollTimer = setTimeout(() => {
    void runPollCycle(instance);
  }, delay);
}

async function runPollCycle(instance: CoordinatorInstance): Promise<void> {
  if (instance.cancelled || instance.subscribers.size === 0) return;

  while (instance.inFlight < MAX_IN_FLIGHT) {
    instance.inFlight += 1;
    void pollOnce(instance).finally(() => {
      instance.inFlight -= 1;
    });
    break;
  }

  scheduleNextPoll(instance);
}

function startPolling(instance: CoordinatorInstance): void {
  if (instance.pollTimer != null) return;

  const onVisibility = () => {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") {
      instance.tabWasHidden = true;
    } else if (instance.tabWasHidden) {
      void pollOnce(instance);
    }
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  void pollOnce(instance);
  scheduleNextPoll(instance);
}

function stopPolling(instance: CoordinatorInstance): void {
  instance.cancelled = true;
  if (instance.pollTimer != null) {
    clearTimeout(instance.pollTimer);
    instance.pollTimer = null;
  }
  instances.delete(instance.gamePk);
}

function getOrCreate(gamePk: number): CoordinatorInstance {
  let instance = instances.get(gamePk);
  if (instance) return instance;

  instance = {
    gamePk,
    subscribers: new Set(),
    refCount: 0,
    parseState: createPlayByPlayParseState(),
    localAllPlays: [],
    lastSnapshot: null,
    state: defaultState(),
    pollTimer: null,
    inFlight: 0,
    cancelled: false,
    tabWasHidden: false,
    generation: 0,
  };
  instances.set(gamePk, instance);
  return instance;
}

export function subscribeLiveFeed(
  gamePk: number,
  subscriber: Subscriber,
): () => void {
  const instance = getOrCreate(gamePk);
  instance.refCount += 1;
  instance.subscribers.add(subscriber);
  subscriber(instance.state);

  if (instance.refCount === 1) {
    instance.cancelled = false;
    startPolling(instance);
  }

  return () => {
    instance.subscribers.delete(subscriber);
    instance.refCount = Math.max(0, instance.refCount - 1);
    if (instance.refCount === 0) {
      stopPolling(instance);
    }
  };
}

export async function refreshLiveFeedNow(gamePk: number): Promise<void> {
  const instance = instances.get(gamePk);
  if (!instance || instance.cancelled) return;
  await pollOnce(instance);
}

export function resetLiveFeedCoordinator(gamePk: number): void {
  const instance = instances.get(gamePk);
  if (!instance) return;
  instance.generation += 1;
  instance.parseState = createPlayByPlayParseState();
  instance.localAllPlays = [];
  instance.lastSnapshot = null;
  instance.tabWasHidden = false;
  instance.state = defaultState();
}

/** Test helper — merge incremental play chunks like the coordinator. */
export function mergeAllPlaysForTest(
  local: AllPlayRaw[],
  from: number,
  chunk: AllPlayRaw[],
  total: number,
): AllPlayRaw[] {
  return mergeAllPlays(local, from, chunk, total);
}

/** Test helper — expose mergeCurrentPlayTail for golden fixtures. */
export { mergeCurrentPlayTail };
