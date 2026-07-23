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
  url.searchParams.set("hydrate", `stats(group=pitching,type=season,season=${season})`);

  try {
    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) return empty;

    const data = (await response.json()) as {
      people?: Array<{
        id?: number;
        fullName?: string;
        pitchHand?: { code?: string };
        stats?: Array<{
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
            };
          }>;
        }>;
      }>;
    };

    const person = data.people?.[0];
    if (!person) return empty;

    const splits = person.stats?.[0]?.splits ?? [];
    const seasonSplit =
      splits.find((s) => s.season === String(season)) ?? splits[0];
    const stat = seasonSplit?.stat;
    if (!stat) {
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
      wins: stat.wins ?? null,
      losses: stat.losses ?? null,
      era: stat.era ?? null,
      inningsPitched: stat.inningsPitched ?? null,
      strikeOuts: stat.strikeOuts ?? null,
      baseOnBalls: stat.baseOnBalls ?? null,
      homeRuns: stat.homeRuns ?? null,
      whip: stat.whip ?? null,
      hits: stat.hits ?? null,
      earnedRuns: stat.earnedRuns ?? null,
      gamesPlayed: stat.gamesPlayed ?? null,
      gamesStarted: stat.gamesStarted ?? null,
      source: "mlb",
    };
  } catch {
    return empty;
  }
}
