import type { SupabaseClient } from "@supabase/supabase-js";

import { getSeasonStartDate } from "@/lib/games/format";
import type { Database } from "@/types/database";
import type { GameHitRow } from "@/types/game-hits";

const GAME_HIT_COLUMNS =
  "game_pk,at_bat_index,season,game_date,venue_id,away_team_abbrev,home_team_abbrev,batter_name,event,inning,half_inning,away_score,home_score,hit_data,play_detail" as const;

const PAGE_SIZE = 1000;

/** Fast read from the indexed game_hits table (no game_state JSONB). */
export async function fetchIndexedGameHits(
  supabase: SupabaseClient<Database>,
  season: number,
  venueId?: number,
): Promise<GameHitRow[]> {
  const seasonEnd = `${season}-12-31`;
  const rows: GameHitRow[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from("game_hits")
      .select(GAME_HIT_COLUMNS)
      .eq("season", season)
      .gte("game_date", getSeasonStartDate(`${season}-06-30`))
      .lte("game_date", seasonEnd)
      .order("game_date", { ascending: true })
      .order("game_pk", { ascending: true })
      .order("at_bat_index", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (venueId != null) {
      query = query.eq("venue_id", venueId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    const page = (data ?? []) as GameHitRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return rows;
}

export async function countIndexedGameHits(
  supabase: SupabaseClient<Database>,
  season: number,
): Promise<number> {
  const { count, error } = await supabase
    .from("game_hits")
    .select("game_pk", { count: "exact", head: true })
    .eq("season", season);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}
