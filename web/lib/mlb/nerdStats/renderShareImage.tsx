import { ImageResponse } from "next/og";

import { mlbTeamShareLogoUrl } from "@/lib/mlb/teamAssets";
import { loadShareImageFonts, SHARE_FONTS } from "@/lib/mlb/nerdStats/shareImageFonts";
import {
  nerdRankBadgeLabel,
  pickFullShareCardStats,
  splitShareableChaosStats,
} from "@/lib/mlb/nerdStats/teamNerdHighlights";
import type { NerdStatDetail, TeamNerdCard } from "@/lib/mlb/nerdStats/types";
import { NERD_STAT_CATEGORIES, type NerdStatCategory } from "@/lib/mlb/nerdStats/types";
import { SITE_NAME, SITE_NAME_SHORT } from "@/lib/site";

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
export const STAT_SHARE_SIZE = { width: 1080, height: 920 } as const;
export const CHAOS_SHARE_WIDTH = 1080;

export type TeamShareCardVariant = "full" | "highlights";

/** Moneyball light palette — mirrors globals.css :root tokens for share/OG images. */
const COLORS = {
  background: "#ede6d6",
  surface: "#f7f3ea",
  surfaceRaised: "#faf7f0",
  panel: "#f5f0e4",
  border: "#c4b89a",
  borderStrong: "#a89878",
  foreground: "#1c2b2a",
  secondary: "#3d4f48",
  muted: "#4a5c52",
  subtle: "#6b7d72",
  faint: "#9a9a88",
  brand: "#1b4332",
  brandFg: "#f5f0e4",
  elite: "#2d6a4f",
  cursed: "#b45309",
  gold: "#a16207",
  silver: "#64748b",
  bronze: "#b45309",
};

const CATEGORY_ACCENT: Record<NerdStatCategory, string> = {
  drama: "#b45309",
  misfortune: "#b91c1c",
  baserunning: "#2d6a4f",
  contact: "#1d4e89",
  pace: "#6d28d9",
  defense: "#0f766e",
  chaos: "#c2410c",
  vibes: "#be185d",
};

const SHARE_BACKGROUND = `linear-gradient(180deg, rgb(255 255 255 / 0.35) 0%, transparent 40%, rgb(0 0 0 / 0.02) 100%), ${COLORS.background}`;

type TeamNerdStat = TeamNerdCard["stats"][number];

function categoryLabel(category: string): string {
  return NERD_STAT_CATEGORIES.find((item) => item.id === category)?.label ?? category;
}

function categoryAccent(category: string): string {
  return CATEGORY_ACCENT[category as NerdStatCategory] ?? COLORS.elite;
}

function podiumColor(rank: number): string | null {
  if (rank === 1) return COLORS.gold;
  if (rank === 2) return COLORS.silver;
  if (rank === 3) return COLORS.bronze;
  return null;
}

function splitChaosStats(stats: TeamNerdStat[]) {
  return splitShareableChaosStats(stats);
}

function teamShareHeight(rowCount: number, twoColumn: boolean): number {
  const rows = Math.max(rowCount, 1);
  const rowHeight = 64;
  const columnHeader = twoColumn ? 45 : 0;
  const teamHeader = 100;
  const footer = 36;
  const padding = 96;
  const accent = 5;
  return accent + padding + teamHeader + columnHeader + rows * rowHeight + footer + 24;
}

function chaosShareHeight(eliteCount: number, cursedCount: number): number {
  return teamShareHeight(Math.max(eliteCount, cursedCount, 1), true);
}

function teamLogo(teamId: number, size: number) {
  const inner = Math.round(size * 0.8);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 0,
        background: COLORS.surfaceRaised,
        border: `1px solid ${COLORS.border}`,
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={mlbTeamShareLogoUrl(teamId)}
        style={{
          objectFit: "contain",
          width: inner,
          height: inner,
        }}
      />
    </div>
  );
}

function accentBar(accent: string, width: number) {
  return (
    <div
      style={{
        display: "flex",
        width,
        height: 5,
        background: accent,
        flexShrink: 0,
      }}
    />
  );
}

