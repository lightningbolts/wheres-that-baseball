import {
  fetchPostseasonScheduleGames,
  type ScheduleApiRawGame,
} from "@/lib/mlb/scheduleApi";

export type PostseasonLeague = "AL" | "NL";
export type PostseasonRound = "wild-card" | "division" | "championship" | "world-series";

export interface PostseasonTeam {
  id: number;
  name: string;
  abbreviation: string;
  seed?: number;
}

export type PostseasonParticipant =
  | { kind: "team"; team: PostseasonTeam }
  | { kind: "winner"; seriesId: string; label: string };

export interface PostseasonSeries {
  id: string;
  title: string;
  league: PostseasonLeague | null;
  round: PostseasonRound;
  bestOf: number;
  participants: [PostseasonParticipant, PostseasonParticipant];
  status: string | null;
  officialWinnerId: number | null;
}

export interface PostseasonBracket {
  season: number;
  series: PostseasonSeries[];
}

export type PostseasonPicks = Record<string, number>;

const ROUND_ORDER: Record<PostseasonRound, number> = {
  "wild-card": 0,
  division: 1,
  championship: 2,
  "world-series": 3,
};

function leagueForGame(game: ScheduleApiRawGame): PostseasonLeague | null {
  const description = `${game.description ?? ""} ${game.seriesDescription ?? ""}`;
  if (/\bAL(?:WC|DS|CS|\s)/.test(description)) return "AL";
  if (/\bNL(?:WC|DS|CS|\s)/.test(description)) return "NL";
  const leagueId = game.teams.home.team.league?.id ?? game.teams.away.team.league?.id;
  if (leagueId === 103) return "AL";
  if (leagueId === 104) return "NL";
  return null;
}

function seriesLetter(game: ScheduleApiRawGame): "a" | "b" {
  return /'B'/.test(game.description ?? "") ? "b" : "a";
}

function seriesIdentity(game: ScheduleApiRawGame): {
  id: string;
  title: string;
  league: PostseasonLeague | null;
  round: PostseasonRound;
} | null {
  const league = leagueForGame(game);
  if (game.gameType === "F" && league) {
    const letter = seriesLetter(game);
    return { id: `${league.toLowerCase()}-wc-${letter}`, title: `Wild Card ${letter.toUpperCase()}`, league, round: "wild-card" };
  }
  if (game.gameType === "D" && league) {
    const letter = seriesLetter(game);
    return { id: `${league.toLowerCase()}-ds-${letter}`, title: `Division Series ${letter.toUpperCase()}`, league, round: "division" };
  }
  if (game.gameType === "L" && league) {
    return { id: `${league.toLowerCase()}-cs`, title: `${league} Championship`, league, round: "championship" };
  }
  if (game.gameType === "W") {
    return { id: "world-series", title: "World Series", league: null, round: "world-series" };
  }
  return null;
}

function teamFromGameSide(side: ScheduleApiRawGame["teams"]["away"]): PostseasonTeam {
  return {
    id: side.team.id,
    name: side.team.name,
    abbreviation: side.team.abbreviation,
  };
}

function isPlaceholder(team: PostseasonTeam): boolean {
  return (
    team.name.includes("/") ||
    /(?:Higher|Lower) Seed|League Champion/i.test(team.name)
  );
}

function sourceForDivisionPlaceholder(
  team: PostseasonTeam,
  league: PostseasonLeague,
  wildCards: PostseasonSeries[],
): PostseasonParticipant {
  const source = wildCards.find((series) =>
    series.participants.some(
      (participant) =>
        participant.kind === "team" &&
        (participant.team.id === team.id || team.abbreviation.includes(participant.team.abbreviation)),
    ),
  );
  const seriesId = source?.id ?? `${league.toLowerCase()}-wc-a`;
  return { kind: "winner", seriesId, label: `Winner ${source?.title ?? "Wild Card"}` };
}

