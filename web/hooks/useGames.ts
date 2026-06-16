"use client";

import { useCallback, useEffect, useState } from "react";

import { getSeasonStartDate } from "@/lib/games/format";
import { getMLBScheduleDate } from "@/lib/mlb/schedule";
import { GAME_LIST_COLUMNS, type Game } from "@/types/database";
import { createClient } from "@/utils/supabase/client";

export interface UseGamesByDateResult {
  games: Game[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useGamesByDate(date: string): UseGamesByDateResult {
  const [games, setGames] = useState<Game[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from("games")
        .select(GAME_LIST_COLUMNS)
        .eq("game_date", date)
        .order("game_date", { ascending: true })
        .order("away_team_name", { ascending: true });

      if (fetchError) {
        setError(fetchError.message);
        setGames([]);
        return;
      }

      setGames((data ?? []) as Game[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load games");
      setGames([]);
    } finally {
      setIsLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { games, isLoading, error, refetch };
}

export interface UseGamesByTeamResult {
  games: Game[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useGamesByTeam(teamId: number | null): UseGamesByTeamResult {
  const [games, setGames] = useState<Game[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!teamId) {
      setGames([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    const seasonEnd = getMLBScheduleDate();
    const seasonStart = getSeasonStartDate(seasonEnd);

    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from("games")
        .select(GAME_LIST_COLUMNS)
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .gte("game_date", seasonStart)
        .lte("game_date", seasonEnd)
        .order("game_date", { ascending: false });

      if (fetchError) {
        setError(fetchError.message);
        setGames([]);
        return;
      }

      setGames((data ?? []) as Game[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load games");
      setGames([]);
    } finally {
      setIsLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { games, isLoading, error, refetch };
}
