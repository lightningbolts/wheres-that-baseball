import type { VenueHit, SprayPreviewHit } from "@/lib/mlb/ballparkHits";
import type { BallparkHitsDetail } from "@/lib/mlb/ballparkHits";

export function toChartHit(hit: VenueHit): SprayPreviewHit {
  return {
    hitKey: hit.hitKey,
    atBatIndex: hit.atBatIndex,
    event: hit.event,
    hit: hit.hit,
    color: hit.color,
    batterName: hit.batterName,
    inning: hit.inning,
    halfInning: hit.halfInning,
    awayScore: hit.awayScore,
    homeScore: hit.homeScore,
    gameDate: hit.gameDate,
    awayAbbrev: hit.awayAbbrev,
    homeAbbrev: hit.homeAbbrev,
  };
}

export function stripHitDetail(hit: VenueHit): Omit<VenueHit, "detail"> {
  const { detail: _detail, ...rest } = hit;
  return rest;
}

export function paginateBallparkDetail(
  detail: BallparkHitsDetail,
  options: {
    limit?: number;
    offset?: number;
    includeDetail?: boolean;
    includeChartHits?: boolean;
  } = {},
): BallparkHitsDetail {
  const { limit = 0, offset = 0, includeDetail = false, includeChartHits = true } = options;
  const allHits = detail.hits;
  const hitsTotal = allHits.length;

  const chartHits = includeChartHits ? allHits.map(toChartHit) : undefined;

  let hits: VenueHit[];
  if (limit > 0) {
    const slice = allHits.slice(offset, offset + limit);
    hits = includeDetail ? slice : slice.map((hit) => ({ ...stripHitDetail(hit) } as VenueHit));
  } else {
    hits = includeDetail
      ? allHits
      : allHits.map((hit) => ({ ...stripHitDetail(hit) } as VenueHit));
  }

  return {
    ...detail,
    hits,
    chartHits,
    hitsTotal,
    hasMore: limit > 0 ? offset + hits.length < hitsTotal : false,
  };
}
