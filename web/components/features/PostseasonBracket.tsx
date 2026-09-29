"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { TeamLogo } from "@/components/ui/TeamLogo";
import {
  decodePostseasonPicks,
  encodePostseasonPicks,
  resolveSeriesTeams,
  sanitizePostseasonPicks,
  type PostseasonBracket as Bracket,
  type PostseasonLeague,
  type PostseasonPicks,
  type PostseasonRound,
  type PostseasonSeries,
  type PostseasonTeam,
} from "@/lib/mlb/postseason";
import { mlbTeamLogoUrl } from "@/lib/mlb/teamAssets";
import { cn } from "@/lib/utils";

interface PostseasonBracketProps {
  bracket: Bracket;
  initialPicks: PostseasonPicks;
}

type BracketJpegLayout = "landscape" | "portrait";

interface BracketEmbeddedFonts {
  sansRegular: string;
  sansSemibold: string;
  serif: string;
  mono: string;
}

const BRACKET_FONT_FAMILIES = {
  sans: "WTBB Sans",
  serif: "WTBB Serif",
  mono: "WTBB Mono",
} as const;

function xml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]!);
}

function embeddedFontStyles(fonts: BracketEmbeddedFonts): string {
  return `<style>@font-face{font-family:'${BRACKET_FONT_FAMILIES.sans}';src:url('${fonts.sansRegular}') format('woff2');font-weight:400;font-style:normal}@font-face{font-family:'${BRACKET_FONT_FAMILIES.sans}';src:url('${fonts.sansSemibold}') format('woff2');font-weight:600;font-style:normal}@font-face{font-family:'${BRACKET_FONT_FAMILIES.serif}';src:url('${fonts.serif}') format('woff2');font-weight:600;font-style:normal}@font-face{font-family:'${BRACKET_FONT_FAMILIES.mono}';src:url('${fonts.mono}') format('woff2');font-weight:100 800;font-style:normal}</style>`;
}