function chaosStatRow(stat: TeamNerdStat, side: "elite" | "cursed", columnWidth: number) {
  const badge = nerdRankBadgeLabel(stat.rank, stat.sort);
  const color = side === "elite" ? COLORS.elite : COLORS.cursed;
  const podium = podiumColor(stat.rank);

  return (
    <div
      key={stat.statId}
      style={{
        display: "flex",
        flexDirection: "column",
        width: columnWidth,
        padding: "14px 16px",
        borderBottom: `1px solid ${COLORS.border}`,
        background: COLORS.surface,
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          width: columnWidth - 32,
          gap: 12,
        }}
      >
        <span
          style={{
            display: "flex",
            flex: 1,
            fontSize: 17,
            fontWeight: 600,
            lineHeight: 1.25,
            color: COLORS.foreground,
          }}
        >
          {stat.title}
        </span>
        <span
          style={{
            display: "flex",
            fontSize: 20,
            fontWeight: 700,
            fontFamily: SHARE_FONTS.mono,
            color: podium ?? COLORS.foreground,
            flexShrink: 0,
          }}
        >
          {stat.displayValue}
        </span>
      </div>
      <span
        style={{
          display: "flex",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color,
        }}
      >
        #{stat.rank}
        {badge ? ` · ${badge}` : ""}
      </span>
    </div>
  );
}

function chaosColumn(
  title: string,
  stats: TeamNerdStat[],
  side: "elite" | "cursed",
  columnWidth: number,
) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: columnWidth,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 0,
        overflow: "hidden",
        background: COLORS.surface,
      }}
    >
      <div
        style={{
          display: "flex",
          padding: "12px 16px",
          background: COLORS.brand,
          borderBottom: `1px solid ${COLORS.brand}`,
          color: COLORS.brandFg,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: "uppercase",
          fontFamily: SHARE_FONTS.sans,
        }}
      >
        {title}
      </div>
      {stats.length === 0 ? (
        <div
          style={{
            display: "flex",
            padding: "24px 16px",
            color: COLORS.faint,
            fontSize: 15,
          }}
        >
          None yet
        </div>
      ) : (
        stats.map((stat) => chaosStatRow(stat, side, columnWidth))
      )}
    </div>
  );
}

export function teamChaosShareElement(card: TeamNerdCard, height: number) {
  const width = CHAOS_SHARE_WIDTH;
  const { elite, cursed } = splitChaosStats(card.stats);
  const contentWidth = width - 88;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width,
        height,
        background: SHARE_BACKGROUND,
        color: COLORS.foreground,
        fontFamily: SHARE_FONTS.sans,
      }}
    >
      {accentBar(COLORS.brand, width)}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width,
          padding: "36px 44px 28px",
          gap: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, width: contentWidth }}>
          {teamLogo(card.teamId, 72)}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ display: "flex", fontSize: 38, fontWeight: 600, lineHeight: 1.05, fontFamily: SHARE_FONTS.serif }}>
              {card.teamName}
            </span>
            <span style={{ display: "flex", fontSize: 17, color: COLORS.muted }}>
              {card.season} team report
            </span>
          </div>
        </div>

        <div style={{ display: "flex", width: contentWidth, gap: 16 }}>
          {chaosColumn("Top 3", elite, "elite", (contentWidth - 16) / 2)}
          {chaosColumn("Bottom 3", cursed, "cursed", (contentWidth - 16) / 2)}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: contentWidth,
            color: COLORS.faint,
            fontSize: 15,
          }}
        >
          <span style={{ display: "flex" }}>Actually, your team is…</span>
          <span style={{ display: "flex" }}>{SITE_NAME}</span>
        </div>
      </div>
    </div>
  );
}

