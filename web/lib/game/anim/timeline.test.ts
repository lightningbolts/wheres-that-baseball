import { describe, expect, it } from "vitest";
import rosters from "@/data/game/rosters.json";
import { GameSession, teamsFromRosters } from "@/lib/game/session/session";
import { buildTimeline, basePathPoint, BATTER_HANDOFF_S, MAX_RUN_FT_S, SMOOTH_H, outPlayEnd, OUT_HOLD_S } from "@/lib/game/anim/timeline";
import { BASE_POS } from "@/lib/game/play/movement";
import { FIELD_POSITIONS, type RosterFile } from "@/lib/game/types";

const teams = teamsFromRosters(rosters as unknown as RosterFile);
const ids = [...teams.keys()];

describe("animation timeline", () => {
  it("base path walks the diamond", () => {
    expect(basePathPoint(0)).toEqual(BASE_POS[4]);
    expect(basePathPoint(90).x).toBeCloseTo(BASE_POS[1].x);
    expect(basePathPoint(360).z).toBeCloseTo(0);
  });

  it("every pitch of a full game animates with finite positions and runners end where the rules put them", () => {
    const s = new GameSession({ awayTeamId: ids[2], homeTeamId: ids[9], human: "none", innings: 9, seed: 11, difficulty: "pro", awayStarter: 0, homeStarter: 0 }, teams);
    let plays = 0;
    while (!s.game.final) {
      const c = s.autoPitch();
      const tl = buildTimeline(c);
      expect(tl.endT).toBeGreaterThan(tl.releaseT);
      for (let T = tl.releaseT; T <= tl.endT; T += 0.25) {
        const b = tl.ball(T).p;
        expect(Number.isFinite(b.x + b.y + b.z)).toBe(true);
        for (const pos of FIELD_POSITIONS) {
          const f = tl.fielder(pos, T).p;
          expect(Number.isFinite(f.x + f.z)).toBe(true);
        }
      }
      // A third out ends the play on the spot: runners still moving don't matter.
      if (tl.inPlay && c.play && !c.events.some((e) => e.kind === "inning_end" || e.kind === "game_over")) {
        plays++;
        for (const ro of c.play.runners) {
          if (ro.out || ro.to === 4) continue;
          const end = tl.runner(ro.playerId, tl.endT - 0.01);
          expect(end, `runner ${ro.from}->${ro.to}`).not.toBeNull();
          const bp = BASE_POS[ro.to];
          expect(Math.hypot(end!.p.x - bp.x, end!.p.z - bp.z)).toBeLessThan(3);
        }
      }
    }
    expect(plays).toBeGreaterThan(30);
  });

  it("nobody teleports or changes speed instantly: motion is eased through every waypoint", () => {
    const s = new GameSession({ awayTeamId: ids[4], homeTeamId: ids[12], human: "none", innings: 9, seed: 29, difficulty: "pro", awayStarter: 0, homeStarter: 0 }, teams);
    const dt = 1 / 60;
    // Legs are capped at MAX_RUN_FT_S; a ±SMOOTH_H box filter bounds acceleration by Δv / 2h.
    const maxStep = (MAX_RUN_FT_S + 1) * dt;
    const maxDv = (MAX_RUN_FT_S / (2 * SMOOTH_H)) * dt * 1.5 + 0.2;
    let checked = 0;
    let plays = 0;
    while (!s.game.final && plays < 40) {
      const c = s.autoPitch();
      const tl = buildTimeline(c);
      if (!tl.inPlay || tl.contactT == null) continue;
      plays += 1;
      const end = Math.min(tl.endT, tl.contactT + 14);
      const track = (get: (T: number) => { p: { x: number; z: number }; speed: number } | null, from: number, label: string) => {
        let prev = get(from);
        for (let T = from + dt; T <= end; T += dt) {
          const cur = get(T);
          if (prev && cur) {
            expect(Math.hypot(cur.p.x - prev.p.x, cur.p.z - prev.p.z), `${label} step @${T.toFixed(2)}`).toBeLessThan(maxStep);
            expect(Math.abs(cur.speed - prev.speed), `${label} accel @${T.toFixed(2)}`).toBeLessThan(maxDv);
            checked += 1;
          }
          prev = cur;
        }
      };
      for (const pos of FIELD_POSITIONS) track((T) => tl.fielder(pos, T), tl.releaseT - 1.5, pos);
      for (const id of tl.runnerIds) track((T) => tl.runner(id, T), tl.releaseT - 1.5, `runner ${id}`);
      // The batter becomes the batter-runner at one instant, at the same spot: never both, never neither.
      const handoff = tl.contactT + BATTER_HANDOFF_S;
      const before = tl.batter(handoff - 0.01);
      const after = tl.runner(tl.batterId, handoff + 0.01);
      expect(before).not.toBeNull();
      expect(tl.runner(tl.batterId, handoff - 0.01)).toBeNull();
      expect(tl.batter(handoff + 0.01)).toBeNull();
      expect(after).not.toBeNull();
      expect(Math.hypot(after!.p.x - before!.p.x, after!.p.z - before!.p.z)).toBeLessThan(3.5); // the renderer glides this last step out
    }
    expect(plays).toBeGreaterThan(20);
    expect(checked).toBeGreaterThan(10000);
  });

  it("a human swing launches at the button press and the barrel arrives at contact", () => {
    const s = new GameSession({ awayTeamId: ids[1], homeTeamId: ids[5], human: "none", innings: 9, seed: 5, difficulty: "pro", awayStarter: 0, homeStarter: 0 }, teams);
    let swings = 0;
    while (!s.game.final && swings < 25) {
      const c = s.autoPitch();
      const auto = buildTimeline(c);
      if (auto.swingT == null) {
        expect(auto.swing).toBeNull();
        continue;
      }
      swings += 1;
      expect(auto.swing!.contactT).toBeCloseTo(auto.swingT);
      expect(auto.swing!.startT).toBeLessThan(auto.swing!.contactT);
      const press = auto.swingT - 0.11;
      const human = buildTimeline(c, { swingStartT: press });
      expect(human.swing!.startT).toBeCloseTo(press);
      expect(human.batter(press - 0.01)!.action).toBe("stance");
      const st = human.batter(press + 0.02)!;
      expect(st.action).toBe("swing");
      expect(st.actionT).toBeCloseTo(0.02);
      if (auto.contactT != null) {
        // On contact the barrel is aimed at the ball itself.
        const b = auto.ball(auto.contactT - 1e-6).p;
        const aim = auto.swing!.aim;
        expect(Math.hypot(aim.x - b.x, aim.y - b.y, aim.z - b.z)).toBeLessThan(0.3);
      }
    }
    expect(swings).toBeGreaterThan(10);
  });

  it("the ball is always in somebody's hand when it is held", () => {
    const s = new GameSession({ awayTeamId: ids[3], homeTeamId: ids[8], human: "none", innings: 9, seed: 17, difficulty: "pro", awayStarter: 0, homeStarter: 0 }, teams);
    let held = 0;
    while (!s.game.final) {
      const c = s.autoPitch();
      const tl = buildTimeline(c);
      expect(tl.ball(tl.releaseT - 0.5).holder).toBe("P");
      for (let T = tl.releaseT; T <= tl.endT; T += 0.1) {
        const b = tl.ball(T);
        if (!b.held || !b.holder) continue;
        held += 1;
        // The holder is standing where the ball is (within a reach).
        const f = tl.fielder(b.holder, T);
        expect(Math.hypot(f.p.x - b.p.x, f.p.z - b.p.z), `${b.holder} @${T.toFixed(2)} ${c.result.kind}`).toBeLessThan(7.5);
      }
    }
    expect(held).toBeGreaterThan(200);
  });
});

