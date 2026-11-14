import { describe, it } from "vitest";
import { BaseballGame } from "@/lib/game/rules/game";
import { simulateGame } from "@/lib/game/engine/sim";
import { CPU } from "@/lib/game/ai/cpu";
import { buildPark, homeVenueForTeam } from "@/lib/game/physics/park";
import { Rng } from "@/lib/game/math";
import { TEAMS } from "@/lib/game/__fixtures/teams";
import { idealContactTime, type Controller } from "@/lib/game/engine/atBat";
import { isStrike } from "@/lib/game/physics/pitch";
import { DIFFICULTY, SWING_LEAD_S, humanSwing } from "@/lib/game/session/humanInput";
import type { Difficulty } from "@/lib/game/session/session";

/** A simulated human hitter: real-time timing error (ms) and PCI aim error (ft). */
function humanCtl(diff: Difficulty, timingMs: number, aimFt: number, inputRng: Rng, biasMs = 0): Controller {
  return {
    choosePitch: CPU.choosePitch,
    decideSwing(ctx, flight, rng) {
      const perPx = flight.px + inputRng.gauss(0, 0.22);
      const perPz = flight.pz + inputRng.gauss(0, 0.22);
      const swing = isStrike(perPx, perPz, ctx.batter.zoneBottom, ctx.batter.zoneTop) || (ctx.count.strikes === 2 && inputRng.chance(0.3));
      if (!swing) return { swing: false, timingErrMs: 0, verticalErrFt: 0, alongErrFt: 0 };
      const ts = DIFFICULTY[diff].timeScale;
      const pressT = idealContactTime(flight) - SWING_LEAD_S + (inputRng.gauss(biasMs, timingMs) / 1000) * ts;
      return humanSwing(
        { pressT, pciPx: flight.px + inputRng.gauss(0, aimFt), pciPz: flight.pz + inputRng.gauss(0, aimFt), power: false },
        flight, ctx.batter, ctx.side, diff, rng,
      );
    },
  };
}

describe.skipIf(!process.env.HUMAN_SIM)("human hitting difficulty", () => {
  it("prints batting lines", { timeout: 300_000 }, () => {
    const rows: string[] = [];
    for (const diff of ["rookie", "pro", "allstar"] as Difficulty[]) {
      for (const [label, tMs, aim, bias] of [["casual", 60, 0.3, 0], ["late", 45, 0.25, 40], ["average", 40, 0.2, 0], ["good", 25, 0.12, 0]] as const) {
        const rng = new Rng(5);
        const inRng = new Rng(9);
        let pa = 0, ab = 0, h = 0, hr = 0, k = 0, bb = 0, tb = 0;
        for (let g = 0; g < 24; g += 1) {
          const a = TEAMS[g % TEAMS.length];
          const hm = TEAMS[(g + 3) % TEAMS.length];
          const game = new BaseballGame(a, hm, buildPark(homeVenueForTeam(hm.teamId)), { awayStarter: g % 5, homeStarter: (g + 2) % 5 });
          simulateGame(game, { away: humanCtl(diff, tMs, aim, inRng, bias), home: CPU }, rng);
          for (const b of game.away.lineup) {
            const l = game.bat.get(b.id);
            if (!l) continue;
            pa += l.pa; ab += l.ab; h += l.h; hr += l.hr; k += l.k; bb += l.bb;
            tb += l.h + l.d + 2 * l.t + 3 * l.hr;
          }
        }
        rows.push(`${diff.padEnd(8)} ${label.padEnd(8)} AVG ${(h / ab).toFixed(3)} SLG ${(tb / ab).toFixed(3)} K% ${(k / pa).toFixed(3)} BB% ${(bb / pa).toFixed(3)} HR/PA ${(hr / pa).toFixed(3)}`);
      }
    }
    console.log("\n" + rows.join("\n"));
  });
});
