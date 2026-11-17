import { describe, expect, it } from "vitest";
import projFile from "@/data/game/franchise-proj.json";
import rosters from "@/data/game/rosters.json";
import type { RosterFile } from "@/lib/game/types";
import { createLeague } from "./league";
import type { ProjectionFile } from "./projections";
import { simUntil } from "./season";
import { teamRows } from "./statline";
import { executeTrade } from "./trades";

describe("mid-season trades", () => {
  it("leave the old club's team totals alone and credit the new club only from then on", () => {
    const league = createLeague(rosters as unknown as RosterFile, { userTeam: 136, seed: 5, proj: projFile as unknown as ProjectionFile });
    simUntil(league, "deadline");
    const hitter = Object.values(league.players)
      .filter((p) => p.team === 121 && p.stats.bat && p.stats.bat.hr > 0)
      .sort((a, b) => b.stats.bat!.hr - a.stats.bat!.hr)[0];
    expect(hitter).toBeDefined();
    const before = new Map(teamRows(league).map((r) => [r.id, r]));
    executeTrade(league, 121, 147, [hitter.id], []);
    const after = new Map(teamRows(league).map((r) => [r.id, r]));
    expect(after.get(121)!.hr).toBe(before.get(121)!.hr);
    expect(after.get(147)!.hr).toBe(before.get(147)!.hr);
    // His own line stays whole, and his next homer counts for his new club.
    expect(hitter.stats.bat!.hr).toBeGreaterThan(0);
    hitter.stats.bat!.hr += 1;
    expect(teamRows(league).find((r) => r.id === 147)!.hr).toBe(before.get(147)!.hr + 1);
  });
});
