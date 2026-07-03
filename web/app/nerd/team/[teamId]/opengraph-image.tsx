import { renderTeamNerdCardImage } from "@/lib/mlb/nerdStats/renderShareImage";
import { loadTeamNerdCard } from "@/lib/mlb/nerdStats/store";
import { getTeamById } from "@/lib/mlb/teams";

export const runtime = "nodejs";

interface TeamNerdOgImageProps {
  params: Promise<{ teamId: string }>;
}

export default async function Image({ params }: TeamNerdOgImageProps) {
  const { teamId: teamIdParam } = await params;
  const teamId = Number.parseInt(teamIdParam, 10);
  const team = Number.isFinite(teamId) ? getTeamById(teamId) : undefined;
  const season = new Date().getFullYear();

  const fallback = {
    season,
    teamId: team?.id ?? 0,
    abbrev: team?.abbrev ?? "???",
    teamName: team?.name ?? "MLB Team",
    generatedAt: new Date().toISOString(),
    stats: [],
  };

  if (!team) {
    return renderTeamNerdCardImage(fallback, false);
  }

  const card = loadTeamNerdCard(season, teamId);
  return renderTeamNerdCardImage(card ?? fallback, false);
}
