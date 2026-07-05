import { describe, expect, it } from "vitest";

import { zoneHeatLabelStyle } from "@/lib/mlb/zoneHeatColors";

describe("zoneHeatLabelStyle", () => {
  it("uses dark text on lukewarm / light zone fills", () => {
    const style = zoneHeatLabelStyle("rgba(255, 255, 255, 0.55)", "lukewarm");
    expect(style.fill).toBe("#1c2b2a");
  });

  it("uses light text on hot zone fills", () => {
    const style = zoneHeatLabelStyle("rgba(214, 41, 52, .55)", "hot");
    expect(style.fill).toBe("#ffffff");
  });
});
