import { describe, expect, it } from "vitest";

import { gameDateInNerdWindow, nerdStatWindowSinceDate } from "@/lib/mlb/nerdStats/windows";

describe("nerd stat windows", () => {
  const now = new Date("2026-07-05T18:00:00.000Z");

  it("computes rolling since dates inclusively", () => {
    expect(nerdStatWindowSinceDate("7d", now)).toBe("2026-06-29");
    expect(nerdStatWindowSinceDate("30d", now)).toBe("2026-06-06");
    expect(nerdStatWindowSinceDate("season", now)).toBeNull();
  });

  it("filters game dates into windows", () => {
    expect(gameDateInNerdWindow("2026-07-04", "7d", now)).toBe(true);
    expect(gameDateInNerdWindow("2026-06-01", "7d", now)).toBe(false);
    expect(gameDateInNerdWindow("2026-03-28", "season", now)).toBe(true);
  });
});
