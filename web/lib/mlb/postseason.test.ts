import { describe, expect, it } from "vitest";

import {
  buildPostseasonBracket,
  decodePostseasonPicks,
  encodePostseasonPicks,
  resolveSeriesTeams,
  sanitizePostseasonPicks,
} from "@/lib/mlb/postseason";
import { portraitBracketSvg } from "@/components/features/PostseasonBracket";
import { MLB_GAME_TYPES } from "@/lib/mlb/scheduleApi";
import type { ScheduleApiRawGame } from "@/lib/mlb/scheduleApi";

function game(
  gameType: string,
  description: string,
  away: [number, string, string],
  home: [number, string, string],
  leagueId: 103 | 104 | null,
): ScheduleApiRawGame {
  return {
    gamePk: Math.random(),
    gameDate: "2026-10-01T00:00:00Z",
    season: "2026",
    gameType,
    description,
    gamesInSeries: gameType === "F" ? 3 : gameType === "D" ? 5 : 7,
    seriesGameNumber: 1,
    teams: {
      away: { team: { id: away[0], name: away[1], abbreviation: away[2], league: leagueId ? { id: leagueId } : undefined } },
      home: { team: { id: home[0], name: home[1], abbreviation: home[2], league: leagueId ? { id: leagueId } : undefined } },
    },
  };
}

const games = [
  game("F", "AL Wild Card 'A' Game 1", [1, "Away A", "A"], [2, "Home A", "B"], 103),
  game("F", "AL Wild Card 'B' Game 1", [3, "Away B", "C"], [4, "Home B", "D"], 103),
  game("D", "ALDS 'A' Game 1", [5001, "C/D", "C/D"], [5, "Top Seed", "TOP"], 103),
  game("D", "ALDS 'B' Game 1", [5002, "A/B", "A/B"], [6, "Second Seed", "SEC"], 103),
  game("L", "ALCS Game 1", [5010, "AL Lower Seed", "Low"], [5011, "AL Higher Seed", "High"], 103),
  game("W", "World Series Game 1", [5020, "Lower Seed League Champion", "Low"], [5021, "Higher Seed League Champion", "High"], null),
];

