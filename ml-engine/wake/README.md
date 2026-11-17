# Wake (shelved, Nov 2026)

**Idea:** credit hitters for how much worse a pitcher is *after* facing them. For each PA,
we took the same pitcher's next 15 pitches in that game and compared velocity, zone rate
and CSW against what an average-length PA would have left behind.

**Status:** shelved. The signal is mostly lineup position, not a hitter skill.

## What we controlled for
- Pitcher (and pitch type) norms, plus the batter facing each follow-up pitch. Without
  the batter control, pitchers reaching back for a star hitting next made strong lineups
  (e.g. the Dodgers) look like they leave no wake.
- The pitcher's day-level form, so teammates don't share a good or bad velo day.
- Cumulative pitch count (counterfactual of an average-length PA) and pitch-of-inning.
- Split-half reliability by odd vs even *games*, not PAs.

## Results (2025 + 2026, all regular-season games, 400+ PA)
| Check | Raw Wake | Lineup-slot adjusted |
|---|---|---|
| 2025 split-half reliability | 0.21 | 0.02 |
| 2026 split-half reliability | 0.51 | 0.41 (team effect p = 0.002) |
| Year-over-year r (87 hitters) | 0.27 (p = 0.007) | 0.18 (95% CI −0.03 to +0.38) |
| corr with average lineup slot | 0.34–0.39 | ~0 |

Zone rate and CSW had no signal in either season. Velocity drop climbs steadily from
slot 1 (~0.005 mph) to slot 9 (~0.04 mph): pitchers ease off after the bottom of the
order, and Wake was crediting that to the hitter.

## If revisited
Only a velocity-only version is worth retrying, slot-adjusted, ideally with a three-season
sample and a test that the next hitters actually do better.

## Files
- `compute_wake.py --season YYYY --min-pa 400 [--adjust-slot --tag _slotadj]`
- `year_over_year.py 2025 2026 [_slotadj]`
- `output/`: leaderboards per season
