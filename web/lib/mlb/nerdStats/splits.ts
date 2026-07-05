import type { GameNerdSourceRow } from "@/lib/mlb/nerdStats/types";
import type { NerdStatWindowId } from "@/lib/mlb/nerdStats/windows";

export type NerdStatSplitId = "home" | "away";

export type NerdStatSplitFilter = "all" | NerdStatSplitId;

export const NERD_STAT_SPLITS: Array<{ id: NerdStatSplitId; label: string }> = [
  { id: "home", label: "Home" },
  { id: "away", label: "Away" },
];

export function parseNerdStatSplit(value: string | null | undefined): NerdStatSplitFilter {
  if (value === "home" || value === "away") return value;
  return "all";
}

export function nerdStatSplitLabel(split: NerdStatSplitFilter): string | null {
  if (split === "all") return null;
  return NERD_STAT_SPLITS.find((item) => item.id === split)?.label ?? null;
}

export function teamPassesSplitFilter(
  teamId: number,
  row: GameNerdSourceRow,
  split: NerdStatSplitFilter,
): boolean {
  if (split === "all") return true;
  if (split === "home") return teamId === row.home_team_id;
  return teamId === row.away_team_id;
}

/** Scale minimum-game thresholds for home-only or away-only samples. */
export function splitEffectiveMinGames(
  minGames: number,
  split: NerdStatSplitFilter,
): number {
  if (split === "all") return minGames;
  return Math.max(1, Math.round(minGames / 2));
}

export function nerdStatBrowseQuery(window: NerdStatWindowId, split: NerdStatSplitFilter): string {
  const params = new URLSearchParams();
  if (window !== "season") params.set("window", window);
  if (split !== "all" && window === "season") params.set("split", split);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function nerdStatDetailHref(
  statId: string,
  window: NerdStatWindowId,
  split: NerdStatSplitFilter,
): string {
  return `/nerd/${statId}${nerdStatBrowseQuery(window, split)}`;
}

export function nerdStandingsHref(window: NerdStatWindowId, split: NerdStatSplitFilter): string {
  return `/nerd${nerdStatBrowseQuery(window, split)}`;
}
