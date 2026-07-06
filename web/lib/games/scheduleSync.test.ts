import { beforeEach, describe, expect, it, vi } from "vitest";

import { syncRecentScheduleAndFeeds } from "@/lib/games/scheduleSync";

vi.mock("@/lib/mlb/schedule", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mlb/schedule")>();
  return {
    ...actual,
    getMLBScheduleDate: () => "2026-06-30",
  };
});

vi.mock("@/lib/games/scheduleRow", () => ({
  fetchScheduleGamesRawForDate: vi.fn(),
  mapScheduleGameToRow: vi.fn((game: { gamePk: number; status?: { abstractGameState?: string } }) => ({
    game_pk: game.gamePk,
    status: game.status?.abstractGameState ?? "Scheduled",
    game_date: "2026-06-24",
    season: 2026,
    game_type: "R",
    status_detail: "",
    away_team_id: 1,
    away_team_name: "Away",
    away_team_abbrev: "AWY",
    home_team_id: 2,
    home_team_name: "Home",
    home_team_abbrev: "HME",
    away_score: 0,
    home_score: 0,
    venue_id: null,
    venue_name: "",
    official_date: "2026-06-24",
  })),
}));

vi.mock("@/lib/games/supabaseAdmin", () => ({
  getServiceSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    })),
  })),
}));

vi.mock("@/lib/games/reconcileFeeds", () => ({
  reconcileFinalFeedsForGames: vi.fn().mockResolvedValue(undefined),
  reconcileMissingFeedsSince: vi.fn().mockResolvedValue(2),
}));

describe("syncRecentScheduleAndFeeds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("syncs seven ET dates and reconciles final feeds", async () => {
    const { fetchScheduleGamesRawForDate } = await import("@/lib/games/scheduleRow");
    const { reconcileFinalFeedsForGames, reconcileMissingFeedsSince } = await import(
      "@/lib/games/reconcileFeeds"
    );

    vi.mocked(fetchScheduleGamesRawForDate).mockResolvedValue([
      { gamePk: 1, gameDate: "2026-06-24T23:05:00Z", status: { abstractGameState: "Final" } },
      { gamePk: 2, gameDate: "2026-06-24T23:05:00Z", status: { abstractGameState: "Scheduled" } },
    ] as never);

    const result = await syncRecentScheduleAndFeeds({ days: 7 });

    expect(result.dates).toHaveLength(7);
    expect(result.synced).toBeGreaterThan(0);
    expect(result.finalGamesSeen).toBeGreaterThan(0);
    expect(reconcileFinalFeedsForGames).toHaveBeenCalled();
    expect(reconcileMissingFeedsSince).toHaveBeenCalledWith(result.dates[0], 20);
  });
});
