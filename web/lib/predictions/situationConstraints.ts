import type { OutcomeProbabilities, StealProbabilities } from "@/types/database";

import type { ClientPredictorSituation } from "./clientPredictor";

function renormalize(probs: OutcomeProbabilities): OutcomeProbabilities {
  const sum = Object.values(probs).reduce((acc, value) => acc + value, 0);
  if (sum <= 0) return probs;
  const out = { ...probs };
  for (const key of Object.keys(out) as (keyof OutcomeProbabilities)[]) {
    out[key] = out[key] / sum;
  }
  return out;
}

/** Outcomes that are impossible given runners / outs. */
export function impossibleOutcomeKeys(
  situation: ClientPredictorSituation,
): Set<keyof OutcomeProbabilities> {
  const onFirst = situation.onFirst ?? false;
  const onSecond = situation.onSecond ?? false;
  const onThird = situation.onThird ?? false;
  const outs = situation.outs ?? 0;
  const anyRunner = onFirst || onSecond || onThird;

  const frozen = new Set<keyof OutcomeProbabilities>();
  if (!onFirst) frozen.add("gidp");
  if (!(onThird && outs < 2)) frozen.add("sac_fly");
  if (!anyRunner) frozen.add("sac_bunt");
  return frozen;
}

/** Zero impossible outcomes and renormalize (for client, ML, and ingestor display). */
export function applySituationConstraints(
  probs: OutcomeProbabilities,
  situation: ClientPredictorSituation,
): OutcomeProbabilities {
  const frozen = impossibleOutcomeKeys(situation);
  if (frozen.size === 0) return probs;

  const out = { ...probs };
  for (const key of frozen) {
    out[key] = 0;
  }
  return renormalize(out);
}

export function clampStealProbabilities(
  steal: StealProbabilities | null,
  situation: ClientPredictorSituation,
): StealProbabilities | null {
  if (!situation.onFirst && !situation.onSecond) return null;
  if (!steal) return null;
  if (steal.steal_attempt <= 0 && steal.steal_success <= 0) return null;
  return steal;
}
