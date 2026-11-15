import { describe, expect, it } from "vitest";
import rosters from "@/data/game/rosters.json";
import { GameSession, teamsFromRosters, type GameSetup } from "@/lib/game/session/session";
import { Rng } from "@/lib/game/math";
import type { RosterFile } from "@/lib/game/types";

const teams = teamsFromRosters(rosters as unknown as RosterFile);
const ids = [...teams.keys()];
const base: GameSetup = { awayTeamId: ids[2], homeTeamId: ids[9], human: "home", innings: 9, seed: 7, difficulty: "pro", awayStarter: 0, homeStarter: 0, manager: true };

/** Human-managed game: plays CPU-quality pitches but makes manager moves along the way. */
function playManaged(s: GameSession, me: Rng) {
  let moves = 0;
  for (let n = 0; n < 2000 && !s.game.final; n += 1) {
    s.prepare();
    const g = s.game;
    const mine = g.home;
    if (s.humanPitching && mine.pitchCount > mine.pitcher.stamina && mine.available.length) {
      if (s.substitute({ kind: "pitcher", side: "home", inId: mine.available[0].id })) moves += 1;
    }
    if (s.humanBatting && g.inning >= 6 && mine.bench.length && me.chance(0.05)) {
      if (s.substitute({ kind: "pinchHit", side: "home", inId: mine.bench[0].id })) moves += 1;
    }
    if (s.humanBatting && g.bases[1] && mine.bench.length && me.chance(0.1)) {
      if (s.substitute({ kind: "pinchRun", side: "home", base: 1, inId: mine.bench[0].id })) moves += 1;
    }
    s.throw({ cpu: false });
    s.swing({ swing: s.humanBatting ? { swing: me.chance(0.45), timingErrMs: me.gauss(0, 25), verticalErrFt: me.gauss(0.02, 0.12), alongErrFt: me.gauss(0, 0.3) } : undefined });
    s.commit();
  }
  return moves;
}

describe("substitutions", () => {
  it("human moves are legal, recorded, and replay to the same game", () => {
    const s = new GameSession(base, teams);
    const moves = playManaged(s, new Rng(3));
    expect(s.game.final).toBe(true);
    expect(moves).toBeGreaterThan(1);
    const home = s.game.home;
    // Nobody appears twice; every slot's current man is its last entry.
    const everyone = home.slots.flat().map((b) => b.id);
    expect(new Set(everyone).size).toBe(everyone.length);
    home.slots.forEach((slot, i) => expect(slot[slot.length - 1].id).toBe(home.lineup[i].id));
    expect(home.staff.length).toBeGreaterThan(1);
    // Nine fielders, one at each position, after all the moves.
    if (!s.game.top) expect(new Set(s.game.fielders().map((f) => f.pos)).size).toBe(9);
    const again = GameSession.replay(base, s.inputs, teams);
    expect(again.game.score).toEqual(s.game.score);
    expect(again.game.home.slots.map((x) => x.map((b) => b.id))).toEqual(home.slots.map((x) => x.map((b) => b.id)));
    expect(again.game.log.map((e) => e.text)).toEqual(s.game.log.map((e) => e.text));
  });

  it("the human runs his own bullpen; the CPU still runs its own", () => {
    const s = new GameSession({ ...base, seed: 11 }, teams);
    while (!s.game.final) s.autoPitch();
    // autoPitch = CPU decisions for the human too, but with managers on his pitchers stay in.
    expect(s.game.home.staff.length).toBe(1);
    expect(s.game.away.staff.length).toBeGreaterThan(1);
  });

  it("CPU managers pinch-hit and pinch-run in late, close games", () => {
    let subs = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const s = new GameSession({ ...base, human: "none", seed, awayTeamId: ids[seed % ids.length], homeTeamId: ids[(seed + 5) % ids.length] }, teams);
      while (!s.game.final) s.autoPitch();
      subs += s.game.log.filter((e) => e.kind === "substitution").length;
      for (const side of [s.game.away, s.game.home]) {
        const all = side.slots.flat().map((b) => b.id);
        expect(new Set(all).size).toBe(all.length);
      }
    }
    expect(subs).toBeGreaterThan(3);
  }, 30_000);

  it("games saved before managers existed replay unchanged (old rules)", () => {
    const old: GameSetup = { ...base, manager: undefined, human: "none" };
    const a = new GameSession(old, teams);
    while (!a.game.final) a.autoPitch();
    expect(a.game.log.some((e) => e.kind === "substitution")).toBe(false);
    const b = GameSession.replay(old, a.inputs, teams);
    expect(b.game.score).toEqual(a.game.score);
  });

  it("illegal moves are refused", () => {
    const s = new GameSession(base, teams);
    s.prepare();
    // Away bats first: home (the human) can't pinch-hit, the away bench isn't his.
    expect(s.substitute({ kind: "pinchHit", side: "home", inId: s.game.home.bench[0].id })).toBeNull();
    expect(s.substitute({ kind: "pitcher", side: "home", inId: s.game.home.available[0].id })).not.toBeNull();
    s.throw({});
    expect(s.substitute({ kind: "pitcher", side: "home", inId: s.game.home.available[0].id })).toBeNull();
  });
});
