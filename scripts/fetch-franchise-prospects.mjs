#!/usr/bin/env node
/**
 * Fetches every club's MLB Pipeline top-30 prospect list and writes it as compact JSON for
 * Play Ball franchise mode (web/lib/game/franchise/data/prospects.json).
 *
 * Each prospect keeps his MLBAM id, rank, position, ETA, birth date, handedness, current
 * level and the Pipeline 20-80 scouting grades (tool grades plus Overall), which the
 * franchise turns into current and potential ratings.
 *
 * Usage:
 *   node scripts/fetch-franchise-prospects.mjs
 *   npm run fetch-franchise-prospects   (from web/)
 */

import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const YEAR = Number(process.argv[2] ?? 2026);

/** MLBAM club id → Pipeline URL slug. */
const SLUGS = {
  109: "dbacks", 144: "braves", 110: "orioles", 111: "redsox", 112: "cubs", 145: "whitesox", 113: "reds",
  114: "guardians", 115: "rockies", 116: "tigers", 117: "astros", 118: "royals", 108: "angels", 119: "dodgers",
  146: "marlins", 158: "brewers", 142: "twins", 121: "mets", 147: "yankees", 133: "athletics", 143: "phillies",
  134: "pirates", 135: "padres", 137: "giants", 136: "mariners", 138: "cardinals", 139: "rays", 140: "rangers",
  141: "bluejays", 120: "nationals",
};

/** Stats API sport id → level label. */
const LEVELS = { 1: "MLB", 11: "AAA", 12: "AA", 13: "A+", 14: "A", 16: "R", 17: "R" };

const unescape = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#x3D;/g, "=").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function parseState(html) {
  const m = html.match(/data-init-state="([^"]*getPlayerRankingsFromSelection[^"]*)"/);
  if (!m) return null;
  return JSON.parse(unescape(m[1]));
}

function findKey(o, key) {
  if (!o || typeof o !== "object") return undefined;
  if (key in o) return o[key];
  for (const v of Object.values(o)) {
    const r = findKey(v, key);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** "Fastball: 60 | Slider: 55 | Control: 50 | Overall: 55" → { fastball: 60, slider: 55, ... } */
function parseGrades(bio) {
  const text = bio.replace(/<[^>]+>/g, " ");
  const m = text.match(/Scouting grades\s*:?\s*:?\s*([^\n]*?Overall\s*:\s*\d+)/i);
  if (!m) return null;
  const out = {};
  for (const part of m[1].split("|")) {
    const g = part.match(/([A-Za-z][A-Za-z /-]*?)\s*:\s*(\d+)/);
    if (g) out[g[1].trim().toLowerCase().replace(/[^a-z]+/g, "_")] = Number(g[2]);
  }
  return out;
}

async function fetchTeam(teamId, slug) {
  const res = await fetch(`https://www.mlb.com/prospects/${slug}`, { headers: { "User-Agent": "Mozilla/5.0 (franchise-data)" } });
  if (!res.ok) throw new Error(`${slug}: HTTP ${res.status}`);
  const state = parseState(await res.text());
  if (!state) throw new Error(`${slug}: no rankings state`);
  const root = findKey(state, "ROOT_QUERY");
  const key = Object.keys(root).find((k) => k.startsWith("getPlayerRankingsFromSelection"));
  const list = root[key] ?? [];
  return list.map((r) => {
    const e = r.playerEntity;
    const ref = e.player.__ref;
    const person = findKey(state, ref) ?? {};
    const team = person.activeRoster ? findKey(state, person.activeRoster.__ref) : undefined;
    const sport = team?.sport ? Number(String(team.sport.__ref).split(":")[1]) : undefined;
    const bio = (e.prospectBio ?? []).map((b) => b.contentText).join("\n");
    const grades = parseGrades(bio) ?? {};
    const { overall, ...tools } = grades;
    return {
      rank: r.rank,
      id: Number(ref.split(":")[1]),
      name: `${person.useName ?? ""} ${person.useLastName ?? ""}`.trim(),
      pos: e.position,
      eta: Number(e.eta) || undefined,
      born: person.birthDate,
      bats: person.batSideCode,
      throws: person.pitchHandCode,
      level: sport ? LEVELS[sport] ?? "R" : undefined,
      ovr: overall,
      tools,
      draft: person.draftYear,
    };
  });
}

const out = { year: YEAR, source: "MLB Pipeline", fetched: new Date().toISOString().slice(0, 10), teams: {} };
for (const [id, slug] of Object.entries(SLUGS)) {
  const list = await fetchTeam(Number(id), slug);
  if (list.length < 25) throw new Error(`${slug}: only ${list.length} prospects`);
  const graded = list.filter((p) => p.ovr).length;
  console.log(`${slug.padEnd(10)} ${list.length} prospects, ${graded} graded — #1 ${list[0].name}`);
  out.teams[id] = list;
}

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "lib", "game", "franchise", "data", "prospects.json");
await writeFile(file, JSON.stringify(out) + "\n");
console.log(`wrote ${file}`);
