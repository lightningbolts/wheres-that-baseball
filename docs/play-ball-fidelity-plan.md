# Play Ball fidelity pass — plan

Goal: close the gap between Play Ball and an MLB broadcast-game look (players, uniforms,
ballparks), make outs resolve faster, align the pitch HUD with WTBB colours, and add a
Statcast-style pitch tracker for games played in Play Ball.

## Workstreams

| # | Workstream | Owner | Files owned |
|---|-----------|-------|-------------|
| A | Gameplay pace + WTBB colours | main session | `lib/game/anim/timeline.ts`, `components/game/controller.ts`, `components/game/scene/view.ts`, `components/game/GameView.tsx` |
| B | Statcast pitch tracker | main session | `lib/game/stats/pitchLog.ts` (new), `lib/game/session/session.ts`, `components/game/PitchTracker.tsx` (new), `GameView.tsx` |
| C | Players: anatomy + uniforms | Fable 5.2 agent | `components/game/scene/character/*`, `components/game/scene/Players.tsx`, `components/game/scene/rig.ts`, a dev-only lab page |
| D | Ballparks | Fable 5.2 agent | `components/game/scene/parks/*`, `components/game/scene/Ballpark.tsx`, `lib/game/data/parkLayouts.ts`, a dev-only lab page |

C and D run in parallel on disjoint files; A and B are done in the main session meanwhile.

## A. Faster outs, WTBB colours

- Timeline: once a play's last out (or the third out) is recorded and nothing else is live,
  end the play ~0.7 s later instead of letting every runner track and the ball-around finish.
  Caught flies / groundouts with nobody on end right after the putout.
- Controller: shorter post-play hold for outs (banner stays up while the next pitch is set),
  shorter strikeout hold; inning-change hold trimmed.
- Pitch-result colours = WTBB `lib/mlb/strikeZoneMath.ts`: ball **green** `#22c55e`, strike /
  foul **red** `#ef4444`, in play (no out) **blue** `#3b82f6`, in play (out) **purple** `#a855f7`,
  HBP / pending neutral. Applies to zone markers, ball pips on the scorebug, readout chip and
  the pitch list. Mark kind gains `in_play_out`.

### A2. Human umpire at the zone edge (added)

`umpireCall` in `lib/game/engine/atBat.ts`: pitches well inside / outside are always
called right; within a couple of inches of the edge each call has its own scatter
(SD ≈ 0.9 in on the corners, ≈ 1.4 in at the knees / letters) and the count leans on
the ump (wider at 3-0, tighter at 0-2). Uses the two RNG draws already reserved for
this, so the stream keeps its shape; save format bumped to v3 because calls change.

## B. Statcast-style pitch tracker

Per pitch (recorded in `GameSession.pitchLog`, so save → resume rebuilds it):
inning/half, count, pitcher, batter, pitch type, velocity (release), spin rpm, induced vertical
break and horizontal break (in, vs. a spinless flight from the same release), extension,
plate x/z, in-zone, swing, whiff, called strike, foul, in play, chase; on contact exit velo,
launch angle, distance, hard-hit, barrel, result.

UI (`PitchTracker`, opened from the top bar and shown compact during at-bats):
- **This at-bat**: Gameday-style rows (number badge in result colour, type, mph, spin, IVB/HB,
  result) next to the zone markers.
- **Arsenal / game tab** per pitcher, per pitch type: #, usage %, velo avg / max and spread
  (min–max), spin, IVB, HB, zone %, swing %, whiff %, CSW %, chase %, put-away, avg EV,
  hard-hit %, xBA-proxy hits allowed.
- Tests for the record builder and aggregation.

## C. Players (Fable 5.2)

Anatomy: 7.5–8-head proportions driven by real height/weight; sculpted torso (pecs, lats,
obliques), shoulder girdle, arms with deltoid/bicep/forearm taper, real hands with fingers
and thumbs on glove/bat, legs with quad/hamstring/calf shape, proper neck, head with
skull/jaw/ears/nose/eyes and facial hair variation; smooth skinning without candy-wrapper
joints. Uniform: button-front placket with piping, sleeve length, team wordmark/number fonts,
name bar, MLB batter logo at the back collar, belt and loops, pants with knee break, high
socks/stirrups or long pants per player, cleats, batting gloves, elbow/shin guards, helmet
with C-flap and decals, catcher gear, umpire uniform. Budget: whole cast at 60 fps on a laptop.
Dev-only lab page with a turntable for close inspection.

## D. Ballparks (Fable 5.2)

Bowl: properly raked tiers with seat rows, aisles, vomitories, railings, club/suite levels,
press box, upper-deck overhang and soffit lighting; facades and roofs per park. Crowd: varied
3D fans (not cardboard), team colours, density by section. Field: mowing patterns, infield
dirt with lips and cut-outs, mound and plate texture, chalk, on-deck circles, warning track,
padding, foul poles with screens, dugouts with rails and benches, bullpens, batter's eye,
video boards and ribbon boards, light towers, per-park landmarks (Green Monster, ivy, Crawford
boxes, splash fountains, warehouse…). Same perf budget; dev-only lab page with fly-through.
Backstop wall behind home (batter-cam backdrop) re-done in WTBB's real brand theme: the
mark / lockup from `public/brand`, brand colours and type, LED-board look (added).

## Verification

- `npm run typecheck`, `npm run lint`, `npm test` (vitest), `npm run build`.
- Browser playtest: full game played via the HUD (human batting and pitching, Watch CPU),
  check out pacing, colours, tracker data sanity (velo/spin/IVB within real ranges), and
  screenshots of players and several parks (day/night).
- Then commit, PR, merge.
