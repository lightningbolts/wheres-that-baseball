import type { NotableNerdEvent, SeasonNerdCounters, TeamNerdCounters } from "@/lib/mlb/nerdStats/types";
import { MLB_TEAMS } from "@/lib/mlb/teams";

export function createEmptyTeamCounters(): TeamNerdCounters {
  return {
    gamesPlayed: 0,
    finalGamesWithFeed: 0,
    wins: 0,
    losses: 0,
    oneRunGames: 0,
    oneRunWins: 0,
    oneRunLosses: 0,
    extraInningGames: 0,
    extraInningWins: 0,
    extraInningLosses: 0,
    blowoutLosses: 0,
    blowoutWins: 0,
    shutoutGames: 0,
    tenPlusRunGames: 0,
    twoOrFewerRunGames: 0,
    comebackWins: 0,
    runsScored: 0,
    runsWithTwoOuts: 0,
    firstInningRuns: 0,
    lateInningRuns: 0,
    plateAppearances: 0,
    strikeouts: 0,
    walks: 0,
    intentWalks: 0,
    hbp: 0,
    sacFlies: 0,
    sacBunts: 0,
    gidp: 0,
    rallyKillerGidp: 0,
    gidpInduced: 0,
    triplePlays: 0,
    triplePlaysTurned: 0,
    triplePlayOpportunities: 0,
    walkoffBloopSingles: 0,
    walkoffWins: 0,
    walkoffLosses: 0,
    bloopSingles: 0,
    infieldSingles: 0,
    homeRuns: 0,
    softestHomeRunMph: null,
    shortestHomeRunFt: null,
    flarestHomeRunLa: null,
    hardestHitMph: null,
    moonshotHomeRuns: 0,
    noDoubterHomeRuns: 0,
    battedBallEvents: 0,
    barrelBalls: 0,
    chopBalls: 0,
    popupBalls: 0,
    pitcherHits: 0,
    stolenBases: 0,
    caughtStealing: 0,
    pickoffs: 0,
    balkBenefits: 0,
    wildPitchBenefits: 0,
    passedBallBenefits: 0,
    errorRunBenefits: 0,
    basesLoadedNoRuns: 0,
    cycleGames: 0,
    backToBackHrGames: 0,
    backToBackToBackHrGames: 0,
    goldenSombreros: 0,
    multiHrGamesAllowed: 0,
    immaculateInningVictims: 0,
    zeroWalkGames: 0,
    wallScraperHomeRuns: 0,
    leftOnBase: 0,
    lobNightmareGames: 0,
    pinchHitAttempts: 0,
    pinchHitHits: 0,
    pinchHitHomeRuns: 0,
    pinchHitChaos: 0,
    hardestHitAllowedMph: null,
    playerCycleGames: 0,
    maxHbpInGame: 0,
    noHitterBidRuined: 0,
    notableEvents: [],
  };
}

export function createEmptySeasonCounters(): SeasonNerdCounters {
  const counters: SeasonNerdCounters = {};
  for (const team of MLB_TEAMS) {
    counters[String(team.id)] = createEmptyTeamCounters();
  }
  return counters;
}

function mergeMinNullable(target: number | null, source: number | null): number | null {
  if (source == null) return target;
  return target == null ? source : Math.min(target, source);
}

function mergeMaxNullable(target: number | null, source: number | null): number | null {
  if (source == null) return target;
  return target == null ? source : Math.max(target, source);
}

