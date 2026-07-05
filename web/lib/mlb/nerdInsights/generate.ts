import type {
  LiveInsightContext,
  NerdInsightToast,
  TeamNerdProfile,
} from "@/lib/mlb/nerdInsights/types";
import { getTeamStat, isEliteRank, rankLabel } from "@/lib/mlb/nerdInsights/profile";

type Rule = (
  ctx: LiveInsightContext,
  away: TeamNerdProfile | null,
  home: TeamNerdProfile | null,
) => NerdInsightToast | null;

function profileForTeam(
  profiles: { away: TeamNerdProfile | null; home: TeamNerdProfile | null },
  teamId: number,
): TeamNerdProfile | null {
  if (profiles.away?.teamId === teamId) return profiles.away;
  if (profiles.home?.teamId === teamId) return profiles.home;
  return null;
}

function livePaceForTeam(
  ctx: LiveInsightContext,
  teamId: number,
): { seenPerHalf: number | null; thrownPerHalf: number | null } {
  const live = ctx.liveStats;
  if (!live) return { seenPerHalf: null, thrownPerHalf: null };

  const team =
    teamId === ctx.awayTeamId
      ? live.away
      : teamId === ctx.homeTeamId
        ? live.home
        : null;
  if (!team) return { seenPerHalf: null, thrownPerHalf: null };

  return {
    seenPerHalf: team.pitchesSeenPerInning,
    thrownPerHalf: team.pitchesThrownPerInning,
  };
}

