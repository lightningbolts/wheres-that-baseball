/**
 * Shareable game links. Saves live in the browser, so a link carries the game itself:
 * box score, teams, the names of everyone who appeared, date and series round, as
 * compressed JSON in the URL hash (never sent to the server).
 */
import type { League, ScheduledGame, Series, TeamState } from "./types";

export const SHARE_PATH = "/play/season/game";

interface Payload {
  v: 1;
  g: ScheduledGame;
  /** Calendar start (UTC ms of Opening Day). */
  c: number;
  t: Array<[number, string, string]>;
  p: Array<[number, string]>;
  s?: [string, Series["round"]];
}

function payload(league: League, game: ScheduledGame): Payload {
  const ids = new Set<number>();
  if (game.box) {
    for (const side of [0, 1] as const) {
      for (const b of game.box.bat[side]) ids.add(b[0]);
      for (const q of game.box.pit[side]) ids.add(q[0]);
    }
  }
  for (const id of [game.result?.wp, game.result?.lp, game.result?.sv]) if (id) ids.add(id);
  const series = game.ps ? league.bracket?.series.find((s) => s.id === game.ps) : undefined;
  return {
    v: 1,
    g: game,
    c: league.calendar.start,
    t: [game.away, game.home].map((id) => [id, league.teams[id].name, league.teams[id].abbrev] as [number, string, string]),
    p: [...ids].map((id) => [id, league.players[id]?.name ?? "—"] as [number, string]),
    ...(series ? { s: [series.id, series.round] as [string, Series["round"]] } : {}),
  };
}

const toB64url = (bytes: Uint8Array) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Hash fragment for a game: "z" + deflated base64url, or "j" + plain base64url where streams aren't available. */
export async function encodeGame(league: League, game: ScheduledGame): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(payload(league, game)));
  if (typeof CompressionStream === "undefined") return `j${toB64url(json)}`;
  return `z${toB64url(await pipe(json, new CompressionStream("deflate-raw")))}`;
}

export async function shareUrl(league: League, game: ScheduledGame, origin: string): Promise<string> {
  return `${origin}${SHARE_PATH}#${await encodeGame(league, game)}`;
}

/** A league with just what the game page reads, plus the game. Throws on a bad link. */
export async function decodeGame(hash: string): Promise<{ league: League; game: ScheduledGame }> {
  const h = hash.replace(/^#/, "");
  const raw = fromB64url(h.slice(1));
  const bytes = h[0] === "z" ? await pipe(raw, new DecompressionStream("deflate-raw")) : h[0] === "j" ? raw : null;
  if (!bytes) throw new Error("Not a game link.");
  const p = JSON.parse(new TextDecoder().decode(bytes)) as Payload;
  if (p.v !== 1 || !p.g?.result) throw new Error("Not a game link.");
  const teams: Record<number, TeamState> = {};
  for (const [id, name, abbrev] of p.t) teams[id] = { id, name, abbrev } as TeamState;
  const players: League["players"] = {};
  for (const [id, name] of p.p) players[id] = { id, name } as League["players"][number];
  const league = {
    teams,
    players,
    calendar: { start: p.c, endDay: 0, asb: [0, 0], deadlineDay: 0 },
    bracket: p.s ? { series: [{ id: p.s[0], round: p.s[1] }] } : undefined,
  } as unknown as League;
  return { league, game: p.g };
}
