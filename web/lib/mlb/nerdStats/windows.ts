export type NerdStatWindowId = "season" | "7d" | "10d" | "14d" | "30d";

export interface NerdStatWindowOption {
  id: NerdStatWindowId;
  label: string;
  days: number | null;
}

export const NERD_STAT_WINDOWS: NerdStatWindowOption[] = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "10d", label: "Last 10 days", days: 10 },
  { id: "14d", label: "Last 14 days", days: 14 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "season", label: "This season", days: null },
];

export function parseNerdStatWindow(value: string | null | undefined): NerdStatWindowId {
  if (value && NERD_STAT_WINDOWS.some((window) => window.id === value)) {
    return value as NerdStatWindowId;
  }
  return "season";
}

export function nerdStatWindowLabel(windowId: NerdStatWindowId): string {
  return NERD_STAT_WINDOWS.find((window) => window.id === windowId)?.label ?? "This season";
}

/** Inclusive UTC date floor for rolling windows (YYYY-MM-DD). */
export function nerdStatWindowSinceDate(windowId: NerdStatWindowId, now = new Date()): string | null {
  const window = NERD_STAT_WINDOWS.find((item) => item.id === windowId);
  if (!window?.days) return null;

  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  since.setUTCDate(since.getUTCDate() - (window.days - 1));
  return since.toISOString().slice(0, 10);
}

export function gameDateInNerdWindow(
  gameDate: string,
  windowId: NerdStatWindowId,
  now = new Date(),
): boolean {
  const since = nerdStatWindowSinceDate(windowId, now);
  if (!since) return true;
  return gameDate >= since;
}

/** Scale season-long minimums down for short rolling windows (~6 games/team in 7d). */
export function windowEffectiveMinGames(
  seasonMinGames: number,
  windowId: NerdStatWindowId,
): number {
  if (windowId === "season") return seasonMinGames;
  const days = NERD_STAT_WINDOWS.find((window) => window.id === windowId)?.days;
  if (!days) return seasonMinGames;
  return Math.max(1, Math.round((seasonMinGames * days) / 50));
}

/** Scale pitch-type sample minimums for rolling windows. */
export function windowEffectiveMinPitches(
  seasonMinPitches: number,
  windowId: NerdStatWindowId,
): number {
  if (windowId === "season") return seasonMinPitches;
  const days = NERD_STAT_WINDOWS.find((window) => window.id === windowId)?.days;
  if (!days) return seasonMinPitches;
  return Math.max(8, Math.round((seasonMinPitches * days) / 30));
}
