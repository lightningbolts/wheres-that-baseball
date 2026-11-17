import type { Metadata } from "next";
import { SharedGame } from "@/components/game/franchise/SharedGame";

export const metadata: Metadata = {
  title: "Box Score · Play Ball",
  description: "Box score and play-by-play from a Play Ball franchise game.",
};

export default function SharedGamePage() {
  return <SharedGame />;
}