export function portraitBracketSvg(
  bracket: Bracket,
  picks: PostseasonPicks,
  logoUrls: Map<number, string>,
  fonts: BracketEmbeddedFonts,
): string {
  const seriesById = new Map(bracket.series.map((series) => [series.id, series]));
  const pickedTeam = (seriesId: string) => {
    const series = seriesById.get(seriesId);
    const teamId = picks[seriesId];
    return series && teamId
      ? resolveSeriesTeams(bracket, series, picks).find((team) => team?.id === teamId) ?? null
      : null;
  };
  const fixedTeam = (seriesId: string) => {
    const participant = seriesById.get(seriesId)?.participants.find((item) => item.kind === "team");
    return participant?.kind === "team" ? participant.team : null;
  };
  const openingTeams = (seriesId: string) => {
    const series = seriesById.get(seriesId);
    return series
      ? resolveSeriesTeams(bracket, series, picks) as [PostseasonTeam | null, PostseasonTeam | null]
      : [null, null] as const;
  };
  const mark = (
    team: PostseasonTeam | null,
    x: number,
    y: number,
    radius: number,
    accent = "#1b4332",
    champion = false,
  ) => {
    const logo = team ? logoUrls.get(team.id) ?? mlbTeamLogoUrl(team.id, "light") : null;
    return `<g><circle cx="${x}" cy="${y}" r="${radius + 6}" fill="#ede6d6" stroke="${accent}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="${radius}" fill="url(#slotFill)" stroke="${accent}" stroke-width="${champion ? 4 : 1.5}"/>${logo ? `<image href="${xml(logo)}" x="${x - radius * 0.68}" y="${y - radius * 0.68}" width="${radius * 1.36}" height="${radius * 1.36}"/>` : `<circle cx="${x}" cy="${y}" r="${radius * 0.52}" fill="none" stroke="${accent}" stroke-width="1.5" opacity="0.32"/>`}${team?.seed ? `<circle cx="${x - radius * 0.76}" cy="${y - radius * 0.76}" r="13" fill="#1c2b2a" stroke="#f7f3ea" stroke-width="2"/><text x="${x - radius * 0.76}" y="${y - radius * 0.76 + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#f7f3ea" font-family="${BRACKET_FONT_FAMILIES.mono}">${team.seed}</text>` : ""}${team ? `<text x="${x}" y="${y + radius + 20}" text-anchor="middle" font-size="11" font-weight="700" letter-spacing="1.5" fill="#3d4f48" font-family="${BRACKET_FONT_FAMILIES.mono}">${xml(team.abbreviation)}</text>` : ""}</g>`;
  };
  const [alWcATop, alWcABottom] = openingTeams("al-wc-a");
  const [alWcBTop, alWcBBottom] = openingTeams("al-wc-b");
  const [nlWcATop, nlWcABottom] = openingTeams("nl-wc-a");
  const [nlWcBTop, nlWcBBottom] = openingTeams("nl-wc-b");
  const connectors = `<g fill="none" stroke="#a89878" stroke-width="3" stroke-linecap="square" opacity="0.92"><path d="M90 350h16v120H90M106 410h16M90 920h16v120H90M106 980h16M206 410h11v82h11M206 575h11v-83h11M206 980h11v-82h11M206 815h11v83h11M324 492h9v203h9M324 898h9v-203h9M446 695h32M602 695h32M756 492h-9v203h-9M756 898h-9v-203h-9M874 410h-11v82h-11M874 575h-11v-83h-11M874 980h-11v-82h-11M874 815h-11v83h-11M990 350h-16v120h16M974 410h-16M990 920h-16v120h16M974 980h-16"/></g>`;
  const teamMarks = [
    mark(alWcATop, 54, 350, 30), mark(alWcABottom, 54, 470, 30),
    mark(pickedTeam("al-wc-a"), 164, 410, 36), mark(fixedTeam("al-ds-b"), 164, 575, 36),
    mark(pickedTeam("al-ds-b"), 276, 492, 42),
    mark(alWcBTop, 54, 920, 30), mark(alWcBBottom, 54, 1040, 30),
    mark(pickedTeam("al-wc-b"), 164, 980, 36), mark(fixedTeam("al-ds-a"), 164, 815, 36),
    mark(pickedTeam("al-ds-a"), 276, 898, 42),
    mark(pickedTeam("al-cs"), 394, 695, 46),
    mark(nlWcATop, 1026, 350, 30), mark(nlWcABottom, 1026, 470, 30),
    mark(pickedTeam("nl-wc-a"), 916, 410, 36), mark(fixedTeam("nl-ds-b"), 916, 575, 36),
    mark(pickedTeam("nl-ds-b"), 804, 492, 42),
    mark(nlWcBTop, 1026, 920, 30), mark(nlWcBBottom, 1026, 1040, 30),
    mark(pickedTeam("nl-wc-b"), 916, 980, 36), mark(fixedTeam("nl-ds-a"), 916, 815, 36),
    mark(pickedTeam("nl-ds-a"), 804, 898, 42),
    mark(pickedTeam("nl-cs"), 686, 695, 46),
    mark(pickedTeam("world-series"), 540, 695, 56, "#8b6914", true),
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><defs>${embeddedFontStyles(fonts)}<linearGradient id="paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#faf7f0"/><stop offset="0.55" stop-color="#f5f0e4"/><stop offset="1" stop-color="#ede6d6"/></linearGradient><radialGradient id="slotFill"><stop offset="0" stop-color="#faf7f0"/><stop offset="1" stop-color="#f0eadc"/></radialGradient><pattern id="grain" width="36" height="36" patternUnits="userSpaceOnUse" patternTransform="rotate(22)"><rect width="10" height="36" fill="#1b4332" opacity="0.012"/></pattern><radialGradient id="centerGlow"><stop offset="0" stop-color="#1b4332" stop-opacity="0.09"/><stop offset="1" stop-color="#1b4332" stop-opacity="0"/></radialGradient></defs><rect width="1080" height="1350" fill="url(#paper)"/><rect width="1080" height="1350" fill="url(#grain)"/><circle cx="540" cy="695" r="240" fill="url(#centerGlow)"/><rect x="472" y="376" width="136" height="638" rx="68" fill="#f7f3ea" stroke="#a89878" stroke-width="2" opacity="0.9"/><path d="M540 390v186M540 808v192" stroke="#a89878" stroke-width="2" opacity="0.65"/><text x="540" y="75" text-anchor="middle" font-size="18" font-weight="600" letter-spacing="6" fill="#1b4332" font-family="${BRACKET_FONT_FAMILIES.mono}">WTBB.ORG</text><text x="540" y="136" text-anchor="middle" font-size="58" font-weight="600" fill="#1c2b2a" font-family="${BRACKET_FONT_FAMILIES.serif}">POSTSEASON</text><text x="540" y="192" text-anchor="middle" font-size="58" font-weight="600" fill="#1c2b2a" font-family="${BRACKET_FONT_FAMILIES.serif}">PICTURE</text><text x="540" y="228" text-anchor="middle" font-size="17" font-weight="600" letter-spacing="7" fill="#1b4332" font-family="${BRACKET_FONT_FAMILIES.mono}">${bracket.season}</text><g font-family="${BRACKET_FONT_FAMILIES.mono}" font-weight="600" fill="#3d4f48"><text x="42" y="266" font-size="15" letter-spacing="3">AMERICAN LEAGUE</text><text x="1038" y="266" text-anchor="end" font-size="15" letter-spacing="3">NATIONAL LEAGUE</text><g font-size="10" letter-spacing="2" fill="#6b7d72"><text x="54" y="296" text-anchor="middle">WILD CARD</text><text x="164" y="296" text-anchor="middle">WC / BYE</text><text x="276" y="296" text-anchor="middle">ALDS</text><text x="394" y="296" text-anchor="middle">ALCS</text><text x="686" y="296" text-anchor="middle">NLCS</text><text x="804" y="296" text-anchor="middle">NLDS</text><text x="916" y="296" text-anchor="middle">WC / BYE</text><text x="1026" y="296" text-anchor="middle">WILD CARD</text></g><g font-size="9" letter-spacing="1.5" fill="#8c9e93"><text x="54" y="312" text-anchor="middle">BEST OF 3</text><text x="276" y="312" text-anchor="middle">BEST OF 5</text><text x="394" y="312" text-anchor="middle">BEST OF 7</text><text x="686" y="312" text-anchor="middle">BEST OF 7</text><text x="804" y="312" text-anchor="middle">BEST OF 5</text><text x="1026" y="312" text-anchor="middle">BEST OF 3</text></g></g><text x="540" y="348" text-anchor="middle" font-size="14" font-weight="600" letter-spacing="3" fill="#1b4332" font-family="${BRACKET_FONT_FAMILIES.mono}">WORLD SERIES · BEST OF 7</text>${connectors}${teamMarks}<text x="540" y="608" text-anchor="middle" font-size="12" font-weight="700" letter-spacing="3" fill="#8b6914" font-family="${BRACKET_FONT_FAMILIES.mono}">CHAMPION</text><text x="540" y="1296" text-anchor="middle" font-size="14" letter-spacing="2" fill="#4a5c52" font-family="${BRACKET_FONT_FAMILIES.sans}">My postseason dibs · picks advance automatically</text><rect x="0" y="1338" width="1080" height="12" fill="#1b4332"/></svg>`;
}

function bracketSvg(
  bracket: Bracket,
  picks: PostseasonPicks,
  logoUrls: Map<number, string> = new Map(),
  layout: BracketJpegLayout = "landscape",
  fonts: BracketEmbeddedFonts,
): string {
  if (layout === "portrait") return portraitBracketSvg(bracket, picks, logoUrls, fonts);
  const seriesById = new Map(bracket.series.map((series) => [series.id, series]));
  const node = (seriesId: string, x: number, y: number) => {
    const series = seriesById.get(seriesId);
    if (!series) return "";
    const teams = resolveSeriesTeams(bracket, series, picks);
    const teamMarks = teams.map((team, index) => {
      const slotX = index * 70;
      if (!team) {
        return `<path d="M${slotX + 35} 43l17 17-17 17-17-17z" fill="#ede6d6" stroke="#b6aa8f"/>`;
      }
      const selected = picks[series.id] === team.id;
      const logoUrl = logoUrls.get(team.id) ?? mlbTeamLogoUrl(team.id, "light");
      return `<g transform="translate(${slotX} 0)"><rect x="2" y="22" width="66" height="72" fill="${selected ? "#dce8df" : "#f8f4e9"}" stroke="${selected ? "#1b4332" : "#c4b89a"}" stroke-width="${selected ? 2 : 1}"/><image href="${xml(logoUrl)}" x="12" y="31" width="46" height="46"/><text x="35" y="89" text-anchor="middle" font-size="9" font-weight="700" fill="#435047" font-family="${BRACKET_FONT_FAMILIES.mono}">${xml(team.abbreviation)}</text>${team.seed ? `<circle cx="10" cy="30" r="9" fill="#1c2b2a"/><text x="10" y="33" text-anchor="middle" font-size="8" font-weight="700" fill="#f8f4e9" font-family="${BRACKET_FONT_FAMILIES.mono}">${team.seed}</text>` : ""}</g>`;
    }).join("");
    return `<g transform="translate(${x} ${y})"><text x="70" y="10" text-anchor="middle" font-size="9" letter-spacing="1" fill="#4a5c52" font-family="${BRACKET_FONT_FAMILIES.mono}">${xml(series.title.toUpperCase())} · BEST OF ${series.bestOf}</text>${teamMarks}</g>`;
  };
  const width = 1200;
  const height = 650;
  const nodes = [
    node("al-wc-a", 22, 120), node("al-wc-b", 22, 440),
    node("al-ds-b", 187, 200), node("al-ds-a", 187, 360),
    node("al-cs", 352, 280), node("world-series", 530, 280),
    node("nl-cs", 708, 280), node("nl-ds-b", 873, 200),
    node("nl-ds-a", 873, 360), node("nl-wc-a", 1038, 120),
    node("nl-wc-b", 1038, 440),
  ].join("");
  const connectorPath = "M162 180h13v80h12M162 500h13V420h12M327 260h13v80h12M327 420h13v-80h12M492 340h38M670 340h38M848 340h13v-80h12M848 340h13v80h12M1013 260h13v-80h12M1013 420h13v80h12";
  const connectors = `<g fill="none" stroke="#b6aa8f" stroke-width="2"><path d="${connectorPath}"/></g>`;
  const leagueLabels = `<text x="92" y="105" text-anchor="middle" font-size="10" font-weight="600" fill="#4a5c52" font-family="${BRACKET_FONT_FAMILIES.mono}">AMERICAN LEAGUE</text><text x="1108" y="105" text-anchor="middle" font-size="10" font-weight="600" fill="#4a5c52" font-family="${BRACKET_FONT_FAMILIES.mono}">NATIONAL LEAGUE</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${embeddedFontStyles(fonts)}</defs><rect width="100%" height="100%" fill="#ede6d6"/><rect width="100%" height="7" fill="#1b4332"/><text x="${width / 2}" y="52" text-anchor="middle" font-size="36" font-weight="600" fill="#1c2b2a" font-family="${BRACKET_FONT_FAMILIES.serif}">${bracket.season} POSTSEASON PICTURE</text><text x="${width / 2}" y="79" text-anchor="middle" font-size="12" letter-spacing="3" fill="#4a5c52" font-family="${BRACKET_FONT_FAMILIES.mono}">WHERE&apos;S THAT BASEBALL · WTBB.ORG</text>${leagueLabels}${connectors}${nodes}<text x="${width / 2}" y="${height - 26}" text-anchor="middle" font-size="12" fill="#6b7d72" font-family="${BRACKET_FONT_FAMILIES.sans}">My postseason dibs · filled picks advance automatically</text></svg>`;
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function embeddedTeamLogos(bracket: Bracket): Promise<Map<number, string>> {
  const teamIds = new Set<number>();
  for (const series of bracket.series) {
    for (const participant of series.participants) {
      if (participant.kind === "team") teamIds.add(participant.team.id);
    }
  }
  return new Map(await Promise.all([...teamIds].map(async (teamId) => {
    const response = await fetch(mlbTeamLogoUrl(teamId, "light"));
    return [teamId, await blobDataUrl(await response.blob())] as const;
  })));
}

