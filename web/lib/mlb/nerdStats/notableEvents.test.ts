import { describe, expect, it } from "vitest";

import {
  formatPlayInning,
  formatPlayScore,
  notableGameHref,
  subjectFromDescription,
} from "@/lib/mlb/nerdStats/notableEvents";

describe("notableGameHref", () => {
  it("links to the game when no at-bat index is provided", () => {
    expect(notableGameHref(777001)).toBe("/games/777001");
  });

  it("links to a specific at-bat when an index is provided", () => {
    expect(notableGameHref(777001, 42)).toBe("/games/777001?atBat=42");
  });
});

describe("formatPlayInning", () => {
  it("formats top and bottom halves", () => {
    expect(formatPlayInning({ inning: 7, halfInning: "top" })).toBe("Top 7");
    expect(formatPlayInning({ inning: 9, halfInning: "bottom" })).toBe("Bot 9");
  });
});

describe("formatPlayScore", () => {
  it("formats the scoreline", () => {
    expect(formatPlayScore({ awayScore: 3, homeScore: 5 })).toBe("3–5");
  });
});

describe("subjectFromDescription", () => {
  it("extracts the leading player name", () => {
    expect(subjectFromDescription("Juan Soto steals 2nd base")).toBe("Juan Soto");
    expect(subjectFromDescription("Pitching Change: Chris Martin replaces...")).toBe(
      "Pitching Change",
    );
  });
});
