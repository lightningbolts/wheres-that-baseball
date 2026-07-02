import type {
  BatterBoxLine,
  BenchPlayerLine,
  BullpenPlayerLine,
  GameBoxScore,
  GameInfoItem,
  LineScore,
  LineScoreInning,
  PitcherBoxLine,
  PitchingDecisions,
  PitchingTotals,
  TeamBoxScore,
} from "@/types/mlb-boxscore";

interface BoxScorePlayerRaw {
  person?: {
    id?: number;
    fullName?: string;
    boxscoreName?: string;
  };
  position?: { abbreviation?: string };
  allPositions?: Array<{ abbreviation?: string }>;
  batSide?: { code?: string };
  pitchHand?: { code?: string };
  stats?: {
    batting?: Record<string, unknown>;
    pitching?: Record<string, unknown>;
  };
  seasonStats?: {
    batting?: { avg?: string; ops?: string; gamesPlayed?: number; runs?: number; hits?: number; homeRuns?: number; rbi?: number };
    pitching?: { era?: string; inningsPitched?: string; hits?: number; baseOnBalls?: number; strikeOuts?: number };
  };
}

interface BoxScoreTeamRaw {
  team?: { id?: number; name?: string; abbreviation?: string };
  teamStats?: {
    pitching?: Record<string, unknown>;
  };
  players?: Record<string, BoxScorePlayerRaw>;
  batters?: number[];
  pitchers?: number[];
  bench?: number[];
  bullpen?: number[];
}

interface BoxScoreFeedRaw {
  gameData: {
    teams: {
      away: { name: string; abbreviation?: string };
      home: { name: string; abbreviation?: string };
    };
    status?: { abstractGameState?: string };
    venue?: { name?: string };
    datetime?: { originalDate?: string };
    gameInfo?: {
      attendance?: number;
      firstPitch?: string;
      gameDurationMinutes?: number;
    };
    weather?: { condition?: string; temp?: string; wind?: string };
  };
  liveData: {
    linescore?: {
      scheduledInnings?: number;
      innings?: Array<{
        num?: number;
        away?: { runs?: number };
        home?: { runs?: number };
      }>;
      teams?: {
        away?: { runs?: number; hits?: number; errors?: number };
        home?: { runs?: number; hits?: number; errors?: number };
      };
    };
    boxscore?: {
      teams?: { away?: BoxScoreTeamRaw; home?: BoxScoreTeamRaw };
      info?: Array<{ label?: string; value?: string }>;
    };
    decisions?: {
      winner?: { fullName?: string };
      loser?: { fullName?: string };
      save?: { fullName?: string };
    };
  };
}

function playerKey(playerId: number): string {
  return `ID${playerId}`;
}

function getPlayer(team: BoxScoreTeamRaw, playerId: number): BoxScorePlayerRaw | null {
  return team.players?.[playerKey(playerId)] ?? null;
}

function formatPositions(player: BoxScorePlayerRaw): string {
  const positions = player.allPositions?.length
    ? player.allPositions
    : player.position
      ? [player.position]
      : [];
  return positions.map((p) => p.abbreviation).filter(Boolean).join("-");
}

function formatStat(value: unknown, fallback = "—"): string {
  if (value == null || value === "") return fallback;
  return String(value);
}

function parseBatterLine(player: BoxScorePlayerRaw): BatterBoxLine | null {
  const batting = player.stats?.batting;
  if (!batting) return null;

  const season = player.seasonStats?.batting;

  return {
    playerId: player.person?.id ?? 0,
    name: player.person?.boxscoreName ?? player.person?.fullName ?? "—",
    note: formatStat(batting.note, ""),
    positions: formatPositions(player),
    batSide: player.batSide?.code ?? "R",
    atBats: Number(batting.atBats ?? 0),
    runs: Number(batting.runs ?? 0),
    hits: Number(batting.hits ?? 0),
    rbi: Number(batting.rbi ?? 0),
    walks: Number(batting.baseOnBalls ?? 0),
    strikeOuts: Number(batting.strikeOuts ?? 0),
    seasonAvg: formatStat(season?.avg, ".000"),
    seasonOps: formatStat(season?.ops, ".000"),
  };
}

