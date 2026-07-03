"use client";

import { useMemo } from "react";

import { gamedayInfieldProxyUrl, gamedayStadiumProxyUrl } from "@/lib/mlb/gamedayAssets";

export function useGamedayStadiumImage(venueId: number | null | undefined): string {
  return useMemo(() => gamedayStadiumProxyUrl(venueId), [venueId]);
}

export function useGamedayInfieldImage(venueId: number | null | undefined): string {
  return useMemo(() => gamedayInfieldProxyUrl(venueId), [venueId]);
}
