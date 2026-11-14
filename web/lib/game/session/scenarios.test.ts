/**
 * Visual-QA helper (env-gated: SCENARIOS=<out.json>). Plays CPU-vs-CPU games and records,
 * for notable plays (home runs, foul pops caught and uncaught, double plays, fly outs,
 * strikeouts), the save that resumes the game right before that pitch. A headless
 * browser loads each save and screenshots the play.
 */
import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import rosters from "@/data/game/rosters.json";
import { GameSession, teamsFromRosters, type GameSetup, type PitchInput } from "@/lib/game/session/session";
import type { RosterFile } from "@/lib/game/types";
import type { CommittedPitch } from "@/lib/game/session/session";

const OUT = process.env.SCENARIOS;

type Kind = "hr" | "foulCatch" | "foulStands" | "dp" | "flyout" | "strikeout" | "single" | "wallBall";

function classify(c: CommittedPitch): Kind | null {
  const play = c.play;
  const r = c.result;
  if (r.kind === "swinging_strike" && c.events.some((e) => e.kind === "strikeout")) return "strikeout";
  if (!play || r.kind !== "in_play") {
    if (r.kind === "foul" && r.path && r.path.apex > 40) return "foulStands";
    return null;
  }
  if (play.events.some((e) => e.type === "homerun")) return "hr";
  const ctch = play.events.find((e) => e.type === "catch");
  if (play.caught && ctch?.to && (ctch.to.z < 0 || Math.abs(Math.atan2(-ctch.to.x, ctch.to.z)) > Math.PI / 4)) return "foulCatch";
  if (play.foul && r.path && r.path.apex > 40) return "foulStands";
  if (play.doublePlay) return "dp";
  if (play.caught && ctch && ["LF", "CF", "RF"].includes(ctch.pos ?? "")) return "flyout";
  if (r.path?.hitWall && play.hit >= 2) return "wallBall";
  if (play.hit === 1) return "single";
  return null;
}

describe.skipIf(!OUT)("scenario finder", () => {
  it("records saves before notable plays", () => {
    const teams = teamsFromRosters(rosters as unknown as RosterFile);
    const ids = [...teams.keys()];
    const want: Record<Kind, number> = { hr: 3, foulCatch: 3, foulStands: 2, dp: 2, flyout: 2, strikeout: 1, single: 1, wallBall: 2 };
    const found: Array<{ kind: Kind; home: number; inning: number; top: boolean; setup: GameSetup; inputs: PitchInput[] }> = [];
    for (let seed = 1; seed < 40 && Object.values(want).some((n) => n > 0); seed += 1) {
      const setup: GameSetup = {
        awayTeamId: ids[(seed * 7) % ids.length],
        homeTeamId: ids[(seed * 11 + 3) % ids.length],
        human: "none",
        innings: 9,
        difficulty: "pro",
        seed: 1000 + seed,
        awayStarter: 0,
        homeStarter: 0,
      };
      if (setup.awayTeamId === setup.homeTeamId) continue;
      const s = new GameSession(setup, teams);
      let perGame = 0;
      while (!s.game.final && perGame < 3) {
        const before = s.inputs.length;
        const inning = s.game.inning;
        const top = s.game.top;
        const c = s.autoPitch();
        const k = classify(c);
        if (k && want[k] > 0) {
          want[k] -= 1;
          perGame += 1;
          found.push({ kind: k, home: setup.homeTeamId, inning, top, setup, inputs: s.inputs.slice(0, before) });
        }
      }
    }
    writeFileSync(OUT!, JSON.stringify(found));
    console.log(found.map((f) => `${f.kind} home=${f.home} inn=${f.inning}${f.top ? "t" : "b"} pitch#${f.inputs.length}`).join("\n"));
  }, 120_000);
});