function leaderRow(
  leader: { rank: number; teamName: string; abbrev: string; displayValue: string; teamId: number },
) {
  const podium = podiumColor(leader.rank);

  return (
    <div
      key={leader.teamId}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "12px 18px",
        borderBottom: `1px solid ${COLORS.border}`,
        background: leader.rank <= 3 ? COLORS.panel : COLORS.surface,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            display: "flex",
            width: 24,
            color: podium ?? COLORS.subtle,
            fontSize: 16,
            fontWeight: podium ? 700 : 500,
            fontFamily: SHARE_FONTS.mono,
          }}
        >
          {leader.rank}
        </span>
        {teamLogo(leader.teamId, 36)}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ display: "flex", fontSize: 20, fontWeight: 600 }}>{leader.abbrev}</span>
          <span style={{ display: "flex", fontSize: 14, color: COLORS.muted }}>{leader.teamName}</span>
        </div>
      </div>
      <span
        style={{
          display: "flex",
          color: podium ?? COLORS.foreground,
          fontSize: 24,
          fontWeight: 700,
          fontFamily: SHARE_FONTS.mono,
        }}
      >
        {leader.displayValue}
      </span>
    </div>
  );
}

export function nerdStatShareElement(detail: NerdStatDetail, portrait: boolean) {
  const leaders = detail.stat.leaders.slice(0, 5);
  const top = leaders[0];
  const accent = categoryAccent(detail.stat.category);
  const size = portrait ? STAT_SHARE_SIZE : OG_IMAGE_SIZE;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: size.width,
        height: size.height,
        background: SHARE_BACKGROUND,
        color: COLORS.foreground,
        fontFamily: SHARE_FONTS.sans,
      }}
    >
      {accentBar(accent, size.width)}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: size.width,
          flex: 1,
          padding: portrait ? "36px 44px 28px" : "32px 40px",
          gap: portrait ? 20 : 16,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            width: size.width - (portrait ? 88 : 80),
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 780 }}>
            <span
              style={{
                display: "flex",
                color: COLORS.muted,
                fontSize: 14,
                textTransform: "uppercase",
                letterSpacing: 2,
                fontWeight: 600,
              }}
            >
              {categoryLabel(detail.stat.category)} · {detail.season}
            </span>
            <span style={{ display: "flex", fontSize: portrait ? 40 : 36, fontWeight: 600, lineHeight: 1.1, fontFamily: SHARE_FONTS.serif }}>
              {detail.stat.title}
            </span>
            <span style={{ display: "flex", color: COLORS.muted, fontSize: portrait ? 18 : 16, lineHeight: 1.35 }}>
              {detail.stat.subtitle}
            </span>
          </div>
          <span style={{ display: "flex", color: COLORS.faint, fontSize: 14 }}>{SITE_NAME_SHORT}</span>
        </div>

        {portrait && top && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: size.width - 88,
              padding: "18px 20px",
              borderRadius: 0,
              border: `1px solid ${COLORS.borderStrong}`,
              background: COLORS.panel,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {teamLogo(top.teamId, 52)}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span
                  style={{
                    display: "flex",
                    color: COLORS.brand,
                    fontSize: 12,
                    textTransform: "uppercase",
                    letterSpacing: 1.5,
                    fontWeight: 700,
                  }}
                >
                  #1 · {detail.stat.title}
                </span>
                <span style={{ display: "flex", fontSize: 26, fontWeight: 600, fontFamily: SHARE_FONTS.serif }}>{top.teamName}</span>
              </div>
            </div>
            <span style={{ display: "flex", fontSize: 34, fontWeight: 700, fontFamily: SHARE_FONTS.mono, color: COLORS.foreground }}>{top.displayValue}</span>
          </div>
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: size.width - (portrait ? 88 : 80),
            border: `1px solid ${COLORS.border}`,
            borderRadius: 0,
            overflow: "hidden",
            background: COLORS.surface,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              width: "100%",
              padding: "8px 18px",
              borderBottom: `1px solid ${COLORS.brand}`,
              color: COLORS.brandFg,
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: 1.5,
              background: COLORS.brand,
              fontWeight: 600,
            }}
          >
            <span style={{ display: "flex" }}>Team</span>
            <span style={{ display: "flex" }}>Value</span>
          </div>
          {leaders.map((leader) => leaderRow(leader))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            width: size.width - (portrait ? 88 : 80),
            color: COLORS.faint,
            fontSize: 14,
            marginTop: "auto",
          }}
        >
          <span style={{ display: "flex" }}>{SITE_NAME}</span>
          <span style={{ display: "flex" }}>{detail.stat.category}</span>
        </div>
      </div>
    </div>
  );
}

