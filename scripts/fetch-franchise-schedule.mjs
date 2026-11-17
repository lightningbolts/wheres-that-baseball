#!/usr/bin/env node
/**
 * Fetches a published MLB regular-season schedule from the MLB Stats API and writes
 * it as compact JSON for Play Ball franchise mode
 * (web/lib/game/franchise/data/schedule-<season>.json).
 *
 * Each game is [day, awayId, homeId] or [day, awayId, homeId, site] where `day` counts
 * from Opening Day (day 0) and `site` names a neutral/alternate venue.
 *
 * Usage:
 *   node scripts/fetch-franchise-schedule.mjs 2027
 *   npm run fetch-franchise-schedule -- 2027   (from web/)
 */

import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const season = Number(process.argv[2] ?? 2027);
if (!Number.isInteger(season)) throw new Error("usage: fetch-franchise-schedule.mjs <season>");

const url =
  `https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=${season}&gameType=R` +
  "&fields=dates,games,gamePk,officialDate,gameNumber,teams,away,home,team,id,venue,name";
const res = await fetch(url);
if (!res.ok) throw new Error(`MLB schedule ${res.status}`);
const data = await res.json();

const games = (data.dates ?? []).flatMap((d) => d.games ?? []);
if (games.length !== 2430) throw new Error(`expected 2430 games, got ${games.length}`);

// Each club's usual home venue = the one it hosts most games in.
const venues = new Map();
for (const g of games) {
  const h = g.teams.home.team.id;
  const c = venues.get(h) ?? new Map();
  c.set(g.venue.name, (c.get(g.venue.name) ?? 0) + 1);
  venues.set(h, c);
}
const homePark = new Map([...venues].map(([t, c]) => [t, [...c].sort((a, b) => b[1] - a[1])[0][0]]));

const opening = games.map((g) => g.officialDate).sort()[0];
const t0 = Date.parse(`${opening}T00:00:00Z`);
const dayOf = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - t0) / 86_400_000);

games.sort((a, b) => a.officialDate.localeCompare(b.officialDate) || a.gameNumber - b.gameNumber || a.gamePk - b.gamePk);
const rows = games.map((g) => {
  const home = g.teams.home.team.id;
  const row = [dayOf(g.officialDate), g.teams.away.team.id, home];
  if (g.venue.name !== homePark.get(home)) row.push(g.venue.name);
  return row;
});

// All-Star break = the longest run of days with no games in July.
const played = new Set(rows.map((r) => r[0]));
const julyStart = dayOf(`${season}-07-01`);
let asb = [0, -1];
for (let d = julyStart; d < julyStart + 31; d += 1) {
  if (played.has(d)) continue;
  let e = d;
  while (!played.has(e + 1) && e + 1 < julyStart + 31) e += 1;
  if (e - d > asb[1] - asb[0]) asb = [d, e];
  d = e;
}

const out = { season, opening, asb, source: "MLB Stats API", fetched: new Date().toISOString().slice(0, 10), games: rows };
const file = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "lib", "game", "franchise", "data", `schedule-${season}.json`);
await writeFile(file, `{"season":${season},"opening":"${opening}","asb":${JSON.stringify(asb)},"source":"${out.source}","fetched":"${out.fetched}","games":[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]}\n`);
console.log(`wrote ${rows.length} games (${opening} → day ${Math.max(...played)}, ASB days ${asb.join("–")}) to ${file}`);
