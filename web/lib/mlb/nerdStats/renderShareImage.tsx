import { ImageResponse } from "next/og";

import { mlbTeamShareLogoUrl } from "@/lib/mlb/teamAssets";
import { pickEliteCursedTeamStats, nerdRankBadgeLabel } from "@/lib/mlb/nerdStats/teamNerdHighlights";
import type { NerdStatDetail, TeamNerdCard } from "@/lib/mlb/nerdStats/types";
import { NERD_STAT_CATEGORIES, type NerdStatCategory } from "@/lib/mlb/nerdStats/types";
import { SITE_NAME, SITE_NAME_SHORT } from "@/lib/site";

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
export const SHARE_CARD_WIDTH = 1080;

export type TeamShareCardVariant = "full" | "highlights";

const COLORS = {
  background: "#0a0a0a",
  surface: "#141414",
  surfaceRaised: "#1c1c1c",
  border: "#2e2e2e",
  foreground: "#fafafa",
  muted: "#8a8a8a",
  faint: "#5c5c5c",
  accent: "#34d399",
  cursed: "#fbbf24",
  gold: "#f5c842",
  silver: "#b8bcc4",
  bronze: "#d4925a",
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

function categoryLabel(category: string): string {
  return NERD_STAT_CATEGORIES.find((item) => item.id === category)?.label ?? category;
}

function categoryAccent(category: string): string {
  return CATEGORY_ACCENT[category as NerdStatCategory] ?? COLORS.accent;
}

function podiumColor(rank: number): string | null {
  if (rank === 1) return COLORS.gold;
  if (rank === 2) return COLORS.silver;
  if (rank === 3) return COLORS.bronze;
  return null;
}

function shareCardHeight(rowCount: number, portrait: boolean, hasFeatured = false): number {
  const padY = portrait ? 56 : 40;
  const header = portrait ? 168 : 140;
  const featured = hasFeatured ? (portrait ? 132 : 0) : 0;
  const tableHead = portrait ? 36 : 32;
  const footer = portrait ? 44 : 40;
  const rowHeight = portrait ? 72 : 56;
  const computed = padY * 2 + header + featured + tableHead + footer + rowCount * rowHeight;
  return Math.max(portrait ? 640 : OG_IMAGE_SIZE.height, computed);
}

function cardShell({
  accent,
  portrait,
  children,
}: {
  accent: string;
  portrait: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: COLORS.background,
        color: COLORS.foreground,
        padding: portrait ? "56px 48px" : "40px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          background: accent,
        }}
      />
      {children}
    </div>
  );
}

function cardFooter(portrait: boolean) {
  return (
    <div
      style={{
        marginTop: portrait ? 24 : 20,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        color: COLORS.faint,
        fontSize: portrait ? 16 : 14,
      }}
    >
      <span>Not W–L. Not WAR. Better.</span>
      <span>{SITE_NAME}</span>
    </div>
  );
}

function leaderRow(
  leader: { rank: number; teamName: string; abbrev: string; displayValue: string; teamId: number },
  portrait: boolean,
) {
  const podium = podiumColor(leader.rank);
  const logoSize = portrait ? 40 : 36;

  return (
    <div
      key={leader.teamId}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: portrait ? "14px 18px" : "10px 14px",
        borderBottom: `1px solid ${COLORS.border}`,
        background: leader.rank <= 3 ? COLORS.surfaceRaised : COLORS.surface,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flex: 1 }}>
        <span
          style={{
            display: "flex",
            width: 28,
            color: podium ?? COLORS.muted,
            fontSize: portrait ? 18 : 16,
            fontWeight: podium ? 700 : 500,
          }}
        >
          {leader.rank}
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mlbTeamShareLogoUrl(leader.teamId)} alt="" width={logoSize} height={logoSize} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span
            style={{
              color: COLORS.foreground,
              fontSize: portrait ? 22 : 18,
              fontWeight: 600,
            }}
          >
            {leader.abbrev}
          </span>
          <span
            style={{
              color: COLORS.muted,
              fontSize: portrait ? 15 : 13,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {leader.teamName}
          </span>
        </div>
      </div>
      <span
        style={{
          color: podium ?? COLORS.foreground,
          fontSize: portrait ? 26 : 22,
          fontWeight: 700,
          marginLeft: 12,
        }}
      >
        {leader.displayValue}
      </span>
    </div>
  );
}

