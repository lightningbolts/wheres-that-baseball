import type { BaseOccupancy, GameSituation } from "@/types/mlb-live";

export function playerLastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] ?? fullName;
}

export function formatRunnerBases(bases: BaseOccupancy): string | null {
  const parts: string[] = [];
  if (bases.first) parts.push(`${playerLastName(bases.first)} on 1st`);
  if (bases.second) parts.push(`${playerLastName(bases.second)} on 2nd`);
  if (bases.third) parts.push(`${playerLastName(bases.third)} on 3rd`);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function formatGameScore(awayScore: number, homeScore: number): string {
  return `${awayScore}–${homeScore}`;
}

export function formatOuts(outs: number): string {
  const safe = Math.min(3, Math.max(0, outs));
  return `${safe} out${safe === 1 ? "" : "s"}`;
}

/** True when a half-inning begins: no outs and empty bases. */
export function isHalfInningStart(situation: GameSituation): boolean {
  return (
    situation.outs === 0 &&
    !situation.onFirst &&
    !situation.onSecond &&
    !situation.onThird
  );
}

export function hasSituationContent(situation: GameSituation): boolean {
  return (
    situation.onFirst ||
    situation.onSecond ||
    situation.onThird ||
    situation.outs > 0 ||
    situation.awayScore > 0 ||
    situation.homeScore > 0
  );
}
