#!/usr/bin/env node
/**
 * Fetches MLB ballpark dimensions and outfield wall geometry, then writes
 * JSON + per-park SVG files for the spray chart UI.
 *
 * Data sources:
 *   - MLB Stats API — official fieldInfo (LF/CF/RF distances, capacity, etc.)
 *   - GeomMLBStadiums — outfield/infield wall paths in MLBAM hc_x/hc_y coords
 *     (https://github.com/bdilday/GeomMLBStadiums)
 *
 * Usage:
 *   node scripts/fetch-ballparks.mjs
 *   npm run fetch-ballparks   (from web/)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
// Output dirs can be redirected (e.g. to diff a fresh fetch against the checked-in data).
const OUT_DIR = process.env.BALLPARKS_OUT_DIR ?? join(ROOT, "web", "data", "ballparks");
const SVG_DIR = process.env.BALLPARKS_SVG_DIR ?? join(ROOT, "web", "public", "ballparks");

const SEASON = 2026;
const MLB_TEAMS_URL = `https://statsapi.mlb.com/api/v1/teams?season=${SEASON}&sportId=1&hydrate=venue(fieldInfo)`;

/**
 * Past home parks kept alongside the current ones so older games still resolve to the
 * park they were played in. They don't become their club's default (`bySlug`) and don't
 * write an SVG over the current park's.
 */
const EXTRA_VENUES = [
  // The Rays' 2025 season at George M. Steinbrenner Field while Tropicana Field was repaired.
  { teamId: 139, season: 2025 },
];
/**
 * Where the Stats API's fieldInfo lags behind a fence change, the published figures win
 * (merged over the API's numbers).
 */
const FIELD_INFO_OVERRIDES = {
  // Camden Yards, 2025 Orioles ground rules (left-field wall moved back in): 373 LF, 400 CF.
  2: { left: 373, center: 400 },
  // Rogers Centre, 2023 outfield rebuild (Blue Jays / SI).
  14: { left: 368, leftCenter: 381, center: 400, rightCenter: 372, right: 359 },
  // Comerica Park, 2023 fences moved in (Tigers).
  2394: { leftLine: 342, center: 412 },
  // Kauffman Stadium, 2026 fences moved in (Royals release, 13 Jan 2026).
  7: { leftLine: 330, rightLine: 330 },
  // T-Mobile Park, 2013 fences moved in (Mariners; Clem's Baseball).
  680: { leftCenter: 378, center: 401, rightCenter: 381, rightLine: 326 },
  // Dodger Stadium alleys: 375 (Dodgers / Clem's Baseball; the API still has 385).
  22: { leftCenter: 375, rightCenter: 375 },
};
const teamSeasonUrl = (teamId, season) =>
  `https://statsapi.mlb.com/api/v1/teams/${teamId}?season=${season}&hydrate=venue(fieldInfo)`;
const STADIUM_PATHS_URL =
  "https://raw.githubusercontent.com/bdilday/GeomMLBStadiums/main/inst/extdata/mlb_stadia_paths.csv";

/** MLB team id → GeomMLBStadiums slug */
const TEAM_ID_TO_SLUG = {
  108: "angels",
  109: "diamondbacks",
  110: "orioles",
  111: "red_sox",
  112: "cubs",
  113: "reds",
  114: "guardians",
  115: "rockies",
  116: "tigers",
  117: "astros",
  118: "royals",
  119: "dodgers",
  120: "nationals",
  121: "mets",
  133: "athletics",
  134: "pirates",
  135: "padres",
  136: "mariners",
  137: "giants",
  138: "cardinals",
  139: "rays",
  140: "rangers",
  141: "blue_jays",
  142: "twins",
  143: "phillies",
  144: "braves",
  145: "white_sox",
  146: "marlins",
  147: "yankees",
  158: "brewers",
};

const SEGMENT_STYLES = {
  outfield_outer: { fill: "#243524", stroke: "#3d5c3d", strokeWidth: 0.5 },
  outfield_inner: { fill: "none", stroke: "#3d5c3d", strokeWidth: 0.25, opacity: 0.4 },
  infield_outer: { fill: "#2a3f2a", stroke: "#4a6b4a", strokeWidth: 0.4 },
  infield_inner: { fill: "none", stroke: "#4a6b4a", strokeWidth: 0.25, opacity: 0.5 },
  foul_lines: { fill: "none", stroke: "#4a6b4a", strokeWidth: 0.3, opacity: 0.6 },
  home_plate: { fill: "#e5e5e5", stroke: "#ffffff", strokeWidth: 0.3 },
};

