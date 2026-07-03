import {
  formatDegrees,
  formatMph,
} from "@/lib/mlb/nerdStats/format";
import type { NerdStatDefinition } from "@/lib/mlb/nerdStats/statDefinitions";
import { TRACKED_PITCH_TYPES } from "@/lib/mlb/nerdStats/pitchTypeStats";
import type { TeamNerdCounters } from "@/lib/mlb/nerdStats/types";

const MIN_PITCHES_PER_TYPE = 100;

function pitchTypeAcc(counters: TeamNerdCounters, code: string) {
  return counters.pitchTypesThrown[code];
}

function avgPitchMetric(
  counters: TeamNerdCounters,
  code: string,
  field: "velocitySum" | "spinSum" | "hBreakSum" | "vBreakSum",
): number | null {
  const acc = pitchTypeAcc(counters, code);
  if (!acc || acc.count < MIN_PITCHES_PER_TYPE) return null;
  if (field === "spinSum" && acc.spinSum <= 0) return null;
  return acc[field] / acc.count;
}

export const PITCH_TYPE_NERD_STAT_DEFINITIONS: NerdStatDefinition[] = TRACKED_PITCH_TYPES.flatMap(
  ({ code, label }) => {
    const codeLower = code.toLowerCase();
    return [
      {
        id: `${codeLower}-avg-velocity`,
        title: `${label} Velo`,
        subtitle: `Average ${label.toLowerCase()} velocity thrown.`,
        category: "defense" as const,
        sort: "desc" as const,
        unit: "mph",
        formula: `sum of ${label} velocities ÷ ${label} count (min ${MIN_PITCHES_PER_TYPE} pitches)`,
        minGames: 20,
        compute: (c) => avgPitchMetric(c, code, "velocitySum"),
        formatValue: formatMph,
      },
      {
        id: `${codeLower}-avg-spin`,
        title: `${label} Spin`,
        subtitle: `Average ${label.toLowerCase()} spin rate.`,
        category: "defense" as const,
        sort: "desc" as const,
        unit: "rpm",
        formula: `sum of ${label} spin rates ÷ ${label} count (min ${MIN_PITCHES_PER_TYPE} pitches)`,
        minGames: 20,
        compute: (c) => avgPitchMetric(c, code, "spinSum"),
        formatValue: (v) => `${Math.round(v)} rpm`,
      },
      {
        id: `${codeLower}-avg-h-break`,
        title: `${label} Horizontal Break`,
        subtitle: `Average ${label.toLowerCase()} horizontal break.`,
        category: "defense" as const,
        sort: "desc" as const,
        unit: "in",
        formula: `sum of ${label} horizontal break ÷ ${label} count (min ${MIN_PITCHES_PER_TYPE} pitches)`,
        minGames: 20,
        compute: (c) => avgPitchMetric(c, code, "hBreakSum"),
        formatValue: (v) => `${v.toFixed(1)} in`,
      },
      {
        id: `${codeLower}-avg-v-break`,
        title: `${label} Induced Vert Break`,
        subtitle: `Average ${label.toLowerCase()} induced vertical break.`,
        category: "defense" as const,
        sort: "desc" as const,
        unit: "in",
        formula: `sum of ${label} induced vertical break ÷ ${label} count (min ${MIN_PITCHES_PER_TYPE} pitches)`,
        minGames: 20,
        compute: (c) => avgPitchMetric(c, code, "vBreakSum"),
        formatValue: (v) => `${v.toFixed(1)} in`,
      },
    ];
  },
);

export const CONTACT_QUALITY_NERD_STAT_DEFINITIONS: NerdStatDefinition[] = [
  {
    id: "avg-exit-velo",
    title: "Exit Velo Merchants",
    subtitle: "Average exit velocity on batted balls.",
    category: "contact",
    sort: "desc",
    unit: "mph",
    formula: "sum of exit velocities ÷ batted ball events",
    minGames: 20,
    compute: (c) => (c.exitVeloCount > 0 ? c.exitVeloSum / c.exitVeloCount : null),
    formatValue: formatMph,
  },
  {
    id: "avg-launch-angle",
    title: "Launch Angle Lounge",
    subtitle: "Average launch angle on batted balls.",
    category: "contact",
    sort: "desc",
    unit: "°",
    formula: "sum of launch angles ÷ batted ball events",
    minGames: 20,
    compute: (c) => (c.launchAngleCount > 0 ? c.launchAngleSum / c.launchAngleCount : null),
    formatValue: formatDegrees,
  },
  {
    id: "avg-bat-speed",
    title: "Bat Speed Brigade",
    subtitle: "Average bat speed on tracked swings.",
    category: "contact",
    sort: "desc",
    unit: "mph",
    formula: "sum of bat speeds ÷ tracked swings (Baseball Savant bat tracking)",
    minGames: 20,
    compute: (c) => (c.batSpeedCount > 0 ? c.batSpeedSum / c.batSpeedCount : null),
    formatValue: formatMph,
  },
];
