import {
  FIELD_DEFENSE_SLOTS,
  FIELD_POSITION_ORDER,
  type FieldPositionCode,
} from "@/lib/mlb/fieldPositions";
import type { GameBoxScore, TeamBoxScore } from "@/types/mlb-boxscore";

export interface FieldDefender {
  position: FieldPositionCode;
  playerId: number;
  name: string;
  x: number;
  y: number;
}

const FIELD_POSITION_CODES = new Set<string>([
  "P",
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "LF",
  "CF",
  "RF",
]);

function primaryFieldPosition(positions: string): FieldPositionCode | null {
  const parts = positions
    .split(/[-/]/)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);

  for (const part of parts) {
    if (FIELD_POSITION_CODES.has(part)) return part as FieldPositionCode;
  }
  return null;
}

function defendingTeam(
  boxScore: GameBoxScore,
  offenseTeamId: number | null,
): TeamBoxScore | null {
  if (offenseTeamId == null) return null;
  if (boxScore.away.teamId === offenseTeamId) return boxScore.home;
  if (boxScore.home.teamId === offenseTeamId) return boxScore.away;
  return null;
}

/**
 * Derive schematic defense from the fielding team's box-score lineup.
 * Pitcher comes from live state (active arm), not the batting order.
 */
export function deriveDefense(
  boxScore: GameBoxScore | null | undefined,
  offenseTeamId: number | null,
  pitcherId: number | null,
  pitcherName: string,
): FieldDefender[] {
  if (!boxScore) return [];

  const team = defendingTeam(boxScore, offenseTeamId);
  if (!team) return [];

  const byPosition = new Map<FieldPositionCode, FieldDefender>();

  for (const batter of team.batters) {
    const position = primaryFieldPosition(batter.positions);
    if (!position || position === "P") continue;
    if (byPosition.has(position)) continue;

    const slot = FIELD_DEFENSE_SLOTS[position];
    byPosition.set(position, {
      position,
      playerId: batter.playerId,
      name: batter.name,
      x: slot.x,
      y: slot.y,
    });
  }

  const pitcherSlot = FIELD_DEFENSE_SLOTS.P;
  if (pitcherId != null && pitcherId > 0) {
    byPosition.set("P", {
      position: "P",
      playerId: pitcherId,
      name: pitcherName && pitcherName !== "—" ? pitcherName : "Pitcher",
      x: pitcherSlot.x,
      y: pitcherSlot.y,
    });
  } else {
    const fromPitchers = team.pitchers.at(-1);
    if (fromPitchers) {
      byPosition.set("P", {
        position: "P",
        playerId: fromPitchers.playerId,
        name: fromPitchers.name,
        x: pitcherSlot.x,
        y: pitcherSlot.y,
      });
    }
  }

  return FIELD_POSITION_ORDER.flatMap((code) => {
    const defender = byPosition.get(code);
    return defender ? [defender] : [];
  });
}