function nextFontAssetUrl(family: string, weight: string): string {
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
      const style = (rule as CSSFontFaceRule).style;
      const ruleFamily = style.getPropertyValue("font-family").replace(/["']/g, "").trim();
      const unicodeRange = style.getPropertyValue("unicode-range").toUpperCase();
      if (
        ruleFamily !== family
        || style.getPropertyValue("font-weight").trim() !== weight
        || !unicodeRange.includes("U+0-FF")
      ) continue;
      const source = style.getPropertyValue("src").match(/url\(["']?([^"')]+)["']?\)/)![1];
      return new URL(source, sheet.href ?? document.baseURI).href;
    }
  }
  throw new Error(`Could not find ${family} ${weight}`);
}

async function embeddedBracketFonts(): Promise<BracketEmbeddedFonts> {
  const urls = {
    sansRegular: nextFontAssetUrl("IBM Plex Sans", "400"),
    sansSemibold: nextFontAssetUrl("IBM Plex Sans", "600"),
    serif: nextFontAssetUrl("IBM Plex Serif", "600"),
    mono: nextFontAssetUrl("JetBrains Mono", "100 800"),
  };
  const [sansRegular, sansSemibold, serif, mono] = await Promise.all([
    fetch(urls.sansRegular).then((response) => response.blob()).then(blobDataUrl),
    fetch(urls.sansSemibold).then((response) => response.blob()).then(blobDataUrl),
    fetch(urls.serif).then((response) => response.blob()).then(blobDataUrl),
    fetch(urls.mono).then((response) => response.blob()).then(blobDataUrl),
  ]);
  return { sansRegular, sansSemibold, serif, mono };
}

