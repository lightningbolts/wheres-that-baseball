/**
 * Seating decks swept along the wall loop. Each park's layout says which kind of stand
 * (three-deck grandstand, bleachers, porch, berm, Monster seats…) sits behind which stretch
 * of wall; this turns that into structure, textured seating and crowd seat positions.
 */
import { STAND_PRESETS, type ParkLayout, type StandSpec } from "@/lib/game/data/parkLayouts";
import { GROUND_Y, type WallLoop, type WallSample } from "@/components/game/scene/fieldGeometry";
import { GeoBuilder, hash, mix, type P3 } from "@/components/game/scene/parks/geo";

export interface StandReach {
  /** Horizontal extent behind the wall, ft. */
  out: number;
  /** Height of the highest point, ft. */
  top: number;
}

export interface StandsResult {
  /** Crowd seat positions (xyz triples) and facing yaws. */
  slots: Float32Array;
  yaws: Float32Array;
  /** How far and how high the stands go at a bearing (zero when there are none). */
  reach(beta: number): StandReach;
}

export interface StandsOptions {
  homeColor: string;
  /** Seats to leave empty (dugouts, camera wells): bearing and distance behind the wall. */
  skip(beta: number, off: number): boolean;
}

interface Sample extends WallSample {
  /** Smoothed outward normal. */
  ox: number;
  oz: number;
}

function sampleSpec(loop: WallLoop, spec: StandSpec): Sample[] {
  const sA = loop.sOf(spec.from);
  const sB = loop.sOf(spec.to);
  if (sB - sA < 8) return [];
  const n = Math.max(2, Math.ceil((sB - sA) / 11));
  const out: Sample[] = [];
  for (let i = 0; i <= n; i += 1) {
    const w = loop.at(sA + ((sB - sA) * i) / n);
    out.push({ ...w, ox: w.nx, oz: w.nz });
  }
  // Smooth the normals so decks set far back from a kinked wall don't fold; the ends
  // stay fixed so neighbouring sections still meet.
  for (let pass = 0; pass < 6; pass += 1) {
    const prev = out.map((p) => [p.ox, p.oz]);
    for (let i = 1; i < n; i += 1) {
      const x = prev[i - 1][0] + prev[i][0] * 2 + prev[i + 1][0];
      const z = prev[i - 1][1] + prev[i][1] * 2 + prev[i + 1][1];
      const l = Math.hypot(x, z) || 1;
      out[i].ox = x / l;
      out[i].oz = z / l;
    }
  }
  return out;
}

