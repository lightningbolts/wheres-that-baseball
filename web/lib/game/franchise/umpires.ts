/**
 * Umpire crews and plate assignments for the franchise schedule.
 *
 * Each season the staff is dealt into crews (a crew chief plus three, one crew of three
 * since the staff isn't a multiple of four), deterministic from the league seed. A crew
 * works a whole series and its members rotate behind the plate one game at a time, so
 * every umpire has the plate about every fourth game the crew works. A new series gets
 * the free crew that has been off longest (postseason: the sharpest free crew, kept for
 * the whole series). No crew works two series on a day, so no umpire works the plate
 * twice in a day (a doubleheader's two games have different plate umpires).
 *
 * Assignments are stored on the games, so they survive save/load; `ensureUmpires`
 * replays the rotation over the stored ones and fills any game that lacks one (new
 * postseason games, the next season, saves from before umpires existed).
 */
import { UMPIRES, umpById, type Umpire } from "@/lib/game/umpires/data";
import {
  addCard,
  emptyTotals,
  type UmpTotals,
} from "@/lib/game/umpires/scorecard";
import { FRng, hash32 } from "./rng";
import type { League, ScheduledGame } from "./types";

/** Crews for a season: lists of umpire ids, crew chief first. */
export function seasonCrews(seed: number, season: number): number[][] {
  const rng = new FRng(hash32(seed, season, "ump-crews"));
  const chiefs = UMPIRES.filter((u) => u.chief).map((u) => u.id);
  const rest = rng.shuffle(UMPIRES.filter((u) => !u.chief).map((u) => u.id));
  const crews = chiefs.map((id) => [id]);
  rest.forEach((id, i) => crews[i % crews.length].push(id));
  return crews;
}

const seriesKey = (g: ScheduledGame) =>
  g.ps ? `ps:${g.ps}` : `${g.away}@${g.home}`;

/** Fill in crew and plate umpire for every game that lacks one. Returns how many were assigned. */
export function ensureUmpires(league: League): number {
  if (league.schedule.every((g) => g.ump != null && g.crew != null)) return 0;
  const crews = seasonCrews(league.seed, league.season);
  const sharp = crews.map(
    (c) => c.reduce((s, id) => s + (umpById(id)?.sd ?? 1), 0) / c.length,
  );
  const games = [...league.schedule].sort(
    (a, b) => a.day - b.day || a.id - b.id,
  );
  const worked = crews.map(() => 0);
  const lastDay = crews.map(() => -999);
  const byKey = new Map<string, { crew: number; day: number }>();
  let day = Number.NaN;
  let busy = new Map<number, string>();
  let assigned = 0;
  for (const g of games) {
    if (g.day !== day) {
      day = g.day;
      busy = new Map();
    }
    const key = seriesKey(g);
    const free = (c: number) => !busy.has(c) || busy.get(c) === key;
    let c = g.crew != null && g.crew < crews.length ? g.crew : undefined;
    if (c == null) {
      const prev = byKey.get(key);
      if (prev && (g.ps || prev.day >= day - 1) && free(prev.crew))
        c = prev.crew;
      else {
        let pool = crews.map((_, i) => i).filter(free);
        if (!pool.length) pool = crews.map((_, i) => i);
        const tie = (i: number) => hash32(league.seed, league.season, day, i);
        pool.sort(
          g.ps
            ? (a, b) => sharp[a] - sharp[b] || lastDay[a] - lastDay[b]
            : (a, b) => lastDay[a] - lastDay[b] || tie(a) - tie(b),
        );
        c = pool[0];
      }
      g.crew = c;
      assigned += 1;
    }
    const crew = crews[c];
    if (g.ump == null) {
      g.ump = crew[worked[c] % crew.length];
      assigned += 1;
    }
    worked[c] += 1;
    lastDay[c] = day;
    busy.set(c, key);
    byKey.set(key, { crew: c, day });
  }
  return assigned;
}

export const plateUmp = (g: ScheduledGame): Umpire | undefined =>
  umpById(g.ump);

/** Scorecard totals by umpire for the current schedule (games with a card). */
export function umpTotals(
  league: League,
  opts: { post?: boolean } = {},
): Map<number, UmpTotals> {
  const out = new Map<number, UmpTotals>();
  for (const g of league.schedule) {
    if (!g.uc || g.ump == null) continue;
    if (opts.post != null && !!g.ps !== opts.post) continue;
    let t = out.get(g.ump);
    if (!t) out.set(g.ump, (t = emptyTotals()));
    addCard(t, g.uc);
  }
  return out;
}

/** One umpire's games with scorecards this season, newest first. */
export function umpGameLog(league: League, umpId: number): ScheduledGame[] {
  return league.schedule
    .filter((g) => g.ump === umpId && g.uc)
    .sort((a, b) => b.day - a.day || b.id - a.id);
}

/** Keep the finished season's umpire totals before the schedule is replaced. */
export function archiveUmpSeason(league: League): void {
  const totals = umpTotals(league);
  if (!totals.size) return;
  const hist = (league.umpHist ??= []).filter(
    (h) => h.season !== league.season,
  );
  hist.push({ season: league.season, totals: Object.fromEntries(totals) });
  league.umpHist = hist;
}
