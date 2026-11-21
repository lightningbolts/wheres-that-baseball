import { describe, expect, it } from "vitest";
import rosters from "@/data/game/rosters.json";
import type { RosterFile } from "@/lib/game/types";
import { setGameLogSink, type GameLog } from "./gamelog";
import { createLeague } from "./league";
import { rosterIndex } from "./manual";
import { simPitchLog, type PitchLogPlayer } from "./pitchReplay";
import { simUntil } from "./season";

const file = rosters as unknown as RosterFile;

function simmedLogs(days: number): { logs: GameLog[]; who: (id: number) => PitchLogPlayer } {
  const league = createLeague(file, { userTeam: 147, seed: 11 });
  const logs: GameLog[] = [];
  setGameLogSink((l) => logs.push(l));
  simUntil(league, "season", { maxDays: days });
  setGameLogSink(null);
  const idx = rosterIndex(file);
  const who = (id: number): PitchLogPlayer => {
    const p = league.players[id];
    const t = p ? ((p.template != null ? idx.get(p.template) : undefined) ?? idx.get(p.id)) : idx.get(id);
    return {
      name: p?.name ?? t?.name ?? `#${id}`,
      throws: p?.throws ?? t?.throws ?? "R",
      bats: p?.bats ?? t?.bats ?? "R",
      arsenal: t?.pitch?.arsenal,
      stamina: t?.pitch?.stamina,
      zone: t?.zone,
      evMean: t?.bat?.evMean,
      laMean: t?.bat?.laMean,
    };
  };
  return { logs, who };
}

describe("simmed games' pitch-by-pitch logs", () => {
  const { logs, who } = simmedLogs(4);

  it("replays every plate appearance with the box score's pitch counts and results", () => {
    expect(logs.length).toBeGreaterThan(20);
    for (const log of logs) {
      const r = simPitchLog(log, who)!;
      expect(r).not.toBeNull();
      // Every pitcher threw exactly what the box score says.
      const thrown = new Map<number, number>();
      for (const p of r.pitches) thrown.set(p.pitcherId, (thrown.get(p.pitcherId) ?? 0) + 1);
      for (const side of log.box) for (const pit of side.pit) expect(thrown.get(pit[0]) ?? 0).toBe(pit[8]);
      // Strikeouts and walks match the box, and every at-bat ends on its last pitch only.
      const ks = r.pitches.filter((p) => p.paResult === "Strikeout").length;
      const bbs = r.pitches.filter((p) => p.paResult === "Walk").length;
      const hrs = r.pitches.filter((p) => p.paResult === "Home run").length;
      const box = log.box.flatMap((s) => s.pit);
      expect(ks).toBe(box.reduce((a, x) => a + x[6], 0));
      expect(bbs).toBe(box.reduce((a, x) => a + x[5], 0));
      expect(hrs).toBe(box.reduce((a, x) => a + x[7], 0));
      for (const p of r.pitches) {
        expect(p.balls).toBeLessThanOrEqual(3);
        expect(p.strikes).toBeLessThanOrEqual(2);
        if (p.paResult === "Strikeout") expect(p.strikes).toBe(2);
        if (p.paResult === "Walk") expect(p.balls).toBe(3);
        if (p.paResult == null) expect(p.inPlay || p.result === "hbp").toBe(false);
        if (p.paResult === "Home run") {
          expect(p.ev!).toBeGreaterThanOrEqual(95);
          expect(p.dist!).toBeGreaterThanOrEqual(330);
        }
        expect(p.mph).toBeGreaterThan(55);
        expect(p.mph).toBeLessThan(106);
      }
      expect(r.paOfPlay.length).toBe(log.plays!.length);
    }
  });

  it("matches the box's pitch counts for older logs without per-play counts", () => {
    for (const log of logs.slice(0, 10)) {
      const r = simPitchLog({ ...log, pc: undefined }, who)!;
      const thrown = new Map<number, number>();
      for (const p of r.pitches) thrown.set(p.pitcherId, (thrown.get(p.pitcherId) ?? 0) + 1);
      for (const side of log.box) for (const pit of side.pit) expect(thrown.get(pit[0]) ?? 0).toBe(pit[8]);
    }
  });

  it("is deterministic and looks like Statcast in aggregate", () => {
    const a = simPitchLog(logs[0], who)!;
    const b = simPitchLog(logs[0], who)!;
    expect(b.pitches).toEqual(a.pitches);
    const all = logs.flatMap((l) => simPitchLog(l, who)!.pitches);
    const perGame = all.length / logs.length;
    const zone = all.filter((p) => p.inZone).length / all.length;
    const swings = all.filter((p) => p.swing);
    const whiff = swings.filter((p) => p.whiff).length / swings.length;
    const bbe = all.filter((p) => p.inPlay);
    const ev = bbe.reduce((s, p) => s + p.ev!, 0) / bbe.length;
    const hard = bbe.filter((p) => p.hardHit).length / bbe.length;
    const ff = all.filter((p) => p.type === "FF");
    const ffIvb = ff.reduce((s, p) => s + p.ivb, 0) / ff.length;
    const out = all.filter((p) => !p.inZone);
    const chase = out.filter((p) => p.swing).length / out.length;
    console.log({ perGame, zone, whiff, ev, hard, ffIvb, chase, swing: swings.length / all.length });
    expect(chase).toBeGreaterThan(0.2);
    expect(chase).toBeLessThan(0.36);
    expect(perGame).toBeGreaterThan(250);
    expect(perGame).toBeLessThan(330);
    expect(zone).toBeGreaterThan(0.4);
    expect(zone).toBeLessThan(0.6);
    expect(whiff).toBeGreaterThan(0.18);
    expect(whiff).toBeLessThan(0.32);
    expect(ev).toBeGreaterThan(85);
    expect(ev).toBeLessThan(92);
    expect(hard).toBeGreaterThan(0.3);
    expect(hard).toBeLessThan(0.5);
    expect(ffIvb).toBeGreaterThan(12);
    expect(ffIvb).toBeLessThan(20);
  });
});