export function mergeTeamCounters(target: TeamNerdCounters, source: TeamNerdCounters): void {
  target.gamesPlayed += source.gamesPlayed;
  target.finalGamesWithFeed += source.finalGamesWithFeed;
  target.wins += source.wins;
  target.losses += source.losses;
  target.oneRunGames += source.oneRunGames;
  target.oneRunWins += source.oneRunWins;
  target.oneRunLosses += source.oneRunLosses;
  target.extraInningGames += source.extraInningGames;
  target.extraInningWins += source.extraInningWins;
  target.extraInningLosses += source.extraInningLosses;
  target.blowoutLosses += source.blowoutLosses;
  target.blowoutWins += source.blowoutWins;
  target.shutoutGames += source.shutoutGames;
  target.tenPlusRunGames += source.tenPlusRunGames;
  target.twoOrFewerRunGames += source.twoOrFewerRunGames;
  target.comebackWins += source.comebackWins;
  target.runsScored += source.runsScored;
  target.runsWithTwoOuts += source.runsWithTwoOuts;
  target.firstInningRuns += source.firstInningRuns;
  target.lateInningRuns += source.lateInningRuns;
  target.plateAppearances += source.plateAppearances;
  target.strikeouts += source.strikeouts;
  target.walks += source.walks;
  target.intentWalks += source.intentWalks;
  target.hbp += source.hbp;
  target.sacFlies += source.sacFlies;
  target.sacBunts += source.sacBunts;
  target.gidp += source.gidp;
  target.rallyKillerGidp += source.rallyKillerGidp;
  target.gidpInduced += source.gidpInduced;
  target.triplePlays += source.triplePlays;
  target.triplePlaysTurned += source.triplePlaysTurned;
  target.triplePlayOpportunities += source.triplePlayOpportunities;
  target.walkoffBloopSingles += source.walkoffBloopSingles;
  target.walkoffWins += source.walkoffWins;
  target.walkoffLosses += source.walkoffLosses;
  target.bloopSingles += source.bloopSingles;
  target.infieldSingles += source.infieldSingles;
  target.homeRuns += source.homeRuns;
  target.moonshotHomeRuns += source.moonshotHomeRuns;
  target.noDoubterHomeRuns += source.noDoubterHomeRuns;
  target.battedBallEvents += source.battedBallEvents;
  target.barrelBalls += source.barrelBalls;
  target.chopBalls += source.chopBalls;
  target.popupBalls += source.popupBalls;
  target.pitcherHits += source.pitcherHits;
  target.stolenBases += source.stolenBases;
  target.caughtStealing += source.caughtStealing;
  target.pickoffs += source.pickoffs;
  target.balkBenefits += source.balkBenefits;
  target.wildPitchBenefits += source.wildPitchBenefits;
  target.passedBallBenefits += source.passedBallBenefits;
  target.errorRunBenefits += source.errorRunBenefits;
  target.basesLoadedNoRuns += source.basesLoadedNoRuns;
  target.cycleGames += source.cycleGames;
  target.backToBackHrGames += source.backToBackHrGames;
  target.backToBackToBackHrGames += source.backToBackToBackHrGames;
  target.goldenSombreros += source.goldenSombreros;
  target.multiHrGamesAllowed += source.multiHrGamesAllowed;
  target.immaculateInningVictims += source.immaculateInningVictims;
  target.zeroWalkGames += source.zeroWalkGames;
  target.wallScraperHomeRuns += source.wallScraperHomeRuns;
  target.leftOnBase += source.leftOnBase;
  target.lobNightmareGames += source.lobNightmareGames;
  target.pinchHitAttempts += source.pinchHitAttempts;
  target.pinchHitHits += source.pinchHitHits;
  target.pinchHitHomeRuns += source.pinchHitHomeRuns;
  target.pinchHitChaos += source.pinchHitChaos;
  target.playerCycleGames += source.playerCycleGames;
  target.noHitterBidRuined += source.noHitterBidRuined;
  target.maxHbpInGame = Math.max(target.maxHbpInGame, source.maxHbpInGame);

  target.hardestHitAllowedMph = mergeMaxNullable(target.hardestHitAllowedMph, source.hardestHitAllowedMph);

  target.softestHomeRunMph = mergeMinNullable(target.softestHomeRunMph, source.softestHomeRunMph);
  target.shortestHomeRunFt = mergeMinNullable(target.shortestHomeRunFt, source.shortestHomeRunFt);
  target.flarestHomeRunLa = mergeMaxNullable(target.flarestHomeRunLa, source.flarestHomeRunLa);
  target.hardestHitMph = mergeMaxNullable(target.hardestHitMph, source.hardestHitMph);

  if (source.notableEvents.length > 0) {
    target.notableEvents.push(...source.notableEvents);
  }
}

export function mergeSeasonCounters(
  target: SeasonNerdCounters,
  source: SeasonNerdCounters,
): void {
  for (const [teamId, teamSource] of Object.entries(source)) {
    const teamTarget = target[teamId] ?? createEmptyTeamCounters();
    mergeTeamCounters(teamTarget, teamSource);
    target[teamId] = teamTarget;
  }
}

export function pushNotable(
  counters: TeamNerdCounters,
  event: NotableNerdEvent,
  maxPerStat = 25,
): void {
  const sameStat = counters.notableEvents.filter((item) => item.statId === event.statId).length;
  if (sameStat >= maxPerStat) return;
  counters.notableEvents.push(event);
}
