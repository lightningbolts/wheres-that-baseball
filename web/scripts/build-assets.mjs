#!/usr/bin/env node
/**
 * Blender → web 3D asset pipeline.
 *
 *   npm run assets               build every asset whose source changed
 *   npm run assets -- bat        build just these (if changed)
 *   npm run assets -- --force    rebuild even when unchanged
 *   npm run assets:check         no Blender: fail if any asset's source changed since its
 *                                last build, or a built file is missing (CI / pre-commit)
 *
 * For each asset in assets3d/blender/assets/<name>.py:
 * 1. Hash its sources (the asset module, the shared wtbb3d library, build_asset.py and this
 *    script's PIPELINE_VERSION). Unchanged hash + existing output = skip.
 * 2. Run Blender headless (build_asset.py): build, validate budgets / naming / winding,
 *    export a GLB, write a JSON report and a preview render.
 * 3. Optimise with glTF-Transform: dedup, prune, meshopt (reorder + quantise + compress).
 * 4. Write public/models/<name>.<contenthash>.glb (immutable, so it can be cached forever),
 *    delete that asset's older builds, copy the preview to assets3d/previews/.
 * 5. Record everything in assets3d/manifest.json and the typed
 *    components/game/scene/assets/manifest.generated.ts the runtime loader imports.
 *
 * Blender is found from $BLENDER, then /Applications/Blender.app, then `blender` on PATH.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

/** Bump when this script's output changes for the same sources (forces a rebuild). */
const PIPELINE_VERSION = 1;

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(WEB, "assets3d");
const BLENDER_DIR = path.join(SRC, "blender");
const ASSET_DIR = path.join(BLENDER_DIR, "assets");
const LIB_DIR = path.join(BLENDER_DIR, "wtbb3d");
const PREVIEWS = path.join(SRC, "previews");
const MANIFEST_JSON = path.join(SRC, "manifest.json");
const OUT_DIR = path.join(WEB, "public", "models");
const MANIFEST_TS = path.join(WEB, "components", "game", "scene", "assets", "manifest.generated.ts");
const URL_BASE = "/models";

const rel = (p) => path.relative(WEB, p);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

function listAssets() {
  return readdirSync(ASSET_DIR)
    .filter((f) => f.endsWith(".py") && !f.startsWith("_"))
    .map((f) => f.slice(0, -3))
    .sort();
}

/** Every input that can change an asset's output, hashed in a fixed order. */
function sourceHash(name) {
  const files = [
    path.join(ASSET_DIR, `${name}.py`),
    path.join(BLENDER_DIR, "build_asset.py"),
    ...readdirSync(LIB_DIR)
      .filter((f) => f.endsWith(".py"))
      .sort()
      .map((f) => path.join(LIB_DIR, f)),
  ];
  const h = createHash("sha256").update(`pipeline:${PIPELINE_VERSION}\n`);
  for (const f of files) h.update(`${path.relative(BLENDER_DIR, f)}\n`).update(readFileSync(f));
  return h.digest("hex").slice(0, 16);
}

function readManifest() {
  if (!existsSync(MANIFEST_JSON)) return { assets: {} };
  return JSON.parse(readFileSync(MANIFEST_JSON, "utf8"));
}

function findBlender() {
  const candidates = [process.env.BLENDER, "/Applications/Blender.app/Contents/MacOS/Blender", "blender"].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ["--version"], { encoding: "utf8" });
    if (r.status === 0) return { bin: c, version: (r.stdout.match(/Blender (\S+)/) || [])[1] ?? "unknown" };
  }
  throw new Error("Blender not found: install it, or set BLENDER=/path/to/blender");
}

