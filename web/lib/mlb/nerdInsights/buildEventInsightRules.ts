import {
  EVENT_INSIGHT_SPECS,
  HAND_CRAFTED_INSIGHT_STAT_IDS,
  type EventInsightSpec,
} from "@/lib/mlb/nerdInsights/eventInsightSpecs";
import { CONTACT_INSIGHT_SPECS } from "@/lib/mlb/nerdInsights/contactInsightSpecs";
import {
  getTeamStat,
  isCursedInsightRank,
  isEliteRank,
  isNotableInsightRank,
  rankLabel,
} from "@/lib/mlb/nerdInsights/profile";
import type {
  LiveInsightContext,
  NerdInsight,
  TeamNerdProfile,
} from "@/lib/mlb/nerdInsights/types";
import { anchorFromTrigger } from "@/lib/mlb/nerdInsights/types";

type Rule = (
  ctx: LiveInsightContext,
  away: TeamNerdProfile | null,
  home: TeamNerdProfile | null,
) => NerdInsight | null;

function profileForTeam(
  profiles: { away: TeamNerdProfile | null; home: TeamNerdProfile | null },
  teamId: number,
): TeamNerdProfile | null {
  if (profiles.away?.teamId === teamId) return profiles.away;
  if (profiles.home?.teamId === teamId) return profiles.home;
  return null;
}

function matchesEvent(ctx: LiveInsightContext, spec: EventInsightSpec): boolean {
  if (!spec.triggerTypes.includes(ctx.trigger.type)) return false;
  if (spec.match && !spec.match(ctx)) return false;

  if (ctx.trigger.type === "at-bat-end") {
    const event = ctx.trigger.event;
    if (spec.eventEquals && !spec.eventEquals.includes(event)) return false;
    if (
      spec.eventIncludes &&
      !spec.eventIncludes.some((fragment) => event.includes(fragment))
    ) {
      return false;
    }
  }

  return true;
}

function passesRankGate(
  spec: EventInsightSpec,
  stat: NonNullable<ReturnType<typeof getTeamStat>>,
): boolean {
  const eliteMax = spec.eliteMaxRank ?? 8;
  const cursedBottom = spec.cursedBottomN ?? 8;

  switch (spec.polarity) {
    case "elite":
      return isEliteRank(stat, eliteMax);
    case "cursed":
      return isCursedInsightRank(stat, cursedBottom);
    case "either":
      return isNotableInsightRank(stat, eliteMax, cursedBottom);
  }
}

function buildRuleFromSpec(spec: EventInsightSpec): Rule {
  return (ctx, away, home) => {
    if (HAND_CRAFTED_INSIGHT_STAT_IDS.has(spec.statId)) return null;
    if (!matchesEvent(ctx, spec)) return null;

    const teamId = spec.team === "offense" ? ctx.offenseTeamId : ctx.defenseTeamId;
    const abbrev = spec.team === "offense" ? ctx.offenseAbbrev : ctx.defenseAbbrev;
    const profile = profileForTeam({ away, home }, teamId);
    const stat = getTeamStat(profile, spec.statId);
    if (!stat || !passesRankGate(spec, stat)) return null;

    const triggerKey =
      ctx.trigger.type === "half-break"
        ? ctx.trigger.halfKey
        : ctx.trigger.type === "at-bat-end" || ctx.trigger.type === "at-bat-start"
          ? String(ctx.trigger.atBatIndex)
          : ctx.trigger.type === "pitch-thrown"
            ? `${ctx.trigger.atBatIndex}-${ctx.trigger.pitchNumber}`
            : ctx.trigger.type === "inning-change"
              ? String(ctx.trigger.inning)
              : "live";

    return {
      id: `${ctx.gamePk}-event-${spec.statId}-${teamId}-${triggerKey}`,
      variant: "full",
      eyebrow: spec.eyebrow,
      title: spec.title(ctx, abbrev),
      message: spec.message(ctx, abbrev, stat.title, stat.displayValue, stat.rank),
      teamId,
      statId: spec.statId,
      anchor: anchorFromTrigger(ctx.trigger),
    };
  };
}

export function buildEventInsightRules(): Rule[] {
  return [...EVENT_INSIGHT_SPECS, ...CONTACT_INSIGHT_SPECS].map(buildRuleFromSpec);
}
