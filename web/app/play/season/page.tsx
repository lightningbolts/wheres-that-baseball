import type { Metadata } from "next";
import { SeasonApp } from "@/components/game/franchise/SeasonApp";

export const metadata: Metadata = {
  title: "Play Ball: 2027 Season",
  description: "Manage a club through a full simulated 2027 MLB season: lineups, trades, free agency, finances and the postseason, with any game playable in 3D.",
};

export default function SeasonPage() {
  return <SeasonApp />;
}
