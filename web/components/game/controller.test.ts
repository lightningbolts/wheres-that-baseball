import { afterEach, describe, expect, it, vi } from "vitest";
import rosters from "@/data/game/rosters.json";
import { GameSession, teamsFromRosters, type GameSetup, type HumanSide } from "@/lib/game/session/session";
import type { RosterFile } from "@/lib/game/types";
import { advancePlayback, createPlayback } from "@/components/game/scene/playback";
import { SWING_LEAD_S } from "@/lib/game/session/humanInput";
import { GameController, idealContactTime } from "@/components/game/controller";
import { Rng } from "@/lib/game/math";

const teams = teamsFromRosters(rosters as unknown as RosterFile);
const ids = [...teams.keys()];

const step = advancePlayback;

function playGame(human: HumanSide, seed: number) {
  const setup: GameSetup = {
    awayTeamId: ids[seed % ids.length],
    homeTeamId: ids[(seed + 7) % ids.length],
    human,
    innings: 3,
    difficulty: "pro",
    seed,
    awayStarter: 0,
    homeStarter: 1,
  };
  const pb = createPlayback();
  const ctl = new GameController(setup, teams, pb);
  // StrictMode-style double mount.
  ctl.start();
  ctl.dispose();
  ctl.start();
  const rng = new Rng(seed ^ 0x5eed);
  let swingAt: number | null = null;
  let swings = 0;
  let marks = 0;
  let readyWaits = 0;
  let steals = 0;
  let longWaits = 0;
  let catcherCam = 0;
  for (let frame = 0; frame < 400_000; frame += 1) {
    vi.advanceTimersByTime(16);
    step(pb, 1 / 60);
    const snap = ctl.getSnapshot();
    // The play never stops to wait for the player: fielding and throws are automatic.
    if (pb.paused) throw new Error("playback paused");
    // From the catcher cam the catcher himself is left out; everywhere else all nine are drawn.
    const drawn = pb.cast!.fielders.map((f) => f.pos);
    if (pb.cam === "batter") {
      catcherCam += 1;
      if (drawn.includes("C") || drawn.length !== 8) throw new Error("catcher drawn in the catcher cam");
    } else if (drawn.length !== 9) throw new Error(`${drawn.length} fielders drawn from the ${pb.cam} cam`);
    // The at-bat's pitch chart: numbered 1..n, each pitch settled before the next is thrown.
    snap.pitches.forEach((m, i) => {
      if (m.n !== i + 1) throw new Error("pitch chart out of order");
      if (m.kind === "pending" && i < snap.pitches.length - 1) throw new Error("unsettled pitch marker");
    });
    marks = Math.max(marks, snap.pitches.length);
    if (snap.phase === "final") return { ctl, swings, marks, catcherCam, steals, longWaits, frames: frame };
    if (snap.phase === "aim") {
      ctl.setAim(rng.range(-0.9, 0.9), rng.range(1.6, 3.4));
      ctl.primary();
      vi.advanceTimersByTime(rng.range(300, 900));
      ctl.primary();
    } else if (snap.phase === "ready" && snap.humanBatting) {
      // The pitcher waits for the batter: nothing happens until he calls for the pitch.
      readyWaits += 1;
      if (readyWaits > 120) {
        longWaits += 1;
        // Sometimes send the runner first.
        if (snap.canSteal && rng.next() < 0.7) {
          ctl.toggleSteal();
          steals += 1;
        }
        ctl.primary();
        readyWaits = 0;
      }
    } else if (snap.phase === "pitch" && pb.timeline && pb.timeline.endT === Infinity) {
      // Human batting: swing at ~60% of pitches with some timing noise.
      if (swingAt == null) {
        const flight = (ctl as unknown as { flight: Parameters<typeof idealContactTime>[0] | null }).flight;
        swingAt = flight && rng.next() < 0.6 ? idealContactTime(flight) - SWING_LEAD_S + rng.range(-0.05, 0.05) : -99;
      }
      if (swingAt > -99 && pb.T >= swingAt) {
        swings += 1;
        ctl.primary();
        swingAt = -99;
      }
    } else swingAt = null;
  }
  throw new Error(`game did not finish (phase ${ctl.getSnapshot().phase}, inning ${JSON.stringify(ctl.getSnapshot().inning)})`);
}

describe("GameController full-game smoke", () => {
  afterEach(() => vi.useRealTimers());

  it.each<[HumanSide, number]>([
    ["none", 11],
    ["home", 41],
    ["away", 37],
  ])("%s plays to a final (seed %i)", (human, seed) => {
    vi.useFakeTimers();
    const res = playGame(human, seed);
    const { ctl, swings, marks, catcherCam, steals, longWaits } = res;
    const snap = ctl.getSnapshot();
    expect(snap.phase).toBe("final");
    const g = ctl.session.game;
    expect(g.final).toBe(true);
    expect(g.score.home).not.toBe(g.score.away);
    if (human !== "none") {
      expect(swings).toBeGreaterThan(0);
      // Every human at-bat pitch waited on the batter (two full seconds, untouched).
      expect(longWaits).toBeGreaterThan(20);
      expect(steals).toBeGreaterThan(0);
    }
    // Long at-bats happened and were charted; the human side hit from the catcher cam.
    expect(marks).toBeGreaterThanOrEqual(5);
    if (human === "none") expect(catcherCam).toBe(0);
    else expect(catcherCam).toBeGreaterThan(0);
    // The HUD caught up with the finished game.
    expect(snap.final).toBe(true);
    expect(snap.score).toEqual(g.score);
    // Recorded inputs carry no fielding decisions and replay to the same game.
    expect(ctl.session.inputs.every((i) => i.throwBase === undefined)).toBe(true);
    const again = GameSession.replay(ctl.setup, ctl.session.inputs, teams).game;
    expect(again.score).toEqual(g.score);
    expect(again.final).toBe(true);
  });
});
