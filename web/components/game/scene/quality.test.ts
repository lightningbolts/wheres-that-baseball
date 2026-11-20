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
  /** Run `ms` of frames at `fps`; every verdict is taken as a step. Returns the step times. */
  const play = (g: FpsGovernor, t0: number, ms: number, fps: number) => {
    const out: number[] = [];
    let now = t0;
    for (; now < t0 + ms; now += 1000 / fps) {
      if (g.frame(now)) {
        out.push(now);
        g.stepped(now);
      }
    }
    return { out, now };
  };

  it("steps down a scene that is slow from the very first frame", () => {
    const g = new FpsGovernor();
    expect(play(g, 0, 5000, 30).out.length).toBeGreaterThan(0);
  });

  it("never asks to step up, however long the scene runs smooth", () => {
    const g = new FpsGovernor();
    let r = play(g, 0, 8000, 25);
    expect(r.out.length).toBe(1);
    r = play(g, r.now, 600_000, 60);
    expect(r.out).toEqual([]);
  });

  it("rides out a short slow stretch (a busy play, a GC pause) without stepping", () => {
    const g = new FpsGovernor();
    let t = play(g, 0, 5000, 60).now;
    t = play(g, t, 2500, 30).now;
    expect(play(g, t, 5000, 60).out).toEqual([]);
  });

  it("waits for the new tier to settle before judging it", () => {
    const g = new FpsGovernor();
    const r = play(g, 0, 5000, 30);
    const first = r.out[0];
    // Still slow after the step: the next one comes no sooner than settle + a full verdict.
    const next = play(g, r.now, 10_000, 30).out[0] ?? r.out[1];
    expect(next - first).toBeGreaterThanOrEqual(2000 + 8 * 500);
  });

  it("a hidden tab's pause is not read as a slow frame rate", () => {
    const g = new FpsGovernor();
    let t = play(g, 0, 1200, 60).now;
    // Two frames a second apart (rAF throttled), then normal again.
    for (let i = 0; i < 6; i += 1) {
      expect(g.frame(t)).toBe(false);
      t += 1000;
    }
    expect(play(g, t, 4000, 60).out).toEqual([]);
  });
});
