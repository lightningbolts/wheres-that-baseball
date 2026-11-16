/**
 * 162-game schedule in the current balanced format:
 *   52 division games (13 vs each rival: 7 at home vs two of them, 6 vs the other two),
 *   64 league games (7 vs four teams, 6 vs six), 46 interleague (3 vs fourteen clubs
 *   plus 2+2 vs the natural rival). Every club gets exactly 81 home games.
 * Series (2–4 games) are laid on the calendar day by day, most-constrained club first,
 * from a Thursday Opening Day in late March to a Sunday finale in late September,
 * with a four-day All-Star break.
 */
import { MLB_TEAMS, type MLBTeam } from "@/lib/mlb/teams";
import { RIVALS } from "./data";
import { FRng } from "./rng";
import type { Calendar, ScheduledGame } from "./types";

export const DAY_MS = 86_400_000;

interface SeriesDef {
  home: number;
  away: number;
  len: number;
}

function findDow(year: number, month: number, from: number, to: number, dow: number): number {
  for (let d = from; d <= to; d += 1) if (new Date(Date.UTC(year, month, d)).getUTCDay() === dow) return d;
  return from;
}

export function seasonCalendar(year: number): Calendar {
  const start = Date.UTC(year, 2, findDow(year, 2, 25, 31, 4));
  const idx = (ms: number) => Math.round((ms - start) / DAY_MS);
  const end = idx(Date.UTC(year, 8, findDow(year, 8, 24, 30, 0)));
  const asbMon = idx(Date.UTC(year, 6, findDow(year, 6, 11, 17, 1)));
  return { start, endDay: end, asb: [asbMon, asbMon + 3], deadlineDay: idx(Date.UTC(year, 6, 31)) };
}

export function dateOf(cal: Calendar, day: number): Date {
  return new Date(cal.start + day * DAY_MS);
}

export function fmtDate(cal: Calendar, day: number, withYear = false): string {
  const d = dateOf(cal, day);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short", timeZone: "UTC", ...(withYear ? { year: "numeric" } : {}) });
}

export function buildSeries(teams: MLBTeam[] = MLB_TEAMS): SeriesDef[] {
  const out: SeriesDef[] = [];
  const add = (home: number, away: number, len: number) => out.push({ home, away, len });
  const divs = (lg: "AL" | "NL") =>
    (["East", "Central", "West"] as const).map((d) =>
      teams.filter((t) => t.league === lg && t.division === d).sort((a, b) => a.id - b.id).map((t) => t.id),
    );
  for (const lg of ["AL", "NL"] as const) {
    const D = divs(lg);
    // Division: heavy host (7 = 4+3) vs light host (6 = 3+3).
    for (const div of D) {
      for (let i = 0; i < div.length; i += 1) {
        for (let j = i + 1; j < div.length; j += 1) {
          const iHeavy = ((j - i) % 5 === 1 || (j - i) % 5 === 2);
          const [h, l] = iHeavy ? [div[i], div[j]] : [div[j], div[i]];
          add(h, l, 4);
          add(h, l, 3);
          add(l, h, 3);
          add(l, h, 3);
        }
      }
    }
    // Non-division league opponents.
    const seven = new Map<string, number>();
    const pairs: Array<[number, number]> = [
      [0, 1],
      [1, 2],
      [2, 0],
    ];
    for (const [x, y] of pairs) {
      for (let i = 0; i < 5; i += 1) {
        seven.set(`${D[x][i]}-${D[y][i]}`, D[x][i]);
        seven.set(`${D[x][i]}-${D[y][(i + 1) % 5]}`, D[y][(i + 1) % 5]);
      }
    }
    for (let x = 0; x < 3; x += 1) {
      for (let y = x + 1; y < 3; y += 1) {
        for (const a of D[x]) {
          for (const b of D[y]) {
            const heavy = seven.get(`${a}-${b}`) ?? seven.get(`${b}-${a}`);
            if (heavy != null) {
              const light = heavy === a ? b : a;
              add(heavy, light, 4);
              add(light, heavy, 3);
            } else {
              add(a, b, 3);
              add(b, a, 3);
            }
          }
        }
      }
    }
  }
  // Interleague.
  const al = RIVALS.map(([a]) => a);
  const nl = RIVALS.map(([, n]) => n);
  for (let i = 0; i < 15; i += 1) {
    for (let j = 0; j < 15; j += 1) {
      if (i === j) {
        add(al[i], nl[j], 2);
        add(nl[j], al[i], 2);
        continue;
      }
      const d = (((j - i) % 15) + 15) % 15;
      if (d <= 7) add(al[i], nl[j], 3);
      else add(nl[j], al[i], 3);
    }
  }
  return out;
}

