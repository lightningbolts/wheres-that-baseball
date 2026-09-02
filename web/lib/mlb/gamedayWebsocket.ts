/**
 * Free MLB Gameday push websocket.
 *
 * Endpoint (undocumented but widely used by Gameday clients):
 *   wss://ws.statsapi.mlb.com/api/v1/game/push/subscribe/gameday/{gamePk}
 * Keepalive: text "Gameday5"
 *
 * Payloads vary (JSON Patch diffs, `{diff:[...]}` wrappers, timecodes, or
 * empty pings). JSON Patch ops are applied locally; pings trigger a lean
 * timestamps/diffPatch refresh — never a full GUMBO download by themselves.
 */

import {
  parseMlbDiffPatchBody,
  type JsonPatchOp,
} from "@/lib/mlb/jsonPatch";

export const MLB_GAMEDAY_WS_HOST = "ws.statsapi.mlb.com";
export const MLB_GAMEDAY_KEEPALIVE = "Gameday5";
export const MLB_GAMEDAY_KEEPALIVE_MS = 8_000;
export const MLB_GAMEDAY_RECONNECT_MS = 2_500;
export const MLB_GAMEDAY_MAX_BACKOFF_MS = 30_000;

const TIMECODE_RE = /^\d{8}_\d{6}$/;

export function mlbGamedayWsUrl(gamePk: number): string {
  return `wss://${MLB_GAMEDAY_WS_HOST}/api/v1/game/push/subscribe/gameday/${gamePk}`;
}

export type GamedayWsStatus = "connecting" | "connected" | "disconnected";

export type GamedayWsPayload =
  | { type: "ops"; ops: JsonPatchOp[] }
  | { type: "timecode"; timeStamp: string }
  | { type: "ping" };

export interface GamedayWsSubscription {
  unsubscribe: () => void;
}

export interface SubscribeGamedayWsOptions {
  onUpdate: (payload: GamedayWsPayload) => void;
  onStatus?: (status: GamedayWsStatus) => void;
  /** Debounce bursty ping/timecode messages before calling onUpdate. */
  debounceMs?: number;
}

function timecodeFromUnknown(value: unknown): string | null {
  if (typeof value === "string" && TIMECODE_RE.test(value)) return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["timeStamp", "timecode", "startTimecode", "timeCode"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && TIMECODE_RE.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** Parse a Gameday websocket data frame into ops, a timecode, or a ping. */
export function parseGamedayWsMessage(data: unknown): GamedayWsPayload {
  if (data == null) return { type: "ping" };
  if (typeof data !== "string") {
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      try {
        const text = new TextDecoder().decode(data as BufferSource);
        return parseGamedayWsMessage(text);
      } catch {
        return { type: "ping" };
      }
    }
    return parseGamedayWsMessage(JSON.stringify(data));
  }

  const trimmed = data.trim();
  if (!trimmed || trimmed === MLB_GAMEDAY_KEEPALIVE) return { type: "ping" };
  if (TIMECODE_RE.test(trimmed)) return { type: "timecode", timeStamp: trimmed };

  try {
    const parsed: unknown = JSON.parse(trimmed);
    const patch = parseMlbDiffPatchBody(parsed);
    if (patch.kind === "ops") return { type: "ops", ops: patch.ops };
    const timeStamp = timecodeFromUnknown(parsed);
    if (timeStamp) return { type: "timecode", timeStamp };
  } catch {
    /* not JSON */
  }

  return { type: "ping" };
}

export function subscribeGamedayWebsocket(
  gamePk: number,
  options: SubscribeGamedayWsOptions,
): GamedayWsSubscription {
  if (typeof window === "undefined" || typeof WebSocket === "undefined") {
    return { unsubscribe: () => undefined };
  }

  let closed = false;
  let ws: WebSocket | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingPayload: GamedayWsPayload = { type: "ping" };
  let attempt = 0;
  const debounceMs = options.debounceMs ?? 80;

  const setStatus = (status: GamedayWsStatus) => {
    options.onStatus?.(status);
  };

  const clearTimers = () => {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const scheduleUpdate = (payload: GamedayWsPayload) => {
    pendingPayload = payload;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (!closed) options.onUpdate(pendingPayload);
    }, debounceMs);
  };

  const connect = () => {
    if (closed) return;
    setStatus("connecting");
    try {
      ws = new WebSocket(mlbGamedayWsUrl(gamePk));
    } catch {
      setStatus("disconnected");
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      if (closed) return;
      attempt = 0;
      setStatus("connected");
      try {
        ws?.send(MLB_GAMEDAY_KEEPALIVE);
      } catch {
        /* ignore */
      }
      keepaliveTimer = setInterval(() => {
        try {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(MLB_GAMEDAY_KEEPALIVE);
          }
        } catch {
          /* ignore */
        }
      }, MLB_GAMEDAY_KEEPALIVE_MS);
    };

    ws.onmessage = (event) => {
      if (closed) return;
      const payload = parseGamedayWsMessage(event.data);
      if (payload.type === "ops") {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        options.onUpdate(payload);
        return;
      }
      scheduleUpdate(payload);
    };

    ws.onerror = () => {
      /* onclose handles reconnect */
    };

    ws.onclose = () => {
      clearTimers();
      ws = null;
      if (closed) return;
      setStatus("disconnected");
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    const delay = Math.min(
      MLB_GAMEDAY_RECONNECT_MS * Math.pow(1.6, attempt),
      MLB_GAMEDAY_MAX_BACKOFF_MS,
    );
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  connect();

  return {
    unsubscribe: () => {
      closed = true;
      clearTimers();
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      ws = null;
      setStatus("disconnected");
    },
  };
}
