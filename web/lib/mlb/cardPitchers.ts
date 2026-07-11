import type { GameBoxScore, PitcherBoxLine } from "@/types/mlb-boxscore";
import type { CardPitcher } from "@/types/mlb";

export function mlbPlayerHeadshotUrl(playerId: number, size = 80): string {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_${size},q_auto:good/v1/people/${playerId}/headshot/silo/current`;
}

/** MLB.com player page (same destination Gameday uses for headshot taps). */
export function mlbPlayerPageUrl(playerId: number): string {
  return `https://www.mlb.com/player/${playerId}`;
}

function pitcherLineFromBox(line: PitcherBoxLine): string {
  const ip = line.inningsPitched || "0.0";
  const era = line.seasonEra && line.seasonEra !== "—" ? line.seasonEra : null;
  return era ? `${ip} IP, ${era} ERA` : `${ip} IP`;
}

function cardPitcherFromBoxLine(line: PitcherBoxLine): CardPitcher {
  return {
    playerId: line.playerId,
    name: line.name,
    throwHand: null,
    line: pitcherLineFromBox(line),
  };
}

/** Current/active pitcher per team from a parsed box score. */
export function buildCardPitchersFromBoxScore(boxScore: GameBoxScore): {
  away: CardPitcher | null;
  home: CardPitcher | null;
} {
  const awayLine = boxScore.away.pitchers.at(-1) ?? null;
  const homeLine = boxScore.home.pitchers.at(-1) ?? null;

  return {
    away: awayLine ? cardPitcherFromBoxLine(awayLine) : null,
    home: homeLine ? cardPitcherFromBoxLine(homeLine) : null,
  };
}

export function formatPitchHand(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code === "L") return "LHP";
  if (code === "R") return "RHP";
  if (code === "S") return "SHP";
  return code;
}

export function formatSeasonPitcherLine(
  wins: number | null,
  losses: number | null,
  era: string | null,
): string {
  const record =
    wins != null && losses != null ? `${wins}-${losses}` : null;
  if (record && era) return `${record}, ${era} ERA`;
  if (record) return record;
  if (era) return `${era} ERA`;
  return "—";
}
