/**
 * Franchise persistence: a few save slots in IndexedDB (localStorage fallback),
 * every access wrapped so private windows / blocked storage just mean "no saves".
 */
import { FRANCHISE_VERSION } from "./league";
import type { League } from "./types";

export const SLOT_COUNT = 3;
const DB = "wtbb-franchise";
const STORE = "slots";
const LS_PREFIX = "wtbb.franchise.slot.";

export interface SlotMeta {
  slot: number;
  savedAt: number;
  season: number;
  day: number;
  phase: League["phase"];
  team: number;
  teamName: string;
  record: string;
}

interface SlotRecord {
  meta: SlotMeta;
  data: string;
}

export function serializeLeague(league: League): string {
  return JSON.stringify(league);
}

export function deserializeLeague(data: string): League | null {
  try {
    const l = JSON.parse(data) as League;
    if (!l || typeof l !== "object" || l.version !== FRANCHISE_VERSION || !l.teams || !l.players || !Array.isArray(l.schedule)) return null;
    return l;
  } catch {
    return null;
  }
}

export function metaFor(league: League, slot: number): SlotMeta {
  const t = league.teams[league.userTeam];
  return { slot, savedAt: Date.now(), season: league.season, day: league.day, phase: league.phase, team: t.id, teamName: t.name, record: `${t.w}-${t.l}` };
}

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

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          // A write can still abort after the request succeeds: report only once the transaction commits.
          let result: T | undefined;
          req.onsuccess = () => {
            result = req.result as T;
          };
          tx.oncomplete = () => {
            db.close();
            resolve(result);
          };
          const fail = () => {
            db.close();
            resolve(undefined);
          };
          tx.onabort = fail;
          tx.onerror = fail;
        } catch {
          db.close();
          resolve(undefined);
        }
      }),
  );
}

const lsGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

export async function saveLeague(league: League, slot: number): Promise<boolean> {
  const rec: SlotRecord = { meta: metaFor(league, slot), data: serializeLeague(league) };
  const ok = await idb<IDBValidKey>("readwrite", (s) => s.put(rec, slot));
  if (ok !== undefined) return true;
  try {
    localStorage.setItem(LS_PREFIX + slot, JSON.stringify(rec));
    return true;
  } catch {
    return false;
  }
}

async function readSlot(slot: number): Promise<SlotRecord | null> {
  const rec = await idb<SlotRecord>("readonly", (s) => s.get(slot));
  const valid = (r: SlotRecord | null | undefined): r is SlotRecord => !!r?.data && deserializeLeague(r.data) !== null;
  const db = valid(rec) ? rec : null;
  let ls: SlotRecord | null = null;
  const raw = lsGet(LS_PREFIX + slot);
  if (raw) {
    try {
      const r = JSON.parse(raw) as SlotRecord;
      if (valid(r)) ls = r;
    } catch {
      ls = null;
    }
  }
  // A save may have fallen back to localStorage while IndexedDB was unavailable: the newest
  // valid record wins, so a corrupt newer copy never hides a good older one.
  if (db && ls) return (ls.meta?.savedAt ?? 0) > (db.meta?.savedAt ?? 0) ? ls : db;
  return db ?? ls;
}

export async function loadLeague(slot: number): Promise<League | null> {
  const rec = await readSlot(slot);
  return rec ? deserializeLeague(rec.data) : null;
}

export async function listSlots(): Promise<Array<SlotMeta | null>> {
  const out: Array<SlotMeta | null> = [];
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    const rec = await readSlot(i);
    out.push(rec?.meta ?? null);
  }
  return out;
}

export async function deleteSlot(slot: number): Promise<void> {
  await idb("readwrite", (s) => s.delete(slot));
  try {
    localStorage.removeItem(LS_PREFIX + slot);
  } catch {
    /* storage blocked */
  }
}
