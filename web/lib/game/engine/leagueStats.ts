/** Aggregate box scores into league rates for calibration against MLB norms. */
import type { BaseballGame } from "@/lib/game/rules/game";

/** 2023–2025 MLB league averages (per team-game / per PA). */
export const MLB_NORMS = {
  runsPerTeamGame: [4.2, 4.8],
  avg: [0.235, 0.255],
  obp: [0.305, 0.325],
  slg: [0.38, 0.425],
  kRate: [0.2, 0.245],
  bbRate: [0.075, 0.095],
  hrPerPA: [0.025, 0.035],
  babip: [0.28, 0.305],
  pitchesPerPA: [3.75, 4.0],
  extraInningPct: [0.04, 0.12],
} as const;

export function leagueSummary(games: BaseballGame[]) {
  let pa = 0, ab = 0, h = 0, d = 0, t = 0, hr = 0, bb = 0, k = 0, hbp = 0, sf = 0, runs = 0, pitches = 0, extras = 0;
  let homeWins = 0;
  for (const g of games) {
    for (const l of g.bat.values()) {
      pa += l.pa; ab += l.ab; h += l.h; d += l.d; t += l.t; hr += l.hr; bb += l.bb; k += l.k; hbp += l.hbp; sf += l.sf;
    }
    for (const l of g.pit.values()) pitches += l.pitches;
    runs += g.score.away + g.score.home;
    if (g.inning > g.regulation) extras += 1;
    if (g.score.home > g.score.away) homeWins += 1;
  }
  const singles = h - d - t - hr;
  const stats = {
    runsPerTeamGame: runs / (games.length * 2),
    avg: h / ab,
    obp: (h + bb + hbp) / (ab + bb + hbp + sf),
    slg: (singles + 2 * d + 3 * t + 4 * hr) / ab,
    kRate: k / pa,
    bbRate: bb / pa,
    hrPerPA: hr / pa,
    babip: (h - hr) / (ab - k - hr + sf),
    pitchesPerPA: pitches / pa,
    extraInningPct: extras / games.length,
  };
  const table = Object.entries(stats).map(([key, value]) => {
    const [lo, hi] = MLB_NORMS[key as keyof typeof MLB_NORMS];
    return { stat: key, sim: Number(value.toFixed(3)), mlbLow: lo, mlbHigh: hi, ok: value >= lo && value <= hi ? "✓" : "✗" };
  });
  return { stats, table, homeWinPct: homeWins / games.length, triples: t, doubles: d };
}
