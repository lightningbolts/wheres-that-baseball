/** Headless CPU-vs-CPU season: random matchups at the home team's park. */
import { BaseballGame } from "@/lib/game/rules/game";
import { simulateGame } from "@/lib/game/engine/sim";
import { CPU } from "@/lib/game/ai/cpu";
import type { TeamModel } from "@/lib/game/ratings";
import { buildPark, homeVenueForTeam } from "@/lib/game/physics/park";
import { Rng } from "@/lib/game/math";

export function simulateSeason(teams: TeamModel[], games: number, seed: number): BaseballGame[] {
  const rng = new Rng(seed);
  const played: BaseballGame[] = [];
  for (let g = 0; g < games; g += 1) {
    const a = teams[Math.floor(rng.next() * teams.length)];
    let h = teams[Math.floor(rng.next() * teams.length)];
    while (h === a) h = teams[Math.floor(rng.next() * teams.length)];
    const game = new BaseballGame(a, h, buildPark(homeVenueForTeam(h.teamId)), { awayStarter: g % 5, homeStarter: (g + 2) % 5 });
    simulateGame(game, { away: CPU, home: CPU }, rng);
    played.push(game);
  }
  return played;
}