function baseParticipants(game: ScheduleApiRawGame): [PostseasonParticipant, PostseasonParticipant] {
  return [
    { kind: "team", team: teamFromGameSide(game.teams.away) },
    { kind: "team", team: teamFromGameSide(game.teams.home) },
  ];
}

function seedInitialRoundTeams(series: PostseasonSeries): PostseasonSeries {
  const letter = series.id.endsWith("-a") ? "a" : "b";
  const seeds = letter === "a" ? [6, 3] : [5, 4];
  return {
    ...series,
    participants: series.participants.map((participant, index) =>
      participant.kind === "team"
        ? { ...participant, team: { ...participant.team, seed: seeds[index] } }
        : participant,
    ) as [PostseasonParticipant, PostseasonParticipant],
  };
}

function extractSeriesState(games: ScheduleApiRawGame[]): {
  status: string | null;
  officialWinnerId: number | null;
} {
  // 1. If any game has isOver === true, that game represents the completed series
  const overGame = games.find((g) => g.seriesStatus?.isOver);
  if (overGame) {
    return {
      status: overGame.seriesStatus?.result ?? null,
      officialWinnerId: overGame.seriesStatus?.winningTeam?.id ?? null,
    };
  }

  // 2. Otherwise find the latest game played or in progress (Live or Final)
  const playedGames = games
    .filter((g) => g.status?.abstractGameState === "Live" || g.status?.abstractGameState === "Final")
    .sort((a, b) => (b.seriesGameNumber ?? 0) - (a.seriesGameNumber ?? 0));

  if (playedGames.length > 0) {
    return {
      status: playedGames[0].seriesStatus?.result ?? null,
      officialWinnerId: null,
    };
  }

  // 3. If no games played yet, check for a real series status result (not preview placeholder text like "plays")
  const withResult = [...games]
    .sort((a, b) => (b.seriesGameNumber ?? 0) - (a.seriesGameNumber ?? 0))
    .find((g) => g.seriesStatus?.result && !g.seriesStatus.result.includes("plays"));

  return {
    status: withResult?.seriesStatus?.result ?? null,
    officialWinnerId: null,
  };
}

export function buildPostseasonBracket(
  season: number,
  games: ScheduleApiRawGame[],
): PostseasonBracket {
  const gamesBySeries = new Map<
    string,
    {
      identity: NonNullable<ReturnType<typeof seriesIdentity>>;
      games: ScheduleApiRawGame[];
    }
  >();

  for (const game of games) {
    const identity = seriesIdentity(game);
    if (!identity) continue;
    let entry = gamesBySeries.get(identity.id);
    if (!entry) {
      entry = { identity, games: [] };
      gamesBySeries.set(identity.id, entry);
    }
    entry.games.push(game);
  }

  for (const entry of gamesBySeries.values()) {
    entry.games.sort((a, b) => (a.seriesGameNumber ?? 99) - (b.seriesGameNumber ?? 99));
  }

  const wildCards: PostseasonSeries[] = [];
  for (const { identity, games: seriesGames } of gamesBySeries.values()) {
    if (identity.round !== "wild-card") continue;
    const firstGame = seriesGames[0];
    const { status, officialWinnerId } = extractSeriesState(seriesGames);
    wildCards.push(seedInitialRoundTeams({
      ...identity,
      bestOf: firstGame.gamesInSeries ?? 3,
      participants: baseParticipants(firstGame),
      status,
      officialWinnerId,
    }));
  }

  const series: PostseasonSeries[] = [...wildCards];
  for (const { identity, games: seriesGames } of gamesBySeries.values()) {
    if (identity.round === "wild-card") continue;
    const firstGame = seriesGames[0];
    const { status, officialWinnerId } = extractSeriesState(seriesGames);
    let participants: [PostseasonParticipant, PostseasonParticipant];
    if (identity.round === "division" && identity.league) {
      participants = baseParticipants(firstGame).map((participant) => {
        if (
          participant.kind === "team" &&
          (isPlaceholder(participant.team) ||
            wildCards.some((wildCard) =>
              wildCard.participants.some(
                (wildCardParticipant) =>
                  wildCardParticipant.kind === "team" &&
                  wildCardParticipant.team.id === participant.team.id,
              ),
            ))
        ) {
          return sourceForDivisionPlaceholder(participant.team, identity.league!, wildCards);
        }
        if (participant.kind === "team") {
          const seed = identity.id.endsWith("-a") ? 1 : 2;
          return { ...participant, team: { ...participant.team, seed } };
        }
        return participant;
      }) as [PostseasonParticipant, PostseasonParticipant];
    } else if (identity.round === "championship" && identity.league) {
      const prefix = identity.league.toLowerCase();
      participants = [
        { kind: "winner", seriesId: `${prefix}-ds-a`, label: "Winner DS A" },
        { kind: "winner", seriesId: `${prefix}-ds-b`, label: "Winner DS B" },
      ];
    } else {
      participants = [
        { kind: "winner", seriesId: "al-cs", label: "American League champion" },
        { kind: "winner", seriesId: "nl-cs", label: "National League champion" },
      ];
    }
    series.push({
      ...identity,
      bestOf: firstGame.gamesInSeries ?? (identity.round === "division" ? 5 : 7),
      participants,
      status,
      officialWinnerId,
    });
  }

  series.sort((a, b) => {
    const league = (a.league ?? "ZZ").localeCompare(b.league ?? "ZZ");
    return league || ROUND_ORDER[a.round] - ROUND_ORDER[b.round] || a.id.localeCompare(b.id);
  });
  return { season, series };
}

