"use client";

import { useEffect, useState } from "react";

import type { BatterHotZoneCell } from "@/types/mlb-live";

export interface UseBatterHotZonesResult {
  zones: BatterHotZoneCell[] | null;
  isLoading: boolean;
  error: string | null;
}

export function useBatterHotZones(
  batterId: number | null | undefined,
  season: number = new Date().getFullYear(),
): UseBatterHotZonesResult {
  const [zones, setZones] = useState<BatterHotZoneCell[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!batterId) {
      setZones(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(
          `/api/batter/zones?batterId=${batterId}&season=${season}`,
        );
        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? `Batter zones error ${response.status}`);
        }

        const data = (await response.json()) as { zones: BatterHotZoneCell[] | null };
        if (!cancelled) {
          setZones(data.zones);
        }
      } catch (err) {
        if (!cancelled) {
          setZones(null);
          setError(err instanceof Error ? err.message : "Failed to fetch batter zones");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [batterId, season]);

  return { zones, isLoading, error };
}
