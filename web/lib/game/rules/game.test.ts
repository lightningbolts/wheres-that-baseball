import { describe, expect, it } from "vitest";
import type { PitchResult, PitchResultKind } from "@/lib/game/engine/atBat";
import type { PlayResult } from "@/lib/game/play/resolvePlay";
import { newGame } from "@/lib/game/__fixtures/teams";
import type { BaseballGame } from "@/lib/game/rules/game";
import { legalSteals, stealOptions } from "@/lib/game/ai/baserunning";

const pitch = (kind: PitchResultKind, extra: Partial<PitchResult> = {}) => ({ kind, ...extra }) as PitchResult;
const runner = (id: number) => ({ playerId: id, sprint: 27, chargedTo: 0 });
const loadBases = (g: BaseballGame) => {
  g.bases = [runner(9001), runner(9002), runner(9003)];
};
const walk = (g: BaseballGame) => {
  for (let i = 0; i < 4; i++) g.apply(pitch("ball"));
};
const strikeout = (g: BaseballGame) => {
  for (let i = 0; i < 3; i++) g.apply(pitch("called_strike"));
};

describe("count and plate appearance", () => {
  it("fouls with two strikes don't strike the batter out; foul tips do", () => {
    const g = newGame();
    g.apply(pitch("called_strike"));
    g.apply(pitch("foul"));
    expect(g.strikes).toBe(2);
    for (let i = 0; i < 5; i++) g.apply(pitch("foul"));
    expect(g.strikes).toBe(2);
    expect(g.outs).toBe(0);
    g.apply(pitch("foul_tip"));
    expect(g.outs).toBe(1);
    expect(g.strikes).toBe(0);
  });

  it("a bases-loaded walk forces in exactly one run", () => {
    const g = newGame();
    loadBases(g);
    walk(g);
    expect(g.score.away).toBe(1);
    expect(g.bases.every(Boolean)).toBe(true);
  });

  it("a walk with a runner on second only doesn't move him", () => {
    const g = newGame();
    g.bases = [null, runner(9002), null];
    walk(g);
    expect(g.bases[0]).not.toBeNull();
    expect(g.bases[1]?.playerId).toBe(9002);
    expect(g.bases[2]).toBeNull();
  });

  it("HBP forces like a walk", () => {
    const g = newGame();
    g.bases = [runner(9001), null, runner(9003)];
    g.apply(pitch("hbp"));
    expect(g.bases.map((b) => b?.playerId ?? null).slice(1)).toEqual([9001, 9003]);
    expect(g.score.away).toBe(0);
  });

  it("three outs end the half inning and clear the bases", () => {
    const g = newGame();
    loadBases(g);
    strikeout(g);
    strikeout(g);
    strikeout(g);
    expect(g.top).toBe(false);
    expect(g.inning).toBe(1);
    expect(g.outs).toBe(0);
    expect(g.bases.every((b) => b === null)).toBe(true);
  });
});