const PLOT_SEGMENTS = [
  "outfield_outer",
  "outfield_inner",
  "infield_outer",
  "infield_inner",
  "foul_lines",
  "home_plate",
];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/** Minimal CSV parser for the stadium paths file. */
function parseCsv(text) {
  const rows = [];
  let i = 0;
  const len = text.length;

  function readField() {
    let value = "";
    if (text[i] === '"') {
      i++;
      while (i < len) {
        if (text[i] === '"') {
          i++;
          if (text[i] === '"') {
            value += '"';
            i++;
          } else break;
        } else {
          value += text[i++];
        }
      }
      if (text[i] === ",") i++;
      return value;
    }
    while (i < len && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") {
      value += text[i++];
    }
    if (text[i] === ",") i++;
    return value;
  }

  const headers = [];
  while (i < len && text[i] !== "\n" && text[i] !== "\r") {
    headers.push(readField());
  }
  if (text[i] === "\r") i++;
  if (text[i] === "\n") i++;

  while (i < len) {
    if (text[i] === "\r" || text[i] === "\n") {
      i++;
      continue;
    }
    const row = {};
    for (const h of headers) row[h] = readField();
    rows.push(row);
    while (i < len && text[i] !== "\n" && text[i] !== "\r") i++;
    if (text[i] === "\r") i++;
    if (text[i] === "\n") i++;
  }
  return rows;
}

function groupPaths(csvRows) {
  /** @type {Record<string, Record<string, {x:number,y:number}[]>>} */
  const byTeam = {};
  for (const row of csvRows) {
    const team = row.team;
    const segment = row.segment;
    if (team === "generic") continue;
    const x = Number(row.x);
    const y = Number(row.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    byTeam[team] ??= {};
    byTeam[team][segment] ??= [];
    byTeam[team][segment].push({ x, y });
  }
  return byTeam;
}

function computeBounds(segments) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const points of Object.values(segments)) {
    for (const { x, y } of points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, maxX, minY, maxY };
}

function buildTransform(bounds, padding = 3) {
  const { minX, maxX, minY, maxY } = bounds;
  const w = maxX - minX;
  const h = maxY - minY;
  const inner = 100 - padding * 2;
  const scale = Math.min(inner / w, inner / h);
  const offsetX = padding + (inner - w * scale) / 2;
  const offsetY = padding + (inner - h * scale) / 2;
  return { minX, maxX, minY, maxY, padding, scale, offsetX, offsetY };
}

function toSvgCoord(x, y, t) {
  return {
    x: t.offsetX + (x - t.minX) * t.scale,
    y: t.offsetY + (y - t.minY) * t.scale,
  };
}

