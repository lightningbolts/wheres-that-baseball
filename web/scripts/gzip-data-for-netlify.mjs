/**
 * Compress tracked season JSON under web/data so Netlify's single Next.js
 * server handler stays under the 250MB unzipped Lambda limit.
 *
 * Replaces each `*.json` with `*.json.gz` (and deletes the plain file).
 * Skips rebuild caches that are not deployed (games/ + nerd-stats-local/).
 */
import { createReadStream, createWriteStream, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

const dataRoot = join(process.cwd(), "data");

function shouldSkip(absPath) {
  const rel = relative(dataRoot, absPath).split(/[/\\]/);
  if (rel.includes("nerd-stats-local")) return true;
  // Per-game rebuild cache — not in git, but skip if present locally.
  if (rel[0] === "nerd-stats" && rel.includes("games")) return true;
  return false;
}

function collectJsonFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, name.name);
    if (shouldSkip(abs)) continue;
    if (name.isDirectory()) {
      collectJsonFiles(abs, out);
      continue;
    }
    if (name.isFile() && name.name.endsWith(".json") && !name.name.endsWith(".json.gz")) {
      out.push(abs);
    }
  }
  return out;
}

async function gzipFile(path) {
  const gzPath = `${path}.gz`;
  await pipeline(createReadStream(path), createGzip({ level: 9 }), createWriteStream(gzPath));
  unlinkSync(path);
}

const files = collectJsonFiles(dataRoot);
if (files.length === 0) {
  console.log("gzip-data-for-netlify: no JSON files under data/");
  process.exit(0);
}

let bytesIn = 0;
let bytesOut = 0;
const { statSync } = await import("node:fs");
for (const file of files) {
  bytesIn += statSync(file).size;
  await gzipFile(file);
  bytesOut += statSync(`${file}.gz`).size;
}

console.log(
  `gzip-data-for-netlify: compressed ${files.length} files ` +
    `(${(bytesIn / 1e6).toFixed(1)}MB → ${(bytesOut / 1e6).toFixed(1)}MB)`,
);
