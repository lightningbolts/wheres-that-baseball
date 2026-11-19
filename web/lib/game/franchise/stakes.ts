/**
 * What a franchise game means: would a win clinch the division, a playoff berth, a
 * postseason series, the pennant or the World Series — or keep a club's season alive?
 * Cheap, conservative checks (strictly clear of every rival's best possible finish), so a
 * "clinched" banner is never wrong; a clinch decided only by a tiebreaker goes unmarked.
 */
import type { GameStakes, Stake } from "@/lib/game/rules/celebration";
import { ROUND_NAME, winsNeeded } from "./postseason";
import type { League, ScheduledGame } from "./types";

/** Regular-season games each club has left (this one included). */
function remaining(league: League): Map<number, number> {
  const left = new Map<number, number>();
  for (const g of league.schedule) {
    if (g.result || g.ps) continue;
    left.set(g.home, (left.get(g.home) ?? 0) + 1);
    left.set(g.away, (left.get(g.away) ?? 0) + 1);
  }
  return left;
}

/**
 * Regular season: does beating `opp` today clinch something for `team` it has not already
 * clinched? Division: more wins than any division rival can reach. Berth: at most three
 * other clubs in the league can still reach his total (then at worst he is the third wild card).
 */
export function regularSeasonStake(league: League, team: number, opp: number): Stake | null {
  const me = league.teams[team];
  if (!me) return null;
  const left = remaining(league);
  // Best finish for a rival: before today (today's game still to play) and after a loss to us today.
  const maxBefore = (id: number) => league.teams[id].w + (left.get(id) ?? 0);
  const maxAfter = (id: number) => maxBefore(id) - (id === opp ? 1 : 0);
  const wNow = me.w;
  const wWin = me.w + 1;
  const rivals = Object.values(league.teams).filter((t) => t.id !== team && t.league === me.league);
  const div = rivals.filter((t) => t.division === me.division);
  const divNow = div.every((t) => wNow > maxBefore(t.id));
  const divWin = div.every((t) => wWin > maxAfter(t.id));
  if (divWin && !divNow) return { kind: "clinch-division", label: `${me.league} ${me.division} champions` };
  const berthNow = rivals.filter((t) => maxBefore(t.id) >= wNow).length <= 3;
  const berthWin = rivals.filter((t) => maxAfter(t.id) >= wWin).length <= 3;
  if (berthWin && !berthNow) return { kind: "clinch-wildcard", label: "Clinched a playoff spot" };
  return null;
}

const NEXT_ROUND: Record<string, (lg: string) => string> = {
  wc: () => "Advance to the Division Series",
  ds: (lg) => `Advance to the ${lg}CS`,
};

/** Postseason: what this game means for each club in its series. */
export function postseasonStakes(league: League, g: ScheduledGame): GameStakes {
  const s = league.bracket?.series.find((x) => x.id === g.ps);
  if (!s || s.winner) return {};
  const need = winsNeeded(s);
  const stakeFor = (team: number): Stake | null => {
    const mine = team === s.hi ? s.wins[0] : s.wins[1];
    const theirs = team === s.hi ? s.wins[1] : s.wins[0];
    if (mine + 1 >= need) {
      if (s.round === "ws") return { kind: "world-series", label: `${league.teams[team]?.name ?? "They"} win the World Series` };
      if (s.round === "lcs") return { kind: "pennant", label: `${s.league} champions — on to the World Series` };
      return { kind: "series-clinch", label: `${ROUND_NAME[s.round]} won · ${NEXT_ROUND[s.round]?.(String(s.league)) ?? "Advance"}` };
    }
    if (theirs + 1 >= need) return { kind: "elimination-save", label: `Facing elimination — forces Game ${s.games.length + 1}` };
    return null;
  };
  return { away: stakeFor(g.away), home: stakeFor(g.home) };
}

/** What winning this game would mean (regular season: the user's club only, to keep it cheap). */
export function gameStakes(league: League, g: ScheduledGame): GameStakes | undefined {
  if (g.ps) {
    const st = postseasonStakes(league, g);
    return st.away || st.home ? st : undefined;
  }
  const user = league.userTeam;
  if (g.home !== user && g.away !== user) return undefined;
  const opp = g.home === user ? g.away : g.home;
  const mine = regularSeasonStake(league, user, opp);
  if (!mine) return undefined;
  return g.home === user ? { home: mine } : { away: mine };
}
