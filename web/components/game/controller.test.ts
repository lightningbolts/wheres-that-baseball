import { afterEach, describe, expect, it, vi } from "vitest";
import rosters from "@/data/game/rosters.json";
import { GameSession, teamsFromRosters, type GameSetup, type HumanSide } from "@/lib/game/session/session";
import type { RosterFile } from "@/lib/game/types";
import { advancePlayback, createPlayback } from "@/components/game/scene/playback";
import { SWING_LEAD_S } from "@/lib/game/session/humanInput";
import { GameController, idealContactTime } from "@/components/game/controller";
import { Rng } from "@/lib/game/math";
import { plateHud } from "@/components/game/scene/view";

const teams = teamsFromRosters(rosters as unknown as RosterFile);
const ids = [...teams.keys()];

const step = advancePlayback;

function playGame(human: HumanSide, seed: number, extra: Partial<GameSetup> = {}) {
  const setup: GameSetup = {
    awayTeamId: ids[seed % ids.length],
    homeTeamId: ids[(seed + 7) % ids.length],
    human,
    innings: 3,
    difficulty: "pro",
    seed,
    awayStarter: 0,
    homeStarter: 1,
    ...extra,
  };
  const pb = createPlayback();
  const hud = plateHud(pb);
  const cpuReviews = new Set<number>();
  let verdicts = 0;
  let hiddenFrames = 0;
  let hiddenOutsidePitch = 0;
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
  let chances = 0;
  let longWaits = 0;
  let catcherCam = 0;
  let handoffs = 0;
  let windows = 0;
  let challenged = 0;
  const pickoffSteps = new Set<number>();
  let humanThrowOvers = 0;
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
    if (snap.phase === "pickoff" && pb.timeline) pickoffSteps.add(ctl.session.inputs.length);
    // ABS reviews (CPU ones included) and the All-Star zone, hidden only through the delivery.
    if (snap.review?.cpu) cpuReviews.add(ctl.session.pitchLog.length);
    if (snap.review?.stage === "verdict") verdicts += 1;
    if (snap.phase === "review" && !snap.review) throw new Error("review phase without a card");
    if (hud.zoneHiddenUntil != null && pb.timeline && pb.T < hud.zoneHiddenUntil) {
      hiddenFrames += 1;
      if (snap.phase !== "pitch" && snap.phase !== "play") hiddenOutsidePitch += 1;
    }
    // Once the third out is made, nobody shows up on a base (or gets a SAFE call) on that play.
    if (snap.outs >= 3 && snap.bases.some(Boolean)) throw new Error(`runner on base with three out: ${snap.bases}`);
    if (snap.outs >= 3 && snap.call && snap.call.text !== "OUT") throw new Error(`${snap.call.text} call after the third out`);
    if (snap.phase === "final") return { ctl, swings, marks, catcherCam, steals, chances, longWaits, handoffs, windows, challenged, frames: frame, cpuReviews: cpuReviews.size, verdicts, hiddenFrames, hiddenOutsidePitch, pickoffSteps: pickoffSteps.size, humanThrowOvers };
    // Two players: the cover card waits for the next player.
    if (snap.phase === "handoff") {
      if (!snap.handoff) throw new Error("handoff phase without a card");
      handoffs += 1;
      ctl.primary();
      continue;
    }
    // ABS: challenge about half the calls the human gets a window on.
    if (snap.phase === "challenge") {
      if (!snap.challenge) throw new Error("challenge phase without a window");
      windows += 1;
      const yes = rng.next() < 0.5;
      if (yes) challenged += 1;
      ctl.decideChallenge(yes);
      continue;
    }
    if (snap.phase === "aim" && snap.pickoffs.length && snap.disengagements < 2 && rng.next() < 0.15) {
      humanThrowOvers += 1;
      ctl.pickoff();
      continue;
    }
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
        if (snap.canSteal) chances += 1;
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
    ["away", 43],
  ])("%s plays to a final (seed %i)", (human, seed) => {
    vi.useFakeTimers();
    const res = playGame(human, seed);
    const { ctl, swings, marks, catcherCam, steals, chances, longWaits } = res;
    const snap = ctl.getSnapshot();
    expect(snap.phase).toBe("final");
    const g = ctl.session.game;
    expect(g.final).toBe(true);
    expect(g.score.home).not.toBe(g.score.away);
    if (human !== "none") {
      expect(swings).toBeGreaterThan(0);
      // Every human at-bat pitch waited on the batter (two full seconds, untouched).
      expect(longWaits).toBeGreaterThan(20);
      // Runners go when the batter sends them (whenever a steal was on).
      if (chances >= 3) expect(steals).toBeGreaterThan(0);
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

describe("ABS and two players through the controller", () => {
  afterEach(() => vi.useRealTimers());

  it("plays a one-player ABS game: challenge windows open, challenges are recorded and replay", () => {
    vi.useFakeTimers();
    const { ctl, windows, challenged } = playGame("home", 51, { abs: true });
    const g = ctl.session.game;
    expect(g.final).toBe(true);
    expect(windows).toBeGreaterThan(0);
    expect(ctl.session.inputs.filter((i) => i.challenge).length).toBe(challenged);
    const reviews = g.log.filter((e) => e.kind === "abs_challenge");
    expect(reviews.length).toBeGreaterThanOrEqual(challenged);
    expect(g.abs!.away).toBeGreaterThanOrEqual(0);
    expect(g.abs!.home).toBeGreaterThanOrEqual(0);
    const again = GameSession.replay(ctl.setup, ctl.session.inputs, teams).game;
    expect(again.score).toEqual(g.score);
    expect(again.log.filter((e) => e.kind === "abs_challenge").length).toBe(reviews.length);
  });

  it("the CPU club challenges too, through the same review and verdict", () => {
    vi.useFakeTimers();
    // The controller seeds the human's swing noise from the clock: pin it so the games repeat.
    vi.setSystemTime(new Date("2026-06-01T19:05:00Z"));
    let cpuChallenges = 0;
    let reviews = 0;
    let shown = 0;
    for (const seed of [52, 56]) {
      const { ctl, cpuReviews, verdicts } = playGame("home", seed, { abs: true, innings: 9 });
      const g = ctl.session.game;
      cpuChallenges += g.log.filter((e) => e.kind === "abs_challenge" && e.abs?.side === "away").length;
      reviews += cpuReviews;
      shown += verdicts;
      // Same limits: never below zero, and a club out of challenges stays out (no extras here).
      expect(g.abs!.away).toBeGreaterThanOrEqual(0);
    }
    expect(cpuChallenges).toBeGreaterThan(0);
    expect(reviews).toBeGreaterThan(0);
    expect(shown).toBeGreaterThan(0);
  });

  it("throw-overs play through the game: the CPU's and the human pitcher's, and they replay", () => {
    vi.useFakeTimers();
    for (const [human, seed] of [["home", 54], ["none", 55]] as const) {
      const { ctl, pickoffSteps, humanThrowOvers } = playGame(human, seed, { innings: 9 });
      const s = ctl.session;
      expect(s.setup.pickoffs).toBe(true);
      const recorded = s.inputs.filter((i) => i.pickoff !== undefined).length;
      if (human === "home") expect(humanThrowOvers).toBeGreaterThan(0);
      else expect(recorded).toBeGreaterThan(0);
      // Every throw-over was staged on screen.
      expect(pickoffSteps).toBe(recorded);
      const r = GameSession.replay(s.setup, s.inputs, teams);
      expect(r.game.score).toEqual(s.game.score);
      expect(r.game.log.length).toBe(s.game.log.length);
    }
  });

  it("All-Star hides the zone through the delivery only; other levels never do", () => {
    vi.useFakeTimers();
    const star = playGame("home", 53, { difficulty: "allstar" });
    expect(star.hiddenFrames).toBeGreaterThan(0);
    expect(star.hiddenOutsidePitch).toBe(0);
    const pro = playGame("home", 53, { difficulty: "pro" });
    expect(pro.hiddenFrames).toBe(0);
  });

  it("plays a two-player pass-the-device game: both sides pitch and hit, every pitch changes hands", () => {
    vi.useFakeTimers();
    const { ctl, swings, handoffs, catcherCam } = playGame("both", 57, { abs: true, hidePitch: true });
    const g = ctl.session.game;
    expect(g.final).toBe(true);
    expect(swings).toBeGreaterThan(0);
    expect(catcherCam).toBeGreaterThan(0);
    // Two cards a human pitch: the pitcher's turn and the hitter's.
    const humanPitches = ctl.session.inputs.filter((i) => !i.cpu).length;
    expect(handoffs).toBeGreaterThanOrEqual(humanPitches);
    // Every human pitch carries both players' input: the pitch and the swing (or take).
    // (Throw-overs are steps of their own, with no pitch or swing.)
    for (const i of ctl.session.inputs.filter((x) => !x.cpu && x.pickoff === undefined)) {
      expect(i.pitch).toBeDefined();
      expect(i.swing).toBeDefined();
    }
    const again = GameSession.replay(ctl.setup, ctl.session.inputs, teams).game;
    expect(again.score).toEqual(g.score);
  });
});

describe("pitch call marks", () => {
  it("calls a batted ball that lands foul a foul, not in play", async () => {
    const { finalMark } = await import("@/components/game/controller");
    const s = new GameSession(
      { awayTeamId: ids[0], homeTeamId: ids[1], human: "none", innings: 9, difficulty: "pro", seed: 7, awayStarter: 0, homeStarter: 1 } as GameSetup,
      teams,
    );
    let seen = 0;
    for (let i = 0; i < 400 && seen < 3; i += 1) {
      const c = s.autoPitch();
      if (c.result.kind === "in_play" && c.play?.foul) {
        expect(finalMark(c).kind).toBe("foul");
        seen += 1;
      } else if (c.result.kind === "in_play" && c.play && !c.play.foul) {
        expect(["in_play", "in_play_out"]).toContain(finalMark(c).kind);
      }
      if (s.game.final) break;
    }
    expect(seen).toBeGreaterThan(0);
  });
});
