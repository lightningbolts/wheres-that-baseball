import { describe, expect, it } from "vitest";
import { buildCelebrationTimeline, DUGOUT_FRONT, MOUND, withPlateMob, type CelebrationInput } from "./celebration";
import type { CelebrationStyle } from "@/lib/game/rules/celebration";
import type { Timeline } from "./timeline";

const POS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;
const SPOTS: Record<string, [number, number]> = { P: [0, 60.5], C: [0, -2], "1B": [60, 75], "2B": [35, 135], "3B": [-60, 75], SS: [-35, 135], LF: [-160, 250], CF: [0, 310], RF: [160, 250] };

function input(style: CelebrationStyle, winnerFielding: boolean): CelebrationInput {
  return {
    style,
    winnerFielding,
    fielders: POS.map((pos) => ({ pos, x: SPOTS[pos][0], z: SPOTS[pos][1] })),
    hitters: [
      { id: 1, x: 0, z: 0 },
      { id: 2, x: 63, z: 63 },
    ],
    hero: winnerFielding ? null : 1,
    mob: [
      { id: 10, x: -64, z: -4 },
      { id: 11, x: -66, z: -4 },
    ],
    homeRun: false,
    battingDugout: DUGOUT_FRONT.home,
    fieldingDugout: DUGOUT_FRONT.away,
    duration: 7,
  };
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe("celebration choreography", () => {
  it("everyone starts where he was, the winners gather, the losers head for their dugout", () => {
    for (const [style, wf] of [
      ["handshake", true],
      ["huddle", true],
      ["swarm", true],
      ["dogpile", true],
      ["walkoff", false],
      ["dogpile", false],
    ] as const) {
      const inp = input(style, wf);
      const tl = buildCelebrationTimeline(inp);
      for (const f of inp.fielders) {
        const s = tl.fielder(f.pos, 0);
        expect(dist(s.p, f), `${style} ${f.pos} at T=0`).toBeLessThan(1);
      }
      // Winners end up together (the infield and battery; outfielders may still be on the way).
      const winnersEnd = wf ? inp.fielders.filter((f) => !["LF", "CF", "RF"].includes(f.pos)).map((f) => tl.fielder(f.pos, inp.duration).p) : [1, 2, 10, 11].map((id) => tl.runner(id, inp.duration)!.p);
      const spread = Math.max(...winnersEnd.map((p) => Math.hypot(p.x - winnersEnd[0].x, p.z - winnersEnd[0].z)));
      expect(spread, `${style} winners spread`).toBeLessThan(40);
      // Losers walk toward their dugout.
      if (wf) {
        const r = inp.hitters[1];
        const end = tl.runner(r.id, inp.duration)!.p;
        expect(dist(end, inp.battingDugout), `${style} loser`).toBeLessThan(dist(r, inp.battingDugout));
      } else {
        const cf = tl.fielder("CF", inp.duration).p;
        expect(dist(cf, inp.fieldingDugout)).toBeLessThan(dist({ x: 0, z: 310 }, inp.fieldingDugout));
      }
      expect(tl.batter(1)).toBeNull();
    }
  });

  it("a swarm and a fielding dogpile meet on the mound; a dogpile has men off their feet", () => {
    const swarm = buildCelebrationTimeline(input("swarm", true));
    expect(dist(swarm.focus(5), MOUND)).toBeLessThan(5);
    const pile = buildCelebrationTimeline(input("dogpile", true));
    const states = POS.map((p) => pile.fielder(p, 4));
    expect(states.some((s) => s.action === "dive")).toBe(true);
    expect(states.some((s) => (s.lift ?? 0) > 0.5)).toBe(true);
    const shake = buildCelebrationTimeline(input("handshake", true));
    expect(POS.map((p) => shake.fielder(p, 4)).some((s) => s.action === "dive")).toBe(false);
  });

  it("a walk-off home run mob joins the play's timeline and waits at the plate", () => {
    const base = { runnerIds: [1], runner: () => null, focus: () => ({ x: 0, z: 0 }) } as unknown as Timeline;
    const tl = withPlateMob(base, [{ id: 10, x: -64, z: -4 }], 3);
    expect(tl.runnerIds).toContain(10);
    expect(dist(tl.runner(10, 12)!.p, { x: 0, z: 0 })).toBeLessThan(15);
  });
});
