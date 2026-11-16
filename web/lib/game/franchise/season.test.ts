import { describe, expect, it } from "vitest";
import rosters from "@/data/game/rosters.json";
import type { RosterFile } from "@/lib/game/types";
import { createLeague } from "./league";
import { simUntil } from "./season";
import { leagueTotals } from "./stats";
import { payroll } from "./contracts";

const file = rosters as unknown as RosterFile;

describe("full season sim", () => {
  it("sims 2,430 games quickly with a realistic run environment", () => {
    const t0 = performance.now();
    const league = createLeague(file, { userTeam: 147, seed: 7 });
    const t1 = performance.now();
    simUntil(league, "season");
    const t2 = performance.now();
    const tot = leagueTotals(league);
    const wins = Object.values(league.teams).map((t) => t.w).sort((a, b) => a - b);
    const pays = Object.values(league.teams).map((t) => payroll(league, t.id)).sort((a, b) => a - b);
    console.log({ createMs: Math.round(t1 - t0), seasonMs: Math.round(t2 - t1), ...tot, wins: wins.join(","), payrolls: pays.map(Math.round).join(",") });
    expect(tot.games).toBe(2430);
    expect(t2 - t1).toBeLessThan(15000);
    expect(tot.rpg).toBeGreaterThan(4.1);
    expect(tot.rpg).toBeLessThan(4.8);
    expect(tot.hrPerPa).toBeGreaterThan(0.024);
    expect(tot.hrPerPa).toBeLessThan(0.036);
    expect(tot.k).toBeGreaterThan(0.19);
    expect(tot.k).toBeLessThan(0.25);
    expect(wins[0]).toBeGreaterThan(48);
    expect(wins[0]).toBeLessThan(74);
    expect(wins[29]).toBeGreaterThan(90);
    expect(wins[29]).toBeLessThan(115);
    expect(league.phase).toBe("postseason");
  });
});
