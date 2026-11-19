import { afterEach, describe, expect, it, vi } from "vitest";
import rosters from "@/data/game/rosters.json";
import { teamsFromRosters, type GameSetup } from "@/lib/game/session/session";
import type { RosterFile } from "@/lib/game/types";
import { advancePlayback, createPlayback } from "@/components/game/scene/playback";
import { GameController, type HudSnapshot } from "@/components/game/controller";

const teams = teamsFromRosters(rosters as unknown as RosterFile);
const ids = [...teams.keys()];

afterEach(() => vi.useRealTimers());

/** A CPU-vs-CPU game run frame by frame until `stop` says so (or the final screen). */
function run(seed: number, stop: (s: HudSnapshot, ctl: GameController) => boolean, extra: Partial<GameSetup> = {}) {
  const setup: GameSetup = { awayTeamId: ids[seed % ids.length], homeTeamId: ids[(seed + 5) % ids.length], human: "none", innings: 2, difficulty: "pro", seed, awayStarter: 0, homeStarter: 0, ...extra };
  const pb = createPlayback();
  const ctl = new GameController(setup, teams, pb);
  ctl.start();
  const phases: string[] = [];
  for (let f = 0; f < 300_000; f += 1) {
    vi.advanceTimersByTime(16);
    advancePlayback(pb, 1 / 60);
    const s = ctl.getSnapshot();
    if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
    if (stop(s, ctl)) return { ctl, pb, phases, snap: s };
  }
  throw new Error(`stuck in ${ctl.getSnapshot().phase}`);
}

describe("postgame celebration", () => {
  it("the last out holds a beat, the winners celebrate, then the final screen", () => {
    vi.useFakeTimers();
    let sawParty: HudSnapshot | null = null;
    let finalBeforeParty = 0;
    let holdFrames = 0;
    const { ctl, phases } = run(3, (s) => {
      if (s.phase === "celebrate") sawParty = sawParty ?? s;
      // Game over, not yet on the final screen: the play is still being shown.
      if (s.final && s.phase !== "celebrate" && s.phase !== "final") holdFrames += 1;
      if (s.phase === "final" && !sawParty) finalBeforeParty += 1;
      return s.phase === "final";
    });
    expect(finalBeforeParty).toBe(0);
    expect(phases.slice(-2)).toEqual(["celebrate", "final"]);
    // At least the ~1.3 s beat at 16 ms a frame.
    expect(holdFrames).toBeGreaterThan(60);
    const party = sawParty as unknown as HudSnapshot;
    expect(party.final).toBe(true);
    expect(party.celebration).not.toBeNull();
    expect(party.celebration!.title.length).toBeGreaterThan(0);
    expect(ctl.getSnapshot().celebration).toBeNull();
    expect(ctl.session.game.final).toBe(true);
  });

  it("Space right away does not skip it; Space a moment later, or the skip button, does", () => {
    vi.useFakeTimers();
    const a = run(3, (s) => s.phase === "celebrate");
    a.ctl.primary();
    expect(a.ctl.getSnapshot().phase).toBe("celebrate");
    vi.advanceTimersByTime(600);
    a.ctl.primary();
    expect(a.ctl.getSnapshot().phase).toBe("final");
    // The skip button works at once, and only once the game is over.
    const b = run(3, (s) => s.phase === "celebrate");
    b.ctl.skipCelebration();
    expect(b.ctl.getSnapshot().phase).toBe("final");
    expect(b.ctl.getSnapshot().celebration).toBeNull();
    const c = run(3, (s) => s.phase === "ready" || s.phase === "pitch");
    c.ctl.skipCelebration();
    expect(c.ctl.getSnapshot().phase).not.toBe("final");
  });

  it("skipping during the postgame hold goes straight to the final screen and stays there", () => {
    vi.useFakeTimers();
    const { ctl, pb } = run(3, (s) => s.final && s.phase !== "celebrate" && s.phase !== "final");
    ctl.skipCelebration();
    expect(ctl.getSnapshot().phase).toBe("final");
    for (let f = 0; f < 600; f += 1) {
      vi.advanceTimersByTime(16);
      advancePlayback(pb, 1 / 60);
    }
    expect(ctl.getSnapshot().phase).toBe("final");
    expect(ctl.getSnapshot().celebration).toBeNull();
  });

  it("a World Series clincher is a dogpile with confetti and fireworks", () => {
    vi.useFakeTimers();
    const stakes = { away: { kind: "world-series" as const, label: "Away win it all" }, home: { kind: "world-series" as const, label: "Home win it all" } };
    const { snap } = run(7, (s) => s.phase === "celebrate", { stakes });
    expect(snap.celebration).toMatchObject({ style: "dogpile", confetti: true, fireworks: true, stake: "world-series" });
  });
});
