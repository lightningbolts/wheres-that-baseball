"use client";

import { useState } from "react";

import { useTheme } from "@/components/providers/ThemeProvider";
import { mlbTeamLogoUrl, type TeamLogoTheme } from "@/lib/mlb/teamAssets";
import { getTeamByAbbrev, getTeamById } from "@/lib/mlb/teams";
import { cn } from "@/lib/utils";

interface TeamLogoProps {
  teamId?: number | null;
  abbrev?: string | null;
  size?: number;
  className?: string;
  title?: string;
  /** Force logo variant for the surface behind the mark (e.g. scorebug overlay on dark glass). */
  surface?: TeamLogoTheme;
}

export function TeamLogo({
  teamId,
  abbrev,
  size = 28,
  className,
  title,
  surface,
}: TeamLogoProps) {
  const { theme } = useTheme();
  const logoTheme: TeamLogoTheme = surface ?? theme;
  const team =
    (teamId != null ? getTeamById(teamId) : undefined) ??
    (abbrev ? getTeamByAbbrev(abbrev) : undefined);
  const [failed, setFailed] = useState(false);

  if (!team || failed) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded bg-surface-elevated font-mono text-[10px] font-semibold text-muted",
          className,
        )}
        style={{ width: size, height: size }}
        title={title ?? team?.abbrev ?? abbrev ?? undefined}
        aria-hidden={!team && !abbrev}
      >
        {(team?.abbrev ?? abbrev ?? "?").slice(0, 3)}
      </span>
    );
  }

  return (
    <img
      key={`${team.id}-${logoTheme}`}
      src={mlbTeamLogoUrl(team.id, logoTheme)}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
      style={{ width: size, height: size }}
      title={title ?? team.name}
      onError={() => setFailed(true)}
    />
  );
}

/** Logo immediately followed by the team abbreviation. */
export function TeamLogoWithAbbrev({
  teamId,
  abbrev,
  size = 20,
  className,
}: {
  teamId?: number | null;
  abbrev: string;
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <TeamLogo teamId={teamId} abbrev={abbrev} size={size} />
      <span className="font-medium">{abbrev}</span>
    </span>
  );
}
