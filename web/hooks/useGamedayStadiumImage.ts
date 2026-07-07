"use client";

import { useMemo } from "react";

import { gamedayInfieldProxyUrl, gamedayStadiumProxyUrl, resolveGamedayStadiumVariant } from "@/lib/mlb/gamedayAssets";

export function useGamedayStadiumImage(
  venueId: number | null | undefined,
  dayNight?: string | null,
): string {
  return useMemo(
    () => gamedayStadiumProxyUrl(venueId, resolveGamedayStadiumVariant(dayNight)),
    [venueId, dayNight],
  );
}

export function useGamedayInfieldImage(venueId: number | null | undefined): string {
  return useMemo(() => gamedayInfieldProxyUrl(venueId), [venueId]);
}
