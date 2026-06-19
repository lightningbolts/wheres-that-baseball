"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getSeasonStartDate } from "@/lib/games/format";
import {
  ACTIVE_CARRYOVER_STATUSES,
  getMLBScheduleDate,
  previousScheduleDate,
} from "@/lib/mlb/schedule";
import { GAME_LIST_COLUMNS, type Game } from "@/types/database";
import { createClient } from "@/utils/supabase/client";

export interface UseGamesByDateResult {
  games: Game[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const DATE_GAMES_POLL_MS = 30_000;

function mergeGamesByPk(primary: Game[], secondary: Game[]): Game[] {
  const byPk = new Map<number, Game>();
  for (const game of secondary) {
    byPk.set(game.game_pk, game);
  }
  for (const game of primary) {
    byPk.set(game.game_pk, game);
  }
  return [...byPk.values()].sort((a, b) =>
    a.away_team_name.localeCompare(b.away_team_name),
  );
}

async function fetchGamesFromDb(date: string): Promise<Game[]> {
  const supabase = createClient();
  const carryoverStatuses = [...ACTIVE_CARRYOVER_STATUSES];
  const prevDate = previousScheduleDate(date);

  const [primaryResult, carryoverResult] = await Promise.all([
    supabase
      .from("games")
      .select(GAME_LIST_COLUMNS)
      .eq("game_date", date)
      .order("away_team_name", { ascending: true }),
    supabase
      .from("games")
      .select(GAME_LIST_COLUMNS)
      .eq("game_date", prevDate)
      .in("status", carryoverStatuses)
      .order("away_team_name", { ascending: true }),
  ]);

  const fetchError = primaryResult.error ?? carryoverResult.error;
  if (fetchError) {
    throw new Error(fetchError.message);
  }

  return mergeGamesByPk(
    (primaryResult.data ?? []) as Game[],
    (carryoverResult.data ?? []) as Game[],
  );
}

export function useGamesByDate(date: string): UseGamesByDateResult {
  const [games, setGames] = useState<Game[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isToday = date === getMLBScheduleDate();
  const requestIdRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const refetch = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const isInitialLoad = !hasLoadedRef.current;
    if (isInitialLoad) setIsLoading(true);
    setError(null);

    try {
      const result = isToday
        ? await (async () => {
            const response = await fetch(`/api/games/by-date?date=${encodeURIComponent(date)}`, {
              cache: "no-store",
            });
            if (!response.ok) {
              const body = (await response.json().catch(() => ({}))) as { error?: string };
              throw new Error(body.error ?? `Failed to load games (${response.status})`);
            }
            const data = (await response.json()) as { games?: Game[] };
            return data.games ?? [];
          })()
        : await fetchGamesFromDb(date);

      if (requestId !== requestIdRef.current) return;

      hasLoadedRef.current = true;
      setGames(result);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load games");
      if (isInitialLoad) setGames([]);
    } finally {
      if (requestId === requestIdRef.current && isInitialLoad) {
        setIsLoading(false);
      }
    }
  }, [date, isToday]);

  useEffect(() => {
    hasLoadedRef.current = false;
  }, [date]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!isToday) return;

    const intervalId = window.setInterval(() => {
      void refetch();
    }, DATE_GAMES_POLL_MS);

    return () => window.clearInterval(intervalId);
  }, [isToday, refetch]);

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
