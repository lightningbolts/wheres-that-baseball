import type { Metadata } from "next";
import { PlayBall } from "@/components/game/PlayBall";

export const metadata: Metadata = {
  title: "Play Ball",
  description: "A nine-inning 3D baseball game with real rosters and real ball physics.",
};

export default function PlayPage() {
  return <PlayBall />;
}