function layOut(series: SeriesDef[], cal: Calendar, endDay: number, rng: FRng): Array<{ s: SeriesDef; day: number }> | null {
  const teamIds = [...new Set(series.flatMap((s) => [s.home, s.away]))];
  const playable = (d: number) => d >= 0 && d <= endDay && !(d >= cal.asb[0] && d <= cal.asb[1]);
  // Consecutive playable days starting at d, and playable days remaining from d.
  const run: number[] = [];
  const left: number[] = [];
  for (let d = endDay + 1; d >= 0; d -= 1) {
    run[d] = playable(d) ? (run[d + 1] ?? 0) + 1 : 0;
    left[d] = (playable(d) ? 1 : 0) + (left[d + 1] ?? 0);
  }
  const rem = new Map<number, number[]>();
  const remDays = new Map<number, number>();
  teamIds.forEach((t) => {
    rem.set(t, []);
    remDays.set(t, 0);
  });
  series.forEach((s, i) => {
    rem.get(s.home)!.push(i);
    rem.get(s.away)!.push(i);
    remDays.set(s.home, remDays.get(s.home)! + s.len);
    remDays.set(s.away, remDays.get(s.away)! + s.len);
  });
  const dowWeight = (d: number) => {
    const dow = new Date(cal.start + d * DAY_MS).getUTCDay();
    return dow === 1 || dow === 4 ? 2.6 : dow === 0 || dow === 6 ? 0.2 : 0.7;
  };
  const busy = new Map<number, number>(teamIds.map((t) => [t, -1]));
  const lastOpp = new Map<number, number>();
  const used = new Array<boolean>(series.length).fill(false);
  const out: Array<{ s: SeriesDef; day: number }> = [];
  for (let d = 0; d <= endDay; d += 1) {
    if (!playable(d)) continue;
    const free = teamIds.filter((t) => busy.get(t)! < d && remDays.get(t)! > 0);
    const slack = (t: number) => left[d] - remDays.get(t)!;
    const order = free.map((t) => ({ t, k: slack(t) + rng.next() * 1.5 })).sort((a, b) => a.k - b.k);
    const taken = new Set<number>();
    for (const { t } of order) {
      if (taken.has(t)) continue;
      // Clubs with room to spare take some off days so they are spread out.
      // Off days lean to Mondays and Thursdays, as on the real calendar.
      const sl = slack(t);
      if (d > 0 && sl > 1 && rng.chance(Math.min(0.6, (sl / left[d]) * dowWeight(d)))) continue;
      let best = -1;
      let bestScore = -Infinity;
      for (const i of rem.get(t)!) {
        if (used[i]) continue;
        const s = series[i];
        const u = s.home === t ? s.away : s.home;
        if (taken.has(u) || busy.get(u)! >= d || s.len > run[d]) continue;
        const score = -slack(u) * 1.2 + s.len * 0.4 + rng.next() * 3 - (lastOpp.get(t) === u ? 8 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best < 0) continue;
      const s = series[best];
      const u = s.home === t ? s.away : s.home;
      used[best] = true;
      taken.add(t);
      taken.add(u);
      for (const x of [t, u]) {
        busy.set(x, d + s.len - 1);
        remDays.set(x, remDays.get(x)! - s.len);
        rem.set(x, rem.get(x)!.filter((j) => j !== best));
      }
      lastOpp.set(t, u);
      lastOpp.set(u, t);
      out.push({ s, day: d });
    }
  }
  return used.every(Boolean) ? out : null;
}

/** Build the regular-season calendar and games. Deterministic from the seed. */
export function buildSchedule(year: number, seed: number, firstGameId = 1): { calendar: Calendar; games: ScheduledGame[] } {
  const cal = seasonCalendar(year);
  const series = buildSeries();
  let placed: Array<{ s: SeriesDef; day: number }> | null = null;
  let endDay = cal.endDay;
  for (let extra = 0; extra <= 6 && !placed; extra += 1) {
    endDay = cal.endDay + extra;
    for (let attempt = 0; attempt < 120 && !placed; attempt += 1) placed = layOut(series, cal, endDay, new FRng(seed * 7919 + attempt * 104729 + extra));
  }
  if (!placed) throw new Error("Could not build a schedule");
  const games: ScheduledGame[] = [];
  for (const { s, day } of placed) {
    for (let g = 0; g < s.len; g += 1) games.push({ id: 0, day: day + g, away: s.away, home: s.home });
  }
  games.sort((a, b) => a.day - b.day || a.home - b.home);
  games.forEach((g, i) => (g.id = firstGameId + i));
  const last = games.reduce((m, g) => Math.max(m, g.day), 0);
  return { calendar: { ...cal, endDay: last }, games };
}
