import { describe, expect, it } from "vitest";
import rosters from "@/data/game/rosters.json";
import type { RosterFile } from "@/lib/game/types";
import { setGameLogSink, type GameLog } from "./gamelog";
import { createLeague } from "./league";
import { rosterIndex } from "./manual";
import { pitchLogPlayers } from "./pitchReplay";
import { arsenalRates, batRates, logsSignature, pitRates, psLookup, REGULAR_SEASON_GAMES, seasonStatcastFromLogs } from "./seasonStatcast";
import { startOffseason } from "./offseason";
import { battingRows } from "./statline";
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

  it("keeps each club's own top plays, matching the league-wide lists", () => {
    const merged = [...sc.team.values()].flatMap((t) => t.hardestHit).sort((a, b) => b.p.ev! - a.p.ev!).slice(0, 25);
    expect(merged.map((m) => m.p.ev)).toEqual(sc.hardestHit.map((m) => m.p.ev));
    for (const [tid, t] of sc.team) {
      for (const m of t.hardestHit) expect(m.p.top ? m.away : m.home).toBe(tid);
      for (const m of t.fastest) expect(m.p.top ? m.home : m.away).toBe(tid);
    }
  });

  it("tells franchises apart even when they played the same scheduled games", () => {
    const other = createLeague(file, { userTeam: 147, seed: 6 });
    const logs2: GameLog[] = [];
    setGameLogSink((l) => logs2.push(l));
    simUntil(other, "season", { maxDays: 2 });
    setGameLogSink(null);
    const mine = logs.filter((l) => logs2.some((x) => x.id === l.id));
    const theirs = logs2.filter((l) => mine.some((x) => x.id === l.id));
    expect(mine.length).toBeGreaterThan(10);
    expect(logsSignature(mine)).not.toBe(logsSignature(theirs));
    expect(logsSignature(mine)).toBe(logsSignature([...mine]));
  });

  it("splits older logs without a postseason flag by game number", () => {
    const past = psLookup(league, league.season - 1);
    const base = logs[0];
    expect(past({ ...base, ps: undefined, id: REGULAR_SEASON_GAMES })).toBe(false);
    expect(past({ ...base, ps: undefined, id: REGULAR_SEASON_GAMES + 1 })).toBe(true);
    expect(past({ ...base, ps: false, id: REGULAR_SEASON_GAMES + 1 })).toBe(false);
    expect(psLookup(league, league.season)({ ...base, ps: undefined })).toBe(false);
  });
});

describe("season stat lines after the offseason begins", () => {
  it("reads the finished season from the archive", () => {
    const league = createLeague(file, { userTeam: 147, seed: 9 });
    simUntil(league, "season", { maxDays: 3 });
    const before = battingRows(league, league.season).length;
    expect(before).toBeGreaterThan(100);
    league.phase = "offseason";
    startOffseason(league);
    expect(battingRows(league, league.season).length).toBe(before);
  });
});