async function bracketJpeg(
  bracket: Bracket,
  picks: PostseasonPicks,
  layout: BracketJpegLayout,
): Promise<Blob> {
  const [logos, fonts] = await Promise.all([
    embeddedTeamLogos(bracket),
    embeddedBracketFonts(),
  ]);
  const svgUrl = URL.createObjectURL(new Blob(
    [bracketSvg(bracket, picks, logos, layout, fonts)],
    { type: "image/svg+xml;charset=utf-8" },
  ));
  try {
    const image = new Image();
    image.src = svgUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = layout === "portrait" ? 1080 : 1800;
    canvas.height = layout === "portrait" ? 1350 : 975;
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Could not render bracket")),
      "image/jpeg",
      0.92,
    ));
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function TeamSlot({ team, fallback, selected, onSelect }: {
  team: PostseasonTeam | null;
  fallback: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!team}
      onClick={onSelect}
      aria-label={team ? `${team.name}${selected ? ", selected to advance" : ""}` : fallback}
      aria-pressed={selected}
      className={cn(
        "relative flex h-[84px] flex-1 items-center justify-center border border-border bg-surface transition-colors",
        team ? "hover:border-border-strong hover:bg-hover" : "cursor-default border-dashed bg-panel/60",
        selected && "border-[#1b4332] bg-[#1b4332]/10 ring-2 ring-[#1b4332] ring-offset-1 ring-offset-background",
      )}
    >
      {team ? (
        <>
          {team.seed ? (
            <span className="absolute left-1.5 top-1.5 flex size-5 items-center justify-center bg-foreground font-mono text-[10px] font-bold text-background">
              {team.seed}
            </span>
          ) : null}
          <TeamLogo teamId={team.id} abbrev={team.abbreviation} size={56} title={team.name} />
          <span className="absolute bottom-1 right-1.5 font-mono text-[9px] font-semibold tracking-wide text-subtle">
            {team.abbreviation}
          </span>
          {selected ? (
            <span className="absolute right-1.5 top-1.5 bg-[#1b4332] px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-wider text-[#f5f0e4]">
              DIBS
            </span>
          ) : null}
        </>
      ) : (
        <>
          <span className="size-9 rotate-45 border border-border-strong bg-background" aria-hidden />
          <span className="sr-only">{fallback}</span>
        </>
      )}
    </button>
  );
}

