/**
 * Free MLB Gameday push websocket.
 *
 * Endpoint (undocumented but widely used by Gameday clients):
 *   wss://ws.statsapi.mlb.com/api/v1/game/push/subscribe/gameday/{gamePk}
 * Keepalive: text "Gameday5"
 *
 * Payloads vary (JSON Patch diffs, status pings, or empty). We treat any
 * message as a signal that the live feed changed and trigger an immediate
 * snapshot refresh — same data as polling, lower latency when push works.
 */

export const MLB_GAMEDAY_WS_HOST = "ws.statsapi.mlb.com";
export const MLB_GAMEDAY_KEEPALIVE = "Gameday5";
export const MLB_GAMEDAY_KEEPALIVE_MS = 8_000;
export const MLB_GAMEDAY_RECONNECT_MS = 2_500;
export const MLB_GAMEDAY_MAX_BACKOFF_MS = 30_000;

export function mlbGamedayWsUrl(gamePk: number): string {
  return `wss://${MLB_GAMEDAY_WS_HOST}/api/v1/game/push/subscribe/gameday/${gamePk}`;
}

export type GamedayWsStatus = "connecting" | "connected" | "disconnected";

export interface GamedayWsSubscription {
  unsubscribe: () => void;
}

export interface SubscribeGamedayWsOptions {
  onUpdate: () => void;
  onStatus?: (status: GamedayWsStatus) => void;
  /** Debounce bursty push messages before calling onUpdate. */
  debounceMs?: number;
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

  const scheduleUpdate = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (!closed) options.onUpdate();
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

    ws.onmessage = () => {
      if (closed) return;
      scheduleUpdate();
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
