import { describe, expect, it } from "vitest";

import { recentScheduleDates } from "@/lib/mlb/schedule";

describe("recentScheduleDates", () => {
  it("returns consecutive dates ending at the anchor, oldest first", () => {
    expect(recentScheduleDates("2026-06-26", 3)).toEqual([
      "2026-06-24",
      "2026-06-25",
      "2026-06-26",
    ]);
  });

  it("returns at least one date when days is zero or negative", () => {
    expect(recentScheduleDates("2026-06-26", 0)).toEqual(["2026-06-26"]);
  });
});
