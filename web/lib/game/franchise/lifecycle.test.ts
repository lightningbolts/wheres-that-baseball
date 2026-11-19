import { describe, expect, it } from "vitest";
import rosters from "@/data/game/rosters.json";
import type { RosterFile } from "@/lib/game/types";
import { createLeague } from "./league";
import { advanceDay, gamesOn, nextUserGame, simUntil } from "./season";
import { buildManualGame, outcomeFromBox, recordManualResult, rosterIndex } from "./manual";
import { evaluateTrade, executeTrade, suggestPackage, tradeValue } from "./trades";
import { activePlayers, fortyMan, ACTIVE_MAX, FORTY_MAX } from "./roster";
import { finishFreeAgency, startNextSeason, startOffseason } from "./offseason";
import { freeAgents, makeOffer } from "./freeAgency";
import { deserializeLeague, serializeLeague } from "./save";
import { cbtTax, payroll } from "./contracts";
import { revenue, expenses } from "./finances";
import type { League } from "./types";

const file = rosters as unknown as RosterFile;
const USER = 147;

function rosterLegal(league: League): void {
  for (const t of Object.values(league.teams)) {
    expect(activePlayers(league, t.id).length, `${t.abbrev} active`).toBeLessThanOrEqual(ACTIVE_MAX);
    expect(fortyMan(league, t.id).length, `${t.abbrev} 40-man`).toBeLessThanOrEqual(FORTY_MAX);
    expect(t.lineup.length).toBe(9);
    expect(t.rotation.length).toBeGreaterThanOrEqual(4);
  }
}

