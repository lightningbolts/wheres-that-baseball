"use client";

import { useEffect, useState } from "react";

export interface GamedayBatterAssets {
  jerseyUrl: string | null;
  pantsUrl: string | null;
}

export function useGamedayBatterImage(
  gamePk: number | null | undefined,
  teamId: number | null | undefined,
  batSide: string | null | undefined,
): GamedayBatterAssets {
  const [assets, setAssets] = useState<GamedayBatterAssets>({
    jerseyUrl: null,
    pantsUrl: null,
  });

  useEffect(() => {
    if (!gamePk || !teamId) {
      setAssets({ jerseyUrl: null, pantsUrl: null });
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
          setAssets({ jerseyUrl: null, pantsUrl: null });
          return;
        }
        const data = (await response.json()) as {
          jerseyUrl?: string;
          pantsUrl?: string;
          imageUrl?: string;
        };
        setAssets({
          jerseyUrl: data.jerseyUrl ?? data.imageUrl ?? null,
          pantsUrl: data.pantsUrl ?? null,
        });
      } catch {
        if (!controller.signal.aborted) {
          setAssets({ jerseyUrl: null, pantsUrl: null });
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [gamePk, teamId, batSide]);

  return assets;
}
