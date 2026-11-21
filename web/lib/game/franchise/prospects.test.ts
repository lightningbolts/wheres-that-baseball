import { describe, expect, it } from "vitest";
import projFile from "@/data/game/franchise-proj.json";
import rosters from "@/data/game/rosters.json";
import type { RosterFile } from "@/lib/game/types";
import { createLeague } from "./league";
import type { ProjectionFile } from "./projections";
import { PROSPECTS, prospectGrades, seasonAge } from "./prospects";
import { orgPlayers } from "./roster";

const league = createLeague(rosters as unknown as RosterFile, { userTeam: 136, seed: 11, proj: projFile as unknown as ProjectionFile });

describe("real farm systems (MLB Pipeline top 30)", () => {
  it("has a full top-30 for all 30 clubs", () => {
    expect(Object.keys(PROSPECTS.teams)).toHaveLength(30);
    for (const list of Object.values(PROSPECTS.teams)) {
      expect(list).toHaveLength(30);
      expect(list.map((p) => p.rank)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    }
  });

  it("puts Ryan Sloan and Kade Anderson in the Mariners' system", () => {
    const sea = orgPlayers(league, 136).filter((p) => p.prospect);
    expect(sea.length).toBe(30);
    const sloan = sea.find((p) => p.name === "Ryan Sloan");
    const anderson = sea.find((p) => p.name === "Kade Anderson");
    expect(sloan?.prospect?.rank).toBe(2);
    expect(anderson?.prospect?.rank).toBe(1);
    expect(sloan?.pos).toBe("SP");
    expect(sloan!.pot).toBeGreaterThan(sloan!.ovr);
  });

  it("tags every ranked prospect in every org", () => {
    for (const [team, list] of Object.entries(PROSPECTS.teams)) {
      const org = new Set(orgPlayers(league, Number(team)).map((p) => p.id));
      const missing = list.filter((p) => !org.has(p.id) && league.players[p.id]?.team === Number(team));
      expect(missing).toEqual([]);
      for (const p of list) expect(league.players[p.id]?.prospect?.rank).toBe(p.rank);
    }
  });

  it("grades: higher FV and higher level mean better current ratings", () => {
    expect(seasonAge("2004-08-01", 2026)).toBe(21);
    expect(seasonAge("2004-03-01", 2026)).toBe(22);
    const base = { rank: 1, id: 1, name: "x", pos: "SS", born: "2004-03-01", tools: {} };
    const aaa = prospectGrades({ ...base, ovr: 60, level: "AAA" }, 2026);
    const a = prospectGrades({ ...base, ovr: 60, level: "A" }, 2026);
    const low = prospectGrades({ ...base, ovr: 45, level: "AAA" }, 2026);
    expect(aaa.ovr).toBeGreaterThan(a.ovr);
    expect(aaa.pot).toBeGreaterThan(low.pot);
    expect(aaa.pot).toBeGreaterThanOrEqual(60);
  });
});
