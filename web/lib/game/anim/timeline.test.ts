import { describe, expect, it } from "vitest";
import rosters from "@/data/game/rosters.json";
import { GameSession, teamsFromRosters } from "@/lib/game/session/session";
import { buildTimeline, basePathPoint } from "@/lib/game/anim/timeline";
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
      if (tl.inPlay && c.play) {
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
});
