import { describe, expect, it } from "vitest";

import { collectInsightTriggers, shouldPersistInsightInFeed } from "@/lib/mlb/nerdInsights/insightTriggers";
import type { LiveGameState, PlayByPlayEntry } from "@/types/mlb-live";

function play(
  overrides: Partial<PlayByPlayEntry> & Pick<PlayByPlayEntry, "atBatIndex" | "event">,
): PlayByPlayEntry {
  return {
    inning: 2,
    halfInning: "top",
    batterId: overrides.atBatIndex,
    batterName: `Batter ${overrides.atBatIndex}`,
    batterHits: 0,
    batterAtBats: 1,
    description: overrides.event,
    awayScore: 0,
    homeScore: 0,
    outs: 1,
    bases: {},
    onFirst: false,
    onSecond: false,
    onThird: false,
    situationBefore: {
      awayScore: 0,
      homeScore: 0,
      outs: 0,
      bases: {},
      onFirst: false,
      onSecond: false,
      onThird: false,
    },
    isScoringPlay: false,
    isAtBat: true,
    detail: {
      atBatIndex: overrides.atBatIndex,
      batterId: overrides.atBatIndex,
      batterName: `Batter ${overrides.atBatIndex}`,
      batterHits: 0,
      batterAtBats: 1,
      pitcherName: "Pitcher",
      pitcherId: 99,
      event: overrides.event,
      description: overrides.event,
      inning: overrides.inning ?? 2,
      halfInning: overrides.halfInning ?? "top",
      awayScore: 0,
      homeScore: 0,
      isScoringPlay: false,
      pitches: [],
      hit: null,
    },
    ...overrides,
  };
}

function state(
  plays: PlayByPlayEntry[],
  overrides: Partial<LiveGameState> = {},
): LiveGameState {
  const last = plays.at(-1);
  return {
    gamePk: 1,
    venueId: null,
    venueName: null,
    gameStatus: "Live",
    awayTeam: "Away",
    awayAbbrev: "AWY",
    homeTeam: "Home",
    homeAbbrev: "HOM",
    awayRuns: 0,
    homeRuns: 0,
    batterId: (last?.batterId ?? 0) + 1,
    batterName: "Next Batter",
    pitcherName: "Pitcher",
    inning: last?.inning ?? 2,
    inningHalf: last?.halfInning ?? "top",
    inningState: "Top",
    outs: 0,
    balls: 0,
    strikes: 0,
    onFirst: false,
    onSecond: false,
    onThird: false,
    offenseTeamId: null,
    atBatPitches: [],
    plays,
    ...overrides,
  } as LiveGameState;
}

describe("collectInsightTriggers", () => {
  it("replays missed at-bat-end triggers after a feed jump", () => {
    const prev = state([
      play({ atBatIndex: 1, event: "Strikeout" }),
      play({ atBatIndex: 2, event: "Walk" }),
    ], {
      batterId: 3,
      atBatPitches: [],
    });

    const next = state([
      play({ atBatIndex: 1, event: "Strikeout" }),
      play({ atBatIndex: 2, event: "Walk" }),
      play({ atBatIndex: 3, event: "Single" }),
      play({ atBatIndex: 4, event: "Groundout" }),
      play({ atBatIndex: 5, event: "Strikeout" }),
    ], {
      batterId: 6,
      atBatPitches: [],
    });

    const triggers = collectInsightTriggers(prev, next);
    const atBatEnds = triggers.filter((trigger) => trigger.type === "at-bat-end");

    expect(atBatEnds.map((trigger) => trigger.atBatIndex)).toEqual([3, 4, 5]);
  });

  it("dedupes incremental and replayed at-bat-end triggers", () => {
    const prev = state([play({ atBatIndex: 1, event: "Strikeout" })], {
      batterId: 2,
      atBatPitches: [{ pitchNumber: 1 } as LiveGameState["atBatPitches"][number]],
    });

    const next = state([
      play({ atBatIndex: 1, event: "Strikeout" }),
      play({ atBatIndex: 2, event: "Flyout" }),
    ], {
      batterId: 3,
      atBatPitches: [],
    });

    const triggers = collectInsightTriggers(prev, next);
    const atBatEnds = triggers.filter((trigger) => trigger.type === "at-bat-end");

    expect(atBatEnds).toHaveLength(1);
    expect(atBatEnds[0]?.atBatIndex).toBe(2);
  });

  it("only persists completed plays and inning boundaries to the feed", () => {
    expect(shouldPersistInsightInFeed({ type: "at-bat-end", atBatIndex: 1, event: "Single" })).toBe(
      true,
    );
    expect(shouldPersistInsightInFeed({ type: "half-break", halfKey: "2-top" })).toBe(true);
    expect(shouldPersistInsightInFeed({ type: "inning-change", inning: 3 })).toBe(true);
    expect(shouldPersistInsightInFeed({ type: "at-bat-start", atBatIndex: 2 })).toBe(false);
    expect(
      shouldPersistInsightInFeed({ type: "pitch-thrown", atBatIndex: 2, pitchNumber: 6 }),
    ).toBe(false);
  });
});
