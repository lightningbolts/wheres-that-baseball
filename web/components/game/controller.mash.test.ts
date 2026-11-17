import { afterEach, expect, it, vi } from "vitest";
import rosters from "@/data/game/rosters.json";
import { teamsFromRosters, type GameSetup } from "@/lib/game/session/session";
import type { RosterFile } from "@/lib/game/types";
import { advancePlayback, createPlayback } from "@/components/game/scene/playback";
import { GameController } from "@/components/game/controller";

const teams = teamsFromRosters(rosters as unknown as RosterFile);
const ids = [...teams.keys()];

afterEach(() => vi.useRealTimers());

// Space pressed at any moment (mid-pitch, during an ABS review, as a third out flips the
// half) never throws and the game still reaches a final.
it("mashing Space through an All-Star ABS game never crashes", () => {
  vi.useFakeTimers();
  for (let seed = 1; seed < 4; seed += 1) {
    const setup: GameSetup = { awayTeamId: ids[seed], homeTeamId: ids[seed + 9], human: "away", innings: 3, difficulty: "allstar", seed, awayStarter: 0, homeStarter: 0, abs: true };
    const pb = createPlayback();
    const ctl = new GameController(setup, teams, pb);
    ctl.start();
    let f = 0;
    for (; f < 200_000 && ctl.getSnapshot().phase !== "final"; f += 1) {
      vi.advanceTimersByTime(16);
      advancePlayback(pb, 1 / 60);
      if (f % 15 === 0) ctl.primary();
    }
    expect(ctl.getSnapshot().phase).toBe("final");
    ctl.dispose();
  }
});
