import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  fetchBatterHotZones,
  formatZoneOps,
} from "@/lib/mlb/batterHotZones";
import { clearStatsCache } from "@/lib/mlb/statsCache";

describe("formatZoneOps", () => {
  it("adds OBP and SLG for broadcast-style OPS labels", () => {
    expect(formatZoneOps(0.421, 1.08)).toBe("1.501");
    expect(formatZoneOps(0.273, 0.563)).toBe(".836");
  });
});

describe("fetchBatterHotZones", () => {
  beforeEach(() => {
    clearStatsCache();
  });

  it("reads every split from a hotColdZones response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        stats: [
          {
            splits: [
              {
                stat: {
                  name: "onBasePercentage",
                  zones: [{ zone: "01", color: "blue", temp: "cold", value: ".273" }],
                },
              },
              {
                stat: {
                  name: "sluggingPercentage",
                  zones: [{ zone: "01", color: "blue", temp: "cold", value: ".563" }],
                },
              },
              {
                stat: {
                  name: "onBasePlusSlugging",
                  zones: [{ zone: "05", color: "red", temp: "hot", value: "1.343" }],
                },
              },
            ],
          },
        ],
      }),
    } as Response);

    const cells = await fetchBatterHotZones(660271, 2025);
    expect(cells).toEqual([
      {
        zoneId: "05",
        color: "red",
        temp: "hot",
        value: "1.343",
      },
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it("fetches OBP and SLG zones and combines them into OPS", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const stat =
        url.includes("hotColdZoneStat=sluggingPercentage")
          ? {
              name: "onBasePercentage",
              zones: [
                { zone: "05", color: "rgba(214, 41, 52, .55)", temp: "hot", value: ".421" },
                { zone: "01", color: "blue", temp: "cold", value: ".273" },
              ],
            }
          : url.includes("hotColdZoneStat=onBasePlusSlugging")
            ? {
                name: "sluggingPercentage",
                zones: [
                  { zone: "05", color: "rgba(214, 41, 52, .55)", temp: "hot", value: "1.080" },
                  { zone: "01", color: "blue", temp: "cold", value: ".563" },
                ],
              }
            : { name: "battingAverage", zones: [] };

      return {
        ok: true,
        json: async () => ({
          stats: [{ splits: [{ stat }] }],
        }),
      } as Response;
    });

    const cells = await fetchBatterHotZones(660271, 2025);
    expect(cells).toEqual([
      {
        zoneId: "01",
        color: "blue",
        temp: "cold",
        value: ".836",
      },
      {
        zoneId: "05",
        color: "rgba(214, 41, 52, .55)",
        temp: "hot",
        value: "1.501",
      },
    ]);

    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    fetchSpy.mockRestore();
  });

  it("uses direct OPS zones when OBP is unavailable", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const stat =
        url.includes("hotColdZoneStat=battingAverage")
          ? {
              name: "onBasePlusSlugging",
              zones: [{ zone: "05", color: "red", temp: "hot", value: "1.343" }],
            }
          : { name: "battingAverage", zones: [{ zone: "05", value: ".406" }] };

      return {
        ok: true,
        json: async () => ({
          stats: [{ splits: [{ stat }] }],
        }),
      } as Response;
    });

    const cells = await fetchBatterHotZones(660271, 2025);
    expect(cells).toEqual([
      {
        zoneId: "05",
        color: "red",
        temp: "hot",
        value: "1.343",
      },
    ]);
    fetchSpy.mockRestore();
  });

  it("returns null when either OBP or SLG zones are unavailable", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        stats: [
          {
            splits: [
              {
                stat: {
                  name: "battingAverage",
                  zones: [{ zone: "01", color: "red", value: ".318" }],
                },
              },
            ],
          },
        ],
      }),
    } as Response);

    expect(await fetchBatterHotZones(123456, 2025)).toBeNull();
    fetchSpy.mockRestore();
  });

  it("includes Gameday border zones 11–14 with OPS and colors", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        stats: [
          {
            splits: [
              {
                stat: {
                  name: "onBasePlusSlugging",
                  zones: [
                    { zone: "05", color: "red", temp: "hot", value: "1.343" },
                    { zone: "11", color: "rgba(234, 147, 153, .55)", temp: "warm", value: ".789" },
                    { zone: "12", color: "blue", temp: "cold", value: ".548" },
                    { zone: "13", color: "blue", temp: "cold", value: ".526" },
                    { zone: "14", color: "rgba(255, 255, 255, 0.55)", temp: "lukewarm", value: ".731" },
                  ],
                },
              },
            ],
          },
        ],
      }),
    } as Response);

    const cells = await fetchBatterHotZones(660271, 2025);
    expect(cells).toEqual([
      { zoneId: "05", color: "red", temp: "hot", value: "1.343" },
      { zoneId: "11", color: "rgba(234, 147, 153, .55)", temp: "warm", value: ".789" },
      { zoneId: "12", color: "blue", temp: "cold", value: ".548" },
      { zoneId: "13", color: "blue", temp: "cold", value: ".526" },
      { zoneId: "14", color: "rgba(255, 255, 255, 0.55)", temp: "lukewarm", value: ".731" },
    ]);
    fetchSpy.mockRestore();
  });
});
