import { describe, expect, it } from "vitest";
import projFile from "@/data/game/franchise-proj.json";
import rosters from "@/data/game/rosters.json";
import type { RosterFile } from "@/lib/game/types";
import { createLeague, expectedWins } from "./league";
import type { ProjectionFile } from "./projections";
import { orgPlayers } from "./roster";

const file = rosters as unknown as RosterFile;
const proj = projFile as unknown as ProjectionFile;

describe("multi-year projections", () => {
  const base = createLeague(file, { userTeam: 147, seed: 7 });
  const league = createLeague(file, { userTeam: 147, seed: 7, proj });

  it("adds 40-man stars missing from the 2026 snapshot", () => {
    const judge = league.players[592450];
    expect(judge?.name).toBe("Aaron Judge");
    expect(judge.team).toBe(147);
    expect(judge.status).toBe("active");
    expect(judge.ovr).toBeGreaterThanOrEqual(70);
    expect(league.teams[147].lineup.some((s) => s.id === 592450)).toBe(true);
    expect(base.players[592450]).toBeUndefined();
  });

  it("keeps rosters legal and the talent spread MLB-like", () => {
    for (const t of Object.values(league.teams)) {
      const org = orgPlayers(league, t.id);
      expect(org.filter((p) => p.status === "active").length).toBe(26);
      expect(org.filter((p) => p.on40).length).toBeLessThanOrEqual(40);
    }
    const w = Object.values(expectedWins(league));
    console.log("expected wins", [...w].sort((a, b) => a - b).join(","));
    expect(Math.min(...w)).toBeGreaterThan(55);
    expect(Math.max(...w)).toBeLessThan(110);
  });

  it("logs biggest rating moves vs 2026-only", () => {
    const moves = Object.values(league.players)
      .filter((p) => p.real && base.players[p.id])
      .map((p) => ({ n: p.name, a: p.age, d: p.ovr - base.players[p.id].ovr, o: p.ovr }))
      .sort((a, b) => b.d - a.d);
    console.log("up", moves.slice(0, 12).map((m) => `${m.n} ${m.a} ${m.o} (${m.d > 0 ? "+" : ""}${m.d})`).join(" | "));
    console.log("down", moves.slice(-12).map((m) => `${m.n} ${m.a} ${m.o} (${m.d})`).join(" | "));
    const top = Object.values(league.players).filter((p) => p.real).sort((a, b) => b.ovr - a.ovr).slice(0, 20);
    console.log("top", top.map((p) => `${p.name} ${p.ovr}`).join(", "));
  });
});
