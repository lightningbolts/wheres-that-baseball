import { describe, expect, it } from "vitest";
import projFile from "@/data/game/franchise-proj.json";
import rosters from "@/data/game/rosters.json";
import { GameSession, teamsFromRosters, type GameSetup } from "@/lib/game/session/session";
import type { RosterFile } from "@/lib/game/types";
import { isPA, lineScore, packPlay, PLAY, unpackPlay } from "./boxscore";
import { createLeague } from "./league";
import { sessionBox } from "./manual";
import type { ProjectionFile } from "./projections";
import { simUntil } from "./season";

const sum = (xs: Array<number | null>) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);

describe("game box scores", () => {
  it("packs plays losslessly", () => {
    const p = { inning: 12, bottom: true, batter: 13, pitcher: 9, code: PLAY.SF, runs: 1, outs: 3, bases: 5 } as const;
    expect(unpackPlay(packPlay(p))).toEqual(p);
  });

  it("simulated games keep a box whose line score and lines add up to the result", () => {
    const league = createLeague(rosters as unknown as RosterFile, { userTeam: 136, seed: 9, proj: projFile as unknown as ProjectionFile });
    simUntil(league, "week");
    const done = league.schedule.filter((g) => g.result);
    expect(done.length).toBeGreaterThan(50);
    for (const g of done) {
      const box = g.box!;
      const [a, h] = lineScore(box);
      expect(sum(a)).toBe(g.result!.as);
      expect(sum(h)).toBe(g.result!.hs);
      expect(box.bat[0].reduce((s, b) => s + b[3], 0)).toBe(g.result!.as);
      // Every out is in the log: 3 an inning (fewer in a walk-off half).
      const outs = box.pit[1].reduce((s, p) => s + p[1], 0);
      expect(outs).toBeGreaterThanOrEqual(24);
      const pas = box.bat[0].concat(box.bat[1]).reduce((s, b) => s + b[2] + b[6] + b[13] + b[14], 0);
      expect(box.pbp.filter((v) => isPA(unpackPlay(v).code)).length).toBe(pas);
    }
  });

  it("hand-played games keep the engine's play text and a matching line score", () => {
    const teams = teamsFromRosters(rosters as unknown as RosterFile);
    const ids = [...teams.keys()];
    const setup: GameSetup = { awayTeamId: ids[1], homeTeamId: ids[6], human: "none", innings: 9, seed: 21, difficulty: "pro", awayStarter: 0, homeStarter: 1, abs: true };
    const s = new GameSession(setup, teams);
    while (!s.game.final) s.autoPitch();
    const box = sessionBox(s);
    const [a, h] = lineScore(box);
    expect(sum(a)).toBe(s.game.score.away);
    expect(sum(h)).toBe(s.game.score.home);
    expect(box.txt!.length).toBe(box.pbp.length);
    expect(box.bat[0].length).toBeGreaterThanOrEqual(9);
  });
});