describe("baserunning events", () => {
  it("a wild pitch moves every runner up one and scores from third", () => {
    const g = newGame();
    g.bases = [runner(9001), null, runner(9003)];
    g.apply(pitch("ball", { wildPitch: true }));
    expect(g.score.away).toBe(1);
    expect(g.bases.map((b) => b?.playerId ?? null)).toEqual([null, 9001, null]);
    expect(g.balls).toBe(1);
  });

  it("stolen base and caught stealing", () => {
    const g = newGame();
    g.bases = [runner(9001), null, null];
    g.applySteal(true);
    expect(g.bases.map((b) => b?.playerId ?? null)).toEqual([null, 9001, null]);
    g.bases = [runner(9004), null, null];
    g.applySteal(false);
    expect(g.outs).toBe(1);
    expect(g.bases.every((b) => b === null)).toBe(true);
  });

  it("a double steal moves both runners, lead runner first", () => {
    const g = newGame();
    g.bases = [runner(9001), runner(9002), null];
    g.applySteals([
      { from: 1, safe: true },
      { from: 0, safe: true },
    ]);
    expect(g.bases.map((b) => b?.playerId ?? null)).toEqual([null, 9001, 9002]);
    expect(g.outs).toBe(0);
  });

  it("a steal of home scores; the trailer still takes his base when the lead runner is thrown out", () => {
    const g = newGame();
    g.bases = [runner(9001), null, runner(9003)];
    g.applySteals([
      { from: 2, safe: true },
      { from: 0, safe: true },
    ]);
    expect(g.score.away).toBe(1);
    expect(g.bases.map((b) => b?.playerId ?? null)).toEqual([null, 9001, null]);
    const h = newGame();
    h.bases = [runner(9001), runner(9002), null];
    h.applySteals([
      { from: 1, safe: false },
      { from: 0, safe: true },
    ]);
    expect(h.outs).toBe(1);
    expect(h.bases.map((b) => b?.playerId ?? null)).toEqual([null, 9001, null]);
  });

  it("only runners with an open base ahead (or a runner going ahead of them) may steal", () => {
    const b = [runner(1), runner(2), null] as const;
    expect(stealOptions(b)).toEqual([1]);
    expect(legalSteals(b, [0])).toEqual([]);
    expect(legalSteals(b, [0, 1])).toEqual([1, 0]);
    expect(legalSteals([null, null, null], [0])).toEqual([]);
  });

  it("a two-strike foul bunt is strike three", () => {
    const g = newGame();
    g.apply(pitch("called_strike"));
    g.apply(pitch("called_strike"));
    g.apply(pitch("foul", { bunt: true }));
    expect(g.outs).toBe(1);
    const h = newGame();
    h.apply(pitch("called_strike"));
    h.apply(pitch("foul"));
    h.apply(pitch("foul"));
    expect(h.outs).toBe(0);
  });
});

describe("game end", () => {
  const toBottomOf = (g: BaseballGame, inning: number) => {
    while (g.inning < inning || g.top) {
      strikeout(g);
      strikeout(g);
      strikeout(g);
    }
  };

  it("skips the bottom of the 9th when the home team leads", () => {
    const g = newGame();
    toBottomOf(g, 8);
    g.score.home = 2;
    for (let i = 0; i < 3; i++) strikeout(g); // end bottom 8
    for (let i = 0; i < 3; i++) strikeout(g); // end top 9
    expect(g.final).toBe(true);
    expect(g.inning).toBe(9);
  });

  it("walk-off walk ends the game immediately with only the winning run", () => {
    const g = newGame();
    toBottomOf(g, 9);
    loadBases(g);
    walk(g);
    expect(g.final).toBe(true);
    expect(g.score.home - g.score.away).toBe(1);
  });

  it("walk-off hit counts only the winning run (not a homer)", () => {
    const g = newGame();
    toBottomOf(g, 9);
    loadBases(g);
    const play = {
      foul: false,
      outs: 0,
      hit: 2,
      error: false,
      caught: false,
      runs: [9003, 9002, 9001],
      runners: [
        { playerId: 9003, from: 3, to: 4, out: false, t: 2 },
        { playerId: 9002, from: 2, to: 4, out: false, t: 3 },
        { playerId: 9001, from: 1, to: 4, out: false, t: 5 },
        { playerId: g.batter.id, from: 0, to: 2, out: false, t: 6 },
      ],
      sacFly: false,
      doublePlay: false,
      fieldersChoice: false,
      fieldedBy: "LF",
      scoring: "2B7",
      events: [],
      endT: 6,
    } as unknown as PlayResult;
    g.apply(pitch("in_play"), play);
    expect(g.final).toBe(true);
    expect(g.score.home - g.score.away).toBe(1);
  });

  it("extra innings start with a runner on second", () => {
    const g = newGame();
    toBottomOf(g, 9);
    for (let i = 0; i < 3; i++) strikeout(g);
    expect(g.final).toBe(false);
    expect(g.inning).toBe(10);
    expect(g.top).toBe(true);
    expect(g.bases[1]).not.toBeNull();
    expect(g.bases[0]).toBeNull();
  });
});
