import { ImageResponse } from "next/og";

import { mlbTeamShareLogoUrl } from "@/lib/mlb/teamAssets";
import { pickEliteCursedTeamStats, nerdRankBadgeLabel } from "@/lib/mlb/nerdStats/teamNerdHighlights";
import type { NerdStatDetail, TeamNerdCard } from "@/lib/mlb/nerdStats/types";
import { NERD_STAT_CATEGORIES } from "@/lib/mlb/nerdStats/types";
import { SITE_NAME, SITE_NAME_SHORT } from "@/lib/site";

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
export const SHARE_CARD_SIZE = { width: 1080, height: 1350 } as const;

export type TeamShareCardVariant = "full" | "highlights";

function shareCardHeight(rowCount: number, portrait: boolean): number {
  const padding = portrait ? 96 : 80;
  const header = portrait ? 200 : 160;
  const footer = portrait ? 56 : 48;
  const rowHeight = portrait ? 68 : 56;
  const computed = padding + header + footer + rowCount * rowHeight;
  return Math.min(SHARE_CARD_SIZE.height, Math.max(720, computed));
}

const COLORS = {
  background: "#0f0f0f",
  surface: "#1a1a1a",
  border: "#2a2a2a",
  foreground: "#f5f5f5",
  muted: "#a3a3a3",
  accent: "#34d399",
  cursed: "#fbbf24",
};

function categoryLabel(category: string): string {
  return NERD_STAT_CATEGORIES.find((item) => item.id === category)?.label ?? category;
}

function leaderRow(
  leader: { rank: number; teamName: string; abbrev: string; displayValue: string; teamId: number },
  compact: boolean,
) {
  const logoSize = compact ? 36 : 44;
  return (
    <div
      key={leader.teamId}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: compact ? "10px 14px" : "12px 16px",
        borderBottom: `1px solid ${COLORS.border}`,
        background: leader.rank <= 3 ? COLORS.surface : "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <span style={{ width: 24, color: COLORS.muted, fontSize: compact ? 16 : 18 }}>{leader.rank}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mlbTeamShareLogoUrl(leader.teamId)}
          alt=""
          width={logoSize}
          height={logoSize}
        />
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span
            style={{
              color: COLORS.foreground,
              fontSize: compact ? 20 : 22,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {leader.teamName}
          </span>
          <span style={{ color: COLORS.muted, fontSize: compact ? 14 : 16 }}>{leader.abbrev}</span>
        </div>
      </div>
      <span style={{ color: COLORS.foreground, fontSize: compact ? 22 : 26, fontWeight: 700 }}>
        {leader.displayValue}
      </span>
    </div>
  );
}

export function nerdStatShareElement(detail: NerdStatDetail, portrait: boolean) {
  const leaders = detail.stat.leaders.slice(0, portrait ? 8 : 5);
  const compact = portrait;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: COLORS.background,
        color: COLORS.foreground,
        padding: portrait ? 48 : 40,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: "80%" }}>
          <span
            style={{
              color: COLORS.muted,
              fontSize: portrait ? 18 : 16,
              textTransform: "uppercase",
              letterSpacing: 2,
            }}
          >
            {categoryLabel(detail.stat.category)} · {detail.season} Nerd Standings
          </span>
          <span style={{ fontSize: portrait ? 52 : 44, fontWeight: 700, lineHeight: 1.1 }}>
            {detail.stat.title}
          </span>
          <span style={{ color: COLORS.muted, fontSize: portrait ? 22 : 20, lineHeight: 1.35 }}>
            {detail.stat.subtitle}
          </span>
        </div>
        <span style={{ color: COLORS.muted, fontSize: portrait ? 20 : 18 }}>{SITE_NAME_SHORT}</span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginTop: portrait ? 36 : 28,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 16,
          overflow: "hidden",
          flex: portrait ? 1 : undefined,
        }}
      >
        {leaders.map((leader) => leaderRow(leader, compact))}
      </div>

      <div
        style={{
          marginTop: portrait ? 28 : 20,
          display: "flex",
          justifyContent: "space-between",
          color: COLORS.muted,
          fontSize: portrait ? 18 : 16,
        }}
      >
        <span>Not W–L. Not WAR. Better.</span>
        <span>{SITE_NAME}</span>
      </div>
    </div>
  );
}

