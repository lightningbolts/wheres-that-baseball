import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { parseStoredGameState } from "@/lib/games/gameState";
import { getServiceSupabase } from "@/lib/games/supabaseAdmin";
import type { VenueHit } from "@/lib/mlb/ballparkHits";
import { extractGameHits } from "@/lib/mlb/gameHits";

function getReadSupabase(): SupabaseClient | null {
  const service = getServiceSupabase();
  if (service) return service;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** Parse `gamePk-atBatIndex` hit keys used by ballpark / player BIP stores. */
export function parseHitKey(hitKey: string): { gamePk: number; atBatIndex: number } | null {
  const match = /^(\d+)-(\d+)$/.exec(hitKey);
  if (!match) return null;
  const gamePk = Number.parseInt(match[1]!, 10);
  const atBatIndex = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(gamePk) || !Number.isFinite(atBatIndex)) return null;
  return { gamePk, atBatIndex };
}

/**
 * Load play detail for a slim stored hit from archived games.game_state.
 * Returns the original hit (possibly still without detail) if the feed is missing.
 */
export async function enrichVenueHitDetail(hit: VenueHit): Promise<VenueHit> {
  if (hit.detail) return hit;

  const parsed = parseHitKey(hit.hitKey);
  const gamePk = parsed?.gamePk ?? hit.gamePk;
  const atBatIndex = parsed?.atBatIndex ?? hit.atBatIndex;
  if (!Number.isFinite(gamePk) || !Number.isFinite(atBatIndex)) return hit;

  const supabase = getReadSupabase();
  if (!supabase) return hit;

  const { data, error } = await supabase
    .from("games")
    .select("game_state")
    .eq("game_pk", gamePk)
    .maybeSingle();

  if (error || data?.game_state == null) return hit;

  const state = parseStoredGameState(data.game_state, gamePk);
  if (!state?.plays?.length) return hit;

  const extracted = extractGameHits(state.plays).find((entry) => entry.atBatIndex === atBatIndex);
  if (!extracted?.detail) return hit;

  return {
    ...hit,
    playId: hit.playId ?? extracted.playId,
    detail: extracted.detail,
  };
}
