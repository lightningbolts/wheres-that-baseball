import { buildEventInsightRules } from "@/lib/mlb/nerdInsights/buildEventInsightRules";
import { isEstablishedGameShape } from "@/lib/mlb/nerdInsights/situational";
import type {
  LiveInsightContext,
  NerdInsight,
  TeamNerdProfile,
} from "@/lib/mlb/nerdInsights/types";
import { anchorFromTrigger } from "@/lib/mlb/nerdInsights/types";
import {
  getTeamStat,
  isCursedInsightRank,
  isEliteRank,
  rankLabel,
} from "@/lib/mlb/nerdInsights/profile";

type Rule = (
  ctx: LiveInsightContext,
  away: TeamNerdProfile | null,
  home: TeamNerdProfile | null,
) => NerdInsight | null;

function fullInsight(
  ctx: LiveInsightContext,
  insight: Omit<NerdInsight, "variant" | "anchor">,
): NerdInsight {
  return {
    ...insight,
    variant: "full",
    anchor: anchorFromTrigger(ctx.trigger),
  };
}

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

function pitchesInHalf(ctx: LiveInsightContext, halfKey: string): number | null {
  const count = ctx.liveStats?.pitchesByHalf[halfKey];
  return count != null ? count : null;
}

function runsInHalf(ctx: LiveInsightContext, halfKey: string): number | null {
  const count = ctx.liveStats?.runsByHalf[halfKey];
  return count != null ? count : null;
}

