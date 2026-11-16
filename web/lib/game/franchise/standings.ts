/** Standings, games back, tiebreakers, playoff picture. */
import type { MLBDivision, MLBLeague } from "@/lib/mlb/teams";
import type { League, TeamState } from "./types";

export const pct = (t: TeamState): number => (t.w + t.l ? t.w / (t.w + t.l) : 0);

function headToHead(league: League, a: number, b: number): number {
  let aw = 0;
  let bw = 0;
  for (const g of league.schedule) {
    if (!g.result || g.ps) continue;
    if (!((g.home === a && g.away === b) || (g.home === b && g.away === a))) continue;
    const homeWon = g.result.hs > g.result.as;
    if ((homeWon ? g.home : g.away) === a) aw += 1;
    else bw += 1;
  }
  return aw - bw;
}

export function sortTeams(league: League, teams: TeamState[]): TeamState[] {
  return [...teams].sort((a, b) => pct(b) - pct(a) || headToHead(league, b.id, a.id) || b.rs - b.ra - (a.rs - a.ra) || a.id - b.id);
}

export function divisionStandings(league: League, lg: MLBLeague, div: MLBDivision): TeamState[] {
  return sortTeams(
    league,
    Object.values(league.teams).filter((t) => t.league === lg && t.division === div),
  );
}

export const gamesBack = (leader: TeamState, t: TeamState): number => (leader.w - t.w + (t.l - leader.l)) / 2;

/** Seeds 1–6: three division winners by record, then three wild cards. */
export function playoffSeeds(league: League, lg: MLBLeague): number[] {
  const winners = (["East", "Central", "West"] as const).map((d) => divisionStandings(league, lg, d)[0]);
  const ws = sortTeams(league, winners);
  const rest = sortTeams(
    league,
    Object.values(league.teams).filter((t) => t.league === lg && !winners.includes(t)),
  );
  return [...ws, ...rest.slice(0, 3)].map((t) => t.id);
}

/** Wild-card race table: non-division-leaders ordered, with GB from the last spot. */
export function wildCardRace(league: League, lg: MLBLeague): Array<{ t: TeamState; gb: number }> {
  const winners = (["East", "Central", "West"] as const).map((d) => divisionStandings(league, lg, d)[0]);
  const rest = sortTeams(
    league,
    Object.values(league.teams).filter((t) => t.league === lg && !winners.includes(t)),
  );
  const cut = rest[2];
  return rest.map((t) => ({ t, gb: cut ? gamesBack(cut, t) : 0 }));
}

export function streak(t: TeamState): string {
  if (!t.last.length) return "-";
  const last = t.last[t.last.length - 1];
  let n = 0;
  for (let i = t.last.length - 1; i >= 0 && t.last[i] === last; i -= 1) n += 1;
  return `${last}${n}`;
}

export function lastTen(t: TeamState): string {
  const l = t.last.slice(-10);
  const w = l.filter((x) => x === "W").length;
  return `${w}-${l.length - w}`;
}
