import { parseStoredGameState } from "@/lib/games/gameState";
import {
  createEmptySeasonCounters,
  createEmptyTeamCounters,
  pushNotable,
} from "@/lib/mlb/nerdStats/counters";
import {
  battingTeamId,
  buildPitcherBatterIds,
  extractPinchHitterName,
  fieldingTeamId,
  findWalkOffPlay,
  hasBattedBallData,
  isBalk,
  isBarrel,
  isBloopSingle,
  isCaughtStealing,
  isGidp,
  isInfieldSingle,
  isNoDoubterHr,
  isPassedBall,
  isPickoff,
  isPitcherHit,
  isRallyKillerGidp,
  isStolenBase,
  isTriplePlay,
  isTriplePlayOpportunity,
  isWildPitch,
  runnersLeftOnBases,
  runsForBattingTeam,
  teamWon,
} from "@/lib/mlb/nerdStats/extractHelpers";
import { recordPitchCounters } from "@/lib/mlb/nerdStats/pitchCounters";
import type { GameNerdSourceRow, SeasonNerdCounters } from "@/lib/mlb/nerdStats/types";
import type { GameBoxScore } from "@/types/mlb-boxscore";
import type { PlayByPlayEntry } from "@/types/mlb-live";

function teamCounters(counters: SeasonNerdCounters, teamId: number) {
  const key = String(teamId);
  if (!counters[key]) counters[key] = createEmptyTeamCounters();
  return counters[key]!;
}

function maxInningFromPlays(plays: PlayByPlayEntry[]): number {
  return plays.reduce((max, play) => Math.max(max, play.inning), 0);
}

function maxInningFromBoxScore(boxScore: GameBoxScore | null): number {
  const innings = boxScore?.lineScore?.innings;
  if (!innings?.length) return 0;
  return innings.reduce((max, inning) => Math.max(max, inning.num), 0);
}

function gameInningCount(plays: PlayByPlayEntry[], boxScore: GameBoxScore | null): number {
  return Math.max(maxInningFromPlays(plays), maxInningFromBoxScore(boxScore));
}

function halfKey(play: PlayByPlayEntry): string {
  return `${play.inning}-${play.halfInning}`;
}

function basesLoaded(before: PlayByPlayEntry["situationBefore"]): boolean {
  return before.onFirst && before.onSecond && before.onThird;
}

interface BatterCycleState {
  name: string;
  types: Set<string>;
}

interface GameTeamState {
  maxDeficit: number;
  hitTypes: Set<string>;
  batterHitTypes: Map<number, BatterCycleState>;
  hrStreak: number;
  maxHrStreak: number;
  batterStrikeouts: Map<number, { count: number; name: string }>;
  opponentHr: number;
  walksInGame: number;
  lobInGame: number;
  hbpInGame: number;
  hitsAllowed: number;
  hitsAllowedThrough6: number;
  strikeoutsInGame: number;
  firstAbOfHalf: boolean;
  pinchBatters: Set<string>;
}

function createGameTeamState(): GameTeamState {
  return {
    maxDeficit: 0,
    hitTypes: new Set(),
    batterHitTypes: new Map(),
    hrStreak: 0,
    maxHrStreak: 0,
    batterStrikeouts: new Map(),
    opponentHr: 0,
    walksInGame: 0,
    lobInGame: 0,
    hbpInGame: 0,
    hitsAllowed: 0,
    hitsAllowedThrough6: 0,
    strikeoutsInGame: 0,
    firstAbOfHalf: true,
    pinchBatters: new Set(),
  };
}

interface HalfInningTracker {
  key: string;
  offenseId: number;
  basesLoadedSeen: boolean;
  runs: number;
}

function finalizeHalfInning(
  counters: SeasonNerdCounters,
  tracker: HalfInningTracker | null,
): void {
  if (!tracker || !tracker.basesLoadedSeen || tracker.runs > 0) return;
  teamCounters(counters, tracker.offenseId).basesLoadedNoRuns += 1;
}

function trackDeficit(
  awayScore: number,
  homeScore: number,
  awayTeamId: number,
  homeTeamId: number,
  awayState: GameTeamState,
  homeState: GameTeamState,
): void {
  const awayDeficit = Math.max(0, homeScore - awayScore);
  const homeDeficit = Math.max(0, awayScore - homeScore);
  awayState.maxDeficit = Math.max(awayState.maxDeficit, awayDeficit);
  homeState.maxDeficit = Math.max(homeState.maxDeficit, homeDeficit);
}

