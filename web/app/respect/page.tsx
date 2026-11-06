import type { Metadata } from "next";

import { RespectLeaderboard } from "@/components/features/RespectLeaderboard";
import report from "@/data/newstats/respect-2026.json";
import type { RespectReport } from "@/lib/mlb/respect";

const data = report as RespectReport;

export const metadata: Metadata = {
  title: `Respect+ ${data.season}: How Pitchers Change Their Plan for Each Hitter | Where's That Baseball`,
  description: `Respect+ measures how far pitchers move off their normal plan for each MLB hitter: fewer strikes, fewer pitches in the heart of the zone, fewer fastballs. Count, base state, platoon and pitcher tendencies are removed, along with what the hitter's chase and whiff rates explain.`,
};

export default function RespectPage() {
  return <RespectLeaderboard report={data} />;
}
