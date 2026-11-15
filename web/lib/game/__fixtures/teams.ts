/** Shared test fixtures: real roster teams and a stock park. */
import rosters from "@/data/game/rosters.json";
import { teamModel, type TeamModel } from "@/lib/game/ratings";
import { buildPark, homeVenueForTeam } from "@/lib/game/physics/park";
import { BaseballGame } from "@/lib/game/rules/game";
import type { RosterFile } from "@/lib/game/types";

export const TEAMS: TeamModel[] = Object.values((rosters as unknown as RosterFile).teams).map(teamModel);

export function newGame(awayIdx = 0, homeIdx = 1, innings?: number): BaseballGame {
  const away = TEAMS[awayIdx];
  const home = TEAMS[homeIdx];
  return new BaseballGame(away, home, buildPark(homeVenueForTeam(home.teamId)), { innings });
}
