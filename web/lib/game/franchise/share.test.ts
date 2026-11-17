import { describe, expect, it } from "vitest";
import rosters from "@/data/game/rosters.json";
import type { RosterFile } from "@/lib/game/types";
import { createLeague } from "./league";
import { simUntil } from "./season";
import { decodeGame, encodeGame } from "./share";

describe("shared game links", () => {
  it("carry a game's box score, teams and names through the URL hash", async () => {
    const league = createLeague(rosters as unknown as RosterFile, { userTeam: 136, seed: 4 });
    simUntil(league, "day");
    const game = league.schedule.find((g) => g.result && g.box)!;
    const hash = await encodeGame(league, game);
    expect(hash[0]).toBe("z");
    expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hash.length).toBeLessThan(6000);
    const back = await decodeGame(`#${hash}`);
    expect(back.game).toEqual(game);
    expect(back.league.teams[game.home].name).toBe(league.teams[game.home].name);
    const someone = game.box!.bat[0][0][0];
    expect(back.league.players[someone].name).toBe(league.players[someone].name);
    expect(back.league.calendar.start).toBe(league.calendar.start);
    await expect(decodeGame("#zgarbage")).rejects.toThrow();
  });
});
