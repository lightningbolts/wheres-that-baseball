import { NERD_STAT_DEFINITIONS } from "@/lib/mlb/nerdStats/statDefinitions";
import type { NerdStatCategory, NerdStatDetail } from "@/lib/mlb/nerdStats/types";
import { NERD_STAT_CATEGORIES } from "@/lib/mlb/nerdStats/types";
import { getSiteUrl } from "@/lib/site";

/** Primary viral habit — daily nerd standings posts ("Actually, your team is…"). */
export const PRIMARY_VIRAL_HABIT = "daily-nerd-standings" as const;

/** UTC weekday → featured category (Mon Drama, Tue Misfortune, Wed Chaos, …). */
const WEEKDAY_CATEGORY: NerdStatCategory[] = [
  "vibes", // Sunday
  "drama", // Monday
  "misfortune", // Tuesday
  "chaos", // Wednesday
  "baserunning", // Thursday
  "contact", // Friday
  "pace", // Saturday
];

function categoryForDate(date: Date): NerdStatCategory {
  const weekday = date.getUTCDay();
  if (weekday === 6) {
    const weekNum = Math.floor(date.getTime() / (7 * 86_400_000));
    return weekNum % 2 === 0 ? "pace" : "defense";
  }
  return WEEKDAY_CATEGORY[weekday] ?? "drama";
}

/** Deterministic featured stat for a calendar day (category rotates by weekday). */
export function pickDailyNerdStatId(season: number, date = new Date()): string {
  const category = categoryForDate(date);
  const pool = NERD_STAT_DEFINITIONS.filter((stat) => stat.category === category);
  const stats = pool.length > 0 ? pool : NERD_STAT_DEFINITIONS;

  const anchor = new Date(`${season}-03-01T12:00:00Z`).getTime();
  const dayOfYear = Math.floor((date.getTime() - anchor) / 86_400_000);
  const index = Math.abs(dayOfYear) % stats.length;
  return stats[index]!.id;
}

/** Used by the nerd-stats build pipeline for summary.statOfTheDayId. */
export function pickStatOfTheDay(season: number, _stats?: { id: string }[]): string {
  return pickDailyNerdStatId(season);
}

export function dailyCategoryLabel(date = new Date()): string {
  const category = categoryForDate(date);
  return NERD_STAT_CATEGORIES.find((item) => item.id === category)?.label ?? category;
}

/** Suggested social copy for the organic posting pilot. */
export function buildDailySocialPostCopy(detail: NerdStatDetail, statId: string): string {
  const leader = detail.stat.leaders[0];
  const hook = leader
    ? `Actually, ${leader.teamName} is #1 in ${detail.stat.title} (${leader.displayValue}).`
    : `Today's Nerd Standings: ${detail.stat.title}.`;

  const siteUrl = getSiteUrl();
  return [
    hook,
    "",
    detail.stat.subtitle,
    "",
    `${siteUrl}/nerd/daily`,
    `${siteUrl}/nerd/${statId}`,
  ].join("\n");
}
