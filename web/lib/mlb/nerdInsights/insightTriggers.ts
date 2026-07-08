import { isHalfInningBreak } from "@/lib/mlb/lineup";
import { isPlayByPlayAtBat } from "@/lib/mlb/liveFeed";
import { normalizeHalfInning } from "@/lib/mlb/nerdInsights/situational";
import type { InsightTrigger } from "@/lib/mlb/nerdInsights/types";
import type { LiveGameState, PlayByPlayEntry } from "@/types/mlb-live";

function atBats(state: LiveGameState): PlayByPlayEntry[] {
  return state.plays.filter(isPlayByPlayAtBat);
}

function triggerKey(trigger: InsightTrigger): string {
  switch (trigger.type) {
    case "at-bat-end":
      return `at-bat-end:${trigger.atBatIndex}`;
    case "at-bat-start":
      return `at-bat-start:${trigger.atBatIndex}`;
    case "pitch-thrown":
      return `pitch-thrown:${trigger.atBatIndex}:${trigger.pitchNumber}`;
    case "half-break":
      return `half-break:${trigger.halfKey}`;
    case "inning-change":
      return `inning-change:${trigger.inning}`;
  }
}

function dedupeTriggers(triggers: InsightTrigger[]): InsightTrigger[] {
  const seen = new Set<string>();
  const unique: InsightTrigger[] = [];
  for (const trigger of triggers) {
    const key = triggerKey(trigger);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trigger);
  }
  return unique;
}

/** Single poll-step diff — pitch milestones and the latest batter change. */
export function detectTriggers(
  prev: LiveGameState,
  next: LiveGameState,
): InsightTrigger[] {
  const triggers: InsightTrigger[] = [];

  if (isHalfInningBreak(next.inningState) && !isHalfInningBreak(prev.inningState)) {
    triggers.push({
      type: "half-break",
      halfKey: `${prev.inning}-${normalizeHalfInning(prev.inningHalf)}`,
    });
  }

  if (next.inning !== prev.inning) {
    triggers.push({ type: "inning-change", inning: next.inning });
  }

  if (next.batterId != null && next.batterId !== prev.batterId) {
    const nextAtBats = atBats(next);
    triggers.push({ type: "at-bat-start", atBatIndex: nextAtBats.length });

    if (prev.batterId != null && prev.atBatPitches.length > 0) {
      const completed = nextAtBats.at(-1);
      triggers.push({
        type: "at-bat-end",
        atBatIndex: completed?.atBatIndex ?? nextAtBats.length,
        event: completed?.event ?? "",
      });
    }
  }

  if (next.atBatPitches.length > prev.atBatPitches.length) {
    const nextAtBats = atBats(next);
    triggers.push({
      type: "pitch-thrown",
      atBatIndex: nextAtBats.length,
      pitchNumber: next.atBatPitches.length,
    });
  }

  return triggers;
}

function missedPlayTriggers(
  prev: LiveGameState,
  next: LiveGameState,
): InsightTrigger[] {
  const prevAtBats = atBats(prev);
  const nextAtBats = atBats(next);
  if (nextAtBats.length <= prevAtBats.length) return [];

  const triggers: InsightTrigger[] = [];
  const boundaryPlay = prevAtBats.at(-1) ?? null;

  for (let i = prevAtBats.length; i < nextAtBats.length; i++) {
    const play = nextAtBats[i];
    const prior = i > 0 ? nextAtBats[i - 1] : boundaryPlay;
    if (prior) {
      const priorHalf = normalizeHalfInning(prior.halfInning);
      const playHalf = normalizeHalfInning(play.halfInning);
      if (prior.inning !== play.inning || priorHalf !== playHalf) {
        triggers.push({
          type: "half-break",
          halfKey: `${prior.inning}-${priorHalf}`,
        });
      }
      if (prior.inning !== play.inning) {
        triggers.push({ type: "inning-change", inning: play.inning });
      }
    }

    triggers.push({
      type: "at-bat-end",
      atBatIndex: play.atBatIndex,
      event: play.event,
    });
  }

  return triggers;
}

/**
 * Collect insight triggers between two game snapshots.
 * Replays completed plate appearances when the feed jumps (tab backgrounding).
 */
export function collectInsightTriggers(
  prev: LiveGameState,
  next: LiveGameState,
): InsightTrigger[] {
  const incremental = detectTriggers(prev, next);
  const replay =
    atBats(next).length > atBats(prev).length + 1 ||
    next.plays.length - prev.plays.length > 2
      ? missedPlayTriggers(prev, next)
      : [];

  return dedupeTriggers([...replay, ...incremental]);
}

/** Only completed plays and inning/half boundaries belong in the play-by-play log. */
export function shouldPersistInsightInFeed(trigger: InsightTrigger): boolean {
  return (
    trigger.type === "at-bat-end" ||
    trigger.type === "half-break" ||
    trigger.type === "inning-change"
  );
}
