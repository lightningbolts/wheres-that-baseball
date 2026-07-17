import { describe, expect, it } from "vitest";

import { buildStateChartCells, hitTestStateChart } from "@/lib/mlb/stateChartMath";

describe("hitTestStateChart", () => {
  const cells = buildStateChartCells({
    inning: 1,
    halfInning: "top",
    outs: 0,
    onFirst: false,
    onSecond: false,
    onThird: false,
    awayScore: 0,
    homeScore: 0,
  });

  it("returns nearest cell in gaps between diamonds", () => {
    const empty = cells.find((c) => c.label === "Empty" && c.outs === 0)!;
    const first = cells.find((c) => c.label === "1B" && c.outs === 0)!;
    const hit = hitTestStateChart((empty.cx + first.cx) / 2, empty.cy, cells, [], []);
    expect(hit?.kind).toBe("cell");
  });

  it("returns null outside the plot band", () => {
    expect(hitTestStateChart(-40, -40, cells, [], [])).toBeNull();
  });
});
