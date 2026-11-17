import { describe, expect, it } from "vitest";
import { crowdReaction, crowdRise, crowdVolume, type CrowdInput } from "@/lib/game/crowd/reaction";
import type { PlayResult } from "@/lib/game/play/resolvePlay";
import type { GameEvent, GameEventKind } from "@/lib/game/rules/game";

const ev = (kind: GameEventKind, top: boolean, extra: Partial<GameEvent> = {}): GameEvent => ({ kind, inning: 5, top, text: "", ...extra });
const play = (p: Partial<PlayResult>): PlayResult => ({
  foul: false,
  outs: 0,
  runners: [],
  runs: [],
  hit: 0,
  error: false,
  caught: false,
  fieldedBy: null,
  scoring: "",
  sacFly: false,
  doublePlay: false,
  fieldersChoice: false,
  events: [],
  endT: 0,
  ...p,
});

function input(top: boolean, over: Partial<CrowdInput> = {}): CrowdInput {
  return {
    events: [ev("pitch", top)],
    top,
    inning: 5,
    regulation: 9,
    outsBefore: 0,
    basesBefore: [false, false, false],
    scoreBefore: { away: 2, home: 2 },
    scoreAfter: { away: 2, home: 2 },
    ...over,
  };
}

const homer = (top: boolean) =>
  input(top, {
    events: [ev("in_play", top)],
    play: play({ hit: 4, runs: [1] }),
    scoreAfter: top ? { away: 3, home: 2 } : { away: 2, home: 3 },
  });

describe("crowd reaction", () => {
  it("brings the house down for a home-team homer", () => {
    const r = crowdReaction(homer(false));
    expect(r.home).toBeGreaterThan(0.9);
    expect(r.away).toBe(0);
    expect(r.awayGroan).toBeGreaterThan(0.5);
    expect(r.homeGroan).toBe(0);
  });

  it("gives a visitors' homer a groan from the home crowd, and a small cheer overall", () => {
    const away = crowdReaction(homer(true));
    const home = crowdReaction(homer(false));
    expect(away.away).toBeGreaterThan(0.9);
    expect(away.home).toBe(0);
    expect(away.homeGroan).toBeGreaterThan(0.5);
    // Only the visiting section cheers: far quieter than the same swing by the home team.
    expect(crowdVolume(away)).toBeLessThan(crowdVolume(home) * 0.3);
  });

  it("cheers the home team's defense: a strikeout with runners in scoring position", () => {
    const r = crowdReaction(input(true, { events: [ev("strikeout", true)], basesBefore: [false, true, false], outsBefore: 2 }));
    expect(r.home).toBeGreaterThan(0.3);
    expect(r.away).toBe(0);
  });

  it("stays quiet on routine pitches", () => {
    const r = crowdReaction(input(false));
    expect(r).toEqual({ home: 0, away: 0, homeGroan: 0, awayGroan: 0, why: null });
  });

  it("goes wild for a walk-off and the road fans for a final out", () => {
    const wo = crowdReaction(
      input(false, { inning: 9, events: [ev("in_play", false), ev("game_over", false)], play: play({ hit: 1, runs: [1] }), scoreAfter: { away: 2, home: 3 } }),
    );
    expect(wo.home).toBe(1);
    expect(wo.why).toBe("walk-off");
    const fin = crowdReaction(input(false, { inning: 9, events: [ev("strikeout", false), ev("inning_end", false), ev("game_over", false)], scoreBefore: { away: 3, home: 2 }, scoreAfter: { away: 3, home: 2 } }));
    expect(fin.away).toBe(1);
    expect(fin.homeGroan).toBeGreaterThan(0.8);
  });

  it("damps a blowout", () => {
    const close = crowdReaction(input(false, { events: [ev("in_play", false)], play: play({ hit: 2 }) }));
    const blow = crowdReaction(input(false, { events: [ev("in_play", false)], play: play({ hit: 2 }), scoreBefore: { away: 10, home: 1 }, scoreAfter: { away: 10, home: 1 } }));
    expect(blow.home).toBeLessThan(close.home);
  });

  it("rises on a deep drive for the batting side only", () => {
    expect(crowdRise(105, 28, 380, true).home).toBeGreaterThan(0.5);
    expect(crowdRise(105, 28, 380, false)).toMatchObject({ home: 0 });
    expect(crowdRise(80, -10, 40, true).home).toBe(0);
  });
});

describe("crowd reaction to ABS challenges", () => {
  const absEv = (top: boolean, abs: NonNullable<GameEvent["abs"]>) => ev("abs_challenge", top, { abs });
  it("an overturn to strike three by the home catcher brings the home crowd up and the visitors groan", () => {
    const r = crowdReaction(input(true, { events: [absEv(true, { side: "home", overturned: true, left: 2, by: "catcher", call: "ball", strikeout: true }), ev("strikeout", true)] }));
    expect(r.home).toBeGreaterThan(0.5);
    expect(r.awayGroan).toBeGreaterThan(0);
  });
  it("a road batter's failed challenge gets a cheer from the home fans", () => {
    const r = crowdReaction(input(true, { events: [absEv(true, { side: "away", overturned: false, left: 1, by: "batter", call: "strike" })] }));
    expect(r.home).toBeGreaterThan(0.2);
    expect(r.away).toBe(0);
  });
  it("an overturn to ball four by the home batter is a big moment", () => {
    const r = crowdReaction(input(false, { basesBefore: [true, true, false], events: [absEv(false, { side: "home", overturned: true, left: 2, by: "batter", call: "strike", walk: true }), ev("walk", false)] }));
    expect(r.home).toBeGreaterThan(0.6);
  });
});
