import { describe, expect, it } from "vitest";
import { classifyDevice, FpsGovernor, nextSetting, PROFILES } from "@/components/game/scene/quality";

describe("graphics quality", () => {
  it("rates devices by their weakest signal", () => {
    expect(classifyDevice({ cores: 10, memory: 8, renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)", maxTexture: 16384 })).toBe("high");
    expect(classifyDevice({ cores: 16, memory: 8, renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)", maxTexture: 16384 })).toBe("high");
    expect(classifyDevice({ cores: 8, memory: 8, renderer: "ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)" })).toBe("medium");
    expect(classifyDevice({ cores: 8, memory: 8, renderer: "ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)" })).toBe("high");
    expect(classifyDevice({ cores: 4, memory: 8, renderer: "NVIDIA GeForce GTX 1060" })).toBe("medium");
    expect(classifyDevice({ cores: 8, memory: 4 })).toBe("medium");
    expect(classifyDevice({ cores: 2, memory: 8 })).toBe("low");
    expect(classifyDevice({ cores: 8, memory: 2 })).toBe("low");
    expect(classifyDevice({ cores: 4, renderer: "ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11 vs_5_0 ps_5_0)" })).toBe("low");
    expect(classifyDevice({ renderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)" })).toBe("low");
    expect(classifyDevice({ maxTexture: 4096 })).toBe("low");
    expect(classifyDevice({ noWebGL2: true })).toBe("low");
    expect(classifyDevice({ smallScreen: true, renderer: "Apple GPU" })).toBe("medium");
    expect(classifyDevice({})).toBe("high");
  });

  it("tiers only ever get cheaper going down", () => {
    const [h, m, l] = [PROFILES.high, PROFILES.medium, PROFILES.low];
    for (const [a, b] of [
      [h, m],
      [m, l],
    ]) {
      expect(b.dpr[1]).toBeLessThanOrEqual(a.dpr[1]);
      expect(b.shadowMap).toBeLessThanOrEqual(a.shadowMap);
      expect(b.crowd).toBeLessThanOrEqual(a.crowd);
      expect(b.mow).toBeLessThanOrEqual(a.mow);
      expect(b.atlasScale).toBeLessThanOrEqual(a.atlasScale);
    }
    // High is the look the game shipped with.
    expect(h).toMatchObject({ antialias: true, logDepth: true, dpr: [1, 1.5], shadowMap: 4096, crowd: 1, clouds: true });
  });

  it("cycles Auto → High → Medium → Low", () => {
    expect(nextSetting("auto")).toBe("high");
    expect(nextSetting("high")).toBe("medium");
    expect(nextSetting("medium")).toBe("low");
    expect(nextSetting("low")).toBe("auto");
  });
});

describe("Auto's frame-rate governor", () => {
  /** Run `ms` of frames at `fps`, handing each verdict to `on`. */
  const play = (g: FpsGovernor, t0: number, ms: number, fps: number, on: (d: -1 | 1, now: number) => boolean = () => false) => {
    const out: number[] = [];
    let now = t0;
    for (; now < t0 + ms; now += 1000 / fps) {
      const d = g.frame(now);
      if (d !== 0) {
        out.push(d);
        g.stepped(d, on(d, now), now);
      }
    }
    return { out, now };
  };

  it("steps down a scene that is slow from the very first frame", () => {
    const g = new FpsGovernor();
    expect(play(g, 0, 5000, 30).out).toContain(-1);
  });

  it("leaves a smooth scene alone, and steps up only after a long smooth spell", () => {
    const g = new FpsGovernor();
    expect(play(g, 0, 20_000, 60).out).toEqual([]);
    const { out } = play(g, 20_000, 40_000, 60);
    expect(out.every((d) => d === 1)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it("rides out a short slow stretch (a busy play, a GC pause) without stepping", () => {
    const g = new FpsGovernor();
    let t = play(g, 0, 5000, 60).now;
    t = play(g, t, 2500, 30).now;
    expect(play(g, t, 5000, 60).out).toEqual([]);
  });

  it("no-op steps never use up its patience: still steps down after a long healthy spell", () => {
    const g = new FpsGovernor();
    // Already at the top tier: every step up changes nothing.
    const a = play(g, 0, 120_000, 60, () => false);
    expect(a.out.length).toBeGreaterThan(1);
    expect(g.stopped).toBe(false);
    expect(play(g, a.now, 7000, 25).out).toContain(-1);
  });

  it("never oscillates: a step up that has to be undone settles on the lower tier", () => {
    const g = new FpsGovernor();
    // Slow at the top: down. Smooth below: eventually back up. Slow again: down, and stop.
    let r = play(g, 0, 8000, 25, () => true);
    expect(r.out).toEqual([-1]);
    r = play(g, r.now, 40_000, 60, () => true);
    expect(r.out).toEqual([1]);
    r = play(g, r.now, 8000, 25, () => true);
    expect(r.out).toEqual([-1]);
    expect(g.stopped).toBe(true);
    expect(play(g, r.now, 60_000, 60).out).toEqual([]);
  });

  it("a hidden tab's pause is not read as a slow frame rate", () => {
    const g = new FpsGovernor();
    let t = play(g, 0, 1200, 60).now;
    // Two frames a second apart (rAF throttled), then normal again.
    for (let i = 0; i < 6; i += 1) {
      expect(g.frame(t)).not.toBe(-1);
      t += 1000;
    }
    expect(play(g, t, 4000, 60).out).not.toContain(-1);
  });
});
