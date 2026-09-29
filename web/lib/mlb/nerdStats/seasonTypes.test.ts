import { describe, expect, it } from "vitest";

import {
  isPostseasonGameType,
  nerdSeasonTypeLabel,
  parseNerdSeasonType,
} from "@/lib/mlb/nerdStats/seasonTypes";

describe("nerd standings season types", () => {
  it("defaults unknown filters to the regular season", () => {
    expect(parseNerdSeasonType(null)).toBe("regular");
    expect(parseNerdSeasonType("spring")).toBe("regular");
    expect(parseNerdSeasonType("postseason")).toBe("postseason");
  });

  it("classifies every MLB postseason game type", () => {
    expect(["F", "D", "L", "W"].every(isPostseasonGameType)).toBe(true);
    expect(isPostseasonGameType("R")).toBe(false);
  });

  it("uses plain labels for the filter", () => {
    expect(nerdSeasonTypeLabel("regular")).toBe("Regular season");
    expect(nerdSeasonTypeLabel("postseason")).toBe("Postseason");
  });
});