function recordHitType(
  state: GameTeamState,
  event: string,
  batterId?: number | null,
  batterName?: string,
): void {
  const hitKey =
    event === "Single"
      ? "single"
      : event === "Double"
        ? "double"
        : event === "Triple"
          ? "triple"
          : event === "Home Run"
            ? "hr"
            : null;
  if (!hitKey) return;
  state.hitTypes.add(hitKey);
  if (batterId == null) return;
  const entry = state.batterHitTypes.get(batterId) ?? {
    name: batterName?.trim() || "Unknown batter",
    types: new Set<string>(),
  };
  if (batterName?.trim()) entry.name = batterName.trim();
  entry.types.add(hitKey);
  state.batterHitTypes.set(batterId, entry);
}

function hasCycle(hitTypes: Set<string>): boolean {
  return (
    hitTypes.has("single") &&
    hitTypes.has("double") &&
    hitTypes.has("triple") &&
    hitTypes.has("hr")
  );
}

function finalizeGameTeamState(
  counters: SeasonNerdCounters,
  teamId: number,
  state: GameTeamState,
  row: GameNerdSourceRow,
): void {
  const team = teamCounters(counters, teamId);

  if (hasCycle(state.hitTypes)) {
    team.cycleGames += 1;
    pushNotable(team, {
      statId: "cycle-games",
      gamePk: row.game_pk,
      gameDate: row.game_date,
      label: "Cycle game",
      detail: "Team hit a single, double, triple, and home run",
    });
  }

  if (state.maxHrStreak >= 2) {
    team.backToBackHrGames += 1;
    pushNotable(team, {
      statId: "back-to-back-hr-games",
      gamePk: row.game_pk,
      gameDate: row.game_date,
      label: `${state.maxHrStreak} straight HRs`,
      detail: "Back-to-back (or more) homers in one game",
      value: state.maxHrStreak,
    });
  }

  if (state.maxHrStreak >= 3) {
    team.backToBackToBackHrGames += 1;
    pushNotable(team, {
      statId: "back-to-back-to-back-hr-games",
      gamePk: row.game_pk,
      gameDate: row.game_date,
      label: "Back-to-back-to-back HRs",
      detail: "Three consecutive homers in one game",
    });
  }

  if (state.opponentHr >= 3) {
    team.multiHrGamesAllowed += 1;
    pushNotable(team, {
      statId: "multi-hr-games-allowed",
      gamePk: row.game_pk,
      gameDate: row.game_date,
      label: `${state.opponentHr} HRs allowed`,
      detail: "Opponent hit 3+ home runs",
      value: state.opponentHr,
    });
  }

  for (const { count, name } of state.batterStrikeouts.values()) {
    if (count >= 4) {
      team.goldenSombreros += 1;
      pushNotable(team, {
        statId: "golden-sombrero",
        gamePk: row.game_pk,
        gameDate: row.game_date,
        label: `${name} — golden sombrero`,
        detail: `${count} strikeouts in one game`,
        value: count,
      });
      break;
    }
  }

  if (state.walksInGame === 0 && team.finalGamesWithFeed > 0) {
    team.zeroWalkGames += 1;
  }

  if (state.lobInGame >= 10) {
    team.lobNightmareGames += 1;
    pushNotable(team, {
      statId: "lob-nightmare-games",
      gamePk: row.game_pk,
      gameDate: row.game_date,
      label: "LOB nightmare",
      detail: `${state.lobInGame} runners left on base`,
      value: state.lobInGame,
    });
  }

  if (state.hbpInGame > team.maxHbpInGame) {
    team.maxHbpInGame = state.hbpInGame;
    pushNotable(team, {
      statId: "max-hbp-in-game",
      gamePk: row.game_pk,
      gameDate: row.game_date,
      label: "HBP barrage",
      detail: `${state.hbpInGame} hit-by-pitches in one game`,
      value: state.hbpInGame,
    });
  }

  const teamRuns =
    teamId === row.away_team_id ? row.away_score ?? 0 : row.home_score ?? 0;
  if (teamRuns >= 8) {
    team.eightPlusRunGames += 1;
    pushNotable(team, {
      statId: "eight-plus-run-games",
      gamePk: row.game_pk,
      gameDate: row.game_date,
      label: "Slugfest",
      detail: `${teamRuns} runs scored`,
      value: teamRuns,
    });
  }

  if (state.strikeoutsInGame >= 12) {
    team.whiffFestGames += 1;
    pushNotable(team, {
      statId: "whiff-fest-games",
      gamePk: row.game_pk,
      gameDate: row.game_date,
      label: "Whiff fest",
      detail: `${state.strikeoutsInGame} strikeouts in one game`,
      value: state.strikeoutsInGame,
    });
  }

  for (const { name, types } of state.batterHitTypes.values()) {
    if (hasCycle(types)) {
      team.playerCycleGames += 1;
      pushNotable(team, {
        statId: "player-cycle-games",
        gamePk: row.game_pk,
        gameDate: row.game_date,
        label: `${name} hit for the cycle`,
        detail: "Single, double, triple, and home run in the same game",
      });
      break;
    }
  }
}

