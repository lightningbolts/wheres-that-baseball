import { describe, expect, it } from "vitest";
import rosters from "@/data/game/rosters.json";
import { GameSession, teamsFromRosters, type GameSetup } from "@/lib/game/session/session";
import { arsenalSummary, isBarrel, pitchersInLog } from "@/lib/game/stats/pitchLog";
import type { RosterFile } from "@/lib/game/types";

const teams = teamsFromRosters(rosters as unknown as RosterFile);
const ids = [...teams.keys()];
const setup: GameSetup = { awayTeamId: ids[2], homeTeamId: ids[7], human: "none", innings: 9, seed: 7, difficulty: "pro", awayStarter: 0, homeStarter: 0 };

function cpuGame() {
  const s = new GameSession(setup, teams);
  while (!s.game.final) s.autoPitch();
  return s;
}

describe("pitch log", () => {
  const s = cpuGame();
  const log = s.pitchLog;

  it("records every pitch with Statcast-range numbers", () => {
    expect(log.length).toBeGreaterThan(150);
    expect(log.map((p) => p.n)).toEqual(log.map((_, i) => i + 1));
    for (const p of log) {
      expect(p.mph).toBeGreaterThan(60);
      expect(p.mph).toBeLessThan(106);
      expect(p.plateMph).toBeLessThan(p.mph);
      expect(p.spinRpm).toBeGreaterThan(400);
      expect(p.spinRpm).toBeLessThan(3600);
      expect(Math.abs(p.ivb)).toBeLessThan(28);
      expect(Math.abs(p.hb)).toBeLessThan(28);
      if (p.whiff) expect(p.swing).toBe(true);
      if (p.ev != null) expect(p.swing).toBe(true);
    }
  });

  it("gives four-seamers ride and sinkers / changeups arm-side run", () => {
    const ff = log.filter((p) => p.type === "FF");
    expect(ff.length).toBeGreaterThan(10);
    const ivb = ff.reduce((a, p) => a + p.ivb, 0) / ff.length;
    expect(ivb).toBeGreaterThan(9);
    expect(ivb).toBeLessThan(22);
    // Arm side is toward first base (+) for a lefty, toward third (−) for a righty.
    const arm = log.filter((p) => p.type === "SI" || p.type === "CH").map((p) => (p.pThrows === "R" ? -p.hb : p.hb));
    if (arm.length > 5) expect(arm.reduce((a, x) => a + x, 0) / arm.length).toBeGreaterThan(5);
  });

  it("numbers plate appearances and ends each with a result", () => {
    const ends = log.filter((p) => p.paResult);
    const pas = new Set(log.map((p) => p.pa));
    expect(ends.length).toBeGreaterThanOrEqual(pas.size - 1);
    for (const p of log) if (p.paPitch === 1) expect(p.balls + p.strikes).toBe(0);
  });

  it("summarises each pitcher's arsenal", () => {
    const ps = pitchersInLog(log);
    expect(ps.length).toBeGreaterThanOrEqual(2);
    const { lines, all } = arsenalSummary(log, ps[0].id);
    expect(all!.n).toBe(ps[0].n);
    expect(lines.reduce((a, l) => a + l.usage, 0)).toBeCloseTo(1, 5);
    for (const l of lines) {
      expect(l.mphMax).toBeGreaterThanOrEqual(l.mph);
      expect(l.mphMin).toBeLessThanOrEqual(l.mph);
      expect(l.cswPct).toBeLessThanOrEqual(1);
    }
  });

  it("is rebuilt identically on replay", () => {
    const r = GameSession.replay(setup, s.inputs, teams);
    expect(r.pitchLog.length).toBe(log.length);
    expect(r.pitchLog[log.length - 1]).toEqual(log[log.length - 1]);
  });

  it("uses the Statcast barrel window", () => {
    expect(isBarrel(97, 28)).toBe(false);
    expect(isBarrel(98, 28)).toBe(true);
    expect(isBarrel(98, 35)).toBe(false);
    expect(isBarrel(110, 15)).toBe(true);
    expect(isBarrel(116, 50)).toBe(true);
  });
});
