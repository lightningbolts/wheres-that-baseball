/** Calibration diagnostics: batted-ball distributions and outcome rates by type. */
import rosters from "../data/game/rosters.json";
import { BaseballGame } from "../lib/game/rules/game";
import { stepPitch } from "../lib/game/engine/sim";
import { CPU } from "../lib/game/ai/cpu";
import { teamModel } from "../lib/game/ratings";
import { buildPark, homeVenueForTeam } from "../lib/game/physics/park";
import { Rng } from "../lib/game/math";
import type { RosterFile } from "../lib/game/types";

const games = Number(process.argv[2] ?? 30);
const teams = Object.values((rosters as unknown as RosterFile).teams).map(teamModel);
const rng = new Rng(7);
const kinds: Record<string, number> = {};
const ev: number[] = [], la: number[] = [], spray: number[] = [];
const bucket: Record<string, { n: number; hits: number; hr: number; out: number }> = {};
let swings = 0, zSw = 0, zN = 0, oSw = 0, oN = 0, contact = 0;
for (let g = 0; g < games; g++) {
  const a = teams[g % 30], h = teams[(g * 7 + 3) % 30];
  if (a === h) continue;
  const game = new BaseballGame(a, h, buildPark(homeVenueForTeam(h.teamId)), { awayStarter: g % 5, homeStarter: g % 5 });
  let n = 0;
  while (!game.final && n++ < 1200) {
    const { result, play } = stepPitch(game, { away: CPU, home: CPU }, rng);
    kinds[result.kind] = (kinds[result.kind] ?? 0) + 1;
    if (result.inZone) { zN++; if (result.swing.swing) zSw++; } else { oN++; if (result.swing.swing) oSw++; }
    if (result.swing.swing) { swings++; if (result.kind !== "swinging_strike") contact++; }
    if (result.kind === "in_play" && result.contact && play && !play.foul) {
      const L = result.contact.launchAngleDeg!;
      ev.push(result.contact.exitSpeedMph!); la.push(L); spray.push(result.contact.sprayDeg!);
      const b = L < 10 ? "GB" : L < 25 ? "LD" : L < 50 ? "FB" : "PU";
      const s = (bucket[b] ??= { n: 0, hits: 0, hr: 0, out: 0 });
      s.n++; if (play.hit > 0) s.hits++; if (play.hit === 4) s.hr++; if (play.outs > 0) s.out++;
    }
  }
}
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const sd = (x: number[]) => Math.sqrt(mean(x.map((v) => (v - mean(x)) ** 2)));
console.log("pitch kinds", kinds);
console.log({ zSwing: (zSw / zN).toFixed(3), oSwing: (oSw / oN).toFixed(3), contact: (contact / swings).toFixed(3), zoneRate: (zN / (zN + oN)).toFixed(3) });
console.log({ evMean: mean(ev).toFixed(1), evSd: sd(ev).toFixed(1), laMean: mean(la).toFixed(1), laSd: sd(la).toFixed(1), sprayMean: mean(spray).toFixed(1), spraySd: sd(spray).toFixed(1), bbe: ev.length });
for (const [k, v] of Object.entries(bucket)) console.log(k, { share: (v.n / ev.length).toFixed(3), avg: (v.hits / v.n).toFixed(3), hr: (v.hr / v.n).toFixed(3) });
