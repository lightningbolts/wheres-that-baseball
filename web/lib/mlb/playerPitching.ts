import { formatPitchHand } from "@/lib/mlb/cardPitchers";
import type { PlayerPitchingSeasonLine } from "@/lib/mlb/playerBip";
import { TRACKED_PITCH_TYPES } from "@/lib/mlb/nerdStats/pitchTypeStats";
import type { PitchTypeAccumulator } from "@/lib/mlb/nerdStats/types";
import { MLB_SCHEDULE_BASE } from "@/lib/mlb/scheduleApi";

export interface PlayerPitchMixEntry {
  code: string;
  label: string;
  count: number;
  pct: number;
  avgVelocity: number | null;
  avgSpin: number | null;
  avgHBreak: number | null;
  avgVBreak: number | null;
}

export interface PlayerPitchMix {
  totalPitches: number;
  pitches: PlayerPitchMixEntry[];
}

const SAVANT_XERA_TTL_MS = 30 * 60 * 1000;

type SavantXeraCache = {
  fetchedAt: number;
  byPlayerId: Map<number, string>;
};

const savantXeraBySeason = new Map<number, SavantXeraCache>();

export function buildPitchMixFromThrown(
  pitchTypesThrown: Record<string, PitchTypeAccumulator> | null | undefined,
): PlayerPitchMix {
  const entries: PlayerPitchMixEntry[] = [];
  let total = 0;

  const source = pitchTypesThrown ?? {};
  for (const tracked of TRACKED_PITCH_TYPES) {
    const acc = source[tracked.code];
    const count = acc?.count ?? 0;
    if (count <= 0) continue;
    total += count;
    entries.push({
      code: tracked.code,
      label: tracked.label,
      count,
      pct: 0,
      avgVelocity: acc && acc.velocitySum > 0 ? acc.velocitySum / count : null,
      avgSpin: acc && acc.spinSum > 0 ? acc.spinSum / count : null,
      avgHBreak: acc && count > 0 ? acc.hBreakSum / count : null,
      avgVBreak: acc && count > 0 ? acc.vBreakSum / count : null,
    });
  }

  // Include any untracked codes that still have volume.
  for (const [code, acc] of Object.entries(source)) {
    if (TRACKED_PITCH_TYPES.some((t) => t.code === code)) continue;
    const count = acc?.count ?? 0;
    if (count <= 0) continue;
    total += count;
    entries.push({
      code,
      label: code,
      count,
      pct: 0,
      avgVelocity: acc.velocitySum > 0 ? acc.velocitySum / count : null,
      avgSpin: acc.spinSum > 0 ? acc.spinSum / count : null,
      avgHBreak: count > 0 ? acc.hBreakSum / count : null,
      avgVBreak: count > 0 ? acc.vBreakSum / count : null,
    });
  }

  for (const entry of entries) {
    entry.pct = total > 0 ? entry.count / total : 0;
  }

  entries.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { totalPitches: total, pitches: entries };
}

function formatRateStat(value: number | string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const num = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(num)) return null;
  return num.toFixed(2);
}

/** Parse Baseball Savant expected-stats CSV into playerId → xERA. */
export function parseSavantExpectedPitcherCsv(csv: string): Map<number, string> {
  const byPlayerId = new Map<number, string>();
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return byPlayerId;

  const header = lines[0]!;
  const cols = splitCsvLine(header).map((c) => c.replace(/^"|"$/g, "").toLowerCase());
  const idIdx = cols.findIndex((c) => c === "player_id" || c === "player id");
  const xeraIdx = cols.findIndex((c) => c === "xera");
  if (idIdx < 0 || xeraIdx < 0) return byPlayerId;

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = splitCsvLine(line).map((c) => c.replace(/^"|"$/g, ""));
    const playerId = Number.parseInt(cells[idIdx] ?? "", 10);
    const xEra = formatRateStat(cells[xeraIdx]);
    if (!Number.isFinite(playerId) || playerId <= 0 || !xEra) continue;
    byPlayerId.set(playerId, xEra);
  }
  return byPlayerId;
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