export function buildStands(layout: ParkLayout, loop: WallLoop, st: GeoBuilder, seats: GeoBuilder, opts: StandsOptions): StandsResult {
  const slots: number[] = [];
  const yaws: number[] = [];
  const reaches: Array<{ from: number; to: number; out: number; top: number }> = [];
  const concrete = layout.concrete;
  let seed = 1;

  for (const spec of layout.stands) {
    const sm = sampleSpec(loop, spec);
    if (!sm.length) continue;
    const decks = STAND_PRESETS[spec.key];
    const back = spec.back ?? 0;
    let out = 0;
    let top = 0;
    const n = sm.length - 1;

    // Bullpen or plaza floor in the gap behind the wall.
    if (back > 4) {
      const floor = spec.pen ? "#3f7d3a" : mix(concrete, "#6b6e72", 0.4);
      for (let i = 0; i < n; i += 1) {
        const p = sm[i];
        const q = sm[i + 1];
        st.quad([p.x, 0.05, p.z], [q.x, 0.05, q.z], [q.x + q.ox * (back + 4), 0.05, q.z + q.oz * (back + 4)], [p.x + p.ox * (back + 4), 0.05, p.z + p.oz * (back + 4)], floor, 0.95);
      }
    }

    decks.forEach((deck, di) => {
      const off0 = back + deck.off;
      const off1 = off0 + deck.depth;
      const last = di === decks.length - 1;
      const lower = di === 0 || !!deck.rel;
      const tint = layout.seats[deck.tint ?? 0];
      const yF = (p: Sample) => deck.base + (deck.rel ? p.h : 0);
      const F = (p: Sample, y: number): P3 => [p.x + p.ox * off0, y, p.z + p.oz * off0];
      const B = (p: Sample, y: number): P3 => [p.x + p.ox * off1, y, p.z + p.oz * off1];
      const bottom = (p: Sample) => (lower ? (back > 4 ? 0 : GROUND_Y) : yF(p) - 5);
      out = Math.max(out, off1);

      for (let i = 0; i < n; i += 1) {
        const p = sm[i];
        const q = sm[i + 1];
        const yp = yF(p);
        const yq = yF(q);
        const ypB = yp + deck.rise;
        const yqB = yq + deck.rise;
        top = Math.max(top, ypB + (deck.roof ? 17 : 4));

        if (deck.berm) st.quad(F(p, yp), F(q, yq), B(q, yqB), B(p, ypB), "#4a8a3f", 0.95 + 0.08 * hash(i + di * 31));
        else seats.quadUv(F(p, yp), F(q, yq), B(q, yqB), B(p, ypB), [p.s / 32, 0], [q.s / 32, 0], [q.s / 32, deck.depth / 12], [p.s / 32, deck.depth / 12], tint);

        if (lower) {
          // Front wall down to the floor, and a walkway back from the field wall.
          st.quad(F(p, bottom(p)), F(q, bottom(q)), F(q, yq), F(p, yp), concrete, 0.82);
          if (back <= 4) st.quad([p.x, p.h, p.z], [q.x, q.h, q.z], F(q, yq), F(p, yp), concrete, 0.9);
        } else {
          // Fascia (a ribbon board in the home color on the club level) and the underside.
          const fascia = di === 1 ? mix(layout.trim, opts.homeColor, 0.55) : layout.trim;
          st.quad(F(p, yp - 5), F(q, yq - 5), F(q, yq + 1.5), F(p, yp + 1.5), fascia);
          st.quad(F(p, yp - 5), F(q, yq - 5), B(q, yq - 5), B(p, yp - 5), concrete, 0.5);
        }
        // Back wall: the outermost deck's is the stadium facade.
        const yb0 = (s: Sample) => (last ? GROUND_Y : lower ? yF(s) + deck.rise - 9 : yF(s) - 5);
        st.quad(B(p, yb0(p)), B(q, yb0(q)), B(q, yqB + 3.5), B(p, ypB + 3.5), concrete, last ? 0.74 : 0.66);

        if (deck.roof) {
          const lip = (s: Sample, y: number): P3 => [s.x + s.ox * (off0 + deck.depth * 0.3), y, s.z + s.oz * (off0 + deck.depth * 0.3)];
          st.quad(B(p, ypB + 17), B(q, yqB + 17), lip(q, yqB + 13), lip(p, ypB + 13), layout.trim, 0.9);
          st.quad(lip(p, ypB + 13), lip(q, yqB + 13), lip(q, yqB + (layout.frieze ? 7.5 : 11.5)), lip(p, ypB + (layout.frieze ? 7.5 : 11.5)), layout.frieze ? "#f4f2ea" : layout.trim, 1);
          st.quad(B(p, ypB + 3.5), B(q, yqB + 3.5), B(q, yqB + 17), B(p, ypB + 17), concrete, 0.6);
          if (i % 3 === 0) st.beam(B(p, ypB), [p.x + p.ox * (off1 - 1), ypB + 17, p.z + p.oz * (off1 - 1)], 1.2, layout.trim, 0.8);
        }
        if (layout.purpleRow && deck.tint === 2 && last) {
          const f0 = 0.62;
          const f1 = 0.66;
          const at = (s: Sample, f: number): P3 => [s.x + s.ox * (off0 + deck.depth * f), yF(s) + deck.rise * f + 0.25, s.z + s.oz * (off0 + deck.depth * f)];
          st.quad(at(p, f0), at(q, f0), at(q, f1), at(p, f1), "#5b3f96");
        }

        // Crowd seats.
        if (deck.berm && deck.depth < 20) continue;
        const rows = Math.max(1, Math.floor(deck.depth / 3.1));
        const yaw = Math.atan2(-(p.ox + q.ox), -(p.oz + q.oz));
        for (let r = 0; r < rows; r += 1) {
          const f = (r + 0.5) / rows;
          const o = off0 + deck.depth * f;
          const ax = p.x + p.ox * o;
          const az = p.z + p.oz * o;
          const bx = q.x + q.ox * o;
          const bz = q.z + q.oz * o;
          const perRow = Math.floor(Math.hypot(bx - ax, bz - az) / 2.3);
          for (let k = 0; k < perRow; k += 1) {
            seed += 1;
            const g = (k + 0.5) / perRow;
            if (deck.berm && hash(seed) > 0.14) continue;
            if (opts.skip(p.beta + (q.beta - p.beta) * g, o)) continue;
            slots.push(ax + (bx - ax) * g, yp + (yq - yp) * g + deck.rise * f + 0.35, az + (bz - az) * g);
            yaws.push(yaw);
          }
        }
      }

      // Closed ends.
      for (const p of [sm[0], sm[n]]) {
        const y = yF(p);
        st.quad(F(p, bottom(p)), B(p, bottom(p)), B(p, y + deck.rise + 3.5), F(p, y), concrete, 0.7);
        if (deck.roof) st.tri(B(p, y + deck.rise + 3.5), B(p, y + deck.rise + 17), F(p, y + deck.rise * 0.3 + 12), concrete, 0.62);
      }
    });
    reaches.push({ from: spec.from, to: spec.to, out, top });
  }

  return {
    slots: new Float32Array(slots),
    yaws: new Float32Array(yaws),
    reach(beta: number): StandReach {
      let out = 0;
      let top = 0;
      for (const r of reaches) {
        if (beta >= r.from - 0.01 && beta <= r.to + 0.01) {
          out = Math.max(out, r.out);
          top = Math.max(top, r.top);
        }
      }
      return { out, top };
    },
  };
}