const rules: Rule[] = [
  // —— Half-inning breaks ——
  (ctx, away, home) => {
    if (ctx.trigger.type !== "half-break") return null;
    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const pace = getTeamStat(offense, "pitches-seen-per-half");
    const live = livePaceForTeam(ctx, ctx.offenseTeamId);
    if (!isEliteRank(pace, 6) || live.seenPerHalf == null) return null;
    if (live.seenPerHalf < pace.value * 1.12) return null;

    return {
      id: `${ctx.gamePk}-pace-${ctx.trigger.halfKey}`,
      eyebrow: "Nerd pace check",
      title: `${ctx.offenseAbbrev} is grinding`,
      message: `This half is moving slow — ${live.seenPerHalf.toFixed(1)} pitches per half so far. They rank ${rankLabel(pace.rank)} league-wide at ${pace.displayValue} per half.`,
      teamId: ctx.offenseTeamId,
      statId: "pitches-seen-per-half",
    };
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "half-break") return null;
    const fouls = ctx.liveStats?.foulBalls ?? 0;
    if (fouls < 6) return null;

    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const foulStat = getTeamStat(offense, "foul-ball-factory");
    if (!isEliteRank(foulStat, 8)) return null;

    return {
      id: `${ctx.gamePk}-fouls-${ctx.trigger.halfKey}`,
      eyebrow: "Foul ball factory",
      title: "Beer hawk weather",
      message: `${fouls} fouls already in this game. ${ctx.offenseAbbrev} are ${rankLabel(foulStat.rank)} in the league's foul-ball factory (${foulStat.displayValue} on the year).`,
      teamId: ctx.offenseTeamId,
      statId: "foul-ball-factory",
    };
  },

  // —— At-bat start ——
  (ctx, away, home) => {
    if (ctx.trigger.type !== "at-bat-start" || !ctx.runnersInScoringPosition) return null;
    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const risp = getTeamStat(offense, "risp-batting");
    if (!isEliteRank(risp, 8)) return null;

    return {
      id: `${ctx.gamePk}-risp-${ctx.trigger.atBatIndex}`,
      eyebrow: "Scoring position",
      title: `${ctx.batterName} with runners on`,
      message: `${ctx.offenseAbbrev} rank ${rankLabel(risp.rank)} in RISP hitting (${risp.displayValue}).`,
      teamId: ctx.offenseTeamId,
      statId: "risp-batting",
    };
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "at-bat-start" || !ctx.twoOuts || !ctx.runnersInScoringPosition) {
      return null;
    }
    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const twoOut = getTeamStat(offense, "runs-with-two-outs-pct");
    if (!isEliteRank(twoOut, 6)) return null;

    return {
      id: `${ctx.gamePk}-two-out-${ctx.trigger.atBatIndex}`,
      eyebrow: "Two-out drama",
      title: "Clutch or bust",
      message: `${ctx.offenseAbbrev} score ${twoOut.displayValue} of their runs with two outs (${rankLabel(twoOut.rank)} in MLB).`,
      teamId: ctx.offenseTeamId,
      statId: "runs-with-two-outs-pct",
    };
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "at-bat-start" || !ctx.basesLoaded) return null;
    const defense = profileForTeam({ away, home }, ctx.defenseTeamId);
    const stranded = getTeamStat(defense, "bases-loaded-no-runs");
    if (!isEliteRank(stranded, 5)) return null;

    return {
      id: `${ctx.gamePk}-loaded-${ctx.trigger.atBatIndex}`,
      eyebrow: "Bases juiced",
      title: "Strand patrol activated",
      message: `${ctx.defenseAbbrev} specialize in bases-loaded heartbreak — ${rankLabel(stranded.rank)} in leaving 'em loaded (${stranded.displayValue} times).`,
      teamId: ctx.defenseTeamId,
      statId: "bases-loaded-no-runs",
    };
  },

  // —— Pitch milestones ——
  (ctx, away, home) => {
    if (ctx.trigger.type !== "pitch-thrown" || ctx.trigger.pitchNumber < 6) return null;
    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const perPa = getTeamStat(offense, "pitches-per-pa");
    if (!isEliteRank(perPa, 6)) return null;

    return {
      id: `${ctx.gamePk}-deep-${ctx.trigger.atBatIndex}-${ctx.trigger.pitchNumber}`,
      eyebrow: "Marathon at-bat",
      title: `Pitch ${ctx.trigger.pitchNumber} and counting`,
      message: `${ctx.offenseAbbrev} see ${perPa.displayValue} pitches per plate appearance (${rankLabel(perPa.rank)} in MLB). ${ctx.batterName} is making them work.`,
      teamId: ctx.offenseTeamId,
      statId: "pitches-per-pa",
    };
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "pitch-thrown" || ctx.foulsThisAb < 3) return null;
    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const foulRate = getTeamStat(offense, "foul-rate");
    if (!isEliteRank(foulRate, 6)) return null;

    return {
      id: `${ctx.gamePk}-foul-ab-${ctx.trigger.atBatIndex}`,
      eyebrow: "Foul fest",
      title: "Net behind the plate working overtime",
      message: `${ctx.foulsThisAb} fouls this at-bat. ${ctx.offenseAbbrev} foul off ${foulRate.displayValue} of pitches — ${rankLabel(foulRate.rank)} in the league.`,
      teamId: ctx.offenseTeamId,
      statId: "foul-rate",
    };
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "pitch-thrown" || ctx.balls !== 3 || ctx.strikes !== 2) return null;
    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const ballHawk = getTeamStat(offense, "ball-rate");
    if (!isEliteRank(ballHawk, 6)) return null;

    return {
      id: `${ctx.gamePk}-fullcount-${ctx.trigger.atBatIndex}`,
      eyebrow: "3-2 chess match",
      title: "Full count standoff",
      message: `${ctx.offenseAbbrev} take balls at a ${ballHawk.displayValue} clip (${rankLabel(ballHawk.rank)} in MLB). Eye discipline meets arm fatigue.`,
      teamId: ctx.offenseTeamId,
      statId: "ball-rate",
    };
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "pitch-thrown" || ctx.balls !== 3 || ctx.strikes !== 2) return null;
    const defense = profileForTeam({ away, home }, ctx.defenseTeamId);
    const freeze = getTeamStat(defense, "called-strike-rate");
    if (!isEliteRank(freeze, 6)) return null;

    return {
      id: `${ctx.gamePk}-freeze-${ctx.trigger.atBatIndex}`,
      eyebrow: "3-2 chess match",
      title: "Paint corner incoming?",
      message: `${ctx.defenseAbbrev} rank ${rankLabel(freeze.rank)} in freeze rate (${freeze.displayValue} called strikes per pitch). ${ctx.pitcherName} has the blueprint.`,
      teamId: ctx.defenseTeamId,
      statId: "called-strike-rate",
    };
  },

  // —— At-bat results ——
  (ctx, away, home) => {
    if (ctx.trigger.type !== "at-bat-end" || ctx.trigger.event !== "Strikeout") return null;
    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const whiff = getTeamStat(offense, "swinging-strike-rate");
    if (!isEliteRank(whiff, 6)) return null;

    return {
      id: `${ctx.gamePk}-k-${ctx.trigger.atBatIndex}`,
      eyebrow: "Whiff watch",
      title: "Another swing and miss",
      message: `${ctx.offenseAbbrev} swing through ${whiff.displayValue} of pitches (${rankLabel(whiff.rank)} in MLB). The K column keeps growing.`,
      teamId: ctx.offenseTeamId,
      statId: "swinging-strike-rate",
    };
  },

  (ctx, away, home) => {
    if (
      ctx.trigger.type !== "at-bat-end" ||
      (ctx.trigger.event !== "Walk" && ctx.trigger.event !== "Intent Walk")
    ) {
      return null;
    }
    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const walks = getTeamStat(offense, "walks-per-game");
    if (!isEliteRank(walks, 6)) return null;

    return {
      id: `${ctx.gamePk}-bb-${ctx.trigger.atBatIndex}`,
      eyebrow: "Free pass",
      title: "Take your base",
      message: `${ctx.offenseAbbrev} draw ${walks.displayValue} walks per game (${rankLabel(walks.rank)} in MLB). Patience pays.`,
      teamId: ctx.offenseTeamId,
      statId: "walks-per-game",
    };
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "at-bat-end" || !ctx.trigger.event.includes("Double Play")) {
      return null;
    }
    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const gidp = getTeamStat(offense, "double-plays-hit-into");
    if (!isEliteRank(gidp, 6)) return null;

    return {
      id: `${ctx.gamePk}-gidp-${ctx.trigger.atBatIndex}`,
      eyebrow: "Rally killer",
      title: "Twin killing trauma",
      message: `${ctx.offenseAbbrev} hit into ${gidp.displayValue} double plays (${rankLabel(gidp.rank)} in MLB). Momentum, deleted.`,
      teamId: ctx.offenseTeamId,
      statId: "double-plays-hit-into",
    };
  },

  // —— Inning / game situation ——
  (ctx, away, home) => {
    if (ctx.trigger.type !== "inning-change" || !ctx.isLateInning || !ctx.isCloseGame) return null;
    const trailingId = ctx.trailingTeamId;
    if (trailingId == null) return null;
    const trailing = profileForTeam({ away, home }, trailingId);
    const walkoffs = getTeamStat(trailing, "walk-off-wins");
    if (!isEliteRank(walkoffs, 6)) return null;

    const abbrev = trailingId === ctx.awayTeamId ? ctx.awayAbbrev : ctx.homeAbbrev;
    return {
      id: `${ctx.gamePk}-walkoff-inn-${ctx.inning}`,
      eyebrow: "Late & close",
      title: "Walk-off weather",
      message: `${abbrev} have ${walkoffs.displayValue} walk-off wins (${rankLabel(walkoffs.rank)} in MLB). One swing could end it.`,
      teamId: trailingId,
      statId: "walk-off-wins",
    };
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "inning-change" || !ctx.isCloseGame) return null;
    const oneRun = getTeamStat(profileForTeam({ away, home }, ctx.awayTeamId), "one-run-games");
    const oneRunHome = getTeamStat(profileForTeam({ away, home }, ctx.homeTeamId), "one-run-games");
    const pick =
      oneRun && oneRunHome
        ? oneRun.rank <= oneRunHome.rank
          ? { teamId: ctx.awayTeamId, stat: oneRun, abbrev: ctx.awayAbbrev }
          : { teamId: ctx.homeTeamId, stat: oneRunHome, abbrev: ctx.homeAbbrev }
        : oneRun
          ? { teamId: ctx.awayTeamId, stat: oneRun, abbrev: ctx.awayAbbrev }
          : oneRunHome
            ? { teamId: ctx.homeTeamId, stat: oneRunHome, abbrev: ctx.homeAbbrev }
            : null;
    if (!pick || !isEliteRank(pick.stat, 5)) return null;

    return {
      id: `${ctx.gamePk}-one-run-inn-${ctx.inning}`,
      eyebrow: "Nailbiter nation",
      title: "One-run game alert",
      message: `${pick.abbrev} have played ${pick.stat.displayValue} one-run games (${rankLabel(pick.stat.rank)} in MLB). Buckle up.`,
      teamId: pick.teamId,
      statId: "one-run-games",
    };
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "inning-change" || !ctx.isExtraInnings) return null;
    const awayExtra = getTeamStat(profileForTeam({ away, home }, ctx.awayTeamId), "extra-inning-win-pct");
    const homeExtra = getTeamStat(profileForTeam({ away, home }, ctx.homeTeamId), "extra-inning-win-pct");
    const pick =
      awayExtra && homeExtra
        ? awayExtra.rank <= homeExtra.rank
          ? { teamId: ctx.awayTeamId, stat: awayExtra, abbrev: ctx.awayAbbrev }
          : { teamId: ctx.homeTeamId, stat: homeExtra, abbrev: ctx.homeAbbrev }
        : awayExtra
          ? { teamId: ctx.awayTeamId, stat: awayExtra, abbrev: ctx.awayAbbrev }
          : homeExtra
            ? { teamId: ctx.homeTeamId, stat: homeExtra, abbrev: ctx.homeAbbrev }
            : null;
    if (!pick || !isEliteRank(pick.stat, 6)) return null;

    return {
      id: `${ctx.gamePk}-extras-${ctx.inning}`,
      eyebrow: "Bonus baseball",
      title: "Free baseball favors someone",
      message: `${pick.abbrev} win ${pick.stat.displayValue} of extra-inning games (${rankLabel(pick.stat.rank)} in MLB).`,
      teamId: pick.teamId,
      statId: "extra-inning-win-pct",
    };
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "inning-change" || ctx.runMargin < 5) return null;
    const leader = ctx.leadingTeamId;
    if (leader == null) return null;
    const profile = profileForTeam({ away, home }, leader);
    const blowout = getTeamStat(profile, "blowout-wins");
    if (!isEliteRank(blowout, 6)) return null;

    const abbrev = leader === ctx.awayTeamId ? ctx.awayAbbrev : ctx.homeAbbrev;
    return {
      id: `${ctx.gamePk}-blowout-${ctx.inning}`,
      eyebrow: "Slugfest alert",
      title: "Running it up",
      message: `${abbrev} have ${blowout.displayValue} blowout wins (${rankLabel(blowout.rank)} in MLB). They don't do subtle.`,
      teamId: leader,
      statId: "blowout-wins",
    };
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "half-break" || ctx.inning < 7) return null;
    const defense = profileForTeam({ away, home }, ctx.defenseTeamId);
    const pace = getTeamStat(defense, "pitches-thrown-per-half");
    const live = livePaceForTeam(ctx, ctx.defenseTeamId);
    if (!isEliteRank(pace, 6) || live.thrownPerHalf == null) return null;
    if (live.thrownPerHalf < pace.value * 1.1) return null;

    return {
      id: `${ctx.gamePk}-staff-grind-${ctx.trigger.halfKey}`,
      eyebrow: "Bullpen meter",
      title: `${ctx.defenseAbbrev} staff is laboring`,
      message: `${live.thrownPerHalf.toFixed(1)} pitches per half thrown today. They rank ${rankLabel(pace.rank)} at ${pace.displayValue} — arms getting the full workout.`,
      teamId: ctx.defenseTeamId,
      statId: "pitches-thrown-per-half",
    };
  },
];

export function generateNerdInsight(
  ctx: LiveInsightContext,
  awayProfile: TeamNerdProfile | null,
  homeProfile: TeamNerdProfile | null,
): NerdInsightToast | null {
  for (const rule of rules) {
    const insight = rule(ctx, awayProfile, homeProfile);
    if (insight) return insight;
  }
  return null;
}