function SeriesNode({ bracket, series, picks, onPick }: {
  bracket: Bracket;
  series: PostseasonSeries;
  picks: PostseasonPicks;
  onPick: (seriesId: string, teamId: number) => void;
}) {
  const teams = resolveSeriesTeams(bracket, series, picks);
  const selected = picks[series.id];

  return (
    <article className="relative w-full">
      <div className="mb-1 flex items-end justify-between gap-2">
        <h3 className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted">{series.title}</h3>
        <span className="whitespace-nowrap font-mono text-[9px] uppercase text-subtle">Best of {series.bestOf}</span>
      </div>
      <div className="flex gap-1.5">
        {series.participants.map((participant, index) => {
          const team = teams[index];
          const fallback = participant.kind === "winner" ? participant.label : participant.team.name;
          return (
            <TeamSlot
              key={`${series.id}-${index}`}
              team={team}
              fallback={fallback}
              selected={Boolean(team && selected === team.id)}
              onSelect={() => team && onPick(series.id, team.id)}
            />
          );
        })}
      </div>
      {series.status ? <p className="mt-1 truncate text-center font-mono text-[9px] text-secondary">{series.status}</p> : null}
    </article>
  );
}

const ROUND_LABELS: Record<PostseasonRound, string> = {
  "wild-card": "Wild Card",
  division: "Division Series",
  championship: "Championship Series",
  "world-series": "World Series",
};

function StageColumn({ league, round, bracket, picks, onPick, flow }: {
  league: PostseasonLeague;
  round: Exclude<PostseasonRound, "world-series">;
  bracket: Bracket;
  picks: PostseasonPicks;
  onPick: (seriesId: string, teamId: number) => void;
  flow: "left" | "right";
}) {
  const series = bracket.series
    .filter((item) => item.league === league && item.round === round)
    .sort((a, b) => round === "division" ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id));
  const twoSeries = series.length === 2;

  return (
    <section className="relative grid min-w-0 grid-rows-[36px_1fr_32px]">
      <p className="text-center font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-secondary">
        {league} {ROUND_LABELS[round]}
      </p>
      <div className={cn(
        "relative flex min-h-[470px] flex-col",
        twoSeries ? (round === "wild-card" ? "justify-between py-2" : "justify-between py-24") : "justify-center",
        flow === "right"
          ? "after:absolute after:-right-3 after:bottom-1/4 after:top-1/4 after:border-r after:border-border-strong"
          : "before:absolute before:-left-3 before:bottom-1/4 before:top-1/4 before:border-l before:border-border-strong",
      )}>
        {series.map((item) => (
          <div key={item.id} className={cn(
            "relative",
            flow === "right"
              ? "after:absolute after:-right-3 after:top-1/2 after:w-3 after:border-t after:border-border-strong"
              : "before:absolute before:-left-3 before:top-1/2 before:w-3 before:border-t before:border-border-strong",
          )}>
            <SeriesNode bracket={bracket} series={item} picks={picks} onPick={onPick} />
          </div>
        ))}
      </div>
      <p className="text-center font-serif text-sm font-semibold text-muted">Best of {series[0]?.bestOf ?? "—"}</p>
    </section>
  );
}

