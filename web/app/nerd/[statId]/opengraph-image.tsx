import { getNerdStatDefinition } from "@/lib/mlb/nerdStats/definitions";
import { renderNerdStatImage } from "@/lib/mlb/nerdStats/renderShareImage";
import { loadNerdStatDetail } from "@/lib/mlb/nerdStats/store";

export const runtime = "nodejs";

interface NerdStatOgImageProps {
  params: Promise<{ statId: string }>;
}

export default async function Image({ params }: NerdStatOgImageProps) {
  const { statId } = await params;
  if (!getNerdStatDefinition(statId)) {
    return renderNerdStatImage(
      {
        season: new Date().getFullYear(),
        stat: {
          id: statId,
          title: "Nerd Standings",
          subtitle: "Team stat standings.",
          category: "vibes",
          sort: "desc",
          unit: "",
          leagueAverage: null,
          leagueAverageDisplay: null,
          leaders: [],
        },
        allTeams: [],
        notableEvents: [],
        generatedAt: new Date().toISOString(),
      },
      false,
    );
  }

  const season = new Date().getFullYear();
  const detail = loadNerdStatDetail(season, statId);
  if (!detail) {
    return renderNerdStatImage(
      {
        season,
        stat: {
          id: statId,
          title: getNerdStatDefinition(statId)!.title,
          subtitle: getNerdStatDefinition(statId)!.subtitle,
          category: getNerdStatDefinition(statId)!.category,
          sort: getNerdStatDefinition(statId)!.sort,
          unit: getNerdStatDefinition(statId)!.unit,
          leagueAverage: null,
          leagueAverageDisplay: null,
          leaders: [],
        },
        allTeams: [],
        notableEvents: [],
        generatedAt: new Date().toISOString(),
      },
      false,
    );
  }

  return renderNerdStatImage(detail, false);
}
