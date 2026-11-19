import { describe, expect, it } from "vitest";
import rosters from "@/data/game/rosters.json";
import type { RosterFile } from "@/lib/game/types";
import { createLeague } from "./league";
import { prepareDay, simUntil } from "./season";
import { buildManualGame, outcomeFromBox, rosterIndex } from "./manual";
import { deserializeLeague, serializeLeague } from "./save";
import { finishFreeAgency, startNextSeason, startOffseason } from "./offseason";
import { ensureUmpires, seasonCrews, umpGameLog, umpTotals } from "./umpires";
import { UMPIRES } from "@/lib/game/umpires/data";
import type { League } from "./types";

const file = rosters as unknown as RosterFile;

function checkRotation(league: League) {
  const byDay = new Map<number, number[]>();
  for (const g of league.schedule) {
    expect(g.ump, `game ${g.id}`).toBeDefined();
    const list = byDay.get(g.day) ?? [];
    list.push(g.ump!);
    byDay.set(g.day, list);
  }
  // Nobody has the plate twice in a day.
  for (const [day, umps] of byDay)
    expect(new Set(umps).size, `day ${day}`).toBe(umps.length);
}

describe("franchise umpires", () => {
  const league = createLeague(file, { userTeam: 147, seed: 21 });

  it("assigns a plate umpire to every game, crews rotating the plate", () => {
    checkRotation(league);
    const crews = seasonCrews(league.seed, league.season);
    expect(crews.length).toBe(19);
    expect(new Set(crews.flat()).size).toBe(UMPIRES.length);
    // A crew works whole series: the same crew all games of a series.
    const reg = league.schedule
      .filter((g) => !g.ps)
      .sort((a, b) => a.day - b.day || a.id - b.id);
    let same = 0;
    let pairs = 0;
    for (const g of reg) {
      const y = reg.find(
        (x) => x.day === g.day - 1 && x.away === g.away && x.home === g.home,
      );
      if (!y) continue;
      pairs += 1;
      if (y.crew === g.crew) same += 1;
    }
    expect(same / pairs).toBeGreaterThan(0.95);
    // Every crew member gets the plate about every fourth game the crew works.
    const games = new Map<number, number>();
    for (const g of reg) games.set(g.ump!, (games.get(g.ump!) ?? 0) + 1);
    const counts = [...games.values()];
    expect(games.size).toBe(UMPIRES.length);
    expect(Math.min(...counts)).toBeGreaterThan(20);
    expect(Math.max(...counts)).toBeLessThan(45);
  });

  it("is deterministic from the seed and backfills saves made before umpires", () => {
    const again = createLeague(file, { userTeam: 147, seed: 21 });
    expect(again.schedule.map((g) => g.ump)).toEqual(
      league.schedule.map((g) => g.ump),
    );
    const old = JSON.parse(serializeLeague(league)) as League;
    for (const g of old.schedule) {
      delete g.ump;
      delete g.crew;
    }
    const loaded = deserializeLeague(JSON.stringify(old))!;
    prepareDay(loaded);
    expect(loaded.schedule.map((g) => g.ump)).toEqual(
      league.schedule.map((g) => g.ump),
    );
    expect(ensureUmpires(loaded)).toBe(0);
  });

  it("simmed games keep scorecards, the umpire's zone, and survive save/load", () => {
    const l = structuredClone(league);
    simUntil(l, "week");
    const played = l.schedule.filter((g) => g.result);
    expect(played.length).toBeGreaterThan(60);
    for (const g of played) {
      expect(g.uc).toBeDefined();
      expect(g.uc!.n).toBeGreaterThan(80);
      expect(g.uc!.ok).toBeLessThanOrEqual(g.uc!.n);
    }
    const totals = umpTotals(l);
    const games = [...totals.values()].reduce((s, t) => s + t.g, 0);
    expect(games).toBe(played.length);
    const acc =
      [...totals.values()].reduce((s, t) => s + t.ok, 0) /
      [...totals.values()].reduce((s, t) => s + t.n, 0);
    expect(acc).toBeGreaterThan(0.93);
    expect(acc).toBeLessThan(0.96);
    const someone = played[0].ump!;
    expect(umpGameLog(l, someone).length).toBe(totals.get(someone)!.g);
    const back = deserializeLeague(serializeLeague(l))!;
    expect(back.schedule.find((g) => g.id === played[0].id)?.uc).toEqual(
      played[0].uc,
    );
  });

  it("puts the plate umpire into the Play Ball setup and the manual box score", () => {
    const l = structuredClone(league);
    const g = l.schedule.find(
      (x) => x.home === l.userTeam || x.away === l.userTeam,
    )!;
    const m = buildManualGame(l, g.id, rosterIndex(file))!;
    expect(m.setup.ump?.id).toBe(g.ump);
    expect(m.setup.ump?.name).toBe(UMPIRES.find((u) => u.id === g.ump)!.name);
    const out = outcomeFromBox({
      awayRuns: 2,
      homeRuns: 3,
      innings: 9,
      bat: new Map(),
      pit: new Map(),
      awayStaff: [],
      homeStaff: [],
      uc: { n: 140, ok: 133, xa: 132.5, con: 136, fav: 0.2 },
    });
    expect(out.uc?.ok).toBe(133);
  });

  it("covers the postseason (one crew a series) and archives the season", () => {
    const l = structuredClone(league);
    simUntil(l, "season");
    simUntil(l, "postseason");
    expect(l.phase).toBe("offseason");
    checkRotation(l);
    const post = l.schedule.filter((g) => g.ps);
    expect(post.length).toBeGreaterThan(20);
    for (const g of post) expect(g.uc).toBeDefined();
    const crewsBySeries = new Map<string, Set<number>>();
    for (const g of post)
      crewsBySeries.set(
        g.ps!,
        (crewsBySeries.get(g.ps!) ?? new Set()).add(g.crew!),
      );
    for (const [, set] of crewsBySeries) expect(set.size).toBe(1);
    const season = l.season;
    startOffseason(l);
    finishFreeAgency(l);
    startNextSeason(l);
    expect(l.umpHist?.find((h) => h.season === season)).toBeDefined();
    expect(l.schedule.every((g) => g.ump != null && !g.uc)).toBe(true);
  });
});
