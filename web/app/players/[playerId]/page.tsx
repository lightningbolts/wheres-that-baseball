import { PlayerDetailView } from "@/components/features/PlayerDetailView";

type PageProps = {
  params: Promise<{ playerId: string }>;
};

export default async function PlayerPage({ params }: PageProps) {
  const { playerId: raw } = await params;
  const playerId = Number.parseInt(raw, 10);

  if (!Number.isFinite(playerId) || playerId <= 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted">
        Invalid player
      </div>
    );
  }

  return <PlayerDetailView playerId={playerId} />;
}
