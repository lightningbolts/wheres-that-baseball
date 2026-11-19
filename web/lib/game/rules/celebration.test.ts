import { describe, expect, it } from "vitest";
import { detectCelebration, type GameStakes } from "./celebration";
import type { BaseballGame, GameEvent } from "./game";

/** Just enough of a finished BaseballGame for the celebration to read. */
function game(o: {
  away: number;
  home: number;
  top: boolean;
  /** Losing club's hits / PA, and the winning staff's outs. */
  hits?: number;
  pa?: number;
  outs?: number;
  staff?: number;
  final?: boolean;
}): BaseballGame {
  const loser = o.home > o.away ? "away" : "home";
  const bat = new Map<number, { pa: number; h: number }>();
  const pit = new Map<number, { outs: number }>();
  const hits = o.hits ?? 6;
  const outs = o.outs ?? 27;
  const pa = o.pa ?? outs + 8;
  const side = (s: "away" | "home") => {
    const base = s === "away" ? 100 : 200;
    const staff = Array.from({ length: s === loser ? 2 : (o.staff ?? 1) }, (_, i) => ({ id: base + 50 + i, name: `${s} P${i + 1}` }));
    const slots = Array.from({ length: 9 }, (_, i) => [{ id: base + i, name: `${s} B${i + 1}` }]);
    return { staff, slots };
  };
  const g = { final: o.final ?? true, top: o.top, score: { away: o.away, home: o.home }, regulation: 9, away: side("away"), home: side("home"), bat, pit };
  // The losing lineup's line, all on the leadoff man; the winning staff's outs on its first arm.
  bat.set(loser === "away" ? 100 : 200, { pa, h: hits });
  const win = loser === "away" ? g.home : g.away;
  win.staff.forEach((p, i) => pit.set(p.id, { outs: i === 0 ? outs - 3 * (win.staff.length - 1) : 3 }));
  return g as unknown as BaseballGame;
}

const ev = (e: Partial<GameEvent>): GameEvent => ({ kind: "pitch", inning: 9, top: false, text: "", ...e }) as GameEvent;
const play = (hit: 0 | 1 | 2 | 3 | 4, error = false) => ev({ kind: "in_play", play: { hit, error } as GameEvent["play"] });

