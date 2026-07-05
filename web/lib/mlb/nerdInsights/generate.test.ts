import { describe, expect, it } from "vitest";

import { buildMiniInsight, generateNerdInsight } from "@/lib/mlb/nerdInsights/generate";
import type { LiveInsightContext, NerdInsight, TeamNerdProfile } from "@/lib/mlb/nerdInsights/types";
import { anchorFromTrigger } from "@/lib/mlb/nerdInsights/types";
import { buildInsightMaps } from "@/hooks/useNerdInsights";

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
        displayValue: ".342",
        value: 0.342,
        title: "RISP Merchants",
      },
    });

    const insight = generateNerdInsight(baseContext(), away, null);
    expect(insight?.statId).toBe("risp-batting");
    expect(insight?.title).toContain("Test Batter");
    expect(insight?.variant).toBe("full");
    expect(insight?.anchor).toEqual({ type: "live" });
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
    expect(insight?.anchor).toEqual({ type: "live" });
  });

  it("fires full-count OPS insight when ball-rate is not elite", () => {
    const away = profile(100, "AWY", {
      "full-count-ops": {
        rank: 2,
        displayValue: ".912",
        value: 0.912,
        title: "Full Count OPS Merchants",
      },
    });

    const insight = generateNerdInsight(
      baseContext({
        trigger: { type: "pitch-thrown", atBatIndex: 2, pitchNumber: 6 },
        balls: 3,
        strikes: 2,
      }),
      away,
      null,
    );

    expect(insight?.statId).toBe("full-count-ops");
    expect(insight?.title).toContain("Full count");
    expect(insight?.anchor).toEqual({ type: "live" });
  });

  it("anchors at-bat-end insights to the completed at-bat", () => {
    const away = profile(100, "AWY", {
      "walks-per-game": {
        rank: 2,
        displayValue: "3.8",
        value: 3.8,
        title: "Walks Per Game",
      },
    });

    const insight = generateNerdInsight(
      baseContext({
        trigger: { type: "at-bat-end", atBatIndex: 7, event: "Walk" },
      }),
      away,
      null,
    );

    expect(insight?.statId).toBe("walks-per-game");
    expect(insight?.anchor).toEqual({ type: "at-bat", atBatIndex: 7 });
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

describe("buildMiniInsight", () => {
  it("produces a shorter walk repeat message", () => {
    const away = profile(100, "AWY", {
      "walks-per-game": {
        rank: 2,
        displayValue: "3.8",
        value: 3.8,
        title: "Walks Per Game",
      },
    });

    const ctx = baseContext({
      trigger: { type: "at-bat-end", atBatIndex: 12, event: "Walk" },
    });
    const full = generateNerdInsight(ctx, away, null)!;

    const mini = buildMiniInsight(full, ctx, away, null, 3);
    expect(mini.variant).toBe("mini");
    expect(mini.message).toContain("Walk #3");
    expect(mini.message).toContain("AWY");
    expect(mini.message).toContain("3.8");
    expect(mini.id).toBe(`${full.id}-mini-3`);
  });

  it("uses generic fallback for stats without a mini template", () => {
    const full: NerdInsight = {
      id: "1-pace-5-Top",
      variant: "full",
      eyebrow: "Nerd pace check",
      title: "AWY is grinding",
      message: "Long message",
      teamId: 100,
      statId: "pitches-seen-per-half",
      anchor: anchorFromTrigger({ type: "half-break", halfKey: "5-Top" }),
    };

    const mini = buildMiniInsight(
      full,
      baseContext({ trigger: { type: "half-break", halfKey: "5-Top" } }),
      profile(100, "AWY", {}),
      null,
      2,
    );

    expect(mini.variant).toBe("mini");
    expect(mini.message).toContain("2× this game");
  });
});

describe("buildInsightMaps", () => {
  it("groups insights by anchor type", () => {
    const feedInsights: NerdInsight[] = [
      {
        id: "a",
        variant: "full",
        eyebrow: "Free pass",
        title: "Walk",
        message: "msg",
        anchor: { type: "at-bat", atBatIndex: 3 },
      },
      {
        id: "b",
        variant: "mini",
        eyebrow: "Free pass",
        title: "Walk",
        message: "mini",
        anchor: { type: "at-bat", atBatIndex: 8 },
      },
      {
        id: "c",
        variant: "full",
        eyebrow: "Late",
        title: "Close",
        message: "msg",
        anchor: { type: "inning", inning: 7 },
      },
      {
        id: "d",
        variant: "full",
        eyebrow: "Pace",
        title: "Grind",
        message: "msg",
        anchor: { type: "half", halfKey: "5-Top" },
      },
    ];

    const { insightsByAtBat, halfInsights, inningInsights } = buildInsightMaps(feedInsights);
    expect(insightsByAtBat.get(3)).toHaveLength(1);
    expect(insightsByAtBat.get(8)).toHaveLength(1);
    expect(inningInsights.get(7)).toHaveLength(1);
    expect(halfInsights.get("5-Top")).toHaveLength(1);
  });
});
