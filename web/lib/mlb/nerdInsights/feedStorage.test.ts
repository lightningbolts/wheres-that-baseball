import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearNerdInsightsFeed,
  loadNerdInsightsFeed,
  nerdInsightsFeedStorageKey,
  saveNerdInsightsFeed,
} from "@/lib/mlb/nerdInsights/feedStorage";
import type { NerdInsight } from "@/lib/mlb/nerdInsights/types";

const store = new Map<string, string>();

describe("nerd insights feed storage", () => {
  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it("round-trips feed insights for a game", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });

    const insights: NerdInsight[] = [
      {
        id: "insight-1",
        variant: "full",
        eyebrow: "NERD",
        title: "Barrel factory",
        message: "Hard contact.",
        anchor: { type: "at-bat", atBatIndex: 12 },
      },
    ];

    saveNerdInsightsFeed(42, insights);
    expect(store.has(nerdInsightsFeedStorageKey(42))).toBe(true);
    expect(loadNerdInsightsFeed(42)).toEqual(insights);

    clearNerdInsightsFeed(42);
    expect(loadNerdInsightsFeed(42)).toEqual([]);
  });
});
