import { describe, expect, it } from "vitest";
import rosters from "@/data/game/rosters.json";
import { GameSession, teamsFromRosters, type GameSetup } from "@/lib/game/session/session";
import { newGame } from "@/lib/game/__fixtures/teams";
import { cpuPickoff, pickoffChance, pickoffOutcome, pickoffTargets, type PickoffOutcome } from "@/lib/game/ai/pickoff";
import { buildPickoffTimeline } from "@/lib/game/anim/pickoff";
import { Rng } from "@/lib/game/math";
import type { RosterFile } from "@/lib/game/types";
import type { BaseballGame, Runner } from "@/lib/game/rules/game";

const teams = teamsFromRosters(rosters as unknown as RosterFile);
const ids = [...teams.keys()];
const runner = (g: BaseballGame, slot: number): Runner => {
  const b = g.batting.lineup[slot];
  return { playerId: b.id, sprint: b.sprint, chargedTo: g.fielding.pitcher.id };
};

describe("pickoff rules", () => {
  it("throws only to a runner whose next base is open", () => {
    const g = newGame();
    expect(pickoffTargets(g.bases)).toEqual([]);
    g.bases = [runner(g, 3), null, null];
    expect(pickoffTargets(g.bases)).toEqual([0]);
    g.bases = [runner(g, 3), runner(g, 4), null];
    expect(pickoffTargets(g.bases)).toEqual([1]);
    g.bases = [runner(g, 3), runner(g, 4), runner(g, 5)];
    expect(pickoffTargets(g.bases)).toEqual([]);
  });

  it("a pickoff is an out that takes the runner off the bases; the count stands", () => {
    const g = newGame();
    g.bases = [runner(g, 3), null, null];
    g.balls = 2;
    const ev = g.applyPickoff(0, "out");
    expect(ev[0].kind).toBe("picked_off");
    expect(g.outs).toBe(1);
    expect(g.bases[0]).toBeNull();
    expect(g.balls).toBe(2);
  });

  it("a third throw-over that doesn't get him is a balk: everybody moves up", () => {
    const g = newGame();
    g.bases = [runner(g, 3), null, runner(g, 5)];
    g.applyPickoff(0, "safe");
    g.applyPickoff(0, "safe");
    expect(g.disengagements).toBe(2);
    expect(pickoffChance(g, 0)).toBe(0);
    const ev = g.applyPickoff(0, "safe");
    expect(ev.some((e) => e.kind === "balk")).toBe(true);
    expect(g.bases[0]).toBeNull();
    expect(g.bases[1]).not.toBeNull();
    expect(g.score.away).toBe(1);
    expect(g.disengagements).toBe(0);
  });

  it("a rundown that breaks down puts him on the next base; a wild throw moves everyone", () => {
    const g = newGame();
    g.bases = [runner(g, 3), null, null];
    g.applyPickoff(0, "rundown_safe");
    expect(g.bases[0]).toBeNull();
    expect(g.bases[1]).not.toBeNull();
    expect(g.outs).toBe(0);
    g.bases = [runner(g, 4), runner(g, 3), null];
    g.applyPickoff(1, "error");
    expect(g.bases[1]).not.toBeNull();
    expect(g.bases[2]).not.toBeNull();
  });

  it("the CPU decision and outcome are pure functions of the game state", () => {
    const g = newGame();
    g.bases = [runner(g, 0), null, null];
    let throws = 0;
    const seen = new Set<PickoffOutcome>();
    for (let pc = 0; pc < 4000; pc += 1) {
      g.fielding.pitchCount = pc;
      const a = cpuPickoff(g);
      expect(cpuPickoff(g)).toBe(a);
      if (a != null) {
        throws += 1;
        seen.add(pickoffOutcome(g, a));
      }
    }
    // A few percent of pitches with a runner on first draw a throw.
    expect(throws / 4000).toBeGreaterThan(0.02);
    expect(throws / 4000).toBeLessThan(0.15);
    expect(seen.has("safe")).toBe(true);
  });
});

describe("pickoffs in a session", () => {
  const setup: GameSetup = { awayTeamId: ids[2], homeTeamId: ids[7], human: "none", innings: 9, seed: 77, difficulty: "pro", awayStarter: 0, homeStarter: 1, pickoffs: true };

  it("CPU throw-overs are recorded and replay to the identical game", () => {
    const s = new GameSession(setup, teams);
    while (!s.game.final) s.simHalfInning();
    const throws = s.inputs.filter((i) => i.pickoff !== undefined).length;
    expect(throws).toBeGreaterThan(0);
    const r = GameSession.replay(setup, s.inputs, teams);
    expect(r.game.score).toEqual(s.game.score);
    expect(r.game.log.map((e) => e.text)).toEqual(s.game.log.map((e) => e.text));
    // Old saves (no flag) replay any recorded throw-over too.
    const legacy = GameSession.replay({ ...setup, pickoffs: undefined }, s.inputs, teams);
    expect(legacy.game.log.length).toBe(s.game.log.length);
  });

  it("a human pitcher can throw over, and it's its own replayable step", () => {
    const s = new GameSession({ ...setup, human: "home", pickoffs: true }, teams);
    const me = new Rng(3);
    let made = 0;
    while (!s.game.final && made < 3) {
      s.prepare();
      if (s.humanPitching && s.pickoffTargets.length && me.chance(0.5)) {
        const k = s.pickoff(s.pickoffTargets[0]);
        expect(k?.human).toBe(true);
        made += 1;
        continue;
      }
      s.throw({});
      s.swing({});
      s.commit();
    }
    expect(made).toBe(3);
    const r = GameSession.replay(s.setup, s.inputs, teams);
    expect(r.game.log.map((e) => e.text)).toEqual(s.game.log.map((e) => e.text));
  });

  it("every outcome stages a finite animation that ends after the call", () => {
    const s = new GameSession({ ...setup, human: "home" }, teams);
    while (!(s.prepare(), s.humanPitching && s.pickoffTargets.includes(0))) {
      s.throw({});
      s.swing({});
      s.commit();
    }
    const k = s.pickoff(0)!;
    for (const outcome of ["safe", "out", "rundown_out", "rundown_safe", "error"] as const) {
      const tl = buildPickoffTimeline({ ...k, outcome });
      expect(tl.callT).toBeLessThan(tl.endT);
      for (let T = 0; T <= tl.endT; T += 0.1) {
        const b = tl.ball(T);
        expect(Number.isFinite(b.p.x + b.p.y + b.p.z)).toBe(true);
        for (const id of tl.runnerIds) {
          const st = tl.runner(id, T)!;
          expect(Number.isFinite(st.p.x + st.p.z)).toBe(true);
          expect(st.speed).toBeLessThan(40);
        }
      }
    }
  });
});
