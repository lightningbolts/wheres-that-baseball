import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { dataFileExists, listJsonBasenames, readDataJson } from "@/lib/dataFile";

describe("dataFile", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("reads plain JSON", () => {
    dir = mkdtempSync(join(tmpdir(), "datafile-"));
    const path = join(dir, "sample.json");
    writeFileSync(path, JSON.stringify({ ok: true }));
    expect(readDataJson<{ ok: boolean }>(path)).toEqual({ ok: true });
    expect(dataFileExists(path)).toBe(true);
  });

  it("reads gzipped JSON written for Netlify", () => {
    dir = mkdtempSync(join(tmpdir(), "datafile-"));
    const path = join(dir, "sample.json");
    writeFileSync(`${path}.gz`, gzipSync(Buffer.from(JSON.stringify({ gzipped: 1 }))));
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.gz`)).toBe(true);
    expect(readDataJson<{ gzipped: number }>(path)).toEqual({ gzipped: 1 });
    expect(dataFileExists(path)).toBe(true);
  });

  it("lists both .json and .json.gz basenames", () => {
    dir = mkdtempSync(join(tmpdir(), "datafile-"));
    writeFileSync(join(dir, "a.json"), "{}");
    writeFileSync(join(dir, "b.json.gz"), gzipSync(Buffer.from("{}")));
    expect(listJsonBasenames(dir).sort()).toEqual(["a", "b"]);
  });
});