export function extractNerdCountersFromGame(row: GameNerdSourceRow): SeasonNerdCounters {
  const counters = createEmptySeasonCounters();
  const away = teamCounters(counters, row.away_team_id);
  const home = teamCounters(counters, row.home_team_id);

  const isFinal =
    row.away_score != null &&
    row.home_score != null &&
    row.feed_synced_at != null;

  if (!isFinal) return counters;

  away.gamesPlayed += 1;
  home.gamesPlayed += 1;

  const awayScore = row.away_score!;
  const homeScore = row.home_score!;
  const scoreRow = {
    away_team_id: row.away_team_id,
    home_team_id: row.home_team_id,
    away_score: awayScore,
    home_score: homeScore,
  };
  const margin = Math.abs(awayScore - homeScore);

  if (teamWon(row.away_team_id, scoreRow)) {
    away.wins += 1;
    home.losses += 1;
  } else if (teamWon(row.home_team_id, scoreRow)) {
    home.wins += 1;
    away.losses += 1;
  }

  if (margin === 1) {
    away.oneRunGames += 1;
    home.oneRunGames += 1;
    if (awayScore > homeScore) {
      away.oneRunWins += 1;
      home.oneRunLosses += 1;
    } else {
      home.oneRunWins += 1;
      away.oneRunLosses += 1;
    }
  }

  if (awayScore < homeScore && homeScore - awayScore >= 5) {
    away.blowoutLosses += 1;
    home.blowoutWins += 1;
  } else if (homeScore < awayScore && awayScore - homeScore >= 5) {
    home.blowoutLosses += 1;
    away.blowoutWins += 1;
  }

  if (awayScore === 0) away.shutoutGames += 1;
  if (homeScore === 0) home.shutoutGames += 1;

  if (awayScore >= 10) away.tenPlusRunGames += 1;
  if (homeScore >= 10) home.tenPlusRunGames += 1;

  if (awayScore <= 2) away.twoOrFewerRunGames += 1;
  if (homeScore <= 2) home.twoOrFewerRunGames += 1;

  if (!row.feed_synced_at) return counters;

  away.finalGamesWithFeed += 1;
  home.finalGamesWithFeed += 1;

  const state = parseStoredGameState(row.game_state, row.game_pk);
  if (!state?.plays?.length) return counters;

  const plays = state.plays;
  const boxScore = row.box_score as GameBoxScore | null;
  const pitcherBatterIds = buildPitcherBatterIds(boxScore);
  const maxInning = gameInningCount(plays, boxScore);

  if (maxInning > 9) {
    away.extraInningGames += 1;
    home.extraInningGames += 1;
    if (awayScore > homeScore) {
      away.extraInningWins += 1;
      home.extraInningLosses += 1;
    } else if (homeScore > awayScore) {
      home.extraInningWins += 1;
      away.extraInningLosses += 1;
    }
  }

  const awayGame = createGameTeamState();
  const homeGame = createGameTeamState();
  let halfTracker: HalfInningTracker | null = null;
  const halfInningStrikeouts = new Map<string, { offenseId: number; count: number }>();

  const isHitEvent = (event: string) =>
    ["Single", "Double", "Triple", "Home Run"].includes(event);

  for (const play of plays) {
    const offenseId = battingTeamId(play, row.away_team_id, row.home_team_id);
    const defenseId = fieldingTeamId(play, row.away_team_id, row.home_team_id);
    const offense = teamCounters(counters, offenseId);
    const defense = teamCounters(counters, defenseId);
    const offenseGame = offenseId === row.away_team_id ? awayGame : homeGame;
    const defenseGame = defenseId === row.away_team_id ? awayGame : homeGame;

    trackDeficit(play.awayScore, play.homeScore, row.away_team_id, row.home_team_id, awayGame, homeGame);

    const playHalf = halfKey(play);
    if (!halfTracker || halfTracker.key !== playHalf) {
      finalizeHalfInning(counters, halfTracker);
      halfTracker = {
        key: playHalf,
        offenseId,
        basesLoadedSeen: basesLoaded(play.situationBefore),
        runs: 0,
      };
      offense.battingHalfInnings += 1;
      defense.pitchingHalfInnings += 1;
      offenseGame.firstAbOfHalf = true;
    } else if (basesLoaded(play.situationBefore)) {
      halfTracker.basesLoadedSeen = true;
    }

    if (play.isAtBat) {
      offense.plateAppearances += 1;
      recordHitType(offenseGame, play.event, play.batterId, play.batterName);

      for (const pitch of play.detail.pitches) {
        recordPitchCounters(offense, defense, pitch);
      }

      if (isHitEvent(play.event)) {
        defenseGame.hitsAllowed += 1;
        if (play.inning <= 6) defenseGame.hitsAllowedThrough6 += 1;
        if (play.event === "Double") offense.doubles += 1;
        if (play.event === "Triple") offense.triples += 1;
        if (
          defenseGame.hitsAllowed === 1 &&
          play.inning >= 7 &&
          defenseGame.hitsAllowedThrough6 === 0
        ) {
          defense.noHitterBidRuined += 1;
          pushNotable(defense, {
            statId: "no-hitter-bid-ruined",
            gamePk: row.game_pk,
            gameDate: row.game_date,
            label: "No-hitter bid ruined",
            detail: `First hit allowed in the ${play.inning}th`,
            value: play.inning,
          });
        }
      }

      if (offenseGame.pinchBatters.has(play.batterName)) {
        offense.pinchHitAttempts += 1;
        const chaos =
          isHitEvent(play.event) ||
          play.event === "Hit By Pitch" ||
          play.event === "Strikeout" ||
          play.event === "Home Run";
        if (chaos) offense.pinchHitChaos += 1;
        if (isHitEvent(play.event)) offense.pinchHitHits += 1;
        if (play.event === "Home Run") offense.pinchHitHomeRuns += 1;
        pushNotable(offense, {
          statId: "pinch-hit-chaos",
          gamePk: row.game_pk,
          gameDate: row.game_date,
          label: `${play.batterName} pinch-hit`,
          detail: play.description,
        });
      }

      if (play.isAtBat) {
        const risp = play.situationBefore.onSecond || play.situationBefore.onThird;
        if (risp) {
          offense.rispPlateAppearances += 1;
          if (isHitEvent(play.event)) offense.rispHits += 1;
        }
      }

      if (play.event === "Strikeout") {
        offense.strikeouts += 1;
        offenseGame.strikeoutsInGame += 1;
        defense.pitchingStrikeouts += 1;
        const batterId = play.batterId ?? play.atBatIndex;
        const prev = offenseGame.batterStrikeouts.get(batterId) ?? {
          count: 0,
          name: play.batterName,
        };
        prev.count += 1;
        if (play.batterName.trim()) prev.name = play.batterName.trim();
        offenseGame.batterStrikeouts.set(batterId, prev);

        const hk = `${playHalf}-k`;
        const halfKs = halfInningStrikeouts.get(hk) ?? { offenseId, count: 0 };
        halfKs.count += 1;
        halfInningStrikeouts.set(hk, halfKs);
      }

      if (play.event === "Walk" || play.event === "Intent Walk") {
        offense.walks += 1;
        offenseGame.walksInGame += 1;
        if (play.event === "Intent Walk") offense.intentWalks += 1;
      }

      if (play.event === "Sac Fly") offense.sacFlies += 1;
      if (play.event === "Sac Bunt") offense.sacBunts += 1;

      if (play.event === "Hit By Pitch") {
        offense.hbp += 1;
        offenseGame.hbpInGame += 1;
        pushNotable(offense, {
          statId: "hit-by-pitch",
          gamePk: row.game_pk,
          gameDate: row.game_date,
          label: `${play.batterName} plunked`,
          detail: play.description,
        });
      }

      if (isGidp(play)) {
        offense.gidp += 1;
        defense.gidpInduced += 1;
        pushNotable(offense, {
          statId: "double-plays-hit-into",
          gamePk: row.game_pk,
          gameDate: row.game_date,
          label: `${play.batterName} GIDP`,
          detail: play.description,
        });
        if (isRallyKillerGidp(play)) {
          offense.rallyKillerGidp += 1;
          pushNotable(offense, {
            statId: "rally-killer-gidp",
            gamePk: row.game_pk,
            gameDate: row.game_date,
            label: `${play.batterName} rally-killer GIDP`,
            detail: play.description,
          });
        }
      }

      if (isTriplePlay(play)) {
        offense.triplePlays += 1;
        defense.triplePlaysTurned += 1;
        pushNotable(offense, {
          statId: "triple-plays-hit-into",
          gamePk: row.game_pk,
          gameDate: row.game_date,
          label: `${play.batterName} triple play`,
          detail: play.description,
        });
        pushNotable(defense, {
          statId: "triple-plays-turned",
          gamePk: row.game_pk,
          gameDate: row.game_date,
          label: "Triple play turned",
          detail: play.description,
        });
      }

      if (isTriplePlayOpportunity(play)) {
        offense.triplePlayOpportunities += 1;
      }

      if (isBloopSingle(play)) {
        offense.bloopSingles += 1;
      }

      if (isInfieldSingle(play)) {
        offense.infieldSingles += 1;
      }

      if (isPitcherHit(play, pitcherBatterIds)) {
        offense.pitcherHits += 1;
        pushNotable(offense, {
          statId: "pitcher-hits",
          gamePk: row.game_pk,
          gameDate: row.game_date,
          label: `${play.batterName} — pitcher hit`,
          detail: play.description,
        });
      }

      if (hasBattedBallData(play)) {
        const hit = play.detail.hit!;
        offense.battedBallEvents += 1;
        if (isBarrel(hit)) offense.barrelBalls += 1;
        if (hit.launchAngle < 5) offense.chopBalls += 1;
        if (hit.launchAngle > 50) offense.popupBalls += 1;

        const ev = hit.launchSpeed;
        if (offense.hardestHitMph == null || ev > offense.hardestHitMph) {
          offense.hardestHitMph = ev;
          pushNotable(offense, {
            statId: "hardest-hit",
            gamePk: row.game_pk,
            gameDate: row.game_date,
            label: `${play.batterName} rocket`,
            detail: `${ev.toFixed(1)} mph`,
            value: ev,
          });
        }
        if (defense.hardestHitAllowedMph == null || ev > defense.hardestHitAllowedMph) {
          defense.hardestHitAllowedMph = ev;
          pushNotable(defense, {
            statId: "hardest-hit-allowed",
            gamePk: row.game_pk,
            gameDate: row.game_date,
            label: `Allowed ${ev.toFixed(1)} mph`,
            detail: `${play.batterName} · ${play.event}`,
            value: ev,
          });
        }
      }

      if (play.event === "Home Run") {
        const hit = play.detail.hit;
        offenseGame.hrStreak += 1;
        offenseGame.maxHrStreak = Math.max(offenseGame.maxHrStreak, offenseGame.hrStreak);
        if (offenseGame.hrStreak >= 2) offense.backToBackHrSequences += 1;
        defenseGame.opponentHr += 1;

        if (basesLoaded(play.situationBefore)) {
          offense.grandSlams += 1;
          pushNotable(offense, {
            statId: "grand-slams",
            gamePk: row.game_pk,
            gameDate: row.game_date,
            label: `${play.batterName} grand slam`,
            detail: play.description,
          });
        }

        if (offenseGame.firstAbOfHalf) {
          offense.leadoffHomeRuns += 1;
          pushNotable(offense, {
            statId: "leadoff-homers",
            gamePk: row.game_pk,
            gameDate: row.game_date,
            label: `${play.batterName} leadoff HR`,
            detail: `${play.inning} ${play.halfInning}`,
          });
        }

        if (/inside[\s-]?the[\s-]?park/i.test(play.description)) {
          offense.insideTheParkHomeRuns += 1;
          pushNotable(offense, {
            statId: "inside-the-park-hrs",
            gamePk: row.game_pk,
            gameDate: row.game_date,
            label: `${play.batterName} inside-the-park HR`,
            detail: play.description,
          });
        }

        if (hit && hit.launchSpeed > 0) {
          offense.homeRuns += 1;
          const ev = hit.launchSpeed;
          const la = hit.launchAngle;
          const dist = hit.totalDistance;

          if (offense.softestHomeRunMph == null || ev < offense.softestHomeRunMph) {
            offense.softestHomeRunMph = ev;
            pushNotable(offense, {
              statId: "softest-home-run",
              gamePk: row.game_pk,
              gameDate: row.game_date,
              label: `${play.batterName} softest HR`,
              detail: `${ev.toFixed(1)} mph`,
              value: ev,
            });
          }

          if (dist > 0 && (offense.shortestHomeRunFt == null || dist < offense.shortestHomeRunFt)) {
            offense.shortestHomeRunFt = dist;
            pushNotable(offense, {
              statId: "shortest-home-run",
              gamePk: row.game_pk,
              gameDate: row.game_date,
              label: `${play.batterName} shortest HR`,
              detail: `${Math.round(dist)} ft`,
              value: dist,
            });
          }

          if (offense.flarestHomeRunLa == null || la > offense.flarestHomeRunLa) {
            offense.flarestHomeRunLa = la;
            pushNotable(offense, {
              statId: "flarest-home-run",
              gamePk: row.game_pk,
              gameDate: row.game_date,
              label: `${play.batterName} flarest HR`,
              detail: `${la.toFixed(1)}° launch angle`,
              value: la,
            });
          }

          if (la > 45) {
            offense.moonshotHomeRuns += 1;
            pushNotable(offense, {
              statId: "moonshot-hrs",
              gamePk: row.game_pk,
              gameDate: row.game_date,
              label: `${play.batterName} moonshot`,
              detail: `${la.toFixed(0)}°`,
              value: la,
            });
          }

          if (isNoDoubterHr(hit)) {
            offense.noDoubterHomeRuns += 1;
          }

          if (dist > 0 && dist < 340) {
            offense.wallScraperHomeRuns += 1;
            pushNotable(offense, {
              statId: "wall-scraper-hrs",
              gamePk: row.game_pk,
              gameDate: row.game_date,
              label: `${play.batterName} wall scraper`,
              detail: `${Math.round(dist)} ft`,
              value: dist,
            });
          }
        }

      } else if (play.isAtBat) {
        offenseGame.hrStreak = 0;
      }

      if (play.isAtBat) {
        offenseGame.firstAbOfHalf = false;
      }
    }

    if (play.isScoringPlay) {
      const runsForOffense = runsForBattingTeam(play);
      offense.runsScored += runsForOffense;
      if (halfTracker && halfTracker.key === playHalf) {
        halfTracker.runs += runsForOffense;
      }

      if (play.situationBefore.outs === 2 && runsForOffense > 0) {
        offense.runsWithTwoOuts += runsForOffense;
      }

      if (play.inning === 1 && runsForOffense > 0) {
        offense.firstInningRuns += runsForOffense;
      }

      if (play.inning >= 8 && runsForOffense > 0) {
        offense.lateInningRuns += runsForOffense;
      }

      if (/error/i.test(`${play.event} ${play.description}`)) {
        offense.errorRunBenefits += runsForOffense;
        pushNotable(offense, {
          statId: "error-assisted-runs",
          gamePk: row.game_pk,
          gameDate: row.game_date,
          label: "Error-assisted runs",
          detail: play.description,
          value: runsForOffense,
        });
      }
    }

    if (play.outs === 3) {
      const lob = runnersLeftOnBases(play.situationBefore);
      if (lob > 0) {
        offense.leftOnBase += lob;
        offenseGame.lobInGame += lob;
      }
    }

    if (!play.isAtBat) {
      const pinchName = extractPinchHitterName(play.description);
      if (pinchName) {
        offenseGame.pinchBatters.add(pinchName);
      }

      if (isStolenBase(play)) {
        offense.stolenBases += 1;
        pushNotable(offense, {
          statId: "games-between-steals",
          gamePk: row.game_pk,
          gameDate: row.game_date,
          label: "Stolen base",
          detail: play.description,
        });
      }
      if (isCaughtStealing(play)) {
        offense.caughtStealing += 1;
      }
      if (isPickoff(play)) {
        offense.pickoffs += 1;
        pushNotable(offense, {
          statId: "pickoffs-suffered",
          gamePk: row.game_pk,
          gameDate: row.game_date,
          label: "Pickoff",
          detail: play.description,
        });
      }
      if (isBalk(play) && play.isScoringPlay) {
        const runs = runsForBattingTeam(play);
        if (runs > 0) {
          offense.balkBenefits += runs;
          pushNotable(offense, {
            statId: "balk-beneficiaries",
            gamePk: row.game_pk,
            gameDate: row.game_date,
            label: "Balk run(s)",
            detail: play.description,
            value: runs,
          });
        }
      }
      if (isWildPitch(play) && play.isScoringPlay) {
        const runs = runsForBattingTeam(play);
        if (runs > 0) {
          offense.wildPitchBenefits += runs;
          pushNotable(offense, {
            statId: "wild-pitch-runs",
            gamePk: row.game_pk,
            gameDate: row.game_date,
            label: "Wild pitch run(s)",
            detail: play.description,
            value: runs,
          });
        }
      }
      if (isPassedBall(play) && play.isScoringPlay) {
        const runs = runsForBattingTeam(play);
        if (runs > 0) {
          offense.passedBallBenefits += runs;
          pushNotable(offense, {
            statId: "passed-ball-runs",
            gamePk: row.game_pk,
            gameDate: row.game_date,
            label: "Passed ball run(s)",
            detail: play.description,
            value: runs,
          });
        }
      }
    }
  }

  finalizeHalfInning(counters, halfTracker);

  for (const { offenseId, count } of halfInningStrikeouts.values()) {
    if (count >= 3) {
      teamCounters(counters, offenseId).immaculateInningVictims += 1;
      pushNotable(teamCounters(counters, offenseId), {
        statId: "immaculate-inning-victim",
        gamePk: row.game_pk,
        gameDate: row.game_date,
        label: "Immaculate inning victim",
        detail: "Three strikeouts in one half-inning",
      });
    }
  }

  if (teamWon(row.away_team_id, scoreRow) && awayGame.maxDeficit >= 3) {
    away.comebackWins += 1;
    pushNotable(away, {
      statId: "comeback-wins",
      gamePk: row.game_pk,
      gameDate: row.game_date,
      label: "Comeback win",
      detail: `Trailed by ${awayGame.maxDeficit}`,
      value: awayGame.maxDeficit,
    });
  }
  if (teamWon(row.home_team_id, scoreRow) && homeGame.maxDeficit >= 3) {
    home.comebackWins += 1;
    pushNotable(home, {
      statId: "comeback-wins",
      gamePk: row.game_pk,
      gameDate: row.game_date,
      label: "Comeback win",
      detail: `Trailed by ${homeGame.maxDeficit}`,
      value: homeGame.maxDeficit,
    });
  }

  finalizeGameTeamState(counters, row.away_team_id, awayGame, row);
  finalizeGameTeamState(counters, row.home_team_id, homeGame, row);

  const walkoffPlay = findWalkOffPlay(plays, homeScore, awayScore);
  if (walkoffPlay) {
    home.walkoffWins += 1;
    away.walkoffLosses += 1;
    pushNotable(home, {
      statId: "walk-off-wins",
      gamePk: row.game_pk,
      gameDate: row.game_date,
      label: `${walkoffPlay.batterName} walk-off`,
      detail: walkoffPlay.description,
    });
    pushNotable(away, {
      statId: "walk-off-losses",
      gamePk: row.game_pk,
      gameDate: row.game_date,
      label: "Walk-off loss",
      detail: walkoffPlay.description,
    });
    if (isBloopSingle(walkoffPlay)) {
      home.walkoffBloopSingles += 1;
      pushNotable(home, {
        statId: "walkoff-bloop-singles",
        gamePk: row.game_pk,
        gameDate: row.game_date,
        label: `${walkoffPlay.batterName} walk-off bloop`,
        detail: walkoffPlay.detail.hit
          ? `${walkoffPlay.detail.hit.launchSpeed.toFixed(0)} mph · ${walkoffPlay.detail.hit.launchAngle.toFixed(0)}°`
          : walkoffPlay.description,
        value: walkoffPlay.detail.hit?.launchSpeed,
      });
    }
  }

  return counters;
}