function leaderboardTable(
  leaders: Array<{
    rank: number;
    teamName: string;
    abbrev: string;
    displayValue: string;
    teamId: number;
  }>,
  portrait: boolean,
) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: `1px solid ${COLORS.border}`,
        borderRadius: 14,
        overflow: "hidden",
        background: COLORS.surface,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: portrait ? "10px 18px" : "8px 14px",
          borderBottom: `1px solid ${COLORS.border}`,
          color: COLORS.faint,
          fontSize: portrait ? 13 : 12,
          textTransform: "uppercase",
          letterSpacing: 1.5,
          background: COLORS.surfaceRaised,
        }}
      >
        <span>Team</span>
        <span>Value</span>
      </div>
      {leaders.map((leader) => leaderRow(leader, portrait))}
    </div>
  );
}

function featuredLeader(
  leader: { teamName: string; abbrev: string; displayValue: string; teamId: number },
  statTitle: string,
  accent: string,
  portrait: boolean,
) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: portrait ? 28 : 20,
        marginBottom: portrait ? 20 : 16,
        padding: portrait ? "20px 22px" : "16px 18px",
        borderRadius: 14,
        border: `1px solid ${accent}`,
        background: COLORS.surfaceRaised,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mlbTeamShareLogoUrl(leader.teamId)}
          alt=""
          width={portrait ? 64 : 52}
          height={portrait ? 64 : 52}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            style={{
              color: accent,
              fontSize: portrait ? 14 : 12,
              textTransform: "uppercase",
              letterSpacing: 2,
              fontWeight: 600,
            }}
          >
            #1 in {statTitle}
          </span>
          <span style={{ fontSize: portrait ? 32 : 26, fontWeight: 700 }}>{leader.teamName}</span>
        </div>
      </div>
      <span style={{ fontSize: portrait ? 40 : 32, fontWeight: 800, color: accent }}>{leader.displayValue}</span>
    </div>
  );
}

export function nerdStatShareElement(detail: NerdStatDetail, portrait: boolean) {
  const leaders = detail.stat.leaders.slice(0, portrait ? 5 : 5);
  const top = leaders[0];
  const accent = categoryAccent(detail.stat.category);

  return cardShell({ accent, portrait, children: (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: "82%" }}>
          <span
            style={{
              color: accent,
              fontSize: portrait ? 15 : 13,
              textTransform: "uppercase",
              letterSpacing: 2.5,
              fontWeight: 600,
            }}
          >
            {categoryLabel(detail.stat.category)} · {detail.season}
          </span>
          <span style={{ fontSize: portrait ? 46 : 40, fontWeight: 800, lineHeight: 1.08, letterSpacing: -0.5 }}>
            {detail.stat.title}
          </span>
          <span style={{ color: COLORS.muted, fontSize: portrait ? 20 : 17, lineHeight: 1.4 }}>
            {detail.stat.subtitle}
          </span>
          {detail.stat.leagueAverageDisplay && portrait && (
            <span style={{ color: COLORS.faint, fontSize: 16 }}>
              League avg: {detail.stat.leagueAverageDisplay}
            </span>
          )}
        </div>
        <span style={{ color: COLORS.faint, fontSize: portrait ? 16 : 14 }}>{SITE_NAME_SHORT}</span>
      </div>

      {portrait && top && featuredLeader(top, detail.stat.title, accent, portrait)}

      <div style={{ marginTop: portrait && !top ? 28 : portrait ? 0 : 24 }}>
        {leaderboardTable(leaders, portrait)}
      </div>

      {cardFooter(portrait)}
    </>
  ) });
}