function parsePitcherLine(player: BoxScorePlayerRaw): PitcherBoxLine | null {
  const pitching = player.stats?.pitching;
  if (!pitching) return null;

  const season = player.seasonStats?.pitching;

  return {
    playerId: player.person?.id ?? 0,
    name: player.person?.boxscoreName ?? player.person?.fullName ?? "—",
    note: formatStat(pitching.note, ""),
    inningsPitched: formatStat(pitching.inningsPitched, "0.0"),
    hits: Number(pitching.hits ?? 0),
    runs: Number(pitching.runs ?? 0),
    earnedRuns: Number(pitching.earnedRuns ?? 0),
    walks: Number(pitching.baseOnBalls ?? 0),
    strikeOuts: Number(pitching.strikeOuts ?? 0),
    homeRuns: Number(pitching.homeRuns ?? 0),
    seasonEra: formatStat(season?.era, "—"),
  };
}

function parseBenchLine(player: BoxScorePlayerRaw): BenchPlayerLine {
  const season = player.seasonStats?.batting ?? {};

  return {
    playerId: player.person?.id ?? 0,
    name: player.person?.boxscoreName ?? player.person?.fullName ?? "—",
    batSide: player.batSide?.code ?? "—",
    position: player.position?.abbreviation ?? "—",
    avg: formatStat(season.avg, ".000"),
    games: Number(season.gamesPlayed ?? 0),
    runs: Number(season.runs ?? 0),
    hits: Number(season.hits ?? 0),
    homeRuns: Number(season.homeRuns ?? 0),
    rbi: Number(season.rbi ?? 0),
  };
}

function parseBullpenLine(player: BoxScorePlayerRaw): BullpenPlayerLine {
  const season = player.seasonStats?.pitching ?? {};

  return {
    playerId: player.person?.id ?? 0,
    name: player.person?.boxscoreName ?? player.person?.fullName ?? "—",
    throwHand: player.pitchHand?.code ?? "—",
    era: formatStat(season.era, "—"),
    inningsPitched: formatStat(season.inningsPitched, "0.0"),
    hits: Number(season.hits ?? 0),
    walks: Number(season.baseOnBalls ?? 0),
    strikeOuts: Number(season.strikeOuts ?? 0),
  };
}

function parsePitchingTotals(team: BoxScoreTeamRaw): PitchingTotals | null {
  const pitching = team.teamStats?.pitching;
  if (!pitching) return null;

  return {
    inningsPitched: formatStat(pitching.inningsPitched, "0.0"),
    hits: Number(pitching.hits ?? 0),
    runs: Number(pitching.runs ?? 0),
    earnedRuns: Number(pitching.earnedRuns ?? 0),
    walks: Number(pitching.baseOnBalls ?? 0),
    strikeOuts: Number(pitching.strikeOuts ?? 0),
    homeRuns: Number(pitching.homeRuns ?? 0),
  };
}

function parseTeamBoxScore(team: BoxScoreTeamRaw, abbrevFallback?: string): TeamBoxScore {
  const batters: BatterBoxLine[] = [];
  for (const playerId of team.batters ?? []) {
    const player = getPlayer(team, playerId);
    if (!player) continue;
    const line = parseBatterLine(player);
    if (line) batters.push(line);
  }

  const pitchers: PitcherBoxLine[] = [];
  for (const playerId of team.pitchers ?? []) {
    const player = getPlayer(team, playerId);
    if (!player) continue;
    const line = parsePitcherLine(player);
    if (line) pitchers.push(line);
  }

  const bench: BenchPlayerLine[] = [];
  for (const playerId of team.bench ?? []) {
    const player = getPlayer(team, playerId);
    if (!player) continue;
    bench.push(parseBenchLine(player));
  }

  const bullpen: BullpenPlayerLine[] = [];
  for (const playerId of team.bullpen ?? []) {
    const player = getPlayer(team, playerId);
    if (!player) continue;
    bullpen.push(parseBullpenLine(player));
  }

  return {
    teamId: team.team?.id ?? 0,
    abbrev: team.team?.abbreviation ?? abbrevFallback ?? "—",
    name: team.team?.name ?? "—",
    batters,
    pitchers,
    pitchingTotals: parsePitchingTotals(team),
    bench,
    bullpen,
  };
}