export function teamNerdCardShareElement(
  card: TeamNerdCard,
  portrait: boolean,
  variant: TeamShareCardVariant = "full",
) {
  const highlights =
    variant === "highlights"
      ? pickEliteCursedTeamStats(card.stats)
      : [...card.stats].sort((a, b) => a.rank - b.rank).slice(0, portrait ? 10 : 6);

  const subtitle =
    variant === "highlights"
      ? `${card.season} nerd card · elite & cursed chaos only`
      : `${card.season} nerd card · elite & cursed ranks`;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: COLORS.background,
        color: COLORS.foreground,
        padding: portrait ? 48 : 40,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mlbTeamShareLogoUrl(card.teamId)} alt="" width={portrait ? 96 : 72} height={portrait ? 96 : 72} />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: portrait ? 48 : 40, fontWeight: 700 }}>{card.teamName}</span>
          <span style={{ color: COLORS.muted, fontSize: portrait ? 22 : 18 }}>{subtitle}</span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginTop: portrait ? 36 : 28,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 16,
          overflow: "hidden",
          flex: portrait ? 1 : undefined,
        }}
      >
        {highlights.length === 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: portrait ? "32px 16px" : "24px 14px",
              color: COLORS.muted,
              fontSize: portrait ? 20 : 18,
            }}
          >
            No elite or cursed chaos yet — check back later.
          </div>
        ) : (
          highlights.map((stat) => {
            const elite = stat.rank <= 3;
            const cursed = stat.rank >= 28;
            const badge = nerdRankBadgeLabel(stat.rank, stat.sort);
            return (
              <div
                key={stat.statId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: portrait ? "12px 16px" : "10px 14px",
                  borderBottom: `1px solid ${COLORS.border}`,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: "72%" }}>
                  <span style={{ fontSize: portrait ? 20 : 18, fontWeight: 600 }}>{stat.title}</span>
                  <span
                    style={{
                      color: elite ? COLORS.accent : cursed ? COLORS.cursed : COLORS.muted,
                      fontSize: 14,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                    }}
                  >
                    Rank #{stat.rank}
                    {badge ? ` · ${badge}` : ""}
                  </span>
                </div>
                <span style={{ fontSize: portrait ? 22 : 20, fontWeight: 700 }}>{stat.displayValue}</span>
              </div>
            );
          })
        )}
      </div>

      <div
        style={{
          marginTop: portrait ? 28 : 20,
          display: "flex",
          justifyContent: "space-between",
          color: COLORS.muted,
          fontSize: portrait ? 18 : 16,
        }}
      >
        <span>Actually, your team is…</span>
        <span>{SITE_NAME}</span>
      </div>
    </div>
  );
}

export async function renderNerdStatImage(detail: NerdStatDetail, portrait: boolean) {
  const size = portrait ? SHARE_CARD_SIZE : OG_IMAGE_SIZE;
  return new ImageResponse(nerdStatShareElement(detail, portrait), size);
}

export async function renderTeamNerdCardImage(
  card: TeamNerdCard,
  portrait: boolean,
  variant: TeamShareCardVariant = "full",
) {
  const highlights =
    variant === "highlights"
      ? pickEliteCursedTeamStats(card.stats)
      : [...card.stats].sort((a, b) => a.rank - b.rank).slice(0, portrait ? 10 : 6);
  const rowCount = Math.max(highlights.length, 1);
  const size =
    portrait && variant === "highlights"
      ? { width: SHARE_CARD_SIZE.width, height: shareCardHeight(rowCount, true) }
      : portrait
        ? SHARE_CARD_SIZE
        : OG_IMAGE_SIZE;
  return new ImageResponse(teamNerdCardShareElement(card, portrait, variant), size);
}
