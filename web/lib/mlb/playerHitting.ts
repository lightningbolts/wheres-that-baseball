import type { PlayerHittingSeasonLine } from "@/lib/mlb/playerBip";
import { MLB_SCHEDULE_BASE } from "@/lib/mlb/scheduleApi";

const SAVANT_XWOBA_TTL_MS = 30 * 60 * 1000;

type SavantXwobaCache = {
  fetchedAt: number;
  byPlayerId: Map<number, string>;
};

const savantXwobaBySeason = new Map<number, SavantXwobaCache>();

function formatBatSide(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code === "L") return "LHB";
  if (code === "R") return "RHB";
  if (code === "S") return "SHB";
  return code;
}

function formatRateStat(value: number | string | null | undefined, digits = 3): string | null {
  if (value == null || value === "") return null;
  const num = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(num)) return null;
  return num.toFixed(digits);
}

/** Broadcast-style rate (e.g. .282, 1.014) when MLB already returns a string. */
function keepRateString(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return null;
  const fixed = value.toFixed(3);
  return fixed.startsWith("0.") ? fixed.slice(1) : fixed;
}

function formatWoba(value: number | string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const num = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(num)) return null;
  const fixed = num.toFixed(3);
  return fixed.startsWith("0.") ? fixed.slice(1) : fixed;
}

function formatWrcPlus(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const num = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(num)) return null;
  return Math.round(num);
}

function formatWar(value: number | string | null | undefined): string | null {
  return formatRateStat(value, 1);
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

/** Parse Baseball Savant expected-stats CSV into playerId → xwOBA (est_woba). */
export function parseSavantExpectedBatterCsv(csv: string): Map<number, string> {
  const byPlayerId = new Map<number, string>();
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return byPlayerId;

  const header = lines[0]!;
  const cols = splitCsvLine(header).map((c) => c.replace(/^"|"$/g, "").toLowerCase());
  const idIdx = cols.findIndex((c) => c === "player_id" || c === "player id");
  const xwobaIdx = cols.findIndex((c) => c === "est_woba" || c === "xwoba");
  if (idIdx < 0 || xwobaIdx < 0) return byPlayerId;

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = splitCsvLine(line).map((c) => c.replace(/^"|"$/g, ""));
    const playerId = Number.parseInt(cells[idIdx] ?? "", 10);
    const xwoba = formatWoba(cells[xwobaIdx]);
    if (!Number.isFinite(playerId) || playerId <= 0 || !xwoba) continue;
    byPlayerId.set(playerId, xwoba);
  }
  return byPlayerId;
}

async function loadSavantXwobaMap(season: number): Promise<Map<number, string>> {
  const cached = savantXwobaBySeason.get(season);
  if (cached && Date.now() - cached.fetchedAt < SAVANT_XWOBA_TTL_MS) {
    return cached.byPlayerId;
  }

  const url = new URL("https://baseballsavant.mlb.com/leaderboard/expected_statistics");
  url.searchParams.set("type", "batter");
  url.searchParams.set("year", String(season));
  url.searchParams.set("position", "");
  url.searchParams.set("team", "");
  url.searchParams.set("min", "1");
  url.searchParams.set("csv", "true");

  try {
    const response = await fetch(url.toString(), {
      cache: "no-store",
      headers: { Accept: "text/csv" },
    });
    if (!response.ok) return cached?.byPlayerId ?? new Map();
    const csv = await response.text();
    const byPlayerId = parseSavantExpectedBatterCsv(csv);
    savantXwobaBySeason.set(season, { fetchedAt: Date.now(), byPlayerId });
    return byPlayerId;
  } catch {
    return cached?.byPlayerId ?? new Map();
  }
}

type HittingStatBlock = {
  avg?: string;
  obp?: string;
  slg?: string;
  ops?: string;
  hits?: number;
  homeRuns?: number;
  rbi?: number;
  baseOnBalls?: number;
  strikeOuts?: number;
  stolenBases?: number;
  plateAppearances?: number;
  atBats?: number;
  babip?: string;
  woba?: number;
  wRcPlus?: number;
  war?: number;
};

export async function fetchPlayerHittingSeasonLine(
  playerId: number,
  season: number,
): Promise<PlayerHittingSeasonLine> {
  const empty: PlayerHittingSeasonLine = {
    playerId,
    season,
    name: null,
    batSide: null,
    avg: null,
    obp: null,
    slg: null,
    ops: null,
    woba: null,
    xwoba: null,
    wrcPlus: null,
    war: null,
    hits: null,
    homeRuns: null,
    rbi: null,
    baseOnBalls: null,
    strikeOuts: null,
    stolenBases: null,
    plateAppearances: null,
    atBats: null,
    babip: null,
    source: "empty",
  };

  if (!Number.isFinite(playerId) || playerId <= 0) return empty;

  const url = new URL(`${MLB_SCHEDULE_BASE}/people/${playerId}`);
  url.searchParams.set(
    "hydrate",
    `stats(group=[hitting],type=[season,sabermetrics],season=${season})`,
  );

  try {
    const [response, xwobaMap] = await Promise.all([
      fetch(url.toString(), { cache: "no-store" }),
      loadSavantXwobaMap(season),
    ]);
    if (!response.ok) return empty;

    const data = (await response.json()) as {
      people?: Array<{
        id?: number;
        fullName?: string;
        batSide?: { code?: string };
        stats?: Array<{
          type?: { displayName?: string };
          splits?: Array<{
            season?: string;
            stat?: HittingStatBlock;
          }>;
        }>;
      }>;
    };

    const person = data.people?.[0];
    if (!person) return empty;

    const seasonBlock = person.stats?.find((s) => s.type?.displayName === "season");
    const saberBlock = person.stats?.find((s) => s.type?.displayName === "sabermetrics");

    const pickSplit = (
      block:
        | {
            splits?: Array<{
              season?: string;
              stat?: HittingStatBlock;
            }>;
          }
        | undefined,
    ) => {
      const splits = block?.splits ?? [];
      return splits.find((s) => s.season === String(season)) ?? splits[0];
    };

    const seasonStat = pickSplit(seasonBlock)?.stat;
    const saberStat = pickSplit(saberBlock)?.stat;
    const xwoba = xwobaMap.get(playerId) ?? null;

    if (!seasonStat && !saberStat && !xwoba) {
      return {
        ...empty,
        name: person.fullName ?? null,
        batSide: formatBatSide(person.batSide?.code),
        source: "empty",
      };
    }

    return {
      playerId,
      season,
      name: person.fullName ?? null,
      batSide: formatBatSide(person.batSide?.code),
      avg: keepRateString(seasonStat?.avg),
      obp: keepRateString(seasonStat?.obp),
      slg: keepRateString(seasonStat?.slg),
      ops: keepRateString(seasonStat?.ops),
      woba: formatWoba(saberStat?.woba),
      xwoba,
      wrcPlus: formatWrcPlus(saberStat?.wRcPlus),
      war: formatWar(saberStat?.war),
      hits: seasonStat?.hits ?? null,
      homeRuns: seasonStat?.homeRuns ?? null,
      rbi: seasonStat?.rbi ?? null,
      baseOnBalls: seasonStat?.baseOnBalls ?? null,
      strikeOuts: seasonStat?.strikeOuts ?? null,
      stolenBases: seasonStat?.stolenBases ?? null,
      plateAppearances: seasonStat?.plateAppearances ?? null,
      atBats: seasonStat?.atBats ?? null,
      babip: keepRateString(seasonStat?.babip),
      source: seasonStat || saberStat ? "mlb" : "empty",
    };
  } catch {
    return empty;
  }
}
