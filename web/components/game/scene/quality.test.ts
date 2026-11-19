import { describe, expect, it } from "vitest";
import { classifyDevice, nextSetting, PROFILES } from "@/components/game/scene/quality";

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
