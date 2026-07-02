"use client";

import { useEffect, useState } from "react";

export function useGamedayBatterImage(
  gamePk: number | null | undefined,
  teamId: number | null | undefined,
  batSide: string | null | undefined,
): string | null {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!gamePk || !teamId) {
      setImageUrl(null);
      return;
    }

    const controller = new AbortController();

    async function load() {
      try {
        const params = new URLSearchParams({
          teamId: String(teamId),
          batSide: batSide ?? "R",
        });
        const response = await fetch(
          `/api/game/${gamePk}/gameday-batter?${params.toString()}`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          setImageUrl(null);
          return;
        }
        const data = (await response.json()) as { imageUrl?: string };
        setImageUrl(data.imageUrl ?? null);
      } catch {
        if (!controller.signal.aborted) setImageUrl(null);
      }
    }

    void load();
    return () => controller.abort();
  }, [gamePk, teamId, batSide]);

  return imageUrl;
}
