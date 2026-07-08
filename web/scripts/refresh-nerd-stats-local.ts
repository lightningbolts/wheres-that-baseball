/**
 * Rebuild nerd stat JSON from committed counters/windows (no DB or per-game cache).
 *
 * Usage:
 *   npm run refresh-nerd-stats-local -- --season=2026
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = dirname(fileURLToPath(import.meta.url));

function readSeason(): number {
  const arg = process.argv.find((item) => item.startsWith("--season="));
  return Number.parseInt(arg?.split("=")[1] ?? String(new Date().getFullYear()), 10);
}

function run(flags: string[]): void {
  const result = spawnSync(
    "tsx",
    ["scripts/aggregate-nerd-stats.ts", `--season=${season}`, ...flags],
    {
      cwd: join(WEB_ROOT, ".."),
      stdio: "inherit",
      env: process.env,
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const season = readSeason();

run(["--rebuild-store", "--full-store", "--team-cards"]);
run(["--rebuild-windows"]);

console.log(`Refreshed nerd stats locally for season ${season} from counters.`);
