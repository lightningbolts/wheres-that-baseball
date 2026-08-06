import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

/** True when `path` or a Netlify-compressed `path.gz` is present. */
export function dataFileExists(path: string): boolean {
  return existsSync(path) || existsSync(`${path}.gz`);
}

/**
 * Read JSON from disk. On Netlify builds, season JSON is stored as `*.json.gz`
 * so the serverless bundle stays under the 250MB unzipped limit.
 */
export function readDataJson<T>(path: string): T | null {
  const gzPath = `${path}.gz`;
  if (existsSync(gzPath)) {
    return JSON.parse(gunzipSync(readFileSync(gzPath)).toString("utf8")) as T;
  }
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Basenames of `*.json` / `*.json.gz` files (extension stripped). */
export function listJsonBasenames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((file) => {
      if (file.endsWith(".json.gz")) return file.slice(0, -".json.gz".length);
      if (file.endsWith(".json")) return file.slice(0, -".json".length);
      return null;
    })
    .filter((name): name is string => Boolean(name));
}