export async function fetchPostseasonBracket(season = new Date().getFullYear()): Promise<PostseasonBracket> {
  return buildPostseasonBracket(season, await fetchPostseasonScheduleGames(season));
}

export function resolveSeriesTeams(
  bracket: PostseasonBracket,
  series: PostseasonSeries,
  picks: PostseasonPicks,
): Array<PostseasonTeam | null> {
  const byId = new Map<number, PostseasonTeam>();
  for (const item of bracket.series) {
    for (const participant of item.participants) {
      if (participant.kind === "team") {
        const existing = byId.get(participant.team.id);
        if (!existing?.seed) byId.set(participant.team.id, participant.team);
      }
    }
  }
  const seriesById = new Map<string, PostseasonSeries>(
    bracket.series.map((item) => [item.id, item]),
  );

  return series.participants.map((participant) => {
    if (participant.kind === "team") return participant.team;
    const sourceSeries = seriesById.get(participant.seriesId);
    const teamId = sourceSeries?.officialWinnerId ?? picks[participant.seriesId];
    return teamId ? byId.get(teamId) ?? null : null;
  });
}

export function sanitizePostseasonPicks(
  bracket: PostseasonBracket,
  picks: PostseasonPicks,
): PostseasonPicks {
  const next = { ...picks };
  let changed = true;
  while (changed) {
    changed = false;
    for (const series of bracket.series) {
      const picked = next[series.id];
      if (!picked) continue;
      const valid = resolveSeriesTeams(bracket, series, next).some((team) => team?.id === picked);
      if (!valid) {
        delete next[series.id];
        changed = true;
      }
    }
  }
  return next;
}

export function encodePostseasonPicks(picks: PostseasonPicks): string {
  return Object.entries(picks)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([seriesId, teamId]) => `${seriesId}.${teamId}`)
    .join(",");
}

export function decodePostseasonPicks(value: string | null | undefined): PostseasonPicks {
  if (!value) return {};
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // fallback if malformed URI sequence
  }
  const picks: PostseasonPicks = {};
  for (const token of decoded.split(",")) {
    const [seriesId, rawTeamId] = token.split(".");
    const teamId = Number.parseInt(rawTeamId, 10);
    if (seriesId && Number.isFinite(teamId)) picks[seriesId] = teamId;
  }
  return picks;
}