export function teamNerdCardShareElement(card: TeamNerdCard, portrait: boolean, height: number) {
  const highlights = pickFullShareCardStats(card.stats);
  const width = CHAOS_SHARE_WIDTH;
  const contentWidth = width - 88;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width,
        height,
        background: SHARE_BACKGROUND,
        color: COLORS.foreground,
        fontFamily: SHARE_FONTS.sans,
      }}
    >
      {accentBar(COLORS.brand, width)}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width,
          padding: "36px 44px 28px",
          gap: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, width: contentWidth }}>
          {teamLogo(card.teamId, 64)}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ display: "flex", fontSize: 34, fontWeight: 600, fontFamily: SHARE_FONTS.serif }}>{card.teamName}</span>
            <span style={{ display: "flex", fontSize: 16, color: COLORS.muted }}>
              {card.season} team report
            </span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: contentWidth,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 0,
            overflow: "hidden",
            background: COLORS.surface,
          }}
        >
          {highlights.length === 0 ? (
            <div
              style={{
                display: "flex",
                padding: "32px 18px",
                color: COLORS.muted,
                fontSize: 16,
              }}
            >
              No standout rankings yet.
            </div>
          ) : (
            highlights.map((stat, index) => {
              const elite = stat.rank <= 3;
              const cursed = stat.rank >= 28;
              const badge = nerdRankBadgeLabel(stat.rank, stat.sort);
              const isLast = index === highlights.length - 1;

              return (
                <div
                  key={stat.statId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: contentWidth,
                    gap: 12,
                    padding: "12px 18px",
                    borderBottom: isLast ? "none" : `1px solid ${COLORS.border}`,
                    background: elite || cursed ? COLORS.panel : COLORS.surface,
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, width: contentWidth - 120 }}>
                    <span style={{ display: "flex", fontSize: 17, fontWeight: 600 }}>{stat.title}</span>
                    {badge && (
                      <span
                        style={{
                          display: "flex",
                          color: elite ? COLORS.elite : COLORS.cursed,
                          fontSize: 11,
                          textTransform: "uppercase",
                          letterSpacing: 1,
                          fontWeight: 700,
                        }}
                      >
                        #{stat.rank} · {badge}
                      </span>
                    )}
                  </div>
                  <span style={{ display: "flex", fontSize: 20, fontWeight: 700, fontFamily: SHARE_FONTS.mono, flexShrink: 0 }}>
                    {stat.displayValue}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            width: contentWidth,
            color: COLORS.faint,
            fontSize: 14,
          }}
        >
          <span style={{ display: "flex" }}>Actually, your team is…</span>
          <span style={{ display: "flex" }}>{SITE_NAME}</span>
        </div>
      </div>
    </div>
  );
}

export async function renderNerdStatImage(detail: NerdStatDetail, portrait: boolean) {
  const size = portrait ? STAT_SHARE_SIZE : OG_IMAGE_SIZE;
  const fonts = await loadShareImageFonts();
  return new ImageResponse(nerdStatShareElement(detail, portrait), { ...size, fonts });
}

export async function renderTeamNerdCardImage(
  card: TeamNerdCard,
  portrait: boolean,
  variant: TeamShareCardVariant = "full",
) {
  const fonts = await loadShareImageFonts();
  if (portrait && variant === "highlights") {
    const { elite, cursed } = splitChaosStats(card.stats);
    const height = chaosShareHeight(elite.length, cursed.length);
    return new ImageResponse(teamChaosShareElement(card, height), {
      width: CHAOS_SHARE_WIDTH,
      height,
      fonts,
    });
  }

  const size = portrait ? { width: 1080, height: teamShareHeight(pickFullShareCardStats(card.stats).length, false) } : OG_IMAGE_SIZE;
  return new ImageResponse(teamNerdCardShareElement(card, portrait, size.height), { ...size, fonts });
}
