import { describe, expect, it } from "vitest";
import rosters from "@/data/game/rosters.json";
import { callIsWrong, challengeableCall, cpuWantsChallenge, edgeDistance, overturned, type ChallengeSituation } from "@/lib/game/rules/abs";
import { GameSession, teamsFromRosters, type GameSetup } from "@/lib/game/session/session";
import { BaseballGame } from "@/lib/game/rules/game";
import { simulateGame } from "@/lib/game/engine/sim";
import { CPU } from "@/lib/game/ai/cpu";
import { buildPark, homeVenueForTeam } from "@/lib/game/physics/park";
import { Rng } from "@/lib/game/math";
import { PLATE_HALF_WIDTH } from "@/lib/game/physics/pitch";
import { BALL_RADIUS_FT } from "@/lib/game/physics/ballFlight";
import type { PitchResult } from "@/lib/game/engine/atBat";
import type { RosterFile } from "@/lib/game/types";

const teams = teamsFromRosters(rosters as unknown as RosterFile);
const ids = [...teams.keys()];
const EDGE = PLATE_HALF_WIDTH + BALL_RADIUS_FT;

const called = (kind: "ball" | "called_strike", px: number, pz: number, inZone: boolean): PitchResult =>
  ({ kind, inZone, flight: { px, pz }, decision: {}, swing: { swing: false } }) as unknown as PitchResult;

const sit = (result: PitchResult, o: Partial<ChallengeSituation> = {}): ChallengeSituation => ({
  result,
  zoneBottom: 1.6,
  zoneTop: 3.4,
  balls: 1,
  strikes: 1,
  outs: 1,
  inning: 5,
  regulation: 9,
  left: 2,
  runnersOn: 0,
  margin: 0,
  ...o,
});

describe("ABS rules", () => {
  it("only called balls and strikes can be challenged, by the right club", () => {
    expect(challengeableCall({ kind: "called_strike" })).toBe("offense");
    expect(challengeableCall({ kind: "ball" })).toBe("defense");
    expect(challengeableCall({ kind: "ball", wildPitch: true })).toBeNull();
    expect(challengeableCall({ kind: "swinging_strike" })).toBeNull();
    expect(challengeableCall({ kind: "foul" })).toBeNull();
  });

  it("the automated zone is the truth", () => {
    expect(callIsWrong(called("called_strike", EDGE + 0.2, 2.5, false))).toBe(true);
    expect(callIsWrong(called("ball", 0, 2.5, true))).toBe(true);
    expect(callIsWrong(called("ball", EDGE + 0.2, 2.5, false))).toBe(false);
    expect(overturned(called("called_strike", EDGE + 0.2, 2.5, false)).kind).toBe("ball");
    expect(overturned(called("ball", 0, 2.5, true)).kind).toBe("called_strike");
  });

  it("measures distance from the edge of the zone", () => {
    expect(edgeDistance({ px: EDGE + 0.1, pz: 2.5 }, 1.6, 3.4)).toBeCloseTo(0.1, 5);
    expect(edgeDistance({ px: 0, pz: 2.5 }, 1.6, 3.4)).toBeLessThan(-0.5);
  });

  it("the CPU challenges clear misses, not close calls early in the game, and never without a challenge left", () => {
    const clearMiss = called("called_strike", EDGE + 0.3, 2.5, false);
    expect(cpuWantsChallenge(sit(clearMiss))).toBe(true);
    expect(cpuWantsChallenge(sit(clearMiss, { left: 0 }))).toBe(false);
    const deep = called("called_strike", 0, 2.5, true);
    expect(cpuWantsChallenge(sit(deep))).toBe(false);
    const hair = called("called_strike", EDGE + 0.01, 2.5, false);
    expect(cpuWantsChallenge(sit(hair, { inning: 1, balls: 0, strikes: 0 }))).toBe(false);
    // A strike that is clearly in, called a ball, with ball four on the line.
    const missedStrike = called("ball", EDGE - 0.25, 2.5, true);
    expect(cpuWantsChallenge(sit(missedStrike, { balls: 3 }))).toBe(true);
  });

  it("keeps a winning challenge, spends a losing one, and refills in extra innings", () => {
    const g = new BaseballGame(teams.get(ids[0])!, teams.get(ids[1])!, buildPark(homeVenueForTeam(ids[1])), { abs: true });
    expect(g.abs).toEqual({ away: 2, home: 2 });
    // Top of the 1st: the away club bats and may challenge a called strike.
    const win = g.absChallenge(called("called_strike", EDGE + 0.3, 2.5, false));
    expect(win?.result.kind).toBe("ball");
    expect(win?.event.abs).toEqual({ side: "away", overturned: true, left: 2 });
    const lose = g.absChallenge(called("called_strike", 0, 2.5, true));
    expect(lose?.result.kind).toBe("called_strike");
    expect(g.abs!.away).toBe(1);
    // The fielding club challenges balls.
    const def = g.absChallenge(called("ball", 0, 2.5, true));
    expect(def?.event.abs?.side).toBe("home");
    g.abs!.away = 0;
    expect(g.absChallenger({ kind: "called_strike" })).toBeNull();
    expect(new BaseballGame(teams.get(ids[0])!, teams.get(ids[1])!, buildPark(homeVenueForTeam(ids[1]))).absChallenger({ kind: "called_strike" })).toBeNull();
  });

  it("CPU-vs-CPU games with ABS see a sane number of challenges, mostly won", () => {
    let reviews = 0;
    let wins = 0;
    for (let i = 0; i < 6; i += 1) {
      const g = new BaseballGame(teams.get(ids[i])!, teams.get(ids[i + 10])!, buildPark(homeVenueForTeam(ids[i + 10])), { abs: true });
      simulateGame(g, { away: CPU, home: CPU }, new Rng(100 + i));
      expect(g.final).toBe(true);
      const ev = g.log.filter((e) => e.kind === "abs_challenge");
      reviews += ev.length;
      wins += ev.filter((e) => e.abs?.overturned).length;
      expect(g.abs!.away).toBeGreaterThanOrEqual(0);
      expect(g.abs!.home).toBeGreaterThanOrEqual(0);
    }
    // MLB's spring trials: a few challenges a game, roughly half or more overturned.
    expect(reviews / 6).toBeGreaterThan(0.5);
    expect(reviews / 6).toBeLessThan(8);
    expect(wins / Math.max(1, reviews)).toBeGreaterThan(0.4);
  });

  it("session games without ABS are unchanged; with ABS they replay exactly", () => {
    const base: GameSetup = { awayTeamId: ids[2], homeTeamId: ids[9], human: "none", innings: 9, seed: 77, difficulty: "pro", awayStarter: 0, homeStarter: 1 };
    const a = new GameSession(base, teams);
    while (!a.game.final) a.autoPitch();
    expect(a.game.log.some((e) => e.kind === "abs_challenge")).toBe(false);
    const withAbs = new GameSession({ ...base, abs: true }, teams);
    while (!withAbs.game.final) withAbs.autoPitch();
    const again = GameSession.replay({ ...base, abs: true }, withAbs.inputs, teams);
    expect(again.game.score).toEqual(withAbs.game.score);
    expect(again.game.log.length).toBe(withAbs.game.log.length);
  });
});