describe("out pacing", () => {
  const base = { foul: false, outs: 1, runs: [], hit: 0 as const, error: false, caught: false, fieldedBy: null, scoring: "", sacFly: false, doublePlay: false, fieldersChoice: false, events: [], endT: 9 };
  it("ends a groundout right after the putout instead of waiting on the throw-around", () => {
    const play = { ...base, runners: [{ playerId: 1, from: 0 as const, to: 1 as const, out: true, t: 4.1 }] };
    expect(outPlayEnd(play, false)).toBeCloseTo(4.1 + OUT_HOLD_S);
  });
  it("ends a caught fly at the catch, and a third out the moment it is made", () => {
    const fly = { ...base, caught: true, events: [{ t: 3.2, type: "catch" as const }], runners: [{ playerId: 1, from: 0 as const, to: 1 as const, out: true, t: 3.2 }] };
    expect(outPlayEnd(fly, false)).toBeCloseTo(3.2 + OUT_HOLD_S);
    const hitAndOut = { ...base, hit: 1 as const, runners: [{ playerId: 2, from: 1 as const, to: 3 as const, out: true, t: 6 }] };
    expect(outPlayEnd(hitAndOut, false)).toBe(Infinity);
    expect(outPlayEnd(hitAndOut, true)).toBeCloseTo(6 + OUT_HOLD_S);
  });

  it("home-run balls fly on into the seats smoothly instead of stopping at the wall", () => {
    let homers = 0;
    for (const seed of [3, 11, 19, 27]) {
      const s = new GameSession({ awayTeamId: ids[seed % ids.length], homeTeamId: ids[(seed + 5) % ids.length], human: "none", innings: 9, seed, difficulty: "pro", awayStarter: 0, homeStarter: 0 }, teams);
      while (!s.game.final && homers < 4) {
        const c = s.autoPitch();
        if (!c.result.path?.homeRun || c.play?.hit !== 4) continue;
        homers++;
        const tl = buildTimeline(c);
        const path = c.result.path;
        const wallT = tl.contactT! + path.endT;
        // No frame-to-frame jump, and still moving after it clears the wall.
        let prev = tl.ball(tl.contactT!).p;
        for (let T = tl.contactT! + 1 / 60; T < wallT + 0.6; T += 1 / 60) {
          const p = tl.ball(T).p;
          expect(Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z)).toBeLessThan(4);
          prev = p;
        }
        const atWall = tl.ball(wallT).p;
        const later = tl.ball(wallT + 0.3).p;
        expect(Math.hypot(later.x - atWall.x, later.z - atWall.z)).toBeGreaterThan(5);
        expect(tl.ball(wallT + 0.3).visible).toBe(true);
      }
    }
    expect(homers).toBeGreaterThan(0);
  });
});
