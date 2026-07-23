import type { HitData, PlayByPlayEntry, PlayDetail } from "@/types/mlb-live";

export const HIT_EVENTS = new Set(["Single", "Double", "Triple", "Home Run"]);

export type HitType = "Single" | "Double" | "Triple" | "Home Run";

export type BipKind = "hit" | "out" | "sac" | "error" | "other";

export type BipFamilyFilter = "all" | BipKind;

export const HIT_TYPE_COLORS: Record<HitType, string> = {
  Single: "#38bdf8",
  Double: "#4ade80",
  Triple: "#fbbf24",
  "Home Run": "#f87171",
};

export const HIT_TYPE_LABELS: Record<HitType, string> = {
  Single: "1B",
  Double: "2B",
  Triple: "3B",
  "Home Run": "HR",
};

export const BIP_KIND_COLORS: Record<BipKind, string> = {
  hit: "#38bdf8",
  out: "#94a3b8",
  sac: "#a78bfa",
  error: "#fb923c",
  other: "#64748b",
};

export const BIP_KIND_LABELS: Record<BipKind, string> = {
  hit: "Hits",
  out: "Outs",
  sac: "Sacrifice",
  error: "Error",
  other: "Other",
};

export const BIP_FAMILY_FILTER_OPTIONS: Array<{ value: BipFamilyFilter; label: string }> = [
  { value: "all", label: "All BIP" },
  { value: "hit", label: "Hits" },
  { value: "out", label: "Outs" },
  { value: "sac", label: "Sacrifice" },
  { value: "error", label: "Error" },
  { value: "other", label: "Other" },
];

const SAC_EVENTS = new Set(["Sac Fly", "Sacrifice Fly", "Sac Bunt", "Sacrifice Bunt"]);
const ERROR_EVENTS = new Set([
  "Error",
  "Field Error",
  "Fielders Choice",
  "Fielders Choice Out",
]);

export interface GameHit {
  atBatIndex: number;
  batterId: number;
  batterName: string;
  event: string;
  bipKind: BipKind;
  inning: number;
  halfInning: string;
  awayScore: number;
  homeScore: number;
  hit: HitData;
  color: string;
  /** Terminal pitch GUID for Savant clip lookup. */
  playId?: string;
  /** Play detail — omitted from on-disk season JSON; loaded on demand via hitKey. */
  detail?: PlayDetail;
}

export type SprayChartHit = Pick<GameHit, "atBatIndex" | "event" | "hit" | "color">;

export interface GameHitStats {
  total: number;
  singles: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  outs: number;
  sac: number;
  errors: number;
  other: number;
  avgExitVelo: number | null;
  avgLaunchAngle: number | null;
  maxExitVelo: number | null;
  maxDistance: number | null;
}

export function isHitEvent(event: string): event is HitType {
  return HIT_EVENTS.has(event);
}

export function classifyBipKind(event: string): BipKind {
  if (isHitEvent(event)) return "hit";
  if (SAC_EVENTS.has(event)) return "sac";
  if (ERROR_EVENTS.has(event) || /error/i.test(event)) return "error";
  if (
    /out/i.test(event) ||
    event === "Double Play" ||
    event === "Triple Play" ||
    event === "Grounded Into DP" ||
    event === "Flyout" ||
    event === "Lineout" ||
    event === "Pop Out" ||
    event === "Groundout" ||
    event === "Forceout" ||
    event === "Field Out"
  ) {
    return "out";
  }
  return "other";
}

export function bipEventColor(event: string, bipKind?: BipKind): string {
  if (isHitEvent(event)) return HIT_TYPE_COLORS[event];
  return BIP_KIND_COLORS[bipKind ?? classifyBipKind(event)];
}

export function bipEventLabel(event: string): string {
  if (isHitEvent(event)) return HIT_TYPE_LABELS[event];
  if (event.length <= 12) return event;
  return event.replace(/\s+/g, " ").slice(0, 14);
}

function hasValidSprayCoords(hit: HitData): boolean {
  return !(hit.coordX === 0 && hit.coordY === 0 && hit.totalDistance === 0);
}

/** All balls in play with spray coordinates (hits, outs, sac, errors, etc.). */
export function extractGameHits(plays: PlayByPlayEntry[]): GameHit[] {
  const hits: GameHit[] = [];

  for (const play of plays) {
    const hit = play.detail.hit;
    if (!hit || !hasValidSprayCoords(hit)) continue;

    const bipKind = classifyBipKind(play.event);
    hits.push({
      atBatIndex: play.atBatIndex,
      batterId: play.batterId ?? play.detail.batterId ?? 0,
      batterName: play.batterName,
      event: play.event,
      bipKind,
      inning: play.inning,
      halfInning: play.halfInning,
      awayScore: play.awayScore,
      homeScore: play.homeScore,
      hit,
      color: bipEventColor(play.event, bipKind),
      playId: play.playId ?? play.detail.playId,
      detail: play.detail,
    });
  }

  return hits;
}

/** Official hits only (1B/2B/3B/HR) — used when UI filter defaults to hits. */
export function extractOfficialHits(plays: PlayByPlayEntry[]): GameHit[] {
  return extractGameHits(plays).filter((h) => h.bipKind === "hit");
}

export function filterBipByFamily<T extends { bipKind?: BipKind; event: string }>(
  hits: T[],
  family: BipFamilyFilter,
): T[] {
  if (family === "all") return hits;
  return hits.filter((h) => (h.bipKind ?? classifyBipKind(h.event)) === family);
}

export function filterBipByHitType<T extends { event: string }>(
  hits: T[],
  hitType: HitType | "all",
): T[] {
  if (hitType === "all") return hits;
  return hits.filter((h) => h.event === hitType);
}

export function computeGameHitStats(
  hits: Array<Pick<GameHit, "event" | "hit"> & { bipKind?: BipKind }>,
): GameHitStats {
  const singles = hits.filter((h) => h.event === "Single").length;
  const doubles = hits.filter((h) => h.event === "Double").length;
  const triples = hits.filter((h) => h.event === "Triple").length;
  const homeRuns = hits.filter((h) => h.event === "Home Run").length;

  let outs = 0;
  let sac = 0;
  let errors = 0;
  let other = 0;
  for (const h of hits) {
    const kind = h.bipKind ?? classifyBipKind(h.event);
    if (kind === "out") outs += 1;
    else if (kind === "sac") sac += 1;
    else if (kind === "error") errors += 1;
    else if (kind === "other") other += 1;
  }

  const exitVelos = hits.map((h) => h.hit.launchSpeed).filter((v) => v > 0);
  const launchAngles = hits.map((h) => h.hit.launchAngle).filter((v) => Number.isFinite(v));
  const distances = hits.map((h) => h.hit.totalDistance).filter((d) => d > 0);

  const avg = (values: number[]) =>
    values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

  return {
    total: hits.length,
    singles,
    doubles,
    triples,
    homeRuns,
    outs,
    sac,
    errors,
    other,
    avgExitVelo: avg(exitVelos),
    avgLaunchAngle: avg(launchAngles),
    maxExitVelo: exitVelos.length > 0 ? Math.max(...exitVelos) : null,
    maxDistance: distances.length > 0 ? Math.max(...distances) : null,
  };
}

/** Official hits (1B/2B/3B/HR) — not total balls in play. */
export function officialHitCount(stats: Pick<GameHitStats, "singles" | "doubles" | "triples" | "homeRuns">): number {
  return stats.singles + stats.doubles + stats.triples + stats.homeRuns;
}