function runBlender(blender, name, work) {
  const glb = path.join(work, `${name}.glb`);
  const report = path.join(work, `${name}.json`);
  const preview = path.join(work, `${name}.png`);
  const r = spawnSync(
    blender.bin,
    ["-b", "--factory-startup", "--python-exit-code", "1", "-P", path.join(BLENDER_DIR, "build_asset.py"), "--", "--asset", name, "--out", glb, "--report", report, "--preview", preview],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const rep = existsSync(report) ? JSON.parse(readFileSync(report, "utf8")) : null;
  if (r.status !== 0) {
    const why = rep?.errors?.length ? rep.errors.join("\n  ") : (r.stderr || r.stdout).split("\n").slice(-30).join("\n");
    throw new Error(`Blender failed on ${name}:\n  ${why}`);
  }
  return { glb, rep, preview: existsSync(preview) ? preview : null };
}

async function optimise(file) {
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  const doc = await io.read(file);
  await doc.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  return Buffer.from(await io.writeBinary(doc));
}

function writeManifestTs(manifest) {
  const entries = Object.keys(manifest.assets)
    .sort()
    .map((name) => {
      const a = manifest.assets[name];
      const lods = a.lods.map((l) => `      { name: ${JSON.stringify(l.name)}, triangles: ${l.triangles}, bounds: ${JSON.stringify(l.bounds)} },`).join("\n");
      return `  ${name}: {\n    url: ${JSON.stringify(a.url)},\n    bytes: ${a.bytes},\n    description: ${JSON.stringify(a.description)},\n    lods: [\n${lods}\n    ],\n  },`;
    })
    .join("\n");
  const body = `// Generated by scripts/build-assets.mjs from assets3d/ — do not edit. Run \`npm run assets\`.
export interface ModelLodInfo {
  name: string;
  triangles: number;
  /** Axis-aligned bounds, feet, three.js (Y-up) frame. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

export interface ModelInfo {
  url: string;
  bytes: number;
  description: string;
  /** Finest first. */
  lods: ModelLodInfo[];
}

export const MODELS = {
${entries}
} satisfies Record<string, ModelInfo>;

export type ModelName = keyof typeof MODELS;
`;
  mkdirSync(path.dirname(MANIFEST_TS), { recursive: true });
  writeFileSync(MANIFEST_TS, body);
}

function check(names) {
  const manifest = readManifest();
  const problems = [];
  for (const name of names) {
    const a = manifest.assets[name];
    if (!a) problems.push(`${name}: never built`);
    else if (a.sourceHash !== sourceHash(name)) problems.push(`${name}: sources changed since the last build`);
    else if (!existsSync(path.join(WEB, "public", a.url))) problems.push(`${name}: ${a.url} is missing`);
  }
  for (const name of Object.keys(manifest.assets)) if (!names.includes(name)) problems.push(`${name}: in the manifest but has no source`);
  if (problems.length) {
    console.error(`3D assets are stale — run \`npm run assets\`:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`3D assets up to date (${names.length}).`);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const all = listAssets();
  if (args.includes("--check")) return check(all);
  const wanted = args.filter((a) => !a.startsWith("--"));
  for (const w of wanted) if (!all.includes(w)) throw new Error(`no asset ${w} (have: ${all.join(", ")})`);
  const names = wanted.length ? wanted : all;

  const manifest = readManifest();
  // Sources deleted: drop their entries and files.
  for (const name of Object.keys(manifest.assets)) {
    if (all.includes(name)) continue;
    rmSync(path.join(WEB, "public", manifest.assets[name].url), { force: true });
    delete manifest.assets[name];
    console.log(`- ${name} (source removed)`);
  }

  const todo = names.filter((n) => {
    const a = manifest.assets[n];
    return force || !a || a.sourceHash !== sourceHash(n) || !existsSync(path.join(WEB, "public", a.url));
  });
  if (todo.length) {
    const blender = findBlender();
    console.log(`Blender ${blender.version} (${blender.bin})`);
    mkdirSync(OUT_DIR, { recursive: true });
    mkdirSync(PREVIEWS, { recursive: true });
    const work = mkdtempSync(path.join(tmpdir(), "wtbb-assets-"));
    try {
      for (const name of todo) {
        const t0 = Date.now();
        const { glb, rep, preview } = runBlender(blender, name, work);
        const raw = readFileSync(glb).length;
        const bin = await optimise(glb);
        const file = `${name}.${sha(bin).slice(0, 10)}.glb`;
        for (const f of readdirSync(OUT_DIR)) if (f.startsWith(`${name}.`) && f.endsWith(".glb") && f !== file) rmSync(path.join(OUT_DIR, f));
        writeFileSync(path.join(OUT_DIR, file), bin);
        if (preview) copyFileSync(preview, path.join(PREVIEWS, `${name}.png`));
        manifest.assets[name] = {
          url: `${URL_BASE}/${file}`,
          bytes: bin.length,
          sourceHash: sourceHash(name),
          description: rep.description,
          blender: rep.blender,
          lods: rep.lods.map((l) => ({ name: l.name, triangles: l.triangles, budget: l.budget, vertices: l.vertices, bounds: l.bounds, images: l.images })),
        };
        const tris = rep.lods.map((l) => l.triangles).join(" / ");
        console.log(`✓ ${name}: ${tris} tris, ${(raw / 1024).toFixed(1)} → ${(bin.length / 1024).toFixed(1)} KB  ${rel(path.join(OUT_DIR, file))}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  } else {
    console.log("3D assets up to date.");
  }
  manifest.pipelineVersion = PIPELINE_VERSION;
  const sorted = Object.fromEntries(Object.keys(manifest.assets).sort().map((k) => [k, manifest.assets[k]]));
  writeFileSync(MANIFEST_JSON, `${JSON.stringify({ ...manifest, assets: sorted }, null, 2)}\n`);
  writeManifestTs({ assets: sorted });
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
