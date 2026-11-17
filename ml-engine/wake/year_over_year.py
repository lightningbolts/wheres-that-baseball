"""Does a hitter's Wake carry over from one season to the next?

Run compute_wake.py for both seasons first (same --min-pa), then:
    .venv/bin/python wake/year_over_year.py 2025 2026
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parent / "output"


def main(a: str, b: str, tag: str = "") -> None:
    x = pd.read_csv(OUT / f"wake_{a}{tag}.csv", index_col=0)
    y = pd.read_csv(OUT / f"wake_{b}{tag}.csv", index_col=0)
    j = x.join(y, lsuffix=f"_{a}", rsuffix=f"_{b}", how="inner")
    n = len(j)
    print(f"Hitters qualified in both {a} and {b}: {n}")
    for col in ["velo_dmg", "zone_dmg", "csw_dmg", "wake_raw_z", "pitches_per_pa"]:
        r = j[f"{col}_{a}"].corr(j[f"{col}_{b}"])
        rho = j[f"{col}_{a}"].corr(j[f"{col}_{b}"], method="spearman")
        se = 1 / np.sqrt(n - 3)
        print(f"  {col:15s} r={r:+.3f}  spearman={rho:+.3f}  "
              f"95% CI [{np.tanh(np.arctanh(r) - 1.96 * se):+.3f}, {np.tanh(np.arctanh(r) + 1.96 * se):+.3f}]")
    # Null: shuffle pairing, how often is |r| this large by chance?
    rng = np.random.default_rng(0)
    r_obs = j[f"wake_raw_z_{a}"].corr(j[f"wake_raw_z_{b}"])
    null = [np.corrcoef(j[f"wake_raw_z_{a}"], rng.permutation(j[f"wake_raw_z_{b}"].to_numpy()))[0, 1]
            for _ in range(5000)]
    print(f"  permutation p (one-sided) for Wake: {(np.array(null) >= r_obs).mean():.4f}")
    cols = [f"name_{b}", f"wake_plus_{a}", f"wake_plus_{b}"]
    j["avg"] = j[[f"wake_plus_{a}", f"wake_plus_{b}"]].mean(axis=1)
    print("\nMost consistent high-Wake hitters (2-year average)\n",
          j.sort_values("avg", ascending=False)[cols + ["avg"]].head(12).round(1).to_string())


if __name__ == "__main__":
    main(*sys.argv[1:4])
