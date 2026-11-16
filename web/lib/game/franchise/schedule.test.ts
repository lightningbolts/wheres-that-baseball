import { describe, expect, it } from "vitest";
import { MLB_TEAMS } from "@/lib/mlb/teams";
import { buildSchedule, buildSeries, fmtDate } from "./schedule";

describe("schedule", () => {
  it("series give every club 162 games and 81 at home", () => {
    const series = buildSeries();
    for (const t of MLB_TEAMS) {
      const home = series.filter((s) => s.home === t.id).reduce((n, s) => n + s.len, 0);
      const away = series.filter((s) => s.away === t.id).reduce((n, s) => n + s.len, 0);
      expect(home).toBe(81);
      expect(away).toBe(81);
    }
  });

  it("lays out a valid 2027 calendar", () => {
    const t0 = Date.now();
    const { calendar, games } = buildSchedule(2027, 42);
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(5000);
    expect(games.length).toBe(2430);
    expect(fmtDate(calendar, 0, true)).toContain("Mar 25, 2027");
    const byDay = new Map<number, Set<number>>();
    const offDays = new Map<number, number>();
    for (const g of games) {
      const s = byDay.get(g.day) ?? new Set<number>();
      expect(s.has(g.home) || s.has(g.away)).toBe(false);
      s.add(g.home);
      s.add(g.away);
      byDay.set(g.day, s);
      expect(g.day < calendar.asb[0] || g.day > calendar.asb[1]).toBe(true);
    }
    for (const t of MLB_TEAMS) {
      const n = games.filter((g) => g.home === t.id || g.away === t.id).length;
      expect(n).toBe(162);
      let off = 0;
      for (let d = 0; d <= calendar.endDay; d += 1) if (!(byDay.get(d)?.has(t.id))) off += 1;
      offDays.set(t.id, off);
    }
    // Every club opens on Opening Day-ish and the season ends by early October.
    expect(calendar.endDay).toBeLessThan(195);
    expect(Math.max(...offDays.values())).toBeLessThan(40);
  });
});
