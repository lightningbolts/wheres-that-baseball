import { NextResponse } from "next/server";

import type { MlPredictRequest } from "@/lib/predictions/buildPredictRequest";
import {
  normalizeOutcomeProbabilities,
  type OutcomeProbabilities,
  type StealProbabilities,
} from "@/types/database";

export const dynamic = "force-dynamic";
/** Render free cold starts can take ~60s on first request. */
export const maxDuration = 60;

const PREDICT_TIMEOUT_MS = 90_000;

function mlEngineBaseUrl(): string | null {
  const url = process.env.ML_ENGINE_URL?.trim();
  return url ? url.replace(/\/$/, "") : null;
}

async function postMlEngine(
  baseUrl: string,
  path: string,
  body: MlPredictRequest,
): Promise<Record<string, number>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PREDICT_TIMEOUT_MS),
  });

  const payload = (await response.json()) as {
    probabilities?: Record<string, number>;
    error?: string;
  };

  if (!response.ok) {
    const message = payload.error ?? `ml-engine status ${response.status}`;
    throw new Error(message);
  }

  if (!payload.probabilities || typeof payload.probabilities !== "object") {
    throw new Error("ml-engine returned empty probabilities");
  }

  return payload.probabilities;
}

function normalizeStealProbabilities(raw: Record<string, number>): StealProbabilities | null {
  const attempt = raw.steal_attempt ?? 0;
  const success = raw.steal_success ?? 0;
  if (attempt <= 0 && success <= 0) return null;
  return { steal_attempt: attempt, steal_success: success };
}

export async function POST(request: Request) {
  const baseUrl = mlEngineBaseUrl();
  if (!baseUrl) {
    return NextResponse.json({ error: "ML engine not configured" }, { status: 503 });
  }

  let body: MlPredictRequest;
  try {
    body = (await request.json()) as MlPredictRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const [outcomeRaw, stealRaw] = await Promise.all([
      postMlEngine(baseUrl, "/predict", body),
      postMlEngine(baseUrl, "/predict_steal", body).catch(() => null),
    ]);

    const probabilities: OutcomeProbabilities = normalizeOutcomeProbabilities(outcomeRaw);
    const stealProbabilities = stealRaw ? normalizeStealProbabilities(stealRaw) : null;

    return NextResponse.json({ probabilities, steal_probabilities: stealProbabilities });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prediction failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
