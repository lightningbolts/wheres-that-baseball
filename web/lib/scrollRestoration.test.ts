// @vitest-environment happy-dom

import { describe, expect, it, beforeEach } from "vitest";

import {
  buildReturnScrollKey,
  buildScrollKey,
  clearScrollPersistBlock,
  getReturnScrollY,
  getSavedScrollY,
  isAsyncScrollRoute,
  readScrollPositions,
  saveReturnScrollPosition,
  saveScrollPosition,
  shouldPersistScroll,
  blockScrollPersist,
} from "./scrollRestoration";

describe("scrollRestoration", () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearScrollPersistBlock();
  });

  it("builds scroll keys with and without search queries", () => {
    expect(buildScrollKey("/postseason")).toBe("/postseason");
    expect(buildScrollKey("/postseason", "season=2026")).toBe("/postseason?season=2026");
    expect(buildReturnScrollKey("/postseason")).toBe("return:/postseason");
  });

  it("saves and retrieves scroll positions", () => {
    saveScrollPosition("/postseason?p=123", 420);
    expect(getSavedScrollY("/postseason?p=123")).toBe(420);
    expect(getSavedScrollY("/postseason?p=other")).toBeUndefined();
    expect(readScrollPositions()).toEqual({ "/postseason?p=123": 420 });
  });

  it("saves and retrieves return scroll positions", () => {
    saveReturnScrollPosition("/nerd", 300, "tab=splits");
    expect(getReturnScrollY("/nerd", "tab=splits")).toBe(300);
    expect(getReturnScrollY("/nerd")).toBeUndefined();
  });

  it("correctly manages scroll persistence blocking", () => {
    expect(shouldPersistScroll()).toBe(true);
    blockScrollPersist(5000);
    expect(shouldPersistScroll()).toBe(false);
    clearScrollPersistBlock();
    expect(shouldPersistScroll()).toBe(true);
  });

  it("identifies async scroll routes", () => {
    expect(isAsyncScrollRoute("/nerd")).toBe(true);
    expect(isAsyncScrollRoute("/ballparks")).toBe(true);
    expect(isAsyncScrollRoute("/ballparks/123")).toBe(true);
    expect(isAsyncScrollRoute("/postseason")).toBe(false);
  });
});
