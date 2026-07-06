"use client";

import { useEffect, useRef, useState } from "react";

import {
  buildPredictRequest,
  oddsStateKey,
} from "@/lib/predictions/buildPredictRequest";
import {
  normalizeOutcomeProbabilities,
  type OutcomeProbabilities,
  type StealProbabilities,
} from "@/types/database";
import type { LiveGameState } from "@/types/mlb-live";

const PREDICT_TIMEOUT_MS = 90_000;

export interface MlPredictionSnapshot {
  probabilities: OutcomeProbabilities | null;
  stealProbabilities: StealProbabilities | null;
  oddsKey: string;
  isLoading: boolean;
  error: string | null;
}

const EMPTY: MlPredictionSnapshot = {
  probabilities: null,
  stealProbabilities: null,
  oddsKey: "none",
  isLoading: false,
  error: null,
};

function predictUrl(): string {
  const direct = process.env.NEXT_PUBLIC_ML_ENGINE_URL?.replace(/\/$/, "");
  return direct ? `${direct}/predict` : "/api/predict";
}

function stealUrl(): string {
  const direct = process.env.NEXT_PUBLIC_ML_ENGINE_URL?.replace(/\/$/, "");
  return direct ? `${direct}/predict_steal` : "/api/predict";
}

/**
 * On-demand sklearn inference when live pitch state changes.
 * Uses client heuristic until ML responds (Render may cold-start ~30–60s).
 */
export function useMlPredictions(
  atBatViewState: LiveGameState | null,
  enabled = true,
): MlPredictionSnapshot {
  const [snapshot, setSnapshot] = useState<MlPredictionSnapshot>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);
  const directMode = Boolean(process.env.NEXT_PUBLIC_ML_ENGINE_URL?.trim());

  useEffect(() => {
    if (!enabled || !atBatViewState) {
      abortRef.current?.abort();
      setSnapshot(EMPTY);
      return;
    }

    const key = oddsStateKey(atBatViewState);
    const body = buildPredictRequest(atBatViewState);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSnapshot((prev) => ({
      probabilities: prev.oddsKey === key ? prev.probabilities : null,
      stealProbabilities: prev.oddsKey === key ? prev.stealProbabilities : null,
      oddsKey: key,
      isLoading: true,
      error: null,
    }));

    const timeout = setTimeout(() => controller.abort(), PREDICT_TIMEOUT_MS);

    void (async () => {
      try {
        if (directMode) {
          const [outcomeRes, stealRes] = await Promise.all([
            fetch(predictUrl(), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
              signal: controller.signal,
            }),
            fetch(stealUrl(), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
              signal: controller.signal,
            }).catch(() => null),
          ]);

          if (!outcomeRes.ok) {
            const err = (await outcomeRes.json().catch(() => ({}))) as { error?: string };
            throw new Error(err.error ?? `predict status ${outcomeRes.status}`);
          }

          const outcomePayload = (await outcomeRes.json()) as {
            probabilities?: Record<string, number>;
          };
          let stealProbabilities: StealProbabilities | null = null;
          if (stealRes?.ok) {
            const stealPayload = (await stealRes.json()) as {
              probabilities?: Record<string, number>;
            };
            const raw = stealPayload.probabilities;
            if (raw) {
              const attempt = raw.steal_attempt ?? 0;
              const success = raw.steal_success ?? 0;
              if (attempt > 0 || success > 0) {
                stealProbabilities = { steal_attempt: attempt, steal_success: success };
              }
            }
          }

          if (controller.signal.aborted) return;

          setSnapshot({
            probabilities: normalizeOutcomeProbabilities(outcomePayload.probabilities),
            stealProbabilities,
            oddsKey: key,
            isLoading: false,
            error: null,
          });
          return;
        }

        const response = await fetch("/api/predict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const payload = (await response.json()) as {
          probabilities?: Record<string, number>;
          steal_probabilities?: StealProbabilities | null;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? `predict status ${response.status}`);
        }

        if (controller.signal.aborted) return;

        setSnapshot({
          probabilities: normalizeOutcomeProbabilities(payload.probabilities),
          stealProbabilities: payload.steal_probabilities ?? null,
          oddsKey: key,
          isLoading: false,
          error: null,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Prediction failed";
        setSnapshot({
          probabilities: null,
          stealProbabilities: null,
          oddsKey: key,
          isLoading: false,
          error: message,
        });
      } finally {
        clearTimeout(timeout);
      }
    })();

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [atBatViewState, enabled, directMode]);

  return snapshot;
}