describe("celebration type", () => {
  it("is nothing until the game is over", () => {
    expect(detectCelebration(game({ away: 1, home: 2, top: true, final: false }), undefined, [])).toBeNull();
  });

  it("an ordinary win is a handshake line for the club in the field", () => {
    const home = detectCelebration(game({ away: 1, home: 3, top: true }), undefined, [], (s) => s.toUpperCase());
    expect(home).toMatchObject({ style: "handshake", winner: "home", winnerFielding: true, walkoff: null, feat: null, title: "HOME win", fireworks: false });
    // The visitors close it out in the bottom of the ninth.
    const away = detectCelebration(game({ away: 5, home: 3, top: false }), undefined, []);
    expect(away).toMatchObject({ style: "handshake", winner: "away", winnerFielding: true, walkoff: null });
  });

  it("a walk-off (any way the run scores) is a mob at the plate, with the way it scored on the banner", () => {
    const hr = detectCelebration(game({ away: 3, home: 5, top: false }), undefined, [play(4)])!;
    expect(hr).toMatchObject({ style: "walkoff", winner: "home", winnerFielding: false, walkoff: "home-run", title: "Walk-off!", fireworks: true });
    expect(hr.sub).toContain("Walk-off home run");
    expect(detectCelebration(game({ away: 3, home: 4, top: false }), undefined, [play(1)])!.walkoff).toBe("single");
    expect(detectCelebration(game({ away: 3, home: 4, top: false }), undefined, [play(0, true)])!.walkoff).toBe("error");
    expect(detectCelebration(game({ away: 3, home: 4, top: false }), undefined, [ev({ kind: "walk" })])!.walkoff).toBe("walk");
    expect(detectCelebration(game({ away: 3, home: 4, top: false }), undefined, [ev({ kind: "hbp" })])!.walkoff).toBe("hbp");
    expect(detectCelebration(game({ away: 3, home: 4, top: false }), undefined, [ev({ kind: "wild_pitch" })])!.walkoff).toBe("other");
  });

  it("no-hitters and perfect games swarm the pitcher on the mound", () => {
    const nh = detectCelebration(game({ away: 0, home: 2, top: true, hits: 0, pa: 30, outs: 27 }), undefined, [])!;
    expect(nh).toMatchObject({ style: "swarm", feat: "no-hitter", title: "No-hitter", fireworks: true });
    expect(nh.sub).toContain("home P1");
    const pg = detectCelebration(game({ away: 0, home: 1, top: true, hits: 0, pa: 27, outs: 27 }), undefined, [])!;
    expect(pg).toMatchObject({ style: "swarm", feat: "perfect-game", title: "Perfect game" });
    const combined = detectCelebration(game({ away: 3, home: 0, top: false, hits: 0, pa: 29, outs: 27, staff: 3 }), undefined, [])!;
    expect(combined).toMatchObject({ style: "swarm", winner: "away", feat: "no-hitter", title: "Combined no-hitter", fireworks: false });
    // A hit, or a game cut short, is no no-hitter.
    expect(detectCelebration(game({ away: 0, home: 2, top: true, hits: 1, pa: 30 }), undefined, [])!.feat).toBeNull();
    expect(detectCelebration(game({ away: 0, home: 2, top: true, hits: 0, pa: 20, outs: 18 }), undefined, [])!.feat).toBeNull();
    // A walk-off on a no-hit day: the mob at the plate, with the feat on the banner.
    const wo = detectCelebration(game({ away: 0, home: 1, top: false, hits: 0, pa: 27, outs: 27 }), undefined, [play(4)])!;
    expect(wo).toMatchObject({ style: "walkoff", feat: "perfect-game", title: "Perfect game" });
  });

  it("clinching is a huddle with a clubhouse banner; only the winner's stakes count", () => {
    const stakes: GameStakes = { home: { kind: "clinch-division", label: "NL East champions" }, away: { kind: "clinch-wildcard", label: "Clinched a playoff spot" } };
    const c = detectCelebration(game({ away: 1, home: 3, top: true }), stakes, [])!;
    expect(c).toMatchObject({ style: "huddle", title: "Clinched", stake: { kind: "clinch-division" }, fireworks: true });
    expect(c.sub).toContain("NL East champions");
    const road = detectCelebration(game({ away: 4, home: 3, top: false }), stakes, [])!;
    expect(road).toMatchObject({ style: "huddle", winner: "away", stake: { kind: "clinch-wildcard" }, fireworks: false });
    // The club that would have clinched lost: just a win for the other one.
    expect(detectCelebration(game({ away: 4, home: 3, top: false }), { home: stakes.home }, [])!.style).toBe("handshake");
    // A walk-off clinch is still a walk-off, with the clinch on the banner.
    const wo = detectCelebration(game({ away: 3, home: 4, top: false }), stakes, [play(1)])!;
    expect(wo).toMatchObject({ style: "walkoff", title: "Clinched" });
    expect(wo.sub).toContain("Walk-off single");
  });

  it("series, pennant and World Series: huddle for a series, a dogpile and confetti for the big ones", () => {
    const series = detectCelebration(game({ away: 2, home: 5, top: true }), { home: { kind: "series-clinch", label: "Wild Card Series won" } }, [])!;
    expect(series).toMatchObject({ style: "huddle", title: "Series Won", confetti: false });
    const pennant = detectCelebration(game({ away: 6, home: 5, top: false }), { away: { kind: "pennant", label: "AL champions" } }, [])!;
    expect(pennant).toMatchObject({ style: "dogpile", winnerFielding: true, title: "Pennant Winners", confetti: true, fireworks: true });
    const ws = detectCelebration(game({ away: 2, home: 3, top: false }), { home: { kind: "world-series", label: "Champs" } }, [play(2)])!;
    expect(ws).toMatchObject({ style: "dogpile", winnerFielding: false, walkoff: "double", title: "World Series Champions", confetti: true });
    expect(ws.duration).toBeGreaterThan(series.duration - 1);
    const alive = detectCelebration(game({ away: 2, home: 3, top: true }), { home: { kind: "elimination-save", label: "Forces Game 6" } }, [])!;
    expect(alive).toMatchObject({ style: "handshake", title: "Still Alive" });
  });

  it("every style has its own length and loudness", () => {
    const h = detectCelebration(game({ away: 1, home: 3, top: true }), undefined, [])!;
    const w = detectCelebration(game({ away: 3, home: 5, top: false }), undefined, [play(4)])!;
    expect(w.intensity).toBeGreaterThan(h.intensity);
    expect(w.duration).toBeGreaterThan(h.duration);
  });
});
