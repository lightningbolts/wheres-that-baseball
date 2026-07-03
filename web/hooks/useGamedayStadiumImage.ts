"use client";

import { useMemo } from "react";

import { gamedayStadiumProxyUrl } from "@/lib/mlb/gamedayAssets";

export function useGamedayStadiumImage(venueId: number | null | undefined): string {
  return useMemo(() => gamedayStadiumProxyUrl(venueId), [venueId]);
}
