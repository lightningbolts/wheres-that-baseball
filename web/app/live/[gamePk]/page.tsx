import { notFound } from "next/navigation";

import { LiveGamePageClient } from "@/components/features/LiveDashboard";

interface LiveGamePageProps {
  params: Promise<{ gamePk: string }>;
}

export default async function LiveGamePage({ params }: LiveGamePageProps) {
  const { gamePk: gamePkParam } = await params;
  const gamePk = Number(gamePkParam);

  if (!Number.isFinite(gamePk) || gamePk <= 0) {
    notFound();
  }

  return <LiveGamePageClient gamePk={gamePk} />;
}
