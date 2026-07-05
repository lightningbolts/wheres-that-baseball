import { ImageResponse } from "next/og";

import { mlbTeamShareLogoUrl } from "@/lib/mlb/teamAssets";
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

const COLORS = {
  background: "#0c0c0c",
  surface: "#161616",
  surfaceRaised: "#1f1f1f",
  border: "#333333",
  foreground: "#f5f5f5",
  muted: "#9ca3af",
  faint: "#6b7280",
  elite: "#34d399",
  cursed: "#f59e0b",
  gold: "#eab308",
  silver: "#94a3b8",
  bronze: "#d97706",
};

const CATEGORY_ACCENT: Record<NerdStatCategory, string> = {
  drama: "#f472b6",
  misfortune: "#fb923c",
  baserunning: "#38bdf8",
  contact: "#4ade80",
  pace: "#a78bfa",
  defense: "#60a5fa",
  chaos: "#facc15",
  vibes: "#2dd4bf",
};

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
        borderRadius: size / 2,
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
        background: COLORS.surfaceRaised,
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
  color: string,
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
        borderRadius: 12,
        overflow: "hidden",
        background: COLORS.surface,
      }}
    >
      <div
        style={{
          display: "flex",
          padding: "12px 16px",
          background: COLORS.surfaceRaised,
          borderBottom: `1px solid ${COLORS.border}`,
          color,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: "uppercase",
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
        background: COLORS.background,
        color: COLORS.foreground,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {accentBar(COLORS.elite, width)}

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
            <span style={{ display: "flex", fontSize: 38, fontWeight: 800, lineHeight: 1.05 }}>
              {card.teamName}
            </span>
            <span style={{ display: "flex", fontSize: 17, color: COLORS.muted }}>
              {card.season} team report
            </span>
          </div>
        </div>

        <div style={{ display: "flex", width: contentWidth, gap: 16 }}>
          {chaosColumn("Top 3", COLORS.elite, elite, "elite", (contentWidth - 16) / 2)}
          {chaosColumn("Bottom 3", COLORS.cursed, cursed, "cursed", (contentWidth - 16) / 2)}
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
        background: leader.rank <= 3 ? COLORS.surfaceRaised : COLORS.surface,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            display: "flex",
            width: 24,
            color: podium ?? COLORS.muted,
            fontSize: 16,
            fontWeight: podium ? 700 : 500,
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
        background: COLORS.background,
        color: COLORS.foreground,
        fontFamily: "system-ui, -apple-system, sans-serif",
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
                color: accent,
                fontSize: 14,
                textTransform: "uppercase",
                letterSpacing: 2,
                fontWeight: 600,
              }}
            >
              {categoryLabel(detail.stat.category)} · {detail.season}
            </span>
            <span style={{ display: "flex", fontSize: portrait ? 40 : 36, fontWeight: 800, lineHeight: 1.1 }}>
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
              borderRadius: 12,
              border: `1px solid ${accent}`,
              background: COLORS.surfaceRaised,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {teamLogo(top.teamId, 52)}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span
                  style={{
                    display: "flex",
                    color: accent,
                    fontSize: 12,
                    textTransform: "uppercase",
                    letterSpacing: 1.5,
                    fontWeight: 700,
                  }}
                >
                  #1 · {detail.stat.title}
                </span>
                <span style={{ display: "flex", fontSize: 26, fontWeight: 700 }}>{top.teamName}</span>
              </div>
            </div>
            <span style={{ display: "flex", fontSize: 34, fontWeight: 800, color: accent }}>{top.displayValue}</span>
          </div>
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: size.width - (portrait ? 88 : 80),
            border: `1px solid ${COLORS.border}`,
            borderRadius: 12,
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
              borderBottom: `1px solid ${COLORS.border}`,
              color: COLORS.faint,
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: 1.5,
              background: COLORS.surfaceRaised,
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
        background: COLORS.background,
        color: COLORS.foreground,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {accentBar(COLORS.elite, width)}

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
            <span style={{ display: "flex", fontSize: 34, fontWeight: 800 }}>{card.teamName}</span>
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
            borderRadius: 12,
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
                    background: elite || cursed ? COLORS.surfaceRaised : COLORS.surface,
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
                  <span style={{ display: "flex", fontSize: 20, fontWeight: 700, flexShrink: 0 }}>
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
  return new ImageResponse(nerdStatShareElement(detail, portrait), size);
}

export async function renderTeamNerdCardImage(
  card: TeamNerdCard,
  portrait: boolean,
  variant: TeamShareCardVariant = "full",
) {
  if (portrait && variant === "highlights") {
    const { elite, cursed } = splitChaosStats(card.stats);
    const height = chaosShareHeight(elite.length, cursed.length);
    return new ImageResponse(teamChaosShareElement(card, height), {
      width: CHAOS_SHARE_WIDTH,
      height,
    });
  }

  const size = portrait ? { width: 1080, height: teamShareHeight(pickFullShareCardStats(card.stats).length, false) } : OG_IMAGE_SIZE;
  return new ImageResponse(teamNerdCardShareElement(card, portrait, size.height), size);
}
