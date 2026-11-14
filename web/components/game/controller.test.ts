import { afterEach, describe, expect, it, vi } from "vitest";
import rosters from "@/data/game/rosters.json";
import { teamsFromRosters, type GameSetup, type HumanSide } from "@/lib/game/session/session";
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
  let prompts = 0;
  let swings = 0;
  for (let frame = 0; frame < 400_000; frame += 1) {
    vi.advanceTimersByTime(16);
    step(pb, 1 / 60);
    const snap = ctl.getSnapshot();
    if (snap.phase === "final") return { ctl, prompts, swings, frames: frame };
    if (snap.phase === "aim") {
      ctl.setAim(rng.range(-0.9, 0.9), rng.range(1.6, 3.4));
      ctl.primary();
      vi.advanceTimersByTime(rng.range(300, 900));
      ctl.primary();
    } else if (snap.phase === "throw") {
      prompts += 1;
      ctl.chooseThrow(rng.next() < 0.5 ? undefined : snap.prompt!.options[0]?.base);
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
    ["home", 23],
    ["away", 37],
  ])("%s plays to a final (seed %i)", (human, seed) => {
    vi.useFakeTimers();
    const res = playGame(human, seed);
    const { ctl, swings } = res;
    const snap = ctl.getSnapshot();
    expect(snap.phase).toBe("final");
    const g = ctl.session.game;
    expect(g.final).toBe(true);
    expect(g.score.home).not.toBe(g.score.away);
    if (human !== "none") expect(swings).toBeGreaterThan(0);
  });
});
