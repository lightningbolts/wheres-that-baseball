/**
 * Monte Carlo season projection on the franchise engine: builds the real Opening Day league
 * (rosters, projections, contracts, Pipeline prospects, winter market closed by the AI), then
 * plays the full season + postseason thousands of times across every CPU core and writes the
 * distributions for the projections page (web/data/projections/<season>.json).
 *
 *   npm run project-season -- [sims=3000] [workers=<cores-1>]
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import contracts from "../data/game/franchise-contracts.json";
import proj from "../data/game/franchise-proj.json";
import rosters from "../data/game/rosters.json";
import type { ContractFile } from "../lib/game/franchise/contracts";
import type { ProjectionFile } from "../lib/game/franchise/projections";
import { addRun, emptyRuns, mergeRuns, openingDayLeague, simulateOnce, summarize, type RawRuns } from "../lib/game/franchise/seasonProjection";
import type { RosterFile } from "../lib/game/types";

const BASE_SEED = 2027;
const here = dirname(fileURLToPath(import.meta.url));

function base() {
  return openingDayLeague(rosters as unknown as RosterFile, {
    proj: proj as unknown as ProjectionFile,
    contracts: contracts as unknown as ContractFile,
    seed: BASE_SEED,
  });
}

async function child(from: number, count: number, out: string): Promise<void> {
  const league = base();
  const runs = emptyRuns();
  const t0 = Date.now();
  for (let i = 0; i < count; i += 1) {
    addRun(runs, simulateOnce(league, 0x9e3779b1 ^ ((from + i) * 2654435761)));
    if (process.send && (i + 1) % 5 === 0) process.send({ done: i + 1 });
  }
  await writeFile(out, JSON.stringify(runs));
  if (process.send) process.send({ done: count, ms: Date.now() - t0 });
}

const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function writeSummary(runs: RawRuns, t0: number): Promise<void> {
  const summary = summarize(runs, base());
  const outFile = join(here, "..", "data", "projections", `${summary.season}.json`);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(summary));
  const secs = (Date.now() - t0) / 1000;
  console.log(`${runs.sims} seasons in ${secs.toFixed(0)}s → ${outFile}`);
  console.log(`${summary.hitters.length} hitters, ${summary.pitchers.length} pitchers, ${summary.teams.length} teams`);
  const top = [...summary.teams].sort((a, b) => b.wins.mean - a.wins.mean);
  for (const t of top.slice(0, 5)) console.log(`  ${t.id} ${t.wins.mean.toFixed(1)} W · playoffs ${(t.playoffs * 100).toFixed(0)}% · WS ${(t.ws * 100).toFixed(1)}%`);
}

async function main(): Promise<void> {
  const t00 = Date.now();
  // Re-summarize saved worker runs (no new simulations): --from-raw <dir>
  const fromRaw = flag("--from-raw");
  if (fromRaw) {
    const files = (await readdir(fromRaw)).filter((f) => f.startsWith("part-")).map((f) => join(fromRaw, f));
    const parts: RawRuns[] = [];
    for (const f of files) parts.push(JSON.parse(await readFile(f, "utf8")) as RawRuns);
    return writeSummary(mergeRuns(parts), t00);
  }
  // Keep the worker runs in this directory (else a temp dir that's removed afterwards).
  const keep = flag("--keep");
  const args = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
  const sims = Number(args[0] ?? 3000);
  const workers = Math.max(1, Math.min(sims, Number(args[1] ?? Math.max(1, cpus().length - 1))));
  const dir = keep ?? (await mkdtemp(join(tmpdir(), "proj-")));
  if (keep) await mkdir(keep, { recursive: true });
  const t0 = Date.now();
  console.log(`Projecting ${sims} seasons on ${workers} workers…`);
  const per = Math.ceil(sims / workers);
  const progress = new Array(workers).fill(0);
  let last = 0;
  const jobs = Array.from({ length: workers }, (_, w) => {
    const from = w * per;
    const count = Math.max(0, Math.min(per, sims - from));
    const out = join(dir, `part-${w}.json`);
    return new Promise<string>((resolve, reject) => {
      if (!count) return resolve("");
      const cp = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), "--child", String(from), String(count), out], {
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      });
      cp.on("message", (m: { done: number }) => {
        progress[w] = m.done;
        const done = progress.reduce((a, b) => a + b, 0);
        if (done - last >= Math.max(25, sims / 40)) {
          last = done;
          const el = (Date.now() - t0) / 1000;
          console.log(`  ${done}/${sims} seasons · ${el.toFixed(0)}s · ~${((el / done) * (sims - done)).toFixed(0)}s left`);
        }
      });
      cp.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(`worker ${w} exited ${code}`))));
    });
  });
  const files = (await Promise.all(jobs)).filter(Boolean);
  const parts: RawRuns[] = [];
  for (const f of files) parts.push(JSON.parse(await readFile(f, "utf8")) as RawRuns);
  if (!keep) await rm(dir, { recursive: true, force: true });
  const runs = mergeRuns(parts);
  await writeSummary(runs, t0);
}

if (process.argv[2] === "--child") {
  void child(Number(process.argv[3]), Number(process.argv[4]), process.argv[5]).then(() => process.exit(0));
} else {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