function pickBetterRunsScoredTeam(
  ctx: LiveInsightContext,
  away: TeamNerdProfile | null,
  home: TeamNerdProfile | null,
): { teamId: number; stat: NonNullable<ReturnType<typeof getTeamStat>>; abbrev: string } | null {
  const awayStat = getTeamStat(away, "runs-scored");
  const homeStat = getTeamStat(home, "runs-scored");
  if (awayStat && homeStat) {
    return awayStat.rank <= homeStat.rank
      ? { teamId: ctx.awayTeamId, stat: awayStat, abbrev: ctx.awayAbbrev }
      : { teamId: ctx.homeTeamId, stat: homeStat, abbrev: ctx.homeAbbrev };
  }
  if (awayStat) return { teamId: ctx.awayTeamId, stat: awayStat, abbrev: ctx.awayAbbrev };
  if (homeStat) return { teamId: ctx.homeTeamId, stat: homeStat, abbrev: ctx.homeAbbrev };
  return null;
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

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-pace-${ctx.trigger.halfKey}`,
      eyebrow: "Nerd pace check",
      title: `${ctx.offenseAbbrev} is grinding`,
      message: `This half is moving slow — ${live.seenPerHalf.toFixed(1)} pitches per half so far. They rank ${rankLabel(pace.rank)} league-wide at ${pace.displayValue} per half.`,
      teamId: ctx.offenseTeamId,
      statId: "pitches-seen-per-half",
    });
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "half-break") return null;
    const halfPitches = pitchesInHalf(ctx, ctx.trigger.halfKey);
    if (halfPitches == null || halfPitches >= 10) return null;

    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const quick = getTeamStat(offense, "quick-half-innings-seen");
    if (!isEliteRank(quick, 6)) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-quick-half-${ctx.trigger.halfKey}`,
      eyebrow: "Blink and you missed it",
      title: `${ctx.offenseAbbrev} flew through that half`,
      message: `Just ${halfPitches} pitches in that half. They lead the league in quick halves (${quick.displayValue} under 10 pitches).`,
      teamId: ctx.offenseTeamId,
      statId: "quick-half-innings-seen",
    });
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "half-break") return null;
    const halfPitches = pitchesInHalf(ctx, ctx.trigger.halfKey);
    if (halfPitches == null || halfPitches <= 30) return null;

    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const marathon = getTeamStat(offense, "long-half-innings-seen");
    if (!isEliteRank(marathon, 6)) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-marathon-half-${ctx.trigger.halfKey}`,
      eyebrow: "Marathon half",
      title: `${ctx.offenseAbbrev} just wore out the mound`,
      message: `${halfPitches} pitches in that half alone. They rank ${rankLabel(marathon.rank)} in marathon halves (${marathon.displayValue} over 30 pitches).`,
      teamId: ctx.offenseTeamId,
      statId: "long-half-innings-seen",
    });
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "half-break") return null;
    const halfPitches = pitchesInHalf(ctx, ctx.trigger.halfKey);
    if (halfPitches == null || halfPitches <= 30) return null;

    const defense = profileForTeam({ away, home }, ctx.defenseTeamId);
    const marathon = getTeamStat(defense, "long-half-innings-thrown");
    if (!isEliteRank(marathon, 6)) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-marathon-thrown-${ctx.trigger.halfKey}`,
      eyebrow: "Bullpen meter",
      title: `${ctx.defenseAbbrev} arms are gassed`,
      message: `${halfPitches} pitches thrown in that half. They rank ${rankLabel(marathon.rank)} in marathon defensive halves (${marathon.displayValue} over 30 pitches).`,
      teamId: ctx.defenseTeamId,
      statId: "long-half-innings-thrown",
    });
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "half-break") return null;
    const halfPitches = pitchesInHalf(ctx, ctx.trigger.halfKey);
    if (halfPitches == null) return null;

    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const longest = getTeamStat(offense, "longest-half-inning-pitches");
    if (!isEliteRank(longest, 5) || longest.value > halfPitches) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-longest-half-${ctx.trigger.halfKey}`,
      eyebrow: "Season pace record",
      title: `${ctx.offenseAbbrev} just set the bar`,
      message: `${halfPitches} pitches in that half ties or beats their season high (${longest.displayValue}). Marathon merchants.`,
      teamId: ctx.offenseTeamId,
      statId: "longest-half-inning-pitches",
    });
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "half-break") return null;
    const fouls = ctx.liveStats?.foulBalls ?? 0;
    if (fouls < 6) return null;

    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const foulStat = getTeamStat(offense, "foul-ball-factory");
    if (!isEliteRank(foulStat, 8)) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-fouls-${ctx.trigger.halfKey}`,
      eyebrow: "Foul ball factory",
      title: "Beer hawk weather",
      message: `${fouls} fouls already in this game. ${ctx.offenseAbbrev} are ${rankLabel(foulStat.rank)} in the league's foul-ball factory (${foulStat.displayValue} on the year).`,
      teamId: ctx.offenseTeamId,
      statId: "foul-ball-factory",
    });
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "half-break") return null;
    const halfRuns = runsInHalf(ctx, ctx.trigger.halfKey);
    if (halfRuns == null || halfRuns < 3) return null;

    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const runsScored = getTeamStat(offense, "runs-scored");
    const runsPerGame = getTeamStat(offense, "runs-per-game");
    const stat =
      runsScored && isEliteRank(runsScored, 6)
        ? { entry: runsScored, statId: "runs-scored" as const, label: "runs scored" }
        : runsPerGame && isEliteRank(runsPerGame, 6)
          ? { entry: runsPerGame, statId: "runs-per-game" as const, label: "runs per game" }
          : null;
    if (!stat) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-runs-half-${ctx.trigger.halfKey}`,
      eyebrow: "Traditional stat check",
      title: `${ctx.offenseAbbrev} hung a crooked number`,
      message: `${halfRuns} runs in that half. They rank ${rankLabel(stat.entry.rank)} in ${stat.label} (${stat.entry.displayValue}).`,
      teamId: ctx.offenseTeamId,
      statId: stat.statId,
    });
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "half-break") return null;
    const halfRuns = runsInHalf(ctx, ctx.trigger.halfKey);
    if (halfRuns == null || halfRuns < 4) return null;

    const defense = profileForTeam({ away, home }, ctx.defenseTeamId);
    const runsAllowed = getTeamStat(defense, "runs-allowed");
    if (!isEliteRank(runsAllowed, 6)) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-allowed-half-${ctx.trigger.halfKey}`,
      eyebrow: "Uncharacteristic leak",
      title: `${ctx.defenseAbbrev} just got tagged`,
      message: `${halfRuns} runs allowed in that half. They rank ${rankLabel(runsAllowed.rank)} in runs allowed (${runsAllowed.displayValue} on the year) — stingier than this.`,
      teamId: ctx.defenseTeamId,
      statId: "runs-allowed",
    });
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "half-break") return null;
    const halfRuns = runsInHalf(ctx, ctx.trigger.halfKey);
    if (halfRuns == null || halfRuns < 3) return null;

    const defense = profileForTeam({ away, home }, ctx.defenseTeamId);
    const runsAllowed = getTeamStat(defense, "runs-allowed");
    if (!runsAllowed || !isCursedInsightRank(runsAllowed, 8)) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-leaky-half-${ctx.trigger.halfKey}`,
      eyebrow: "Runs allowed watch",
      title: `${ctx.defenseAbbrev} spring another leak`,
      message: `${halfRuns} runs allowed in that half. They rank ${rankLabel(runsAllowed.rank)} in runs allowed (${runsAllowed.displayValue}) — business as usual.`,
      teamId: ctx.defenseTeamId,
      statId: "runs-allowed",
    });
  },

  // —— At-bat start ——
  (ctx, away, home) => {
    if (ctx.trigger.type !== "at-bat-start" || !ctx.runnersInScoringPosition) return null;
    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const risp = getTeamStat(offense, "risp-batting");
    if (!isEliteRank(risp, 8)) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-risp-${ctx.trigger.atBatIndex}`,
      eyebrow: "Scoring position",
      title: `${ctx.batterName} with runners on`,
      message: `${ctx.offenseAbbrev} rank ${rankLabel(risp.rank)} in RISP hitting (${risp.displayValue}).`,
      teamId: ctx.offenseTeamId,
      statId: "risp-batting",
    });
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "at-bat-start" || !ctx.twoOuts || !ctx.runnersInScoringPosition) {
      return null;
    }
    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const twoOut = getTeamStat(offense, "runs-with-two-outs-pct");
    if (!isEliteRank(twoOut, 6)) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-two-out-${ctx.trigger.atBatIndex}`,
      eyebrow: "Two-out drama",
      title: "Clutch or bust",
      message: `${ctx.offenseAbbrev} score ${twoOut.displayValue} of their runs with two outs (${rankLabel(twoOut.rank)} in MLB).`,
      teamId: ctx.offenseTeamId,
      statId: "runs-with-two-outs-pct",
    });
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "at-bat-start" || !ctx.basesLoaded) return null;
    const defense = profileForTeam({ away, home }, ctx.defenseTeamId);
    const stranded = getTeamStat(defense, "bases-loaded-no-runs");
    if (!isEliteRank(stranded, 5)) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-loaded-${ctx.trigger.atBatIndex}`,
      eyebrow: "Bases juiced",
      title: "Strand patrol activated",
      message: `${ctx.defenseAbbrev} specialize in bases-loaded heartbreak — ${rankLabel(stranded.rank)} in leaving 'em loaded (${stranded.displayValue} times).`,
      teamId: ctx.defenseTeamId,
      statId: "bases-loaded-no-runs",
    });
  },

  // —— Pitch milestones ——
  (ctx, away, home) => {
    if (ctx.trigger.type !== "pitch-thrown" || ctx.trigger.pitchNumber < 6) return null;
    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const perPa = getTeamStat(offense, "pitches-per-pa");
    if (!isEliteRank(perPa, 6)) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-deep-${ctx.trigger.atBatIndex}-${ctx.trigger.pitchNumber}`,
      eyebrow: "Marathon at-bat",
      title: `Pitch ${ctx.trigger.pitchNumber} and counting`,
      message: `${ctx.offenseAbbrev} see ${perPa.displayValue} pitches per plate appearance (${rankLabel(perPa.rank)} in MLB). ${ctx.batterName} is making them work.`,
      teamId: ctx.offenseTeamId,
      statId: "pitches-per-pa",
    });
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "pitch-thrown" || ctx.foulsThisAb < 3) return null;
    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const foulRate = getTeamStat(offense, "foul-rate");
    if (!isEliteRank(foulRate, 6)) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-foul-ab-${ctx.trigger.atBatIndex}`,
      eyebrow: "Foul fest",
      title: "Net behind the plate working overtime",
      message: `${ctx.foulsThisAb} fouls this at-bat. ${ctx.offenseAbbrev} foul off ${foulRate.displayValue} of pitches — ${rankLabel(foulRate.rank)} in the league.`,
      teamId: ctx.offenseTeamId,
      statId: "foul-rate",
    });
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "pitch-thrown" || ctx.balls !== 3 || ctx.strikes !== 2) return null;
    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const ballHawk = getTeamStat(offense, "ball-rate");
    if (!isEliteRank(ballHawk, 6)) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-fullcount-${ctx.trigger.atBatIndex}`,
      eyebrow: "3-2 chess match",
      title: "Full count standoff",
      message: `${ctx.offenseAbbrev} take balls at a ${ballHawk.displayValue} clip (${rankLabel(ballHawk.rank)} in MLB). Eye discipline meets arm fatigue.`,
      teamId: ctx.offenseTeamId,
      statId: "ball-rate",
    });
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "pitch-thrown" || ctx.balls !== 3 || ctx.strikes !== 2) return null;
    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const ops = getTeamStat(offense, "full-count-ops");
    if (!isEliteRank(ops, 6)) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-fcops-${ctx.trigger.atBatIndex}`,
      eyebrow: "3-2 chess match",
      title: "Full count merchants",
      message: `${ctx.offenseAbbrev} post a ${ops.displayValue} OPS in full-count PAs (${rankLabel(ops.rank)} in MLB). Every pitch matters now.`,
      teamId: ctx.offenseTeamId,
      statId: "full-count-ops",
    });
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "pitch-thrown" || ctx.balls !== 3 || ctx.strikes !== 2) return null;
    const defense = profileForTeam({ away, home }, ctx.defenseTeamId);
    const freeze = getTeamStat(defense, "called-strike-rate");
    if (!isEliteRank(freeze, 6)) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-freeze-${ctx.trigger.atBatIndex}`,
      eyebrow: "3-2 chess match",
      title: "Paint corner incoming?",
      message: `${ctx.defenseAbbrev} rank ${rankLabel(freeze.rank)} in freeze rate (${freeze.displayValue} called strikes per pitch). ${ctx.pitcherName} has the blueprint.`,
      teamId: ctx.defenseTeamId,
      statId: "called-strike-rate",
    });
  },

  // —— At-bat results ——
  (ctx, away, home) => {
    if (
      ctx.trigger.type !== "at-bat-end" ||
      ctx.trigger.event !== "Strikeout" ||
      ctx.strikeoutKind !== "swinging"
    ) {
      return null;
    }
    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const whiff = getTeamStat(offense, "swinging-strike-rate");
    if (!isEliteRank(whiff, 6)) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-k-${ctx.trigger.atBatIndex}`,
      eyebrow: "Whiff watch",
      title: "Another swing and miss",
      message: `${ctx.offenseAbbrev} swing through ${whiff.displayValue} of pitches (${rankLabel(whiff.rank)} in MLB). The K column keeps growing.`,
      teamId: ctx.offenseTeamId,
      statId: "swinging-strike-rate",
    });
  },

  (ctx, away, home) => {
    if (
      ctx.trigger.type !== "at-bat-end" ||
      ctx.trigger.event !== "Strikeout" ||
      ctx.strikeoutKind !== "called"
    ) {
      return null;
    }
    const defense = profileForTeam({ away, home }, ctx.defenseTeamId);
    const freeze = getTeamStat(defense, "called-strike-rate");
    if (!isEliteRank(freeze, 6)) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-freeze-k-${ctx.trigger.atBatIndex}`,
      eyebrow: "Freeze frame",
      title: "Caught looking",
      message: `${ctx.defenseAbbrev} rank ${rankLabel(freeze.rank)} in freeze rate (${freeze.displayValue} called strikes per pitch). ${ctx.pitcherName} painted it.`,
      teamId: ctx.defenseTeamId,
      statId: "called-strike-rate",
    });
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

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-bb-${ctx.trigger.atBatIndex}`,
      eyebrow: "Free pass",
      title: "Take your base",
      message: `${ctx.offenseAbbrev} draw ${walks.displayValue} walks per game (${rankLabel(walks.rank)} in MLB). Patience pays.`,
      teamId: ctx.offenseTeamId,
      statId: "walks-per-game",
    });
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "at-bat-end" || !ctx.trigger.event.includes("Double Play")) {
      return null;
    }
    const offense = profileForTeam({ away, home }, ctx.offenseTeamId);
    const gidp = getTeamStat(offense, "double-plays-hit-into");
    if (!isEliteRank(gidp, 6)) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-gidp-${ctx.trigger.atBatIndex}`,
      eyebrow: "Rally killer",
      title: "Twin killing trauma",
      message: `${ctx.offenseAbbrev} hit into ${gidp.displayValue} double plays (${rankLabel(gidp.rank)} in MLB). Momentum, deleted.`,
      teamId: ctx.offenseTeamId,
      statId: "double-plays-hit-into",
    });
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
    return fullInsight(ctx, {
      id: `${ctx.gamePk}-walkoff-inn-${ctx.inning}`,
      eyebrow: "Late & close",
      title: "Walk-off weather",
      message: `${abbrev} have ${walkoffs.displayValue} walk-off wins (${rankLabel(walkoffs.rank)} in MLB). One swing could end it.`,
      teamId: trailingId,
      statId: "walk-off-wins",
    });
  },

  (ctx, away, home) => {
    if (
      ctx.trigger.type !== "inning-change" ||
      !ctx.isOneRunGame ||
      !isEstablishedGameShape(ctx)
    ) {
      return null;
    }
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

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-one-run-inn-${ctx.inning}`,
      eyebrow: "Nailbiter nation",
      title: "One-run game alert",
      message: `${pick.abbrev} have played ${pick.stat.displayValue} one-run games (${rankLabel(pick.stat.rank)} in MLB). Buckle up.`,
      teamId: pick.teamId,
      statId: "one-run-games",
    });
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

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-extras-${ctx.inning}`,
      eyebrow: "Bonus baseball",
      title: "Free baseball favors someone",
      message: `${pick.abbrev} win at a ${pick.stat.displayValue} clip in extras (${rankLabel(pick.stat.rank)} in MLB).`,
      teamId: pick.teamId,
      statId: "extra-inning-win-pct",
    });
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "inning-change" || ctx.runMargin < 5 || !isEstablishedGameShape(ctx)) {
      return null;
    }
    const leader = ctx.leadingTeamId;
    if (leader == null) return null;
    const profile = profileForTeam({ away, home }, leader);
    const blowout = getTeamStat(profile, "blowout-wins");
    if (!isEliteRank(blowout, 6)) return null;

    const abbrev = leader === ctx.awayTeamId ? ctx.awayAbbrev : ctx.homeAbbrev;
    return fullInsight(ctx, {
      id: `${ctx.gamePk}-blowout-${ctx.inning}`,
      eyebrow: "Slugfest alert",
      title: "Running it up",
      message: `${abbrev} have ${blowout.displayValue} blowout wins (${rankLabel(blowout.rank)} in MLB). They don't do subtle.`,
      teamId: leader,
      statId: "blowout-wins",
    });
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "inning-change") return null;
    const totalRuns = ctx.awayRuns + ctx.homeRuns;
    if (totalRuns < 10) return null;

    const pick = pickBetterRunsScoredTeam(ctx, away, home);
    if (!pick || !isEliteRank(pick.stat, 6)) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-slugfest-${ctx.inning}`,
      eyebrow: "Traditional stat check",
      title: "Runs are flying",
      message: `${totalRuns} combined runs already. ${pick.abbrev} rank ${rankLabel(pick.stat.rank)} in runs scored (${pick.stat.displayValue}).`,
      teamId: pick.teamId,
      statId: "runs-scored",
    });
  },

  (ctx, away, home) => {
    if (
      ctx.trigger.type !== "inning-change" ||
      ctx.runMargin < 4 ||
      !isEstablishedGameShape(ctx)
    ) {
      return null;
    }
    const leader = ctx.leadingTeamId;
    if (leader == null) return null;
    const profile = profileForTeam({ away, home }, leader);
    const differential = getTeamStat(profile, "run-differential");
    if (!isEliteRank(differential, 6)) return null;

    const abbrev = leader === ctx.awayTeamId ? ctx.awayAbbrev : ctx.homeAbbrev;
    const leaderRuns = leader === ctx.awayTeamId ? ctx.awayRuns : ctx.homeRuns;
    const trailerRuns = leader === ctx.awayTeamId ? ctx.homeRuns : ctx.awayRuns;
    return fullInsight(ctx, {
      id: `${ctx.gamePk}-run-diff-${ctx.inning}`,
      eyebrow: "Run differential",
      title: `${abbrev} padding the plus column`,
      message: `Up ${leaderRuns}-${trailerRuns}. They rank ${rankLabel(differential.rank)} in run differential (${differential.displayValue}).`,
      teamId: leader,
      statId: "run-differential",
    });
  },

  (ctx, away, home) => {
    if (ctx.trigger.type !== "half-break" || ctx.inning < 7) return null;
    const defense = profileForTeam({ away, home }, ctx.defenseTeamId);
    const pace = getTeamStat(defense, "pitches-thrown-per-half");
    const live = livePaceForTeam(ctx, ctx.defenseTeamId);
    if (!isEliteRank(pace, 6) || live.thrownPerHalf == null) return null;
    if (live.thrownPerHalf < pace.value * 1.1) return null;

    return fullInsight(ctx, {
      id: `${ctx.gamePk}-staff-grind-${ctx.trigger.halfKey}`,
      eyebrow: "Bullpen meter",
      title: `${ctx.defenseAbbrev} staff is laboring`,
      message: `${live.thrownPerHalf.toFixed(1)} pitches per half thrown today. They rank ${rankLabel(pace.rank)} at ${pace.displayValue} — arms getting the full workout.`,
      teamId: ctx.defenseTeamId,
      statId: "pitches-thrown-per-half",
    });
  },
  ...buildEventInsightRules(),
];

export function generateNerdInsight(
  ctx: LiveInsightContext,
  awayProfile: TeamNerdProfile | null,
  homeProfile: TeamNerdProfile | null,
): NerdInsight | null {
  for (const rule of rules) {
    const insight = rule(ctx, awayProfile, homeProfile);
    if (insight) return insight;
  }
  return null;
}

const MINI_LABELS: Record<string, (abbrev: string, count: number, display: string, rank: number) => string> = {
  "walks-per-game": (abbrev, count, display, rank) =>
    `Walk #${count} — ${abbrev} still ${rankLabel(rank)} in patience (${display}/G).`,
  "swinging-strike-rate": (abbrev, count, display, rank) =>
    `K #${count} — ${abbrev} ${display} whiff rate (${rankLabel(rank)} in MLB).`,
  "risp-batting": (abbrev, count, display, rank) =>
    `RISP AB #${count} — ${abbrev} ${display} with runners on (${rankLabel(rank)}).`,
  "double-plays-hit-into": (abbrev, count, display, rank) =>
    `GDP #${count} — ${abbrev} ${display} twin killings (${rankLabel(rank)}).`,
  "foul-rate": (abbrev, count, display, rank) =>
    `Foul fest again — ${abbrev} ${display} foul rate (${rankLabel(rank)}).`,
  "pitches-per-pa": (abbrev, _count, display, rank) =>
    `Deep AB — ${abbrev} see ${display} per PA (${rankLabel(rank)}).`,
  "ball-rate": (abbrev, _count, display, rank) =>
    `3-2 again — ${abbrev} ${display} ball rate (${rankLabel(rank)}).`,
  "full-count-ops": (abbrev, _count, display, rank) =>
    `3-2 again — ${abbrev} ${display} full-count OPS (${rankLabel(rank)}).`,
  "called-strike-rate": (abbrev, _count, display, rank) =>
    `3-2 freeze — ${abbrev} ${display} called-strike rate (${rankLabel(rank)}).`,
  "runs-with-two-outs-pct": (abbrev, count, display, rank) =>
    `Two-out spot #${count} — ${abbrev} score ${display} of runs with two outs (${rankLabel(rank)}).`,
  "bases-loaded-no-runs": (abbrev, count, _display, rank) =>
    `Bases loaded #${count} — ${abbrev} strand patrol (${rankLabel(rank)}).`,
  "quick-half-innings-seen": (abbrev, count, display, rank) =>
    `Quick half #${count} — ${abbrev} ${display} sub-10-pitch halves (${rankLabel(rank)}).`,
  "long-half-innings-seen": (abbrev, count, display, rank) =>
    `Marathon half #${count} — ${abbrev} ${display} 30+ pitch halves (${rankLabel(rank)}).`,
  "long-half-innings-thrown": (abbrev, count, display, rank) =>
    `Marathon half #${count} — ${abbrev} ${display} 30+ pitch halves thrown (${rankLabel(rank)}).`,
  "pitches-per-run": (abbrev, _count, display, rank) =>
    `Run scored — ${abbrev} need ${display} pitches per run (${rankLabel(rank)}).`,
  "pitches-per-hit": (abbrev, _count, display, rank) =>
    `Hit — ${abbrev} see ${display} pitches per hit (${rankLabel(rank)}).`,
  "runs-scored": (abbrev, count, display, rank) =>
    `Big half #${count} — ${abbrev} rank ${rankLabel(rank)} in runs scored (${display}).`,
  "runs-allowed": (abbrev, count, display, rank) =>
    `Leak #${count} — ${abbrev} ${display} runs allowed (${rankLabel(rank)}).`,
  "runs-per-game": (abbrev, count, display, rank) =>
    `Big half #${count} — ${abbrev} ${display} runs per game (${rankLabel(rank)}).`,
  "run-differential": (abbrev, count, display, rank) =>
    `Run margin #${count} — ${abbrev} ${display} run differential (${rankLabel(rank)}).`,
};