function parseLineScore(
  feed: BoxScoreFeedRaw,
  isFinal: boolean,
): LineScore {
  const linescore = feed.liveData.linescore ?? {};
  const scheduledInnings = linescore.scheduledInnings ?? 9;
  const rawInnings = linescore.innings ?? [];
  const teamTotals = linescore.teams ?? {};

  const innings: LineScoreInning[] = [];
  const inningByNum = new Map(rawInnings.map((inning) => [inning.num ?? 0, inning]));

  for (let num = 1; num <= scheduledInnings; num += 1) {
    const inning = inningByNum.get(num);
    const awayRuns = inning?.away?.runs;
    const homeRuns = inning?.home?.runs;
    const homeSkipped =
      isFinal &&
      num === scheduledInnings &&
      awayRuns != null &&
      homeRuns == null;

    innings.push({
      num,
      awayRuns: awayRuns ?? null,
      homeRuns: homeSkipped ? null : (homeRuns ?? null),
      homeSkipped,
    });
  }

  return {
    scheduledInnings,
    away: {
      runs: teamTotals.away?.runs ?? 0,
      hits: teamTotals.away?.hits ?? 0,
      errors: teamTotals.away?.errors ?? 0,
    },
    home: {
      runs: teamTotals.home?.runs ?? 0,
      hits: teamTotals.home?.hits ?? 0,
      errors: teamTotals.home?.errors ?? 0,
    },
    innings,
  };
}

function parseGameInfo(feed: BoxScoreFeedRaw): GameInfoItem[] {
  const items: GameInfoItem[] = [];
  const rawInfo = feed.liveData.boxscore?.info ?? [];

  for (const item of rawInfo) {
    if (item.label && item.value) {
      items.push({ label: item.label, value: item.value });
    } else if (!item.label && item.value) {
      items.push({ label: "Date", value: item.value });
    }
  }

  const decisions = feed.liveData.decisions;
  if (decisions?.winner?.fullName) {
    items.unshift({ label: "WP", value: decisions.winner.fullName });
  }

  return items;
}

function parseDecisions(feed: BoxScoreFeedRaw): PitchingDecisions {
  const decisions = feed.liveData.decisions ?? {};
  return {
    winner: decisions.winner?.fullName ?? null,
    loser: decisions.loser?.fullName ?? null,
    save: decisions.save?.fullName ?? null,
  };
}

export function parseBoxScore(gamePk: number, feed: BoxScoreFeedRaw): GameBoxScore | null {
  const boxscore = feed.liveData.boxscore;
  if (!boxscore?.teams?.away || !boxscore?.teams?.home) return null;

  const teams = feed.gameData.teams;
  const isFinal = feed.gameData.status?.abstractGameState === "Final";
  const awayAbbrev = teams.away.abbreviation ?? teams.away.name.slice(0, 3).toUpperCase();
  const homeAbbrev = teams.home.abbreviation ?? teams.home.name.slice(0, 3).toUpperCase();

  return {
    gamePk,
    awayAbbrev,
    homeAbbrev,
    lineScore: parseLineScore(feed, isFinal),
    away: parseTeamBoxScore(boxscore.teams.away, awayAbbrev),
    home: parseTeamBoxScore(boxscore.teams.home, homeAbbrev),
    decisions: parseDecisions(feed),
    info: parseGameInfo(feed),
    observedAt: new Date().toISOString(),
  };
}

export function isGameBoxScore(value: unknown): value is GameBoxScore {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GameBoxScore>;
  return (
    typeof candidate.gamePk === "number" &&
    candidate.lineScore != null &&
    candidate.away != null &&
    candidate.home != null
  );
}