describe("franchise lifecycle", () => {
  const league = createLeague(file, { userTeam: USER, seed: 11 });
  const idx = rosterIndex(file);

  it("starts with legal rosters and plausible payrolls", () => {
    rosterLegal(league);
    const pays = Object.values(league.teams).map((t) => payroll(league, t.id));
    expect(Math.min(...pays)).toBeGreaterThan(50);
    expect(Math.max(...pays)).toBeLessThan(450);
  });

  it("builds a Play Ball setup for the user's game and records a manual result", () => {
    const g = nextUserGame(league)!;
    expect(g).toBeTruthy();
    while (league.day < g.day) advanceDay(league);
    const m = buildManualGame(league, g.id, idx)!;
    expect(m).toBeTruthy();
    expect(m.setup.abs).toBe(true);
    expect(m.setup.human).toBe(g.home === USER ? "home" : "away");
    for (const tm of m.teams.values()) {
      expect(tm.lineup.length).toBe(9);
      expect(tm.rotation.length).toBeGreaterThan(0);
      expect(tm.bullpen.length).toBeGreaterThan(2);
    }
    const away = m.teams.get(g.away)!;
    const home = m.teams.get(g.home)!;
    const line = { pa: 4, ab: 4, h: 1, d: 0, t: 0, hr: 0, r: 0, rbi: 0, bb: 0, k: 1, hbp: 0, sf: 0 };
    const bat = new Map([...away.lineup, ...home.lineup].map((b) => [b.id, { ...line }]));
    const pit = new Map([
      [away.rotation[0].id, { outs: 24, h: 6, r: 3, bb: 2, k: 7, hr: 1, pitches: 101, bf: 31 }],
      [home.rotation[0].id, { outs: 18, h: 5, r: 1, bb: 1, k: 6, hr: 0, pitches: 92, bf: 24 }],
      [home.bullpen[0].id, { outs: 9, h: 2, r: 1, bb: 0, k: 3, hr: 0, pitches: 35, bf: 11 }],
    ]);
    const box = { awayRuns: 2, homeRuns: 3, innings: 9, bat, pit, awayStaff: [away.rotation[0].id], homeStaff: [home.rotation[0].id, home.bullpen[0].id] };
    const out = outcomeFromBox(box);
    expect(out.wp).toBe(home.rotation[0].id);
    expect(out.lp).toBe(away.rotation[0].id);
    expect(recordManualResult(league, g.id, box)).toBe(true);
    expect(g.result?.manual).toBe(true);
    expect(league.teams[g.home].w).toBeGreaterThanOrEqual(1);
    expect(league.players[home.rotation[0].id].stats.pit?.w).toBe(1);
    // The rest of the day sims around it.
    advanceDay(league);
    expect(gamesOn(league, g.day).every((x) => x.result)).toBe(true);
  });

  it("evaluates and executes trades", () => {
    const ai = Object.values(league.teams).find((t) => t.id !== USER && t.strategy === "rebuild") ?? Object.values(league.teams).find((t) => t.id !== USER)!;
    const target = activePlayers(league, ai.id).sort((a, b) => tradeValue(league, b, ai.id) - tradeValue(league, a, ai.id))[2];
    const pkg = suggestPackage(league, ai.id, USER, [target.id]);
    if (pkg) {
      const ev = evaluateTrade(league, { from: USER, to: ai.id, give: pkg, get: [target.id] });
      expect(ev.accept).toBe(true);
      executeTrade(league, USER, ai.id, pkg, [target.id]);
      expect(league.players[target.id].team).toBe(USER);
    }
    const star = activePlayers(league, ai.id).sort((a, b) => tradeValue(league, b, ai.id) - tradeValue(league, a, ai.id))[0];
    const lowball = evaluateTrade(league, { from: USER, to: ai.id, give: [], get: [star.id] });
    expect(lowball.accept).toBe(false);
    rosterLegal(league);
  });

  it("finishes the season and postseason with a champion", () => {
    simUntil(league, "season");
    expect(league.phase).toBe("postseason");
    expect(league.bracket?.seeds.AL.length).toBe(6);
    simUntil(league, "postseason");
    expect(league.phase).toBe("offseason");
    expect(league.bracket?.champion).toBeTruthy();
    expect(league.champions.at(-1)?.team ?? league.champions.at(-1)).toBeTruthy();
    expect(league.awards.length).toBe(1);
    const fin = league.teams[USER].fin;
    expect(revenue(fin)).toBeGreaterThan(150);
    expect(expenses(fin)).toBeGreaterThan(100);
  });

  it("runs the offseason, free agency, and opens 2028", () => {
    const before = Object.keys(league.players).length;
    startOffseason(league);
    expect(league.phase).toBe("freeagency");
    const fas = freeAgents(league);
    expect(fas.length).toBeGreaterThan(30);
    const best = fas.sort((a, b) => b.ovr - a.ovr)[0];
    const r = makeOffer(league, best.id, 60, 8);
    expect(r.ok).toBe(true);
    finishFreeAgency(league);
    startNextSeason(league);
    expect(league.season).toBe(2028);
    expect(league.phase).toBe("regular");
    expect(league.schedule.length).toBe(2430);
    expect(Object.keys(league.players).length).toBeGreaterThan(before * 0.8);
    rosterLegal(league);
    simUntil(league, "week");
    expect(league.day).toBeGreaterThan(0);
  });

  it("round-trips through serialization", () => {
    const s = serializeLeague(league);
    expect(s.length).toBeLessThan(6_000_000);
    const back = deserializeLeague(s)!;
    expect(back.season).toBe(league.season);
    expect(Object.keys(back.players).length).toBe(Object.keys(league.players).length);
    expect(deserializeLeague("{oops")).toBeNull();
  });
});

describe("CBT", () => {
  it("taxes repeat offenders more", () => {
    expect(cbtTax(200, 2027, 0).tax).toBe(0);
    const first = cbtTax(300, 2027, 0).tax;
    const third = cbtTax(300, 2027, 2).tax;
    expect(first).toBeGreaterThan(10);
    expect(third).toBeGreaterThan(first);
  });
});

describe("trade values", () => {
  it("never lets the user take a productive player for nothing, however big his contract", async () => {
    const { projectedWar } = await import("./contracts");
    const league = createLeague(file, { userTeam: USER, seed: 11 });
    const good = Object.values(league.players).filter((p) => p.team !== USER && league.teams[p.team] && p.status !== "fa" && p.status !== "retired" && projectedWar(p, 0) >= 1.5);
    expect(good.length).toBeGreaterThan(100);
    for (const p of good) {
      expect(tradeValue(league, p, p.team), p.name).toBeGreaterThan(0);
      expect(evaluateTrade(league, { from: USER, to: p.team, give: [], get: [p.id] }).accept, p.name).toBe(false);
      expect(suggestPackage(league, p.team, USER, [p.id]), p.name).not.toEqual([]);
    }
  });
});