function pointsToPath(points, transform) {
  if (points.length === 0) return "";
  const first = toSvgCoord(points[0].x, points[0].y, transform);
  const rest = points
    .slice(1)
    .map((p) => {
      const { x, y } = toSvgCoord(p.x, p.y, transform);
      return `L ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} ${rest}`;
}

function polygonToPath(points, transform) {
  const path = pointsToPath(points, transform);
  return path ? `${path} Z` : "";
}

function buildParkSvg(slug, segments, transform, fieldInfo) {
  const paths = [];
  for (const segment of PLOT_SEGMENTS) {
    const points = segments[segment];
    if (!points?.length) continue;
    const style = SEGMENT_STYLES[segment] ?? SEGMENT_STYLES.outfield_outer;
    const d =
      segment === "outfield_outer" || segment === "infield_outer" || segment === "home_plate"
        ? polygonToPath(points, transform)
        : pointsToPath(points, transform);
    if (!d) continue;
    const attrs = [
      `d="${d}"`,
      `fill="${style.fill}"`,
      `stroke="${style.stroke}"`,
      `stroke-width="${style.strokeWidth}"`,
    ];
    if (style.opacity != null) attrs.push(`opacity="${style.opacity}"`);
    paths.push(`    <path ${attrs.join(" ")} data-segment="${segment}" />`);
  }

  const dims = fieldInfo
    ? `LF ${fieldInfo.leftLine}' · CF ${fieldInfo.center}' · RF ${fieldInfo.rightLine}'`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="${slug} ballpark">
  <title>${slug}</title>
  <rect width="100" height="100" fill="#1a2e1a" />
${paths.join("\n")}
  <text x="50" y="98" text-anchor="middle" font-size="3" fill="#737373" font-family="monospace">${dims}</text>
</svg>
`;
}

async function main() {
  console.log("Fetching MLB teams + fieldInfo…");
  const teamsData = await fetchJson(MLB_TEAMS_URL);

  console.log("Downloading stadium wall paths (GeomMLBStadiums)…");
  const csvText = await fetchText(STADIUM_PATHS_URL);
  const csvRows = parseCsv(csvText);
  const pathsByTeam = groupPaths(csvRows);

  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(SVG_DIR, { recursive: true });

  /** @type {Record<string, object>} */
  const parks = {};
  /** @type {Record<string, number>} */
  const bySlug = {};

  /** Adds one club's venue; `primary` = its current home (sets bySlug, writes the SVG). */
  async function addPark(team, primary) {
    const slug = TEAM_ID_TO_SLUG[team.id];
    if (!slug) {
      console.warn(`  skip team id ${team.id} (${team.name}) — no stadium slug mapping`);
      return;
    }

    const venue = team.venue;
    const fieldInfo = { ...(venue.fieldInfo ?? {}), ...(FIELD_INFO_OVERRIDES[venue.id] ?? {}) };
    const segments = pathsByTeam[slug];
    if (!segments) {
      console.warn(`  skip ${slug} — no path data in CSV`);
      return;
    }

    const bounds = computeBounds(segments);
    const transform = buildTransform(bounds);
    const svgSegments = {};
    for (const segment of PLOT_SEGMENTS) {
      const points = segments[segment];
      if (!points?.length) continue;
      svgSegments[segment] =
        segment === "outfield_outer" || segment === "infield_outer" || segment === "home_plate"
          ? polygonToPath(points, transform)
          : pointsToPath(points, transform);
    }

    const venueId = venue.id;
    if (!primary && parks[String(venueId)]) {
      console.log(`  = ${venue.name} is already a current park`);
      return;
    }
    const park = {
      venueId,
      venueName: venue.name,
      teamId: team.id,
      teamName: team.name,
      teamAbbrev: team.abbreviation,
      stadiumSlug: slug,
      fieldInfo: {
        capacity: fieldInfo.capacity ?? null,
        turfType: fieldInfo.turfType ?? null,
        roofType: fieldInfo.roofType ?? null,
        leftLine: fieldInfo.leftLine ?? null,
        left: fieldInfo.left ?? null,
        leftCenter: fieldInfo.leftCenter ?? null,
        center: fieldInfo.center ?? null,
        rightCenter: fieldInfo.rightCenter ?? null,
        right: fieldInfo.right ?? null,
        rightLine: fieldInfo.rightLine ?? null,
      },
      bounds,
      transform,
      segments: svgSegments,
      svgPath: `/ballparks/${slug}.svg`,
    };

    parks[String(venueId)] = park;
    if (!primary) {
      console.log(`  + ${venue.name} (${team.abbreviation}, past home park)`);
      return;
    }
    bySlug[slug] = venueId;

    const svg = buildParkSvg(slug, segments, transform, park.fieldInfo);
    await writeFile(join(SVG_DIR, `${slug}.svg`), svg, "utf8");
    console.log(`  ✓ ${venue.name} (${team.abbreviation}) → ${slug}.svg`);
  }

  for (const team of teamsData.teams) await addPark(team, true);

  for (const extra of EXTRA_VENUES) {
    const data = await fetchJson(teamSeasonUrl(extra.teamId, extra.season));
    const team = data.teams?.[0];
    if (team) await addPark(team, false);
    else console.warn(`  skip extra venue for team ${extra.teamId} (${extra.season}) — not found`);
  }

  const index = {
    generatedAt: new Date().toISOString(),
    coordinateSystem:
      "MLBAM hc_x/hc_y — same as coordX/coordY in live feed hitData. Home plate ≈ (125, 200); y decreases toward outfield.",
    sources: {
      fieldInfo: MLB_TEAMS_URL,
      extraVenues: EXTRA_VENUES.map((e) => teamSeasonUrl(e.teamId, e.season)),
      wallPaths: STADIUM_PATHS_URL,
    },
    parks,
    bySlug,
  };

  await writeFile(join(OUT_DIR, "index.json"), JSON.stringify(index, null, 2), "utf8");
  console.log(`\nWrote ${Object.keys(parks).length} parks to ${join(OUT_DIR, "index.json")}`);
  console.log(`Wrote SVG files to ${SVG_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
