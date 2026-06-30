import type { SupabaseClient } from "@supabase/supabase-js";

import { getSeasonStartDate } from "@/lib/games/format";
import type { Database } from "@/types/database";

const GAME_HITS_COLUMNS =
  "game_pk,game_date,venue_id,away_team_abbrev,home_team_abbrev,game_state" as const;

const PAGE_SIZE = 25;

export type GameHitsRow = {
  game_pk: number;
  game_date: string;
  venue_id: number | null;
  away_team_abbrev: string;
  home_team_abbrev: string;
  game_state: unknown;
};

/** Fetch archived game_state rows in small pages to avoid Supabase statement timeouts. */
export async function fetchSeasonGameHitRows(
  supabase: SupabaseClient<Database>,
  season: number,
  venueId?: number,
): Promise<GameHitsRow[]> {
  const seasonEnd = `${season}-12-31`;
  const rows: GameHitsRow[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from("games")
      .select(GAME_HITS_COLUMNS)
      .eq("season", season)
      .gte("game_date", getSeasonStartDate(`${season}-06-30`))
      .lte("game_date", seasonEnd)
      .not("game_state", "is", null)
      .not("venue_id", "is", null)
      .order("game_pk", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (venueId != null) {
      query = query.eq("venue_id", venueId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    const page = (data ?? []) as GameHitsRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return rows;
}
