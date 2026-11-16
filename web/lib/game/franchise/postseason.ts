/**
 * Postseason in the 12-team format: per league three division winners (seeds 1–3)
 * and three wild cards (4–6). Seeds 1–2 get byes; Wild Card Series best-of-3 all at
 * the higher seed (3v6, 4v5), Division Series best-of-5 (2-2-1), LCS and World Series
 * best-of-7 (2-3-2). One game per day within a round, one off day between rounds.
 */
import type { MLBLeague } from "@/lib/mlb/teams";
import { news } from "./roster";
import { pct, playoffSeeds } from "./standings";
import type { Bracket, League, ScheduledGame, Series } from "./types";

export const ROUNDS: Series["round"][] = ["wc", "ds", "lcs", "ws"];
export const ROUND_NAME: Record<Series["round"], string> = { wc: "Wild Card Series", ds: "Division Series", lcs: "League Championship Series", ws: "World Series" };
const BEST_OF: Record<Series["round"], number> = { wc: 3, ds: 5, lcs: 7, ws: 7 };

export type BracketState = Bracket;

function mkSeries(round: Series["round"], lg: MLBLeague | "MLB", n: number, hi: number, lo: number, hiSeed: number, loSeed: number): Series {
  return { id: `${round}-${lg}-${n}`, round, league: lg, hi, lo, hiSeed, loSeed, bestOf: BEST_OF[round], wins: [0, 0], games: [] };
}

export function buildBracket(league: League): BracketState {
  const seeds = { AL: playoffSeeds(league, "AL"), NL: playoffSeeds(league, "NL") };
  const series: Series[] = [];
  for (const lg of ["AL", "NL"] as const) {
    const s = seeds[lg];
    series.push(mkSeries("wc", lg, 1, s[2], s[5], 3, 6));
    series.push(mkSeries("wc", lg, 2, s[3], s[4], 4, 5));
  }
  return { seeds, series, nextDay: league.calendar.endDay + 2 };
}

export const winsNeeded = (s: Series): number => Math.ceil(s.bestOf / 2);

/** Home team for game n (1-based). */
export function seriesHome(s: Series, n: number): number {
  if (s.round === "wc") return s.hi;
  if (s.round === "ds") return n === 3 || n === 4 ? s.lo : s.hi;
  return n >= 3 && n <= 5 ? s.lo : s.hi;
}

export function liveRound(b: Bracket): Series["round"] | null {
  for (const r of ROUNDS) {
    const ss = b.series.filter((s) => s.round === r);
    if (!ss.length) return null;
    if (ss.some((s) => !s.winner)) return r;
  }
  return null;
}

/** Create today's postseason games for every live series that needs one. */
export function schedulePostseasonDay(league: League): ScheduledGame[] {
  const b = league.bracket as BracketState | undefined;
  if (!b || b.champion) return [];
  if ((b.nextDay ?? 0) > league.day) return [];
  const round = liveRound(b);
  if (!round) return [];
  const out: ScheduledGame[] = [];
  for (const s of b.series) {
    if (s.round !== round || s.winner) continue;
    const today = league.schedule.find((g) => g.ps === s.id && g.day === league.day);
    if (today) continue;
    if (s.games.some((id) => !league.schedule.find((g) => g.id === id)?.result)) continue;
    const n = s.games.length + 1;
    const home = seriesHome(s, n);
    const g: ScheduledGame = { id: league.nextGameId++, day: league.day, away: home === s.hi ? s.lo : s.hi, home, ps: s.id };
    s.games.push(g.id);
    league.schedule.push(g);
    out.push(g);
  }
  return out;
}

/** Update the series after a postseason game; open the next round when one finishes. */
export function onPostseasonResult(league: League, g: ScheduledGame): void {
  const b = league.bracket as BracketState | undefined;
  if (!b || !g.result) return;
  const s = b.series.find((x) => x.id === g.ps);
  if (!s || s.winner) return;
  const winner = g.result.hs > g.result.as ? g.home : g.away;
  if (winner === s.hi) s.wins[0] += 1;
  else s.wins[1] += 1;
  const need = winsNeeded(s);
  if (s.wins[0] >= need || s.wins[1] >= need) {
    s.winner = s.wins[0] >= need ? s.hi : s.lo;
    const loser = s.winner === s.hi ? s.lo : s.hi;
    const w = league.teams[s.winner];
    news(league, `${w.name} win the ${s.league === "MLB" ? "" : `${s.league} `}${ROUND_NAME[s.round]} over the ${league.teams[loser].name}, ${Math.max(...s.wins)}-${Math.min(...s.wins)}.`, s.winner, "info");
    if (s.round === "ws") {
      b.champion = s.winner;
      league.champions.push({ season: league.season, team: s.winner, runnerUp: loser });
      return;
    }
    advanceRound(league, b, s.round);
  }
}

function advanceRound(league: League, b: BracketState, round: Series["round"]): void {
  const done = b.series.filter((s) => s.round === round);
  if (done.some((s) => !s.winner)) return;
  const seedOf = (lg: MLBLeague, id: number) => b.seeds[lg].indexOf(id) + 1;
  const next = ROUNDS[ROUNDS.indexOf(round) + 1];
  const pair = (lg: MLBLeague, a: number, c: number, n: number) => {
    const [hi, lo] = seedOf(lg, a) <= seedOf(lg, c) ? [a, c] : [c, a];
    b.series.push(mkSeries(next, lg, n, hi, lo, seedOf(lg, hi), seedOf(lg, lo)));
  };
  for (const lg of ["AL", "NL"] as const) {
    if (next === "ds") {
      const w36 = done.find((s) => s.league === lg && s.id.endsWith("-1"))!.winner!;
      const w45 = done.find((s) => s.league === lg && s.id.endsWith("-2"))!.winner!;
      pair(lg, b.seeds[lg][0], w45, 1);
      pair(lg, b.seeds[lg][1], w36, 2);
    } else if (next === "lcs") {
      const ws = done.filter((s) => s.league === lg).map((s) => s.winner!);
      pair(lg, ws[0], ws[1], 1);
    }
  }
  if (next === "ws") {
    const al = done.find((s) => s.league === "AL")!.winner!;
    const nl = done.find((s) => s.league === "NL")!.winner!;
    const [hi, lo] = pct(league.teams[al]) >= pct(league.teams[nl]) ? [al, nl] : [nl, al];
    b.series.push(mkSeries("ws", "MLB", 1, hi, lo, 0, 0));
  }
  b.nextDay = league.day + 2;
}

export function userSeries(league: League): Series | null {
  const b = league.bracket;
  if (!b) return null;
  const live = b.series.filter((s) => !s.winner && (s.hi === league.userTeam || s.lo === league.userTeam));
  return live[0] ?? null;
}
