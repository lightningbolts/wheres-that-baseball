"use client";

import { useEffect, useRef } from "react";

const RETRY_MS = 15_000;
const MAX_ATTEMPTS = 12;

/**
 * When a watched live game ends, persist the full feed to season history.
 * Retries until MLB marks the game Final and Supabase accepts the upsert.
 */
export function useArchiveFinishedGame(gamePk: number, gameOver: boolean): void {
  const attemptRef = useRef(0);
  const succeededRef = useRef(false);

  useEffect(() => {
    attemptRef.current = 0;
    succeededRef.current = false;
  }, [gamePk]);

  useEffect(() => {
    if (!gamePk || !gameOver || succeededRef.current) return;

    let cancelled = false;
    let timeoutId = 0;

    const tryArchive = async () => {
      if (cancelled || succeededRef.current) return;
      if (attemptRef.current >= MAX_ATTEMPTS) return;

      attemptRef.current += 1;

      try {
        const response = await fetch(`/api/games/${gamePk}/archive`, {
          method: "POST",
          cache: "no-store",
        });
        if (!response.ok) return;

        const data = (await response.json()) as { archived?: boolean; pending?: boolean };
        if (data.archived) {
          succeededRef.current = true;
          return;
        }
        if (!data.pending) return;
      } catch {
        // Retry on transient failures.
      }

      if (!cancelled && !succeededRef.current && attemptRef.current < MAX_ATTEMPTS) {
        timeoutId = window.setTimeout(() => void tryArchive(), RETRY_MS);
      }
    };

    void tryArchive();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [gamePk, gameOver]);
}