function WorldSeriesColumn({ bracket, picks, onPick }: {
  bracket: Bracket;
  picks: PostseasonPicks;
  onPick: (seriesId: string, teamId: number) => void;
}) {
  const series = bracket.series.find((item) => item.round === "world-series");
  return (
    <section className="grid grid-rows-[36px_1fr_32px]">
      <p className="text-center font-serif text-lg font-semibold text-foreground">World Series</p>
      <div className="flex min-h-[470px] items-center justify-center">
        {series ? (
          <div className="w-full border-y-2 border-[#1b4332] bg-background py-4">
            <SeriesNode bracket={bracket} series={series} picks={picks} onPick={onPick} />
          </div>
        ) : null}
      </div>
      <p className="text-center font-serif text-sm font-semibold text-muted">Best of {series?.bestOf ?? 7}</p>
    </section>
  );
}

type MobileBracketTab = "all" | "al" | "ws" | "nl";

export function PostseasonBracket({ bracket, initialPicks }: PostseasonBracketProps) {
  const [picks, setPicks] = useState(() => sanitizePostseasonPicks(bracket, initialPicks));
  const [mobileTab, setMobileTab] = useState<MobileBracketTab>("all");
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState<BracketJpegLayout | null>(null);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const encoded = useMemo(() => encodePostseasonPicks(picks), [picks]);
  const storageKey = `wtbb-postseason-picks-${bracket.season}`;

  const wsSeries = useMemo(
    () => bracket.series.find((item) => item.round === "world-series"),
    [bracket],
  );
  const championTeam = useMemo(() => {
    if (!wsSeries || !picks[wsSeries.id]) return null;
    const teams = resolveSeriesTeams(bracket, wsSeries, picks);
    return teams.find((team) => team?.id === picks[wsSeries.id]) ?? null;
  }, [bracket, picks, wsSeries]);

  const pickedCount = Object.keys(picks).length;
  const totalCount = bracket.series.length;

  useEffect(() => setCanNativeShare("share" in navigator), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const pParam = params.get("p");
    if (pParam) {
      const urlPicks = sanitizePostseasonPicks(bracket, decodePostseasonPicks(pParam));
      if (Object.keys(urlPicks).length > 0) {
        setPicks(urlPicks);
        return;
      }
    }
    if (Object.keys(initialPicks).length > 0) {
      setPicks(sanitizePostseasonPicks(bracket, initialPicks));
      return;
    }
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      try {
        setPicks(sanitizePostseasonPicks(bracket, JSON.parse(saved) as PostseasonPicks));
      } catch {
        // ignore parse error
      }
    }
  }, [bracket, initialPicks, storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(picks));
    const url = new URL(window.location.href);
    url.hash = "";
    url.searchParams.set("season", String(bracket.season));
    if (encoded) {
      url.searchParams.set("p", encoded);
    } else {
      url.searchParams.delete("p");
    }
    window.history.replaceState(null, "", url.toString());
  }, [bracket.season, encoded, picks, storageKey]);

  const onPick = useCallback((seriesId: string, teamId: number) => {
    setPicks((current) => sanitizePostseasonPicks(bracket, { ...current, [seriesId]: teamId }));
  }, [bracket]);

  const shareUrl = useCallback(() => {
    if (typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    url.hash = "";
    url.searchParams.set("season", String(bracket.season));
    if (encoded) url.searchParams.set("p", encoded);
    else url.searchParams.delete("p");
    return url.toString();
  }, [bracket.season, encoded]);

  const copyLink = useCallback(async () => {
    setShareError(null);
    try {
      await navigator.clipboard.writeText(shareUrl());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setShareError("Could not copy the bracket link.");
    }
  }, [shareUrl]);

  const nativeShare = useCallback(async () => {
    setShareError(null);
    const url = shareUrl();
    try {
      const title = championTeam
        ? `${bracket.season} MLB Postseason: ${championTeam.name} to win it all`
        : `${bracket.season} MLB Postseason Bracket`;
      const text = championTeam
        ? `I called dibs on the ${championTeam.name} to win the ${bracket.season} World Series! Check out my bracket:`
        : `Check out my ${bracket.season} MLB postseason bracket picks:`;
      await navigator.share({ title, text, url });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch {
        setShareError("Could not open the share sheet.");
      }
    }
  }, [bracket.season, championTeam, shareUrl]);

  const download = useCallback(async (layout: BracketJpegLayout) => {
    setShareError(null);
    setDownloading(layout);
    try {
      const url = URL.createObjectURL(await bracketJpeg(bracket, picks, layout));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `wtbb-${bracket.season}-postseason-dibs-${layout}.jpg`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setShareError("Could not create the bracket JPG.");
    } finally {
      setDownloading(null);
    }
  }, [bracket, picks]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppNav />
      <main className="mx-auto w-full max-w-[1480px] px-3 py-5 sm:px-4 sm:py-7">
        <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">{bracket.season} MLB postseason</p>
              <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] font-semibold text-secondary border border-border">
                {pickedCount}/{totalCount} picks
              </span>
            </div>
            <h1 className="mt-1 text-3xl font-medium text-foreground">Postseason picture</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">Tap a team mark to call dibs. Winners move into the next round automatically. No account required.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void (canNativeShare ? nativeShare() : copyLink())}
              className="flex items-center gap-1.5 border border-[#1b4332] bg-[#1b4332] px-3.5 py-2 font-mono text-xs font-semibold text-[#f5f0e4] shadow-sm hover:opacity-90"
            >
              <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              {copied ? "Link Copied!" : "Share Bracket"}
            </button>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="border border-border bg-surface px-3 py-2 font-mono text-xs text-secondary hover:bg-hover"
            >
              {copied ? "Copied" : "Copy Link"}
            </button>
            <button
              type="button"
              onClick={() => void download("portrait")}
              disabled={downloading !== null}
              className="border border-[#1b4332] bg-transparent px-3 py-2 font-mono text-xs text-[#1b4332] hover:bg-[#1b4332]/10 disabled:opacity-60"
            >
              {downloading === "portrait" ? "Creating…" : "Portrait JPG"}
            </button>
            <button
              type="button"
              onClick={() => void download("landscape")}
              disabled={downloading !== null}
              className="border border-border bg-surface px-3 py-2 font-mono text-xs text-secondary hover:bg-hover disabled:opacity-60"
            >
              {downloading === "landscape" ? "Creating…" : "Landscape JPG"}
            </button>
            <button
              type="button"
              onClick={() => setPicks({})}
              disabled={Object.keys(picks).length === 0}
              className="border border-border px-3 py-2 font-mono text-xs text-muted hover:bg-hover disabled:opacity-40"
            >
              Reset
            </button>
          </div>
        </div>

        {shareError ? <p className="mt-2 text-xs text-red-700">{shareError}</p> : null}

        {championTeam ? (
          <div className="mt-4 flex items-center justify-between gap-3 border border-[#8b6914]/40 bg-gradient-to-r from-[#8b6914]/15 via-surface to-[#8b6914]/15 p-3 sm:px-4 sm:py-3.5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="relative flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-[#8b6914] bg-surface shadow-sm">
                <TeamLogo teamId={championTeam.id} abbrev={championTeam.abbreviation} size={36} title={championTeam.name} />
                {championTeam.seed ? (
                  <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-[#1c2b2a] font-mono text-[9px] font-bold text-[#f7f3ea]">
                    {championTeam.seed}
                  </span>
                ) : null}
              </div>
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#8b6914]">
                  ★ {bracket.season} World Series Champion Pick
                </p>
                <p className="text-base font-semibold text-foreground">
                  {championTeam.name}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void (canNativeShare ? nativeShare() : copyLink())}
              className="whitespace-nowrap border border-[#8b6914] bg-[#8b6914] px-3 py-1.5 font-mono text-xs font-semibold text-[#f5f0e4] hover:opacity-90"
            >
              {copied ? "Copied!" : "Share"}
            </button>
          </div>
        ) : null}

        {/* Mobile View Switcher */}
        <div className="mt-4 sm:hidden">
          <div className="grid grid-cols-4 gap-1 rounded-lg border border-border bg-surface p-1">
            <button
              type="button"
              onClick={() => setMobileTab("all")}
              className={cn(
                "rounded py-1.5 text-center font-mono text-xs font-semibold transition-colors",
                mobileTab === "all" ? "bg-[#1b4332] text-[#f5f0e4] shadow-sm" : "text-muted hover:text-foreground",
              )}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setMobileTab("al")}
              className={cn(
                "rounded py-1.5 text-center font-mono text-xs font-semibold transition-colors",
                mobileTab === "al" ? "bg-[#1b4332] text-[#f5f0e4] shadow-sm" : "text-muted hover:text-foreground",
              )}
            >
              AL
            </button>
            <button
              type="button"
              onClick={() => setMobileTab("ws")}
              className={cn(
                "rounded py-1.5 text-center font-mono text-xs font-semibold transition-colors",
                mobileTab === "ws" ? "bg-[#8b6914] text-[#f5f0e4] shadow-sm" : "text-muted hover:text-foreground",
              )}
            >
              World Series
            </button>
            <button
              type="button"
              onClick={() => setMobileTab("nl")}
              className={cn(
                "rounded py-1.5 text-center font-mono text-xs font-semibold transition-colors",
                mobileTab === "nl" ? "bg-[#1b4332] text-[#f5f0e4] shadow-sm" : "text-muted hover:text-foreground",
              )}
            >
              NL
            </button>
          </div>
        </div>

        {/* Mobile-specific view panels */}
        <div className="sm:hidden">
          {mobileTab === "al" && (
            <section className="mt-3 overflow-x-auto border border-border bg-panel px-3 py-4 shadow-sm">
              <p className="mb-3 text-center font-mono text-xs font-bold uppercase tracking-[0.16em] text-[#1b4332]">
                American League
              </p>
              <div className="grid min-w-[540px] grid-cols-3 gap-4">
                <StageColumn league="AL" round="wild-card" bracket={bracket} picks={picks} onPick={onPick} flow="right" />
                <StageColumn league="AL" round="division" bracket={bracket} picks={picks} onPick={onPick} flow="right" />
                <StageColumn league="AL" round="championship" bracket={bracket} picks={picks} onPick={onPick} flow="right" />
              </div>
            </section>
          )}

          {mobileTab === "nl" && (
            <section className="mt-3 overflow-x-auto border border-border bg-panel px-3 py-4 shadow-sm">
              <p className="mb-3 text-center font-mono text-xs font-bold uppercase tracking-[0.16em] text-[#1b4332]">
                National League
              </p>
              <div className="grid min-w-[540px] grid-cols-3 gap-4">
                <StageColumn league="NL" round="wild-card" bracket={bracket} picks={picks} onPick={onPick} flow="right" />
                <StageColumn league="NL" round="division" bracket={bracket} picks={picks} onPick={onPick} flow="right" />
                <StageColumn league="NL" round="championship" bracket={bracket} picks={picks} onPick={onPick} flow="right" />
              </div>
            </section>
          )}

          {mobileTab === "ws" && (
            <section className="mt-3 border border-border bg-panel px-4 py-6 shadow-sm">
              <div className="mx-auto max-w-sm">
                <WorldSeriesColumn bracket={bracket} picks={picks} onPick={onPick} />
              </div>
            </section>
          )}

          {mobileTab === "all" && (
            <section className="mt-3 overflow-x-auto border border-border bg-panel px-3 py-4 shadow-sm">
              <p className="mb-2 text-center font-mono text-[11px] text-muted">
                ⇄ Swipe horizontally to navigate all rounds
              </p>
              <div className="grid min-w-[1220px] grid-cols-[1.05fr_1.05fr_1fr_1.18fr_1fr_1.05fr_1.05fr] gap-6">
                <StageColumn league="AL" round="wild-card" bracket={bracket} picks={picks} onPick={onPick} flow="right" />
                <StageColumn league="AL" round="division" bracket={bracket} picks={picks} onPick={onPick} flow="right" />
                <StageColumn league="AL" round="championship" bracket={bracket} picks={picks} onPick={onPick} flow="right" />
                <WorldSeriesColumn bracket={bracket} picks={picks} onPick={onPick} />
                <StageColumn league="NL" round="championship" bracket={bracket} picks={picks} onPick={onPick} flow="left" />
                <StageColumn league="NL" round="division" bracket={bracket} picks={picks} onPick={onPick} flow="left" />
                <StageColumn league="NL" round="wild-card" bracket={bracket} picks={picks} onPick={onPick} flow="left" />
              </div>
            </section>
          )}
        </div>

        {/* Desktop view (always full 7 columns) */}
        <section className="mt-6 hidden overflow-x-auto border border-border bg-panel px-4 py-5 shadow-sm sm:block">
          <div className="mx-auto grid min-w-[1220px] grid-cols-[1.05fr_1.05fr_1fr_1.18fr_1fr_1.05fr_1.05fr] gap-6">
            <StageColumn league="AL" round="wild-card" bracket={bracket} picks={picks} onPick={onPick} flow="right" />
            <StageColumn league="AL" round="division" bracket={bracket} picks={picks} onPick={onPick} flow="right" />
            <StageColumn league="AL" round="championship" bracket={bracket} picks={picks} onPick={onPick} flow="right" />
            <WorldSeriesColumn bracket={bracket} picks={picks} onPick={onPick} />
            <StageColumn league="NL" round="championship" bracket={bracket} picks={picks} onPick={onPick} flow="left" />
            <StageColumn league="NL" round="division" bracket={bracket} picks={picks} onPick={onPick} flow="left" />
            <StageColumn league="NL" round="wild-card" bracket={bracket} picks={picks} onPick={onPick} flow="left" />
          </div>
        </section>

        <p className="mt-4 text-xs text-subtle">Matchups and series status come from MLB. Your picks stay on this device unless you share the generated link or downloaded bracket.</p>
      </main>
    </div>
  );
}
