import type { GameScheduleRow } from "@/lib/games/scheduleRow";
import { getServiceSupabase } from "@/lib/games/supabaseAdmin";

/** Upsert schedule metadata without overwriting stored play-by-play or box scores. */
export async function upsertScheduleRows(rows: GameScheduleRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  const supabase = getServiceSupabase();
  if (!supabase) return 0;

  const syncedAt = new Date().toISOString();
  const payload = rows.map((row) => ({
    ...row,
    updated_at: syncedAt,
  }));

  const { error } = await supabase.from("games").upsert(payload, {
    onConflict: "game_pk",
    ignoreDuplicates: false,
  });

  if (error) {
    throw new Error(`schedule upsert failed: ${error.message}`);
  }

  return rows.length;
}
