import type { EventInsightSpec } from "@/lib/mlb/nerdInsights/eventInsightSpecs";

function contactMessage(
  _ctx: Parameters<EventInsightSpec["message"]>[0],
  abbrev: string,
  statTitle: string,
  displayValue: string,
  rank: number,
  detail: string,
): string {
  return `${detail} ${abbrev} rank #${rank} in ${statTitle.toLowerCase()} (${displayValue}).`;
}

/** Batted-ball insights — require Statcast fields on the completed play. */
export const CONTACT_INSIGHT_SPECS: EventInsightSpec[] = [
  {
    statId: "barrel-rate",
    team: "offense",
    polarity: "elite",
    triggerTypes: ["at-bat-end"],
    match: (ctx) => ctx.contact?.isBarrel === true,
    eyebrow: "Barrel watch",
    title: (ctx) => `${ctx.batterName} barreled up`,
    message: (ctx, abbrev, title, display, rank) =>
      contactMessage(
        ctx,
        abbrev,
        title,
        display,
        rank,
        `${ctx.contact!.exitVelo.toFixed(1)} mph · ${ctx.contact!.launchAngle.toFixed(0)}°.`,
      ),
  },
  {
    statId: "chop-rate",
    team: "offense",
    polarity: "cursed",
    triggerTypes: ["at-bat-end"],
    match: (ctx) => ctx.contact?.isChop === true,
    eyebrow: "Chop merchant",
    title: () => "Chopper into the dirt",
    message: (ctx, abbrev, title, display, rank) =>
      contactMessage(
        ctx,
        abbrev,
        title,
        display,
        rank,
        `${ctx.contact!.launchAngle.toFixed(0)}° launch.`,
      ),
  },
  {
    statId: "popup-rate",
    team: "offense",
    polarity: "cursed",
    triggerTypes: ["at-bat-end"],
    match: (ctx) => ctx.contact?.isPopup === true,
    eyebrow: "Popup factory",
    title: () => "Sky-high popup",
    message: (ctx, abbrev, title, display, rank) =>
      contactMessage(
        ctx,
        abbrev,
        title,
        display,
        rank,
        `${ctx.contact!.launchAngle.toFixed(0)}° launch.`,
      ),
  },
  {
    statId: "avg-exit-velo",
    team: "offense",
    polarity: "elite",
    triggerTypes: ["at-bat-end"],
    match: (ctx) => (ctx.contact?.exitVelo ?? 0) >= 100,
    eyebrow: "Exit velo",
    title: (ctx) => `${ctx.contact!.exitVelo.toFixed(1)} mph off the bat`,
    message: (ctx, abbrev, title, display, rank) =>
      contactMessage(ctx, abbrev, title, display, rank, "Ripped."),
  },
  {
    statId: "avg-launch-angle",
    team: "offense",
    polarity: "either",
    triggerTypes: ["at-bat-end"],
    match: (ctx) => {
      const la = ctx.contact?.launchAngle;
      return la != null && la >= 10 && la <= 35;
    },
    eyebrow: "Launch angle",
    title: (ctx) => `${ctx.contact!.launchAngle.toFixed(0)}° launch`,
    message: (ctx, abbrev, title, display, rank) =>
      contactMessage(ctx, abbrev, title, display, rank, "Optimal window."),
  },
  {
    statId: "avg-bat-speed",
    team: "offense",
    polarity: "elite",
    triggerTypes: ["at-bat-end"],
    match: (ctx) => (ctx.contact?.batSpeed ?? 0) >= 72,
    eyebrow: "Bat speed",
    title: (ctx) => `${ctx.contact!.batSpeed!.toFixed(1)} mph bat speed`,
    message: (ctx, abbrev, title, display, rank) =>
      contactMessage(ctx, abbrev, title, display, rank, "Turned it over."),
  },
  {
    statId: "hardest-hit",
    team: "offense",
    polarity: "elite",
    triggerTypes: ["at-bat-end"],
    match: (ctx) => (ctx.contact?.exitVelo ?? 0) >= 105,
    eyebrow: "Hardest hit",
    title: (ctx) => `${ctx.contact!.exitVelo.toFixed(1)} mph rocket`,
    message: (ctx, abbrev, title, display, rank) =>
      contactMessage(ctx, abbrev, title, display, rank, "Tank shot."),
  },
  {
    statId: "hardest-hit-allowed",
    team: "defense",
    polarity: "cursed",
    triggerTypes: ["at-bat-end"],
    match: (ctx) => (ctx.contact?.exitVelo ?? 0) >= 105,
    eyebrow: "Barreled up against",
    title: (ctx, abbrev) => `${abbrev} got stung`,
    message: (ctx, abbrev, title, display, rank) =>
      contactMessage(
        ctx,
        abbrev,
        title,
        display,
        rank,
        `${ctx.contact!.exitVelo.toFixed(1)} mph against them.`,
      ),
  },
  {
    statId: "no-doubter-hr-rate",
    team: "offense",
    polarity: "elite",
    triggerTypes: ["at-bat-end"],
    match: (ctx) => ctx.contact?.isNoDoubterHr === true,
    eyebrow: "No doubter",
    title: () => "That one had help",
    message: (ctx, abbrev, title, display, rank) =>
      contactMessage(
        ctx,
        abbrev,
        title,
        display,
        rank,
        `${ctx.contact!.exitVelo.toFixed(1)} mph · ${ctx.contact!.launchAngle.toFixed(0)}°.`,
      ),
  },
  {
    statId: "moonshot-hrs",
    team: "offense",
    polarity: "elite",
    triggerTypes: ["at-bat-end"],
    match: (ctx) => ctx.contact?.isMoonshot === true,
    eyebrow: "Moonshot",
    title: () => "Moonshot homer",
    message: (ctx, abbrev, title, display, rank) =>
      contactMessage(
        ctx,
        abbrev,
        title,
        display,
        rank,
        `${ctx.contact!.launchAngle.toFixed(0)}° · ${ctx.contact!.exitVelo.toFixed(1)} mph.`,
      ),
  },
  {
    statId: "wall-scraper-hrs",
    team: "offense",
    polarity: "either",
    triggerTypes: ["at-bat-end"],
    match: (ctx) => ctx.contact?.isWallScraper === true,
    eyebrow: "Wall scraper",
    title: () => "Just enough",
    message: (ctx, abbrev, title, display, rank) =>
      contactMessage(
        ctx,
        abbrev,
        title,
        display,
        rank,
        `${Math.round(ctx.contact!.distance)} ft.`,
      ),
  },
  {
    statId: "softest-home-run",
    team: "offense",
    polarity: "either",
    triggerTypes: ["at-bat-end"],
    eventEquals: ["Home Run"],
    match: (ctx) =>
      ctx.contact != null && ctx.contact.exitVelo > 0 && ctx.contact.exitVelo < 100,
    eyebrow: "Soft homer",
    title: () => "Barely got out",
    message: (ctx, abbrev, title, display, rank) =>
      contactMessage(
        ctx,
        abbrev,
        title,
        display,
        rank,
        `${ctx.contact!.exitVelo.toFixed(1)} mph.`,
      ),
  },
  {
    statId: "shortest-home-run",
    team: "offense",
    polarity: "either",
    triggerTypes: ["at-bat-end"],
    eventEquals: ["Home Run"],
    match: (ctx) =>
      ctx.contact != null &&
      ctx.contact.distance > 0 &&
      ctx.contact.distance < 350,
    eyebrow: "Short homer",
    title: () => "Short porch special",
    message: (ctx, abbrev, title, display, rank) =>
      contactMessage(
        ctx,
        abbrev,
        title,
        display,
        rank,
        `${Math.round(ctx.contact!.distance)} ft.`,
      ),
  },
  {
    statId: "flarest-home-run",
    team: "offense",
    polarity: "either",
    triggerTypes: ["at-bat-end"],
    eventEquals: ["Home Run"],
    match: (ctx) => (ctx.contact?.launchAngle ?? 0) >= 40,
    eyebrow: "Flare homer",
    title: () => "High flare homer",
    message: (ctx, abbrev, title, display, rank) =>
      contactMessage(
        ctx,
        abbrev,
        title,
        display,
        rank,
        `${ctx.contact!.launchAngle.toFixed(0)}° launch.`,
      ),
  },
  {
    statId: "longest-half-inning-pitches-thrown",
    team: "defense",
    polarity: "elite",
    triggerTypes: ["half-break"],
    match: (ctx) => {
      if (ctx.trigger.type !== "half-break") return false;
      const pitches = ctx.liveStats?.pitchesByHalf[ctx.trigger.halfKey];
      return pitches != null && pitches > 30;
    },
    eyebrow: "Marathon half",
    title: (ctx, abbrev) => `${abbrev} threw a marathon half`,
    message: (ctx, abbrev, title, display, rank) => {
      const pitches =
        ctx.trigger.type === "half-break"
          ? ctx.liveStats?.pitchesByHalf[ctx.trigger.halfKey]
          : null;
      return `${pitches ?? "?"} pitches thrown in that half. ${abbrev} rank #${rank} in ${title.toLowerCase()} (${display}).`;
    },
  },
];
