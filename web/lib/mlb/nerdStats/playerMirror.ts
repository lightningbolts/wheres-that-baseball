import { createEmptyTeamCounters, mergeTeamCounters } from "@/lib/mlb/nerdStats/counters";
import type {
  PlayerNerdCounters,
  SeasonPlayerNerdCounters,
  TeamNerdCounters,
} from "@/lib/mlb/nerdStats/types";
import { getTeamById } from "@/lib/mlb/teams";

/**
 * Mirror numeric (and nullable extrema) writes from `primary` onto `secondary`.
 * Used so play-loop increments on team counters also accrue to a player.
 */
export function mirrorNumericIncrements(
  primary: TeamNerdCounters,
  secondary: TeamNerdCounters,
): TeamNerdCounters {
  return new Proxy(primary, {
    set(target, prop, value) {
      if (typeof prop !== "string") {
        return Reflect.set(target, prop, value);
      }

      if (prop === "notableEvents" || prop === "pitchTypesThrown") {
        return Reflect.set(target, prop, value);
      }

      const prev = Reflect.get(target, prop);
      Reflect.set(target, prop, value);

      if (typeof prev === "number" && typeof value === "number") {
        const delta = value - prev;
        if (delta !== 0) {
          const secPrev = Reflect.get(secondary, prop);
          if (typeof secPrev === "number") {
            Reflect.set(secondary, prop, secPrev + delta);
          }
        }
        return true;
      }

      // Nullable extrema (hardestHitMph, softestHomeRunMph, etc.)
      if (
        (prev === null || typeof prev === "number") &&
        (value === null || typeof value === "number")
      ) {
        Reflect.set(secondary, prop, value);
      }

      return true;
    },
  }) as TeamNerdCounters;
}

export function createEmptyPlayerCounters(
  playerId: number,
  name: string,
  teamId: number,
  teamAbbrev?: string,
): PlayerNerdCounters {
  const team = getTeamById(teamId);
  return {
    ...createEmptyTeamCounters(),
    playerId,
    name,
    teamId,
    teamAbbrev: teamAbbrev ?? team?.abbrev ?? "",
  };
}

export function ensurePlayerCounters(
  players: SeasonPlayerNerdCounters,
  playerId: number,
  name: string,
  teamId: number,
  teamAbbrev?: string,
): PlayerNerdCounters {
  const key = String(playerId);
  const existing = players[key];
  if (existing) {
    if (name) existing.name = name;
    return existing;
  }
  const created = createEmptyPlayerCounters(playerId, name, teamId, teamAbbrev);
  players[key] = created;
  return created;
}

export function mergePlayerSeasonCounters(
  target: SeasonPlayerNerdCounters,
  source: SeasonPlayerNerdCounters,
): void {
  for (const [playerId, src] of Object.entries(source)) {
    const existing = target[playerId];
    if (!existing) {
      const created = createEmptyPlayerCounters(src.playerId, src.name, src.teamId, src.teamAbbrev);
      mergeTeamCounters(created, src);
      created.playerId = src.playerId;
      created.name = src.name;
      created.teamId = src.teamId;
      created.teamAbbrev = src.teamAbbrev;
      target[playerId] = created;
      continue;
    }
    mergeTeamCounters(existing, src);
    if (src.name) existing.name = src.name;
    if (src.plateAppearances > existing.plateAppearances) {
      existing.teamId = src.teamId;
      existing.teamAbbrev = src.teamAbbrev;
    }
  }
}