export function buildMiniInsight(
  full: NerdInsight,
  ctx: LiveInsightContext,
  awayProfile: TeamNerdProfile | null,
  homeProfile: TeamNerdProfile | null,
  occurrenceCount: number,
): NerdInsight {
  const teamId = full.teamId;
  const profile =
    teamId === awayProfile?.teamId
      ? awayProfile
      : teamId === homeProfile?.teamId
        ? homeProfile
        : null;
  const abbrev =
    teamId === ctx.awayTeamId
      ? ctx.awayAbbrev
      : teamId === ctx.homeTeamId
        ? ctx.homeAbbrev
        : profile?.abbrev ?? "Team";
  const stat = full.statId ? getTeamStat(profile, full.statId) : undefined;

  const message =
    full.statId && stat && MINI_LABELS[full.statId]
      ? MINI_LABELS[full.statId](abbrev, occurrenceCount, stat.displayValue, stat.rank)
      : full.statId && stat
        ? `${stat.title} — ${abbrev} (${occurrenceCount}× this game, ${rankLabel(stat.rank)}, ${stat.displayValue}).`
        : `${full.title} — ${abbrev} (${occurrenceCount}× this game).`;

  return {
    ...full,
    id: `${full.id}-mini-${occurrenceCount}`,
    variant: "mini",
    title: full.eyebrow,
    message,
    anchor: anchorFromTrigger(ctx.trigger),
  };
}
