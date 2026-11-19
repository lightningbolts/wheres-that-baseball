import { describe, expect, it } from "vitest";
import rosters from "@/data/game/rosters.json";
import { compareSortVals, nextSort, sortRows } from "@/components/game/sort";
import { GameSession, teamsFromRosters, type GameSetup } from "@/lib/game/session/session";
import { battingSide, gameSummary, isSweetSpot, pitchingSide, starterMix } from "@/lib/game/stats/gameSummary";
import type { PitchRecord } from "@/lib/game/stats/pitchLog";
import type { RosterFile } from "@/lib/game/types";

describe("table sorting", () => {
  it("sorts numbers numerically and text alphabetically, both ways", () => {
    expect(sortRows([10, 9, 100, 2], (x) => x, true)).toEqual([2, 9, 10, 100]);
    expect(sortRows([10, 9, 100, 2], (x) => x, false)).toEqual([100, 10, 9, 2]);
    expect(sortRows(["b", "A", "c"], (x) => x, true)).toEqual(["A", "b", "c"]);
    expect(sortRows(["b", "A", "c"], (x) => x, false)).toEqual(["c", "b", "A"]);
  });

  it("keeps missing values last in either direction", () => {
    const rows = [{ v: 3 }, { v: null }, { v: 1 }, { v: Number.NaN }, { v: 2 }, { v: undefined }];
    expect(sortRows(rows, (r) => r.v, true).map((r) => r.v).slice(0, 3)).toEqual([1, 2, 3]);
    expect(sortRows(rows, (r) => r.v, false).map((r) => r.v).slice(0, 3)).toEqual([3, 2, 1]);
    for (const asc of [true, false]) {
      const tail = sortRows(rows, (r) => r.v, asc).slice(3);
      expect(tail.every((r) => r.v == null || Number.isNaN(r.v))).toBe(true);
    }
    expect(compareSortVals("", "a", false)).toBe(1);
  });

  it("is stable and does not mutate the input", () => {
    const rows = [
      { k: 1, id: "a" },
      { k: 0, id: "b" },
      { k: 1, id: "c" },
    ];
    expect(sortRows(rows, (r) => r.k, false).map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("flips the active column and starts a new one in its natural direction", () => {
    expect(nextSort({ key: "ev", asc: false }, "ev", false)).toEqual({ key: "ev", asc: true });
    expect(nextSort({ key: "ev", asc: true }, "name", true)).toEqual({ key: "name", asc: true });
    expect(nextSort({ key: "ev", asc: true }, "k", false)).toEqual({ key: "k", asc: false });
  });
});

const teams = teamsFromRosters(rosters as unknown as RosterFile);
const ids = [...teams.keys()];
const setup: GameSetup = { awayTeamId: ids[3], homeTeamId: ids[11], human: "none", innings: 9, seed: 11, difficulty: "pro", awayStarter: 0, homeStarter: 0 };

describe("game summary", () => {
  const s = new GameSession(setup, teams);
  while (!s.game.final) s.autoPitch();
  const log: PitchRecord[] = s.pitchLog;
  const g = gameSummary(log);

  it("is empty-safe", () => {
    const e = gameSummary([]);
    expect(e.hardestHit).toBeNull();
    expect(e.fastestPitch).toBeNull();
    expect(e.topK).toBeNull();
    expect(e.starters).toEqual([]);
    expect(e.bat.away.evAvg).toBeNull();
    expect(e.pit.home.cswPct).toBeNull();
  });

  it("finds the standout plays", () => {
    const bbe = log.filter((p) => p.inPlay && p.ev != null);
    expect(g.hardestHit?.ev).toBe(Math.max(...bbe.map((p) => p.ev!)));
    expect(g.fastestPitch?.mph).toBe(Math.max(...log.map((p) => p.mph)));
    if (g.longestHr) {
      expect(g.longestHr.hit).toBe(4);
      expect(g.longestBall!.dist!).toBeGreaterThanOrEqual(g.longestHr.dist!);
    }
    if (g.hardLuckOut) {
      expect(g.hardLuckOut.hit).toBe(0);
      const outs = bbe.filter((p) => p.hit === 0 && p.paResult !== "Reached on error");
      expect(g.hardLuckOut.ev).toBe(Math.max(...outs.map((p) => p.ev!)));
    }
    if (g.bloopHit) expect(g.bloopHit.hit).toBeGreaterThan(0);
  });

  it("splits teams by half-inning and adds up", () => {
    expect(g.pit.away.pitches + g.pit.home.pitches).toBe(log.length);
    const ks = log.filter((p) => p.paResult === "Strikeout").length;
    expect(g.pit.away.ks + g.pit.home.ks).toBe(ks);
    expect(g.topK!.ks).toBeLessThanOrEqual(Math.max(g.pit.away.ks, g.pit.home.ks));
    for (const side of ["away", "home"] as const) {
      const b = g.bat[side];
      const mine = log.filter((p) => battingSide(p) === side && p.inPlay && p.ev != null);
      expect(b.bbe).toBe(mine.length);
      expect(b.barrels).toBe(mine.filter((p) => p.barrel).length);
      expect(b.sweetSpotPct).toBeCloseTo(mine.filter((p) => isSweetSpot(p.la!)).length / mine.length, 9);
      expect(b.hardHitPct).toBeGreaterThanOrEqual(0);
      expect(b.hardHitPct).toBeLessThanOrEqual(1);
      const pit = g.pit[side];
      expect(pit.cswPct).toBeGreaterThan(0.1);
      expect(pit.cswPct).toBeLessThan(0.5);
    }
  });

  it("gives each starter's pitch mix", () => {
    expect(g.starters.map((x) => x.side)).toEqual(["away", "home"]);
    for (const st of g.starters) {
      const first = log.find((p) => pitchingSide(p) === st.side)!;
      expect(st.id).toBe(first.pitcherId);
      expect(st.mix.reduce((a, m) => a + m.usage, 0)).toBeCloseTo(1, 9);
      expect(st.mix.reduce((a, m) => a + m.n, 0)).toBe(st.pitches);
      for (let i = 1; i < st.mix.length; i++) expect(st.mix[i - 1].n).toBeGreaterThanOrEqual(st.mix[i].n);
    }
    expect(starterMix([], "home")).toBeNull();
  });
});
