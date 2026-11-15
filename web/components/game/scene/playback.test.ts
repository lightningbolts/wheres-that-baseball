import { describe, expect, it } from "vitest";
import { advancePlayback, createPlayback, MAX_FRAME_DT } from "@/components/game/scene/playback";
import type { Timeline } from "@/lib/game/anim/timeline";

const fakeTimeline = (endT: number) => ({ endT }) as unknown as Timeline;

describe("advancePlayback", () => {
  it("eases into and out of slow motion instead of snapping the rate", () => {
    const pb = createPlayback();
    pb.timeline = fakeTimeline(100);
    pb.slow = { from: 1, to: 2, rate: 0.4 };
    const rates: number[] = [];
    for (let i = 0; i < 600; i += 1) {
      advancePlayback(pb, 1 / 60);
      rates.push(pb.rateNow);
    }
    for (let i = 1; i < rates.length; i += 1) expect(Math.abs(rates[i] - rates[i - 1])).toBeLessThan(0.13);
    expect(Math.min(...rates)).toBeLessThan(0.45);
    expect(pb.rateNow).toBeCloseTo(1, 2);
    expect(pb.T).toBeGreaterThan(2);
  });

  it("lands exactly on a snap cue and fires cues once, in order", () => {
    const pb = createPlayback();
    pb.timeline = fakeTimeline(100);
    const seen: Array<[string, number]> = [];
    pb.cues = [
      { T: 0.3333, snap: true, fn: () => seen.push(["contact", pb.T]) },
      { T: 0.5, fn: () => seen.push(["later", pb.T]) },
    ];
    for (let i = 0; i < 60; i += 1) advancePlayback(pb, 1 / 60);
    expect(seen.map((s) => s[0])).toEqual(["contact", "later"]);
    expect(seen[0][1]).toBe(0.3333);
    expect(seen[1][1]).toBeGreaterThanOrEqual(0.5);
  });

  it("hit-stop all but freezes time for a beat, then releases", () => {
    const pb = createPlayback();
    pb.timeline = fakeTimeline(100);
    pb.hitstop = 0.1;
    const t0 = pb.T;
    for (let i = 0; i < 5; i += 1) advancePlayback(pb, 1 / 60);
    expect(pb.T - t0).toBeLessThan(0.01);
    for (let i = 0; i < 30; i += 1) advancePlayback(pb, 1 / 60);
    expect(pb.T - t0).toBeGreaterThan(0.4);
  });

  it("swallows long frames, honors pause, and ends the timeline once", () => {
    const pb = createPlayback();
    pb.timeline = fakeTimeline(0.5);
    let ended = 0;
    pb.onEnd = () => {
      ended += 1;
    };
    advancePlayback(pb, 5);
    expect(pb.T).toBeLessThanOrEqual(MAX_FRAME_DT + 1e-9);
    pb.paused = true;
    const T = pb.T;
    advancePlayback(pb, 1 / 60);
    expect(pb.T).toBe(T);
    expect(pb.dT).toBe(0);
    pb.paused = false;
    for (let i = 0; i < 60; i += 1) advancePlayback(pb, 1 / 60);
    expect(ended).toBe(1);
  });

  it("visual effects decay on their own", () => {
    const pb = createPlayback();
    pb.fx.shake = 0.3;
    pb.fx.flashAge = 0;
    for (let i = 0; i < 60; i += 1) advancePlayback(pb, 1 / 60);
    expect(pb.fx.shake).toBeLessThan(0.001);
    expect(pb.fx.flashAge).toBeGreaterThan(0.9);
  });
});
