import { describe, expect, it } from "vitest";
import rosters from "@/data/game/rosters.json";
import type { RosterFile } from "@/lib/game/types";
import { setGameLogSink, type GameLog } from "./gamelog";
import { createLeague } from "./league";
import { rosterIndex } from "./manual";
import { pitchLogPlayers } from "./pitchReplay";
import { arsenalRates, batRates, pitRates, psLookup, seasonStatcastFromLogs } from "./seasonStatcast";
import { simUntil } from "./season";

const file = rosters as unknown as RosterFile;

describe("season Statcast leaderboards", () => {
  const league = createLeague(file, { userTeam: 147, seed: 5 });
  const logs: GameLog[] = [];
  setGameLogSink((l) => logs.push(l));
  simUntil(league, "season", { maxDays: 8 });
  setGameLogSink(null);
  const who = pitchLogPlayers(league.players, rosterIndex(file));
  const sc = seasonStatcastFromLogs(logs, who, (l) => !psLookup(league, league.season)(l));

  it("folds every game's pitches together, matching the season's stat lines", () => {
    expect(sc.games).toBe(logs.length);
    let hr = 0;
    let so = 0;
    for (const p of Object.values(league.players)) {
      hr += p.stats.bat?.hr ?? 0;
      so += p.stats.pit?.k ?? 0;
    }
    const scK = [...sc.pit.values()].reduce((a, p) => a + p.ks, 0);
    const scHrs = [...sc.bat.values()].reduce((a, b) => a + b.hrs, 0);
    expect(scK).toBe(so);
    expect(scHrs).toBe(hr);
    // Pitchers' pitch totals add up to every tracked pitch, as do the arsenals.
    expect([...sc.pit.values()].reduce((a, p) => a + p.pitches, 0)).toBe(sc.pitches);
    expect([...sc.arsenal.values()].reduce((a, x) => a + x.n, 0)).toBe(sc.pitches);
    for (const p of sc.pit.values()) {
      const shares = [...sc.arsenal.values()].filter((a) => a.id === p.id).reduce((a, x) => a + x.usage, 0);
      expect(shares).toBeCloseTo(1, 6);
    }
  });

  it("produces believable leaderboards and sorted standout lists", () => {
    const bats = [...sc.bat.values()].filter((b) => b.bbe >= 15).map(batRates);
    expect(bats.length).toBeGreaterThan(50);
    const evs = bats.map((b) => b.ev!);
    expect(Math.max(...evs)).toBeLessThan(100);
    expect(Math.min(...evs)).toBeGreaterThan(75);
    const pits = [...sc.pit.values()].filter((p) => p.pitches >= 150).map(pitRates);
    for (const p of pits) {
      expect(p.cswPct!).toBeGreaterThan(0.15);
      expect(p.cswPct!).toBeLessThan(0.45);
      if (p.fbVelo != null) {
        expect(p.fbVelo).toBeGreaterThan(84);
        expect(p.fbVelo).toBeLessThan(102);
      }
    }
    for (const a of sc.arsenal.values()) if (a.n >= 50 && a.type === "FF") expect(arsenalRates(a).ivb).toBeGreaterThan(8);
    for (const list of [sc.hardestHit.map((m) => m.p.ev!), sc.longestHr.map((m) => m.p.dist!), sc.fastest.map((m) => m.p.mph)]) {
      expect(list.length).toBeGreaterThan(0);
      expect(list.length).toBeLessThanOrEqual(25);
      for (let i = 1; i < list.length; i += 1) expect(list[i]).toBeLessThanOrEqual(list[i - 1]);
    }
    expect(sc.hardestHit[0].p.ev!).toBeGreaterThan(108);
    // The tails taper off rather than piling up at a cap.
    expect(sc.hardestHit[0].p.ev!).toBeLessThan(121);
    expect(new Set(sc.hardestHit.map((m) => m.p.ev)).size).toBeGreaterThan(10);
    expect(sc.fastest[0].p.mph).toBeLessThan(106);
    expect(sc.longestHr[0].p.dist!).toBeLessThan(490);
    expect(new Set(sc.longestHr.map((m) => m.p.dist)).size).toBeGreaterThan(10);
  });
});
