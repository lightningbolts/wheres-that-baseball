/**
 * Seating decks swept along the wall loop. Each park's layout says which kind of stand
 * (three-deck grandstand, bleachers, porch, berm, Monster seats…) sits behind which stretch
 * of wall; this turns that into terraced seating (rows of seat backs, aisles with steps),
 * deck structure (fascia, ribbon boards, soffits, suites, canopies) and crowd positions.
 */
import { STAND_PRESETS, type Deck, type ParkLayout, type StandSpec } from "@/lib/game/data/parkLayouts";
import { GROUND_Y, type WallLoop, type WallSample } from "@/components/game/scene/fieldGeometry";
import { GeoBuilder, hash, mix, rgb, type P3 } from "@/components/game/scene/parks/geo";
import { LED_ROW, SEAT_V } from "@/components/game/scene/parks/textures";

export interface StandReach {
  /** Horizontal extent behind the wall, ft. */
  out: number;
  /** Height of the highest point, ft. */
  top: number;
}

export interface StandsResult {
  /** Crowd seat positions (xyz triples: the fan's seat, at hip height) and facing yaws. */
  slots: Float32Array;
  yaws: Float32Array;
  /** Per seat: [light (0..1, darker under an overhang), rank (lower = closer to the field)]. */
  meta: Float32Array;
  /** How far and how high the stands go at a bearing (zero when there are none). */
  reach(beta: number): StandReach;
}

export interface StandsOptions {
  homeColor: string;
  /** Seats to leave empty (dugouts, camera wells): bearing and distance behind the wall. */
  skip(beta: number, off: number): boolean;
  /** Self-lit signage (ribbon boards, suite glass); omitted in tests. */
  led?: GeoBuilder;
  /** Emissive lamps under canopies. */
  glow?: GeoBuilder;
  lit?: boolean;
}

interface Sample extends WallSample {
  /** Smoothed outward normal. */
  ox: number;
  oz: number;
}

/** Row depth, seat pitch and aisle spacing (in samples) of the seating bowl, ft. */
const ROW = 3.1;
const PITCH = 2.25;
const SEG = 10.67;
const AISLE = 1.7;
/** Slab thickness of an upper deck, and its parapet height. */
const SLAB = 4.5;
const PARAPET = 2.6;

