import type { BatterHotZoneCell } from "@/types/mlb-live";

import { cachedStatsFetch } from "@/lib/mlb/statsCache";

const MLB_STATS_BASE = "https://statsapi.mlb.com/api/v1";

/** Fallback params when the default hotColdZones response is sparse. */
const HOT_COLD_ZONE_FALLBACK_PARAMS = [
  "onBasePlusSlugging",
  "sluggingPercentage",
  "onBasePercentage",
  "battingAverage",
  "strikeouts",
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

function mergeCatalogEntry(
  catalog: Map<string, Map<string, HotColdZoneRaw>>,
  statName: string,
  zones: HotColdZoneRaw[] | undefined,
): void {
  if (!zones?.length) return;
  const next = zoneMapFromStat(zones);
  const existing = catalog.get(statName);
  if (!existing || next.size > existing.size) {
    catalog.set(statName, next);
  }
}

function ingestHotColdResponse(
  catalog: Map<string, Map<string, HotColdZoneRaw>>,
  data: HotColdZonesResponse,
): void {
  for (const split of data.stats?.[0]?.splits ?? []) {
    const stat = split.stat;
    if (!stat?.name) continue;
    mergeCatalogEntry(catalog, stat.name, stat.zones);
  }
}

async function fetchHotColdZonesUrl(url: string): Promise<HotColdZonesResponse | null> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;
  return (await response.json()) as HotColdZonesResponse;
}

async function fetchZoneStatCatalog(
  batterId: number,
  season: number,
): Promise<Map<string, Map<string, HotColdZoneRaw>>> {
  const catalog = new Map<string, Map<string, HotColdZoneRaw>>();

  const baseUrl = new URL(`${MLB_STATS_BASE}/people/${batterId}/stats`);
  baseUrl.searchParams.set("stats", "hotColdZones");
  baseUrl.searchParams.set("group", "hitting");
  baseUrl.searchParams.set("season", String(season));

  const primary = await fetchHotColdZonesUrl(baseUrl.toString());
  if (primary) ingestHotColdResponse(catalog, primary);

  if (!catalog.has("onBasePlusSlugging") && !(catalog.has("onBasePercentage") && catalog.has("sluggingPercentage"))) {
    await Promise.all(
      HOT_COLD_ZONE_FALLBACK_PARAMS.map(async (statParam) => {
        const url = new URL(baseUrl.toString());
        url.searchParams.set("hotColdZoneStat", statParam);
        const data = await fetchHotColdZonesUrl(url.toString());
        if (data) ingestHotColdResponse(catalog, data);
      }),
    );
  }

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
  const opsZones = catalog.get("onBasePlusSlugging");
  if (opsZones) {
    const cells = cellsFromDirectOps(opsZones);
    if (cells.length > 0) return cells;
  }

  const obpZones = catalog.get("onBasePercentage");
  const slgZones = catalog.get("sluggingPercentage");
  if (obpZones && slgZones) {
    const cells = combineObpSlgZones(obpZones, slgZones);
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
    [`hotZones`, "ops-all-splits-v6", String(batterId), String(season)],
    async () => {
      const seasons = [season, new Date().getFullYear(), season - 1, season + 1].filter(
        (value, index, array) => value >= 2008 && array.indexOf(value) === index,
      );

      for (const trySeason of seasons) {
        const zones = await fetchBatterHotZonesForSeason(batterId, trySeason);
        if (zones?.length) return zones;
      }

      return null;
    },
  );
}