async function loadSavantXeraMap(season: number): Promise<Map<number, string>> {
  const cached = savantXeraBySeason.get(season);
  if (cached && Date.now() - cached.fetchedAt < SAVANT_XERA_TTL_MS) {
    return cached.byPlayerId;
  }

  const url = new URL("https://baseballsavant.mlb.com/leaderboard/expected_statistics");
  url.searchParams.set("type", "pitcher");
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
    const byPlayerId = parseSavantExpectedPitcherCsv(csv);
    savantXeraBySeason.set(season, { fetchedAt: Date.now(), byPlayerId });
    return byPlayerId;
  } catch {
    return cached?.byPlayerId ?? new Map();
  }
}

export async function fetchPlayerPitchingSeasonLine(
  playerId: number,
  season: number,
): Promise<PlayerPitchingSeasonLine> {
  const empty: PlayerPitchingSeasonLine = {
    playerId,
    season,
    name: null,
    throwHand: null,
    wins: null,
    losses: null,
    era: null,
    fip: null,
    xEra: null,
    xFip: null,
    inningsPitched: null,
    strikeOuts: null,
    baseOnBalls: null,
    homeRuns: null,
    whip: null,
    hits: null,
    earnedRuns: null,
    gamesPlayed: null,
    gamesStarted: null,
    source: "empty",
  };

  if (!Number.isFinite(playerId) || playerId <= 0) return empty;

  const url = new URL(`${MLB_SCHEDULE_BASE}/people/${playerId}`);
  url.searchParams.set(
    "hydrate",
    `stats(group=[pitching],type=[season,sabermetrics],season=${season})`,
  );

  try {
    const [response, xEraMap] = await Promise.all([
      fetch(url.toString(), { cache: "no-store" }),
      loadSavantXeraMap(season),
    ]);
    if (!response.ok) return empty;

    const data = (await response.json()) as {
      people?: Array<{
        id?: number;
        fullName?: string;
        pitchHand?: { code?: string };
        stats?: Array<{
          type?: { displayName?: string };
          splits?: Array<{
            season?: string;
            stat?: {
              wins?: number;
              losses?: number;
              era?: string;
              inningsPitched?: string;
              strikeOuts?: number;
              baseOnBalls?: number;
              homeRuns?: number;
              whip?: string;
              hits?: number;
              earnedRuns?: number;
              gamesPlayed?: number;
              gamesStarted?: number;
              fip?: number;
              xfip?: number;
            };
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
              stat?: {
                wins?: number;
                losses?: number;
                era?: string;
                inningsPitched?: string;
                strikeOuts?: number;
                baseOnBalls?: number;
                homeRuns?: number;
                whip?: string;
                hits?: number;
                earnedRuns?: number;
                gamesPlayed?: number;
                gamesStarted?: number;
                fip?: number;
                xfip?: number;
              };
            }>;
          }
        | undefined,
    ) => {
      const splits = block?.splits ?? [];
      return splits.find((s) => s.season === String(season)) ?? splits[0];
    };

    const seasonStat = pickSplit(seasonBlock)?.stat;
    const saberStat = pickSplit(saberBlock)?.stat;
    const xEra = xEraMap.get(playerId) ?? null;

    if (!seasonStat && !saberStat && !xEra) {
      return {
        ...empty,
        name: person.fullName ?? null,
        throwHand: formatPitchHand(person.pitchHand?.code),
        source: "empty",
      };
    }

    return {
      playerId,
      season,
      name: person.fullName ?? null,
      throwHand: formatPitchHand(person.pitchHand?.code),
      wins: seasonStat?.wins ?? null,
      losses: seasonStat?.losses ?? null,
      era: seasonStat?.era ?? null,
      fip: formatRateStat(saberStat?.fip),
      xEra,
      xFip: formatRateStat(saberStat?.xfip),
      inningsPitched: seasonStat?.inningsPitched ?? null,
      strikeOuts: seasonStat?.strikeOuts ?? null,
      baseOnBalls: seasonStat?.baseOnBalls ?? null,
      homeRuns: seasonStat?.homeRuns ?? null,
      whip: seasonStat?.whip ?? null,
      hits: seasonStat?.hits ?? null,
      earnedRuns: seasonStat?.earnedRuns ?? null,
      gamesPlayed: seasonStat?.gamesPlayed ?? null,
      gamesStarted: seasonStat?.gamesStarted ?? null,
      source: seasonStat || saberStat ? "mlb" : "empty",
    };
  } catch {
    return empty;
  }
}
