/**
 * Per-game logs for franchise games: a box score and a play-by-play for every game,
 * simmed or played. They are kept out of the League object (a season is ~2,400 games,
 * and the league is cloned on every action) in their own IndexedDB store, keyed by save
 * slot, season and game id. Only the current and previous season are kept.
 */

/** What happened on a play (compact: a season of logs is several MB). */
export type PlayCode =
  | "K" // strikeout
  | "BB"
  | "HBP"
  | "1B"
  | "2B"
  | "3B"
  | "HR"
  | "E" // reached on error
  | "GO" // ground out
  | "FC" // fielder's choice
  | "DP" // double play
  | "FO" // fly / line / pop out
  | "SF" // sacrifice fly
  | "SB"
  | "CS"
  | "PC"; // pitching change (batter field = the new pitcher, pitcher field = the one leaving)

/**
 * One play: half-inning (inning × 2, +1 for the bottom), code, batter (or runner / new
 * pitcher), pitcher, outs after, bases after (bit 0 = first), away and home score after,
 * then the ids of anyone who scored on it.
 */
export type Play = [half: number, code: PlayCode, batter: number, pitcher: number, outs: number, bases: number, as: number, hs: number, ...scored: number[]];

/** A play written out as text (games played in Play Ball keep their own descriptions). */
export type TextPlay = [half: number, text: string, as: number, hs: number];

/** id, position, AB, R, H, RBI, BB, K, HR, 2B, 3B, SB */
export type BoxBat = [id: number, pos: string, ab: number, r: number, h: number, rbi: number, bb: number, k: number, hr: number, d: number, t: number, sb: number];
/** id, outs, H, R, ER, BB, K, HR, pitches, BF */
export type BoxPit = [id: number, outs: number, h: number, r: number, er: number, bb: number, k: number, hr: number, pitches: number, bf: number];

export interface BoxSide {
  bat: BoxBat[];
  pit: BoxPit[];
}

export interface GameLog {
  id: number;
  season: number;
  day: number;
  away: number;
  home: number;
  as: number;
  hs: number;
  inn: number;
  /** Runs per half-inning: [away[], home[]]. */
  line: [number[], number[]];
  box: [BoxSide, BoxSide];
  plays?: Play[];
  text?: TextPlay[];
  /** Player names at the time (anyone may later leave the league's records). */
  names: Record<number, string>;
}

// ---------------------------------------------------------------------------
// Collecting logs as games finish

let sink: ((log: GameLog) => void) | null = null;

/** Route finished games' logs somewhere (the app buffers them for storage); null stops. */
export function setGameLogSink(fn: ((log: GameLog) => void) | null): void {
  sink = fn;
}

export function emitGameLog(log: GameLog): void {
  sink?.(log);
}

/** Runs per half-inning from the plays' running score. */
export function lineFromPlays(plays: Array<Play | TextPlay>, inn: number): [number[], number[]] {
  const away = Array.from({ length: inn }, () => 0);
  const home = Array.from({ length: inn }, () => 0);
  let as = 0;
  let hs = 0;
  for (const p of plays) {
    const half = p[0];
    const [a, h] = p.length === 4 ? [p[2], p[3]] : [(p as Play)[6], (p as Play)[7]];
    const i = Math.floor(half / 2) - 1;
    if (i >= 0) {
      if (a > as) away[i] = (away[i] ?? 0) + (a - as);
      if (h > hs) home[i] = (home[i] ?? 0) + (h - hs);
    }
    as = a;
    hs = h;
  }
  return [away, home];
}

// ---------------------------------------------------------------------------
// Storage

const DB = "wtbb-franchise-logs";
const STORE = "logs";
const key = (slot: number, season: number, id: number) => `${slot}:${season}:${id}`;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function tx(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<unknown> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      let result: unknown;
      if (req) req.onsuccess = () => (result = req.result);
      t.oncomplete = () => {
        db.close();
        resolve(result);
      };
      t.onabort = t.onerror = () => {
        db.close();
        resolve(undefined);
      };
    } catch {
      db.close();
      resolve(undefined);
    }
  });
}

/** Store finished games' logs for a save slot. */
export async function putGameLogs(slot: number, logs: GameLog[]): Promise<void> {
  if (!logs.length) return;
  await tx("readwrite", (s) => {
    for (const l of logs) s.put(l, key(slot, l.season, l.id));
  });
}

export async function getGameLog(slot: number, season: number, id: number): Promise<GameLog | null> {
  const r = (await tx("readonly", (s) => s.get(key(slot, season, id)))) as GameLog | undefined;
  return r ?? null;
}

/** Drop a slot's logs: all of them, or those older than `keepFrom` (a season). */
export async function pruneGameLogs(slot: number, keepFrom?: number): Promise<void> {
  await tx("readwrite", (s) => {
    const req = s.openCursor(IDBKeyRange.bound(`${slot}:`, `${slot}:￿`));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      const season = Number(String(c.key).split(":")[1]);
      if (keepFrom == null || season < keepFrom) c.delete();
      c.continue();
    };
  });
}

// ---------------------------------------------------------------------------
// Building a log from a finished game

interface OutcomeLike {
  awayRuns: number;
  homeRuns: number;
  innings: number;
  bat: Map<number, { ab: number; r: number; h: number; rbi: number; bb: number; k: number; hr: number; d: number; t: number; sb: number }>;
  pit: Map<number, { outs: number; h: number; r: number; er: number; bb: number; k: number; hr: number; pit: number; bf: number }>;
  order?: [Array<[number, string]>, Array<[number, string]>];
  staff?: [number[], number[]];
  plays?: Play[];
}

export function buildGameLog(
  g: { id: number; day: number; away: number; home: number },
  season: number,
  out: OutcomeLike,
  nameOf: (id: number) => string | undefined,
  text?: TextPlay[],
): GameLog | null {
  if (!out.order || !out.staff) return null;
  const names: Record<number, string> = {};
  const nm = (id: number) => {
    if (!(id in names)) names[id] = nameOf(id) ?? `#${id}`;
  };
  const side = (i: 0 | 1): BoxSide => ({
    bat: out.order![i].map(([id, pos]) => {
      nm(id);
      const l = out.bat.get(id);
      return [id, pos, l?.ab ?? 0, l?.r ?? 0, l?.h ?? 0, l?.rbi ?? 0, l?.bb ?? 0, l?.k ?? 0, l?.hr ?? 0, l?.d ?? 0, l?.t ?? 0, l?.sb ?? 0];
    }),
    pit: out.staff![i].map((id) => {
      nm(id);
      const l = out.pit.get(id);
      return [id, l?.outs ?? 0, l?.h ?? 0, l?.r ?? 0, l?.er ?? 0, l?.bb ?? 0, l?.k ?? 0, l?.hr ?? 0, l?.pit ?? 0, l?.bf ?? 0];
    }),
  });
  const box: [BoxSide, BoxSide] = [side(0), side(1)];
  for (const p of out.plays ?? []) {
    nm(p[2]);
    nm(p[3]);
    for (let k = 8; k < p.length; k += 1) nm(p[k] as number);
  }
  const inn = Math.max(9, out.innings);
  return {
    id: g.id,
    season,
    day: g.day,
    away: g.away,
    home: g.home,
    as: out.awayRuns,
    hs: out.homeRuns,
    inn,
    line: lineFromPlays(text ?? out.plays ?? [], inn),
    box,
    plays: text ? undefined : out.plays,
    text,
    names,
  };
}
