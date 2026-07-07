import { describe, expect, it } from "vitest";

import type { LiveInsightContext } from "@/lib/mlb/nerdInsights/types";
import {
  normalizeHalfInning,
  offenseDefenseFromHalfInning,
  parseHalfKey,
  runsAllowedByTeam,
  runsScoredByTeam,
  situationFromHalfKey,
} from "@/lib/mlb/nerdInsights/situational";

function ctx(overrides: Partial<LiveInsightContext> = {}): LiveInsightContext {
  return {
    gamePk: 1,
    trigger: { type: "inning-change", inning: 5 },
    inning: 5,
    inningHalf: "top",
    inningState: "Top",
    outs: 0,
    balls: 0,
    strikes: 0,
    awayRuns: 2,
    homeRuns: 0,
    awayAbbrev: "AWY",
    homeAbbrev: "HOM",
    awayTeamId: 100,
    homeTeamId: 200,
    offenseTeamId: 100,
    defenseTeamId: 200,
    offenseAbbrev: "AWY",
    defenseAbbrev: "HOM",
    onFirst: false,
    onSecond: false,
    onThird: false,
    batterName: "Batter",
    pitcherName: "Pitcher",
    pitchCount: 0,
    foulsThisAb: 0,
    isHalfInningBreak: false,
    isLateInning: false,
    isCloseGame: false,
    isOneRunGame: false,
    isExtraInnings: false,
    runnersInScoringPosition: false,
    twoOuts: false,
    basesLoaded: false,
    runMargin: 2,
    trailingTeamId: 200,
    leadingTeamId: 100,
    liveStats: null,
    strikeoutKind: null,
    contact: null,
    ...overrides,
  };
}

describe("situational helpers", () => {
  it("normalizes half-inning labels", () => {
    expect(normalizeHalfInning("Top")).toBe("top");
    expect(normalizeHalfInning("Bottom")).toBe("bottom");
  });

  it("maps top-half offense to the away team", () => {
    const teams = offenseDefenseFromHalfInning("top", 100, 200);
    expect(teams).toEqual({ offenseTeamId: 100, defenseTeamId: 200 });
  });

  it("parses half keys used by live stats", () => {
    expect(parseHalfKey("2-top")).toEqual({ inning: 2, halfInning: "top" });
  });

  it("returns runs allowed by the defending team", () => {
    expect(runsScoredByTeam(ctx(), 100)).toBe(2);
    expect(runsAllowedByTeam(ctx(), 200)).toBe(2);
    expect(runsAllowedByTeam(ctx(), 100)).toBe(0);
  });

  it("builds half-break teams from the completed half key", () => {
    const situation = situationFromHalfKey("2-top", 146, 136, "MIA", "SEA");
    expect(situation?.offenseAbbrev).toBe("MIA");
    expect(situation?.defenseAbbrev).toBe("SEA");
  });
});