describe("postseason bracket", () => {
  it("includes regular season and every MLB postseason round in the schedule", () => {
    expect(MLB_GAME_TYPES).toBe("R,F,D,L,W");
  });

  it("turns MLB placeholder clubs into winner slots", () => {
    const bracket = buildPostseasonBracket(2026, games);
    const division = bracket.series.find((series) => series.id === "al-ds-a")!;
    expect(division.participants[0]).toEqual({ kind: "winner", seriesId: "al-wc-b", label: "Winner Wild Card B" });
    expect(bracket.series.find((series) => series.id === "al-cs")?.participants).toEqual([
      { kind: "winner", seriesId: "al-ds-a", label: "Winner DS A" },
      { kind: "winner", seriesId: "al-ds-b", label: "Winner DS B" },
    ]);
  });

  it("assigns MLB seeds to the opening round and division-series byes", () => {
    const bracket = buildPostseasonBracket(2026, games);
    const teamSeeds = (seriesId: string) => bracket.series
      .find((series) => series.id === seriesId)!
      .participants.map((participant) => participant.kind === "team" ? participant.team.seed : null);

    expect(teamSeeds("al-wc-a")).toEqual([6, 3]);
    expect(teamSeeds("al-wc-b")).toEqual([5, 4]);
    expect(teamSeeds("al-ds-a")).toEqual([null, 1]);
    expect(teamSeeds("al-ds-b")).toEqual([null, 2]);
  });

  it("propagates picks and drops invalid downstream dibs", () => {
    const bracket = buildPostseasonBracket(2026, games);
    const picks = sanitizePostseasonPicks(bracket, {
      "al-wc-b": 3,
      "al-ds-a": 3,
      "al-cs": 3,
    });
    const division = bracket.series.find((series) => series.id === "al-ds-a")!;
    expect(resolveSeriesTeams(bracket, division, picks).map((team) => team?.id)).toEqual([3, 5]);

    expect(sanitizePostseasonPicks(bracket, { ...picks, "al-wc-b": 4 })).toEqual({ "al-wc-b": 4 });
  });

  it("keeps the winner path after MLB replaces a division placeholder with the actual club", () => {
    const resolvedGames = games.map((item) => item.description === "ALDS 'A' Game 1"
      ? game("D", "ALDS 'A' Game 1", [3, "Away B", "C"], [5, "Top Seed", "TOP"], 103)
      : item);
    const bracket = buildPostseasonBracket(2026, resolvedGames);
    const division = bracket.series.find((series) => series.id === "al-ds-a")!;

    expect(division.participants[0]).toEqual({
      kind: "winner",
      seriesId: "al-wc-b",
      label: "Winner Wild Card B",
    });
    expect(resolveSeriesTeams(bracket, division, { "al-wc-b": 3 })[0]).toMatchObject({
      id: 3,
      seed: 5,
    });
  });

  it("round-trips picks through a shareable query value", () => {
    const encoded = encodePostseasonPicks({ "world-series": 5, "al-wc-a": 2 });
    expect(decodePostseasonPicks(encoded)).toEqual({ "al-wc-a": 2, "world-series": 5 });
    // Verify URI-encoded strings (as produced by browsers or messaging apps) decode correctly
    expect(decodePostseasonPicks(encodeURIComponent(encoded))).toEqual({ "al-wc-a": 2, "world-series": 5 });
  });

  it("formats portrait mode bracket without text collisions or clipping capsule", () => {
    const bracket = buildPostseasonBracket(2026, games);
    const fonts = { sansRegular: "", sansSemibold: "", serif: "", mono: "" };
    const picks = { "world-series": 1, "al-cs": 1, "nl-cs": 2 };
    const svg = portraitBracketSvg(bracket, picks, new Map(), fonts);

    // Verify CHAMPION label is positioned above the champion circle to avoid overlapping team code
    expect(svg).toContain('<text x="540" y="608" text-anchor="middle" font-size="12" font-weight="700" letter-spacing="3" fill="#8b6914"');
    expect(svg).not.toContain('y="782"');

    // Verify old colliding series format labels near the circles are removed
    expect(svg).not.toContain('y="770"');
    expect(svg).not.toContain('y="590"');
    expect(svg).not.toContain('y="545"');

    // Verify series length formats are integrated in the column subheaders
    expect(svg).toContain('<g font-size="9" letter-spacing="1.5" fill="#8c9e93">');
    expect(svg).toContain('<text x="54" y="312" text-anchor="middle">BEST OF 3</text>');
    expect(svg).toContain('<text x="276" y="312" text-anchor="middle">BEST OF 5</text>');
    expect(svg).toContain('<text x="394" y="312" text-anchor="middle">BEST OF 7</text>');

    // Verify capsule is widened to comfortably contain the champion circle (radius 56 + 6)
    expect(svg).toContain('<rect x="472" y="376" width="136" height="638" rx="68"');

    // Verify connectors extend cleanly into center
    expect(svg).toContain("M446 695h32");
    expect(svg).toContain("M602 695h32");
  });

  it("updates series status to the latest game in progress instead of old game 1 state", () => {
    const multiGames: ScheduleApiRawGame[] = [
      {
        ...game("F", "NL Wild Card 'A' Game 1", [10, "Braves", "ATL"], [20, "Phillies", "PHI"], 104),
        seriesGameNumber: 1,
        status: { abstractGameState: "Final" },
        seriesStatus: { result: "ATL leads 1-0", isOver: false },
      },
      {
        ...game("F", "NL Wild Card 'A' Game 2", [10, "Braves", "ATL"], [20, "Phillies", "PHI"], 104),
        seriesGameNumber: 2,
        status: { abstractGameState: "Final" },
        seriesStatus: { result: "Series tied 1-1", isOver: false },
      },
    ];

    const bracket = buildPostseasonBracket(2026, multiGames);
    const nlWcA = bracket.series.find((s) => s.id === "nl-wc-a")!;
    expect(nlWcA.status).toBe("Series tied 1-1");
    expect(nlWcA.officialWinnerId).toBeNull();
  });

  it("extracts official winner and advances them automatically to next round without user picks", () => {
    const wildCardOverGames: ScheduleApiRawGame[] = [
      {
        ...game("F", "AL Wild Card 'A' Game 1", [145, "White Sox", "CWS"], [117, "Astros", "HOU"], 103),
        seriesGameNumber: 1,
        status: { abstractGameState: "Final" },
        seriesStatus: { result: "CWS leads 1-0", isOver: false, winningTeam: { id: 145 } },
      },
      {
        ...game("F", "AL Wild Card 'A' Game 2", [145, "White Sox", "CWS"], [117, "Astros", "HOU"], 103),
        seriesGameNumber: 2,
        status: { abstractGameState: "Final" },
        seriesStatus: { result: "CWS wins 2-0", isOver: true, winningTeam: { id: 145 } },
      },
      game("D", "ALDS 'B' Game 1", [5002, "A/B", "A/B"], [6, "Second Seed", "SEC"], 103),
    ];

    const bracket = buildPostseasonBracket(2026, wildCardOverGames);
    const alWcA = bracket.series.find((s) => s.id === "al-wc-a")!;
    expect(alWcA.status).toBe("CWS wins 2-0");
    expect(alWcA.officialWinnerId).toBe(145);

    // Division series should resolve participant to official winner (White Sox) even with empty picks
    const divisionB = bracket.series.find((s) => s.id === "al-ds-b")!;
    const resolved = resolveSeriesTeams(bracket, divisionB, {});
    expect(resolved[0]).toMatchObject({
      id: 145,
      name: "White Sox",
      abbreviation: "CWS",
      seed: 6,
    });
  });

  it("official winner takes precedence over obsolete picks and drops downstream eliminated picks", () => {
    const wildCardOverGames: ScheduleApiRawGame[] = [
      {
        ...game("F", "AL Wild Card 'A' Game 1", [145, "White Sox", "CWS"], [117, "Astros", "HOU"], 103),
        seriesGameNumber: 1,
        status: { abstractGameState: "Final" },
        seriesStatus: { result: "CWS leads 1-0", isOver: false, winningTeam: { id: 145 } },
      },
      {
        ...game("F", "AL Wild Card 'A' Game 2", [145, "White Sox", "CWS"], [117, "Astros", "HOU"], 103),
        seriesGameNumber: 2,
        status: { abstractGameState: "Final" },
        seriesStatus: { result: "CWS wins 2-0", isOver: true, winningTeam: { id: 145 } },
      },
      game("D", "ALDS 'B' Game 1", [5002, "A/B", "A/B"], [6, "Second Seed", "SEC"], 103),
      game("L", "ALCS Game 1", [5010, "AL Low", "Low"], [5011, "AL High", "High"], 103),
    ];

    const bracket = buildPostseasonBracket(2026, wildCardOverGames);
    const divisionB = bracket.series.find((s) => s.id === "al-ds-b")!;

    // User previously picked Astros (117) before playoffs started
    const oldPicks = {
      "al-wc-a": 117,
      "al-ds-b": 117,
      "al-cs": 117,
    };

    // In division series, White Sox (145) advanced officially, so resolved team is White Sox, not Astros
    const resolved = resolveSeriesTeams(bracket, divisionB, oldPicks);
    expect(resolved[0]?.id).toBe(145);

    // Sanitization drops 117 from division and ALCS because Astros is eliminated
    const sanitized = sanitizePostseasonPicks(bracket, oldPicks);
    expect(sanitized).toEqual({
      "al-wc-a": 117, // preserved for historical round pick
    });
  });
});

