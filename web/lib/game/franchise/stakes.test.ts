import { describe, expect, it } from "vitest";
import { gameStakes, postseasonStakes, regularSeasonStake } from "./stakes";
import type { League, ScheduledGame, Series } from "./types";

/** Five-team divisions, three per league; records and games left are all the stakes read. */
function league(records: Record<number, number>, left: Record<number, number>, user = 1): League {
  const teams: Record<number, unknown> = {};
  const divs = ["East", "Central", "West"] as const;
  for (let id = 1; id <= 30; id += 1) {
    const lg = id <= 15 ? "AL" : "NL";
    const div = divs[Math.floor(((id - 1) % 15) / 5)];
    teams[id] = { id, name: `Team ${id}`, league: lg, division: div, w: records[id] ?? 70, l: 70 };
  }
  // Each club's remaining games, against a far-away filler opponent so nobody's count leaks into another's.
  const schedule: ScheduledGame[] = [];
  let gid = 1;
  for (const [id, n] of Object.entries(left)) for (let i = 0; i < n; i += 1) schedule.push({ id: gid++, day: 1, away: Number(id), home: 999, ps: undefined });
  return { teams, schedule, userTeam: user } as unknown as League;
}

describe("franchise stakes", () => {
  it("division clinch: a win puts him out of every division rival's reach", () => {
    // Team 1 at 95 wins; team 2 (same division) can reach 96 with 6 left; today they play each other.
    const l = league({ 1: 95, 2: 90 }, { 1: 5, 2: 5 });
    const today: ScheduledGame = { id: 500, day: 1, away: 2, home: 1 };
    l.schedule.push(today);
    // Before: 95 vs team 2's 90 + 6 = 96. A win: 96 vs 90 + 5 = 95.
    expect(regularSeasonStake(l, 1, 2)).toEqual({ kind: "clinch-division", label: "AL East champions" });
    expect(gameStakes(l, today)).toEqual({ home: { kind: "clinch-division", label: "AL East champions" } });
    // Already clinched: nothing new.
    const done = league({ 1: 99, 2: 80 }, { 1: 5, 2: 5 });
    done.schedule.push(today);
    expect(regularSeasonStake(done, 1, 2)).toBeNull();
    // Still a race either way.
    const race = league({ 1: 90, 2: 90 }, { 1: 10, 2: 10 });
    race.schedule.push(today);
    expect(regularSeasonStake(race, 1, 2)).toBeNull();
  });

  it("wild-card berth: at most three other clubs can still reach him", () => {
    // Team 1 at 90 trails its division; four other AL clubs can still reach 90, one only if it beats us.
    const l = league({ 1: 90, 2: 100, 6: 95, 11: 95, 7: 85 }, { 1: 3, 2: 3, 6: 3, 11: 3, 7: 4 });
    const today: ScheduledGame = { id: 500, day: 1, away: 1, home: 7 };
    l.schedule.push(today);
    expect(regularSeasonStake(l, 1, 7)).toEqual({ kind: "clinch-wildcard", label: "Clinched a playoff spot" });
    expect(gameStakes(l, today)).toEqual({ away: { kind: "clinch-wildcard", label: "Clinched a playoff spot" } });
    // Not the user's game: no regular-season stakes worked out.
    const other: ScheduledGame = { id: 501, day: 1, away: 2, home: 6 };
    expect(gameStakes(l, other)).toBeUndefined();
  });

  it("postseason: series clinch, pennant, title, and a game a club must win", () => {
    const mk = (round: Series["round"], wins: [number, number], bestOf: number): Series => ({ id: `${round}-x`, round, league: round === "ws" ? "MLB" : "AL", hi: 1, lo: 6, hiSeed: 1, loSeed: 4, bestOf, wins, games: [1, 2, 3, 4] });
    const g: ScheduledGame = { id: 4, day: 1, away: 6, home: 1, ps: "x" };
    const run = (s: Series) => postseasonStakes({ ...league({}, {}), bracket: { seeds: { AL: [], NL: [] }, series: [{ ...s, id: "x" }] } } as League, g);
    expect(run(mk("ws", [3, 2], 7))).toEqual({ home: { kind: "world-series", label: "Team 1 win the World Series" }, away: { kind: "elimination-save", label: "Facing elimination — forces Game 5" } });
    expect(run(mk("lcs", [3, 3], 7)).home?.kind).toBe("pennant");
    expect(run(mk("lcs", [3, 3], 7)).away?.kind).toBe("pennant");
    expect(run(mk("ds", [2, 0], 5)).home).toEqual({ kind: "series-clinch", label: "Division Series won · Advance to the ALCS" });
    expect(run(mk("wc", [1, 1], 3)).away?.label).toContain("Advance to the Division Series");
    expect(run(mk("ds", [1, 0], 5))).toEqual({ home: null, away: null });
  });
});
