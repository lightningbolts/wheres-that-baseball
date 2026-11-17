import { notFound } from "next/navigation";
import { PlayerLab } from "./Lab";

export const metadata = { title: "Play Ball · player lab" };

/** Dev-only turntable for the Play Ball character models. */
export default function PlayerLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PlayerLab />;
}
