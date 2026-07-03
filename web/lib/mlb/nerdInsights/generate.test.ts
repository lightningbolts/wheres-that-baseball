import { describe, expect, it } from "vitest";

import { generateNerdInsight } from "@/lib/mlb/nerdInsights/generate";
import type { LiveInsightContext, TeamNerdProfile } from "@/lib/mlb/nerdInsights/types";

function profile(
  teamId: number,
  abbrev: string,
  stats: Record<string, { rank: number; displayValue: string; value: number; title: string; sort?: "asc" | "desc" }>,
): TeamNerdProfile {
  return {
    teamId,
    abbrev,
    stats: new Map(
      Object.entries(stats).map(([statId, entry]) => [
        statId,
        {
          rank: entry.rank,
          displayValue: entry.displayValue,
          value: entry.value,
          title: entry.title,
          sort: entry.sort ?? "desc",
        },
      ]),
    ),
  };
}

function baseContext(overrides: Partial<LiveInsightContext> = {}): LiveInsightContext {
  return {
    gamePk: 1,
    trigger: { type: "at-bat-start", atBatIndex: 1 },
    inning: 5,
    inningHalf: "Top",
    inningState: "Top",
    outs: 1,
    balls: 0,
    strikes: 0,
    awayRuns: 2,
    homeRuns: 2,
    awayAbbrev: "AWY",
    homeAbbrev: "HOM",
    awayTeamId: 100,
    homeTeamId: 200,
    offenseTeamId: 100,
    defenseTeamId: 200,
    offenseAbbrev: "AWY",
    defenseAbbrev: "HOM",
    onFirst: false,
    onSecond: true,
    onThird: false,
    batterName: "Test Batter",
    pitcherName: "Test Pitcher",
    pitchCount: 0,
    foulsThisAb: 0,
    isHalfInningBreak: false,
    isLateInning: false,
    isCloseGame: true,
    isExtraInnings: false,
    runnersInScoringPosition: true,
    twoOuts: false,
    basesLoaded: false,
    runMargin: 0,
    trailingTeamId: null,
    leadingTeamId: null,
    liveStats: null,
    ...overrides,
  };
}

describe("generateNerdInsight", () => {
  it("fires RISP insight for elite RISP teams", () => {
    const away = profile(100, "AWY", {
      "risp-batting": {
        rank: 2,
        displayValue: "34.2%",
        value: 34.2,
        title: "RISP Merchants",
      },
    });

    const insight = generateNerdInsight(baseContext(), away, null);
    expect(insight?.statId).toBe("risp-batting");
    expect(insight?.title).toContain("Test Batter");
  });

  it("fires full-count ball hawk insight", () => {
    const away = profile(100, "AWY", {
      "ball-rate": {
        rank: 1,
        displayValue: "42.1%",
        value: 42.1,
        title: "Ball Hawk Rate",
      },
    });

    const insight = generateNerdInsight(
      baseContext({
        trigger: { type: "pitch-thrown", atBatIndex: 2, pitchNumber: 6 },
        balls: 3,
        strikes: 2,
        runnersInScoringPosition: false,
        onSecond: false,
      }),
      away,
      null,
    );

    expect(insight?.statId).toBe("ball-rate");
    expect(insight?.title).toContain("Full count");
  });

  it("returns null when no rules match", () => {
    const insight = generateNerdInsight(
      baseContext({ runnersInScoringPosition: false, onSecond: false }),
      profile(100, "AWY", {}),
      profile(200, "HOM", {}),
    );
    expect(insight).toBeNull();
  });
});
