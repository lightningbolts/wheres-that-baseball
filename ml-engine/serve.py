#!/usr/bin/env python3
"""HTTP inference server for the ingestor. Loads the sklearn model once at startup."""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from inference import get_artifact, get_steal_artifact, predict_from_game_state, predict_steal_from_game_state

HOST = os.environ.get(
    "ML_ENGINE_HOST",
    "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1",
)
PORT = int(os.environ.get("PORT", os.environ.get("ML_ENGINE_PORT", "8765")))
CORS_ORIGIN = os.environ.get("ML_ENGINE_CORS_ORIGIN", "*")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", CORS_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._cors_headers()
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path == "/health":
            try:
                artifact = get_artifact()
                body = {
                    "status": "ok",
                    "feature_cols": artifact["feature_cols"],
                    "outcome_keys": artifact["outcome_keys"],
                }
                steal = get_steal_artifact()
                if steal is not None:
                    body["steal_outcome_keys"] = steal["outcome_keys"]
                self._send_json(200, body)
            except Exception as exc:
                self._send_json(503, {"status": "error", "error": str(exc)})
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path == "/predict_steal":
            length = int(self.headers.get("Content-Length", "0"))
            try:
                raw = self.rfile.read(length)
                state = json.loads(raw.decode("utf-8"))
                probs = predict_steal_from_game_state(state)
                self._send_json(200, {"probabilities": probs})
            except json.JSONDecodeError:
                self._send_json(400, {"error": "invalid JSON body"})
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})
            return

        if self.path != "/predict":
            self._send_json(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        try:
            raw = self.rfile.read(length)
            state = json.loads(raw.decode("utf-8"))
            probs = predict_from_game_state(state)
            self._send_json(200, {"probabilities": probs})
        except json.JSONDecodeError:
            self._send_json(400, {"error": "invalid JSON body"})
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})


def main() -> None:
    print("Loading model...", flush=True)
    get_artifact()

    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as exc:
        if exc.errno == 48 or "Address already in use" in str(exc):
            print(
                f"Port {PORT} is already in use (another ml-engine instance?).\n"
                f"  Stop it:  lsof -ti :{PORT} | xargs kill\n"
                f"  Or use:   ML_ENGINE_PORT=8766 python serve.py",
                file=sys.stderr,
            )
        raise SystemExit(1) from exc

    print(f"ml-engine listening on http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down", flush=True)
        server.shutdown()


if __name__ == "__main__":
    main()
