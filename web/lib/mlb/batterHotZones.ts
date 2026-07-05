import type { BatterHotZoneCell } from "@/types/mlb-live";

import { cachedStatsFetch } from "@/lib/mlb/statsCache";

const MLB_STATS_BASE = "https://statsapi.mlb.com/api/v1";

/** Request every param; MLB maps stat.name inconsistently by player/season. */
const HOT_COLD_ZONE_PARAMS = [
  "sluggingPercentage",
  "onBasePlusSlugging",
  "onBasePercentage",
  "battingAverage",
] as const;

const STRIKE_ZONE_IDS = ["01", "02", "03", "04", "05", "06", "07", "08", "09"] as const;

interface HotColdZoneRaw {
  zone?: string;
  color?: string;
  temp?: string;
  value?: string;
}

interface HotColdZonesResponse {
  stats?: Array<{
    splits?: Array<{
      season?: string;
      stat?: {
        name?: string;
        zones?: HotColdZoneRaw[];
      };
    }>;
  }>;
}

function parseRate(value: string | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Broadcast-style OPS label (e.g. .847, 1.012). */
export function formatZoneOps(obp: number, slg: number): string {
  const ops = obp + slg;
  const fixed = ops.toFixed(3);
  return fixed.startsWith("0.") ? fixed.slice(1) : fixed;
}

function formatDirectOps(value: number): string {
  const fixed = value.toFixed(3);
  return fixed.startsWith("0.") ? fixed.slice(1) : fixed;
}

function zoneMapFromStat(zones: HotColdZoneRaw[] | undefined): Map<string, HotColdZoneRaw> {
  const map = new Map<string, HotColdZoneRaw>();
  for (const raw of zones ?? []) {
    const zoneId = raw.zone?.padStart(2, "0");
    if (!zoneId) continue;
    map.set(zoneId, raw);
  }
  return map;
}

async function fetchZoneStatCatalog(
  batterId: number,
  season: number,
): Promise<Map<string, Map<string, HotColdZoneRaw>>> {
  const catalog = new Map<string, Map<string, HotColdZoneRaw>>();

  await Promise.all(
    HOT_COLD_ZONE_PARAMS.map(async (statParam) => {
      const url = new URL(`${MLB_STATS_BASE}/people/${batterId}/stats`);
      url.searchParams.set("stats", "hotColdZones");
      url.searchParams.set("group", "hitting");
      url.searchParams.set("season", String(season));
      url.searchParams.set("hotColdZoneStat", statParam);

      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`MLB hot/cold zones failed: ${response.status}`);
      }

      const data = (await response.json()) as HotColdZonesResponse;
      const stat = data.stats?.[0]?.splits?.[0]?.stat;
      const statName = stat?.name;
      if (!statName || !stat.zones?.length) return;

      if (!catalog.has(statName)) {
        catalog.set(statName, zoneMapFromStat(stat.zones));
      }
    }),
  );

  return catalog;
}

function combineObpSlgZones(
  obpZones: Map<string, HotColdZoneRaw>,
  slgZones: Map<string, HotColdZoneRaw>,
): BatterHotZoneCell[] {
  const cells: BatterHotZoneCell[] = [];

  for (const zoneId of STRIKE_ZONE_IDS) {
    const obp = obpZones.get(zoneId);
    const slg = slgZones.get(zoneId);
    const obpRate = parseRate(obp?.value);
    const slgRate = parseRate(slg?.value);
    if (obpRate == null || slgRate == null) continue;

    cells.push({
      zoneId,
      color: slg?.color ?? obp?.color ?? "rgba(255, 255, 255, 0.55)",
      temp: slg?.temp ?? obp?.temp,
      value: formatZoneOps(obpRate, slgRate),
    });
  }

  return cells;
}

function cellsFromDirectOps(opsZones: Map<string, HotColdZoneRaw>): BatterHotZoneCell[] {
  const cells: BatterHotZoneCell[] = [];

  for (const zoneId of STRIKE_ZONE_IDS) {
    const raw = opsZones.get(zoneId);
    const opsRate = parseRate(raw?.value);
    if (opsRate == null) continue;

    cells.push({
      zoneId,
      color: raw?.color ?? "rgba(255, 255, 255, 0.55)",
      temp: raw?.temp,
      value: formatDirectOps(opsRate),
    });
  }

  return cells;
}

function cellsFromCatalog(
  catalog: Map<string, Map<string, HotColdZoneRaw>>,
): BatterHotZoneCell[] | null {
  const obpZones = catalog.get("onBasePercentage");
  const slgZones = catalog.get("sluggingPercentage");
  const opsZones = catalog.get("onBasePlusSlugging");

  if (obpZones && slgZones) {
    const cells = combineObpSlgZones(obpZones, slgZones);
    if (cells.length > 0) return cells;
  }

  if (opsZones) {
    const cells = cellsFromDirectOps(opsZones);
    if (cells.length > 0) return cells;
  }

  return null;
}

async function fetchBatterHotZonesForSeason(
  batterId: number,
  season: number,
): Promise<BatterHotZoneCell[] | null> {
  const catalog = await fetchZoneStatCatalog(batterId, season);
  return cellsFromCatalog(catalog);
}

export async function fetchBatterHotZones(
  batterId: number,
  season: number,
): Promise<BatterHotZoneCell[] | null> {
  return cachedStatsFetch(
    [`hotZones`, "ops-obp-slg-v4", String(batterId), String(season)],
    async () => {
      const current = await fetchBatterHotZonesForSeason(batterId, season);
      if (current) return current;

      if (season > 2008) {
        return fetchBatterHotZonesForSeason(batterId, season - 1);
      }

      return null;
    },
  );
}