function sampleSpec(loop: WallLoop, spec: StandSpec): Sample[] {
  const sA = loop.sOf(spec.from);
  const sB = loop.sOf(spec.to);
  if (sB - sA < 8) return [];
  const n = Math.max(2, Math.ceil((sB - sA) / SEG));
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

interface DeckInfo {
  deck: Deck;
  off0: number;
  off1: number;
  rows: number;
  lower: boolean;
  /** Canopy: where its lip is (offset) and how high above the top row its back edge sits. */
  roof: { lip: number; h: number; drop: number } | null;
}

const at = (s: Sample, o: number, y: number): P3 => [s.x + s.ox * o, y, s.z + s.oz * o];
const lerp3 = (a: P3, b: P3, t: number): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function buildStands(layout: ParkLayout, loop: WallLoop, st: GeoBuilder, seats: GeoBuilder, opts: StandsOptions): StandsResult {
  const slots: number[] = [];
  const yaws: number[] = [];
  const meta: number[] = [];
  const reaches: Array<{ from: number; to: number; out: number; top: number }> = [];
  const concrete = layout.concrete;
  const slab = mix(concrete, "#b9bbbd", 0.5);
  const ribbon = rgb(mix("#ffffff", opts.homeColor, 0.3));
  const { led, glow } = opts;
  let seed = 1;

  for (const spec of layout.stands) {
    const sm = sampleSpec(loop, spec);
    if (!sm.length) continue;
    const back = spec.back ?? 0;
    const n = sm.length - 1;
    const presets = STAND_PRESETS[spec.key];
    const outer = Math.max(...presets.map((d) => d.off + d.depth));
    const decks: DeckInfo[] = presets.map((deck, di) => {
      const lower = di === 0 || !!deck.rel;
      const outermost = deck.off + deck.depth >= outer - 0.01;
      let roof: DeckInfo["roof"] = null;
      if (deck.roof) roof = { lip: back + deck.off + deck.depth * 0.3, h: 17, drop: 4 };
      else if (!lower && outermost && deck.rise >= 40) roof = { lip: back + deck.off + deck.depth * 0.52, h: 15, drop: -5 };
      return { deck, off0: back + deck.off, off1: back + deck.off + deck.depth, rows: Math.max(1, Math.round(deck.depth / ROW)), lower, roof };
    });
    const lowBack = decks[0].lower ? decks[0].off1 : back;
    const yF = (d: DeckInfo, p: Sample) => d.deck.base + (d.deck.rel ? p.h : 0);
    const soffit = (d: DeckInfo, p: Sample, o: number) => yF(d, p) - SLAB + d.deck.rise * Math.min(1, Math.max(0, (o - d.off0) / d.deck.depth));
    /** Underside of whatever hangs over a spot (another deck or this deck's canopy). */
    const ceiling = (self: DeckInfo, p: Sample, o: number, y: number): number => {
      let c = Infinity;
      for (const d of decks) {
        if (d === self || d.lower || o < d.off0 - 0.5 || o > d.off1 + 0.5) continue;
        const sy = soffit(d, p, o);
        if (sy > y) c = Math.min(c, sy);
      }
      if (self.roof && o > self.roof.lip) c = Math.min(c, yF(self, p) + self.deck.rise + self.roof.h - 1);
      return c;
    };
    /** Baked light at a seat: full in the open, dimmer the deeper it sits under cover. */
    const light = (self: DeckInfo, p: Sample, o: number, y: number): number => {
      let cover = 0;
      for (const d of decks) {
        if (d === self || d.lower || o < d.off0 || o > d.off1 + 2) continue;
        if (soffit(d, p, o) > y) cover = Math.max(cover, o - d.off0);
      }
      if (self.roof && o > self.roof.lip) cover = Math.max(cover, (o - self.roof.lip) * 0.6);
      return 1 - 0.42 * Math.min(1, cover / 22);
    };

    let out = 0;
    let top = 0;

    // Bullpen or plaza floor in the gap behind the wall.
    if (back > 4) {
      const floor = spec.pen ? "#3f7d3a" : mix(concrete, "#6b6e72", 0.4);
      st.mat = spec.pen ? 2 : 1;
      for (let i = 0; i < n; i += 1) {
        const p = sm[i];
        const q = sm[i + 1];
        st.quad(at(p, 0, 0.05), at(q, 0, 0.05), at(q, back + 4, 0.05), at(p, back + 4, 0.05), floor, 0.95);
      }
      st.mat = 0;
    }

    decks.forEach((d, di) => {
      const { deck, off0, off1, rows, lower } = d;
      const outermost = deck.off + deck.depth >= outer - 0.01;
      const tint = layout.seats[deck.tint ?? 0];
      const dRow = deck.depth / rows;
      const hRow = deck.rise / rows;
      const bottom = lower ? (back > 4 ? 0 : GROUND_Y) : 0;
      const purple = layout.purpleRow && deck.tint === 2 && outermost ? Math.floor(rows * 0.63) : -1;
      out = Math.max(out, off1);

      for (let i = 0; i < n; i += 1) {
        const p = sm[i];
        const q = sm[i + 1];
        const yp = yF(d, p);
        const yq = yF(d, q);
        const ypB = yp + deck.rise;
        const yqB = yq + deck.rise;
        top = Math.max(top, ypB + (d.roof ? d.roof.h : 4));
        const mid: Sample = i % 2 ? p : q;

        if (deck.berm) {
          st.mat = 2;
          st.quad(at(p, off0, yp), at(q, off0, yq), at(q, off1, yqB), at(p, off1, ypB), "#4f9143", 0.95 + 0.08 * hash(i + di * 31));
          st.mat = 0;
        } else {
          for (let r = 0; r < rows; r += 1) {
            const o0 = off0 + r * dRow;
            const o1 = o0 + dRow;
            const y0 = (r * deck.rise) / rows;
            const sh = light(d, mid, o0 + dRow * 0.5, yF(d, mid) + y0);
            const a0 = at(p, o0, yp + y0);
            const b0 = at(q, o0, yq + y0);
            const a1 = at(p, o1, yp + y0);
            const b1 = at(q, o1, yq + y0);
            const u0 = p.s / 7;
            const u1 = q.s / 7;
            seats.quadUv(a0, b0, b1, a1, [u0, SEAT_V.slab[1]], [u1, SEAT_V.slab[1]], [u1, SEAT_V.slab[0]], [u0, SEAT_V.slab[0]], slab, sh);
            // Seat backs along the riser, broken by an aisle every third bay.
            const len = Math.hypot(b1[0] - a1[0], b1[2] - a1[2]);
            const g0 = i % 3 === 0 ? AISLE / len : 0;
            const g1 = i % 3 === 2 ? 1 - AISLE / len : 1;
            const count = Math.max(1, Math.round((len * (g1 - g0)) / PITCH));
            const sa = lerp3(a1, b1, g0);
            const sb = lerp3(a1, b1, g1);
            const hS = Math.max(2.7, hRow + 1.3);
            seats.quadUv(sa, sb, [sb[0], sb[1] + hS, sb[2]], [sa[0], sa[1] + hS, sa[2]], [0, SEAT_V.seat[0]], [count, SEAT_V.seat[0]], [count, SEAT_V.seat[1]], [0, SEAT_V.seat[1]], r === purple ? "#6a48b0" : tint, sh);
            for (const [ga, gb] of [
              [0, g0],
              [g1, 1],
            ]) {
              if (gb - ga < 1e-4) continue;
              const ra = lerp3(a1, b1, ga);
              const rb = lerp3(a1, b1, gb);
              seats.quadUv(ra, rb, [rb[0], rb[1] + hRow, rb[2]], [ra[0], ra[1] + hRow, ra[2]], [0, 0.3], [0.3, 0.3], [0.3, 0.42], [0, 0.42], slab, sh * 0.82);
            }
          }
        }

        st.mat = 1;
        if (lower) {
          // Front wall down to the floor, and a walkway back from the field wall.
          st.quad(at(p, off0, bottom), at(q, off0, bottom), at(q, off0, yq), at(p, off0, yp), concrete, 0.86);
          if (back <= 4) st.quad([p.x, p.h, p.z], [q.x, q.h, q.z], at(q, off0, yq), at(p, off0, yp), slab, 0.96);
        } else {
          // Fascia with a parapet, the sloped soffit, and (club level) a ribbon board.
          st.mat = 0;
          st.quad(at(p, off0, yp - SLAB), at(q, off0, yq - SLAB), at(q, off0, yq + PARAPET), at(p, off0, yp + PARAPET), layout.trim, 1.05);
          st.quad(at(p, off0 - 0.05, yp + PARAPET - 0.5), at(q, off0 - 0.05, yq + PARAPET - 0.5), at(q, off0 - 0.05, yq + PARAPET), at(p, off0 - 0.05, yp + PARAPET), "#d9dcdf");
          st.mat = 1;
          st.quad(at(p, off0, yp - SLAB), at(q, off0, yq - SLAB), at(q, off1, yqB - SLAB), at(p, off1, ypB - SLAB), concrete, 0.6);
          if (i % 3 === 0) st.beam(at(p, off0 + 1, yp - SLAB - 0.8), at(p, off1, ypB - SLAB - 0.8), 1.6, concrete, 0.5);
          if (led && di === 1) {
            const r = LED_ROW.ribbon;
            led.quadUv(at(p, off0 - 0.2, yp - SLAB + 0.7), at(q, off0 - 0.2, yq - SLAB + 0.7), at(q, off0 - 0.2, yq + PARAPET - 0.9), at(p, off0 - 0.2, yp + PARAPET - 0.9), [p.s / r.ft, r.v[0]], [q.s / r.ft, r.v[0]], [q.s / r.ft, r.v[1]], [p.s / r.ft, r.v[1]], ribbon);
          }
        }

        // Back wall: up to whatever hangs over it (a concourse or suite level), else a
        // parapet; the outermost deck's is the stadium facade.
        const cp = ceiling(d, p, off1 + 0.4, ypB);
        const cq = ceiling(d, q, off1 + 0.4, yqB);
        const open = !Number.isFinite(cp) || !Number.isFinite(cq);
        const tp = open ? ypB + 3.5 : cp;
        const tq = open ? yqB + 3.5 : cq;
        if (outermost) {
          st.quad(at(p, off1, GROUND_Y), at(q, off1, GROUND_Y), at(q, off1, tq), at(p, off1, tp), concrete, 0.8);
        } else if (open || tp - ypB < 9) {
          st.quad(at(p, off1, ypB - (lower ? 6 : SLAB)), at(q, off1, yqB - (lower ? 6 : SLAB)), at(q, off1, tq), at(p, off1, tp), open ? concrete : "#2b2724", open ? 0.8 : 1);
        } else {
          st.quad(at(p, off1, ypB), at(q, off1, yqB), at(q, off1, yqB + 3.4), at(p, off1, ypB + 3.4), concrete, 0.7);
          if (led) {
            const r = LED_ROW.suites;
            const reps = Math.max(1, Math.round((tp - ypB - 3.4) / 11));
            for (let k = 0; k < reps; k += 1) {
              const f0 = k / reps;
              const f1 = (k + 1) / reps;
              const y = (yb: number, t: number, f: number) => yb + 3.4 + (t - yb - 3.4) * f;
              led.quadUv(at(p, off1, y(ypB, tp, f0)), at(q, off1, y(yqB, tq, f0)), at(q, off1, y(yqB, tq, f1)), at(p, off1, y(ypB, tp, f1)), [p.s / r.ft, r.v[0]], [q.s / r.ft, r.v[0]], [q.s / r.ft, r.v[1]], [p.s / r.ft, r.v[1]], "#ffffff");
            }
          } else st.quad(at(p, off1, ypB + 3.4), at(q, off1, yqB + 3.4), at(q, off1, tq), at(p, off1, tp), "#2b2724");
        }

        if (d.roof) {
          const { lip, h, drop } = d.roof;
          const yl = (yb: number) => yb + h - drop;
          const face = layout.frieze ? 5.5 : 2.2;
          st.mat = 0;
          st.quad(at(p, off1 + 1, ypB + h), at(q, off1 + 1, yqB + h), at(q, lip, yl(yqB)), at(p, lip, yl(ypB)), layout.trim, 0.95);
          st.quad(at(p, off1 + 1, ypB + h - 1.4), at(q, off1 + 1, yqB + h - 1.4), at(q, lip, yl(yqB) - 1.4), at(p, lip, yl(ypB) - 1.4), mix(layout.trim, "#9aa0a6", 0.35), 0.75);
          st.quad(at(p, lip, yl(ypB) + 0.3), at(q, lip, yl(yqB) + 0.3), at(q, lip, yl(yqB) - face), at(p, lip, yl(ypB) - face), layout.frieze ? "#f4f2ea" : mix(layout.trim, "#ffffff", 0.12), 1.05);
          st.mat = 1;
          st.quad(at(p, off1, ypB + 3.5), at(q, off1, yqB + 3.5), at(q, off1, yqB + h), at(p, off1, ypB + h), concrete, 0.66);
          st.mat = 0;
          if (i % 3 === 0) {
            st.beam(at(p, off1 - 1, ypB), at(p, off1 - 1, ypB + h - 1), 1.3, layout.trim, 0.8);
            st.beam(at(p, off1 - 1, ypB + h - 2.2), at(p, lip + 1, yl(ypB) - 2), 1.1, mix(layout.trim, "#9aa0a6", 0.3), 0.8);
          }
          // Light rail under the lip.
          if (glow && i % 2 === 0) {
            const a = lerp3(at(p, lip + 1.2, yl(ypB) - 1.7), at(q, lip + 1.2, yl(yqB) - 1.7), 0.2);
            const b = lerp3(at(p, lip + 1.2, yl(ypB) - 1.7), at(q, lip + 1.2, yl(yqB) - 1.7), 0.8);
            glow.quad(a, b, [b[0], b[1] + 1.1, b[2]], [a[0], a[1] + 1.1, a[2]], opts.lit ? [1, 0.97, 0.86] : [0.8, 0.82, 0.84]);
          }
        }
        st.mat = 0;

        // Crowd seats.
        if (deck.berm && deck.depth < 20) continue;
        const yaw = Math.atan2(-(p.ox + q.ox), -(p.oz + q.oz));
        for (let r = 0; r < rows; r += 1) {
          const o = off0 + (r + 0.6) * dRow;
          const y0 = (r * deck.rise) / rows;
          const a = at(p, o, yp + y0);
          const b = at(q, o, yq + y0);
          const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
          const g0 = !deck.berm && i % 3 === 0 ? AISLE / len : 0;
          const g1 = !deck.berm && i % 3 === 2 ? 1 - AISLE / len : 1;
          const perRow = Math.max(1, Math.round((len * (g1 - g0)) / PITCH));
          if (!deck.berm && ceiling(d, mid, o, yF(d, mid) + y0) - (yF(d, mid) + y0) < 6.4) continue;
          const sh = light(d, mid, o, yF(d, mid) + y0);
          for (let k = 0; k < perRow; k += 1) {
            seed += 1;
            const g = g0 + ((g1 - g0) * (k + 0.5)) / perRow;
            if (deck.berm && hash(seed) > 0.12) continue;
            if (opts.skip(p.beta + (q.beta - p.beta) * g, o)) continue;
            slots.push(a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g + (deck.berm ? hRow * 0.6 - 0.9 : 0), a[2] + (b[2] - a[2]) * g);
            yaws.push(yaw);
            meta.push(sh, di + r / rows);
          }
        }
      }

      // Closed ends.
      st.mat = 1;
      for (const p of [sm[0], sm[n]]) {
        const y = yF(d, p);
        if (lower) st.quad(at(p, off0, bottom), at(p, off1, bottom), at(p, off1, y + deck.rise + 3.5), at(p, off0, y + (deck.berm ? 0 : 2.6)), concrete, 0.78);
        else {
          st.quad(at(p, off0, y - SLAB), at(p, off1, y + deck.rise - SLAB), at(p, off1, y + deck.rise + 3.5), at(p, off0, y + PARAPET), concrete, 0.78);
          const c0 = Math.max(off0, lowBack);
          if (c0 < off1 - 1) st.quad(at(p, c0, GROUND_Y), at(p, off1, GROUND_Y), at(p, off1, soffit(d, p, off1)), at(p, c0, soffit(d, p, c0)), concrete, 0.7);
        }
        if (d.roof) st.tri(at(p, off1, y + deck.rise + 3.5), at(p, off1, y + deck.rise + d.roof.h), at(p, d.roof.lip, y + deck.rise + d.roof.h - d.roof.drop), concrete, 0.66);
      }
      st.mat = 0;
    });
    reaches.push({ from: spec.from, to: spec.to, out, top });
  }

  return {
    slots: new Float32Array(slots),
    yaws: new Float32Array(yaws),
    meta: new Float32Array(meta),
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
