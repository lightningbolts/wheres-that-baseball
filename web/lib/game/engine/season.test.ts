import { describe, expect, it } from "vitest";
import { simulateSeason } from "@/lib/game/engine/season";
import { leagueSummary } from "@/lib/game/engine/leagueStats";
import { TEAMS } from "@/lib/game/__fixtures/teams";

/**
 * Calibration guard: 120 CPU games must land near MLB league norms. Bands are the
 * MLB ranges widened for a 120-game sample (runs/game SE ≈ 0.2). Runs sit ~5% low
 * (no hit-and-run, pickoffs or steals of third yet), so its floor is 3.8.
 */
const BANDS: Record<string, [number, number]> = {
  runsPerTeamGame: [3.8, 5.0],
  avg: [0.228, 0.262],
  obp: [0.298, 0.332],
  slg: [0.37, 0.435],
  kRate: [0.19, 0.255],
  bbRate: [0.068, 0.102],
  hrPerPA: [0.022, 0.04],
  babip: [0.27, 0.315],
  pitchesPerPA: [3.65, 4.05],
};

describe("season calibration", () => {
  // ~45 s: run with `npm run test:sim` (GAME_SIM=1).
  it.skipIf(!process.env.GAME_SIM)("CPU-vs-CPU league stats match MLB norms", { timeout: 120_000 }, () => {
    const { stats } = leagueSummary(simulateSeason(TEAMS, 120, 1));
    for (const [k, [lo, hi]] of Object.entries(BANDS)) {
      const v = stats[k as keyof typeof stats];
      expect.soft(v, k).toBeGreaterThanOrEqual(lo);
      expect.soft(v, k).toBeLessThanOrEqual(hi);
    }
  });

  it("every game ends legally", { timeout: 30_000 }, () => {
    for (const g of simulateSeason(TEAMS, 12, 7)) {
      expect(g.final).toBe(true);
      expect(g.score.home).not.toBe(g.score.away);
      expect(g.inning).toBeGreaterThanOrEqual(9);
    }
  });
});
