import { describe, expect, it } from "vitest";
import contracts from "@/data/game/franchise-contracts.json";
import projFile from "@/data/game/franchise-proj.json";
import rosters from "@/data/game/rosters.json";
import type { RosterFile } from "@/lib/game/types";
import type { ContractFile } from "./contracts";
import type { ProjectionFile } from "./projections";
import { addRun, dist, emptyRuns, mergeRuns, openingDayLeague, simulateOnce, summarize } from "./seasonProjection";

describe("dist", () => {
  it("computes mean, sd, percentiles and a histogram that sums to ~1000‰", () => {
    const xs = Array.from({ length: 1001 }, (_, i) => i / 10);
    const d = dist(xs, { bins: 20 });
    expect(d.mean).toBeCloseTo(50, 5);
    expect(d.pct[3]).toBeCloseTo(50, 5);
    expect(d.pct[0]).toBeCloseTo(5, 5);
    expect(d.pct[6]).toBeCloseTo(95, 5);
    expect(d.sd).toBeCloseTo(28.9, 0);
    const total = d.hist!.n.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(990);
    expect(total).toBeLessThan(1010);
  });
});

describe("season projection", () => {
  const base = openingDayLeague(rosters as unknown as RosterFile, {
    proj: projFile as unknown as ProjectionFile,
    contracts: contracts as unknown as ContractFile,
    seed: 2027,
  });

  it("simulates whole seasons, and merged parts equal one combined run", { timeout: 120_000 }, () => {
    const a = emptyRuns();
    const b = emptyRuns();
    const all = emptyRuns();
    for (let i = 0; i < 4; i += 1) {
      const r = simulateOnce(base, 1000 + i);
      const games = r.teams.reduce((s, t) => s + t.w, 0);
      expect(games).toBe(81 * 30);
      expect(r.teams.filter((t) => t.reach === 5)).toHaveLength(1);
      expect(r.teams.filter((t) => t.reach >= 1)).toHaveLength(12);
      addRun(i < 2 ? a : b, r);
      addRun(all, r);
    }
    const merged = mergeRuns([a, b]);
    expect(merged.sims).toBe(4);
    const s1 = summarize(merged, base, { minPa: 1, minOuts: 1 });
    const s2 = summarize(all, base, { minPa: 1, minOuts: 1 });
    expect(s1.teams).toEqual(s2.teams);
    expect(s1.hitters.slice(0, 50)).toEqual(s2.hitters.slice(0, 50));
    const ws = s1.teams.reduce((s, t) => s + t.ws, 0);
    expect(ws).toBeCloseTo(1, 5);
    const playoffs = s1.teams.reduce((s, t) => s + t.playoffs, 0);
    expect(playoffs).toBeCloseTo(12, 5);
    const judge = s1.hitters.find((h) => h.name === "Aaron Judge");
    expect(judge?.team).toBe(147);
    expect(judge!.pa.mean).toBeGreaterThan(400);
  });
});
