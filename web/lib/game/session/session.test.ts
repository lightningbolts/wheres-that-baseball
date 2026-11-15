import { describe, expect, it } from "vitest";
import rosters from "@/data/game/rosters.json";
import { GameSession, teamsFromRosters, type GameSetup } from "@/lib/game/session/session";
import { Rng } from "@/lib/game/math";
import type { RosterFile } from "@/lib/game/types";

const teams = teamsFromRosters(rosters as unknown as RosterFile);
const ids = [...teams.keys()];
const setup: GameSetup = { awayTeamId: ids[0], homeTeamId: ids[5], human: "home", innings: 9, seed: 42, difficulty: "pro", awayStarter: 0, homeStarter: 1 };

/** A scripted "human": random pitch choices, swings and throw choices from its own RNG. */
function playScripted(s: GameSession, maxPitches = 1500) {
  const me = new Rng(9);
  let n = 0;
  while (!s.game.final && n++ < maxPitches) {
    const { ctx } = s.prepare();
    if (n % 40 === 0) {
      s.simHalfInning();
      continue;
    }
    s.throw({
      pitch: s.humanPitching
        ? { pitchIdx: Math.floor(me.next() * ctx.pitcher.arsenal.length), targetPx: me.range(-0.9, 0.9), targetPz: me.range(1.4, 3.6), commandMult: me.range(0.7, 1.6) }
        : undefined,
      steal: s.humanBatting && me.chance(0.05),
    });
    const o = s.swing({
      swing: s.humanBatting
        ? { swing: me.chance(0.5), timingErrMs: me.gauss(0, 30), verticalErrFt: me.gauss(0.02, 0.12), alongErrFt: me.gauss(0, 0.3) }
        : undefined,
    });
    const pick = o.throwPrompt && me.chance(0.6) ? (me.chance(0.2) ? null : o.throwPrompt.options[0].base) : undefined;
    s.commit(pick);
  }
}

describe("GameSession", () => {
  it("plays a full human-vs-CPU game to a legal finish", () => {
    const s = new GameSession(setup, teams);
    playScripted(s);
    expect(s.game.final).toBe(true);
    expect(s.game.score.home).not.toBe(s.game.score.away);
  });

  it("replaying the recorded inputs reproduces the game exactly", () => {
    const s = new GameSession(setup, teams);
    playScripted(s);
    const saved = JSON.parse(JSON.stringify(s.inputs));
    const r = GameSession.replay(setup, saved, teams);
    expect(r.game.score).toEqual(s.game.score);
    expect(r.game.log.map((e) => e.text)).toEqual(s.game.log.map((e) => e.text));
  });

  it("CPU-vs-CPU spectating works and partial replays resume mid-game", () => {
    const spectate: GameSetup = { ...setup, human: "none", seed: 5 };
    const s = new GameSession(spectate, teams);
    for (let i = 0; i < 120; i++) s.autoPitch();
    const r = GameSession.replay(spectate, s.inputs, teams);
    expect([r.game.inning, r.game.top, r.game.outs, r.game.balls, r.game.strikes]).toEqual([s.game.inning, s.game.top, s.game.outs, s.game.balls, s.game.strikes]);
  });
});