export function teamNerdCardShareElement(
  card: TeamNerdCard,
  portrait: boolean,
  variant: TeamShareCardVariant = "full",
) {
  const highlights =
    variant === "highlights"
      ? pickEliteCursedTeamStats(card.stats)
      : [...card.stats].sort((a, b) => a.rank - b.rank).slice(0, portrait ? 8 : 6);

  const subtitle =
    variant === "highlights"
      ? "Elite & cursed chaos only"
      : `${card.season} nerd card`;

  return cardShell({ accent: COLORS.accent, portrait, children: (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mlbTeamShareLogoUrl(card.teamId)} alt="" width={portrait ? 80 : 64} height={portrait ? 80 : 64} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: portrait ? 42 : 34, fontWeight: 800, lineHeight: 1.05 }}>{card.teamName}</span>
          <span style={{ color: COLORS.muted, fontSize: portrait ? 18 : 15 }}>{subtitle}</span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginTop: portrait ? 28 : 22,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 14,
          overflow: "hidden",
          background: COLORS.surface,
        }}
      >
        {highlights.length === 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: portrait ? "36px 20px" : "28px 16px",
              color: COLORS.muted,
              fontSize: portrait ? 18 : 16,
            }}
          >
            No elite or cursed chaos yet.
          </div>
        ) : (
          highlights.map((stat, index) => {
            const elite = stat.rank <= 3;
            const cursed = stat.rank >= 28;
            const badge = nerdRankBadgeLabel(stat.rank, stat.sort);
            const podium = podiumColor(stat.rank);
            const isLast = index === highlights.length - 1;

            return (
              <div
                key={stat.statId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: portrait ? "14px 18px" : "11px 14px",
                  borderBottom: isLast ? "none" : `1px solid ${COLORS.border}`,
                  background: elite || cursed ? COLORS.surfaceRaised : COLORS.surface,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: portrait ? 19 : 16, fontWeight: 600, lineHeight: 1.2 }}>
                    {stat.title}
                  </span>
                  <span
                    style={{
                      color: elite ? COLORS.accent : cursed ? COLORS.cursed : COLORS.muted,
                      fontSize: 13,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      fontWeight: 600,
                    }}
                  >
                    #{stat.rank}
                    {badge ? ` · ${badge}` : ""}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: portrait ? 22 : 18,
                    fontWeight: 700,
                    color: podium ?? COLORS.foreground,
                    flexShrink: 0,
                  }}
                >
                  {stat.displayValue}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div
        style={{
          marginTop: portrait ? 24 : 20,
          display: "flex",
          justifyContent: "space-between",
          color: COLORS.faint,
          fontSize: portrait ? 16 : 14,
        }}
      >
        <span>Actually, your team is…</span>
        <span>{SITE_NAME}</span>
      </div>
    </>
  ) });
}

export async function renderNerdStatImage(detail: NerdStatDetail, portrait: boolean) {
  const leaders = detail.stat.leaders.slice(0, 5);
  const size = portrait
    ? { width: SHARE_CARD_WIDTH, height: shareCardHeight(leaders.length, true, Boolean(leaders[0])) }
    : OG_IMAGE_SIZE;
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
      : [...card.stats].sort((a, b) => a.rank - b.rank).slice(0, portrait ? 8 : 6);
  const rowCount = Math.max(highlights.length, 1);
  const size = portrait
    ? {
        width: SHARE_CARD_WIDTH,
        height: shareCardHeight(rowCount, true, false) + (variant === "full" ? 40 : 0),
      }
    : OG_IMAGE_SIZE;
  return new ImageResponse(teamNerdCardShareElement(card, portrait, variant), size);
}
