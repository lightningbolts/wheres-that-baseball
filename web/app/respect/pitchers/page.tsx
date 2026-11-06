import type { Metadata } from "next";

import { AttackLeaderboard } from "@/components/features/AttackLeaderboard";
import report from "@/data/newstats/attack-2026.json";
import type { AttackReport } from "@/lib/mlb/respect";

const data = report as AttackReport;

export const metadata: Metadata = {
  title: `Attack+ ${data.season}: Which MLB Pitchers Challenge Hitters | Where's That Baseball`,
  description: `Attack+ measures how often each MLB pitcher throws strikes and pitches in the heart of the zone compared with what the count, base state, score, ballpark and the specific hitter would predict. The pitcher-side mirror of Respect+.`,
};

export default function AttackPage() {
  return <AttackLeaderboard report={data} />;
}
