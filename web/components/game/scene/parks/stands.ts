/**
 * Seating decks swept along the wall loop. Each park's layout says which kind of stand
 * (three-deck grandstand, bleachers, porch, berm, Monster seats…) sits behind which stretch
 * of wall; this turns that into terraced seating (rows of seat backs, aisles with steps, a
 * cross-aisle), deck structure (fascia, ribbon boards, soffits, suites, canopies), the outer
 * facade and plaza, and crowd positions. Upper decks can stop short of the lower bowl and
 * taper toward their ends, and light is baked in: seats and soffits darken under overhangs,
 * walls darken toward the ground.
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
/** Width of the paved apron around the outside of the stands. */
const PLAZA = 58;

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
  /** Sample range this deck spans (segments i0 … i1 − 1). */
  i0: number;
  i1: number;
  /** Rows built in each segment (fewer toward a tapered end). */
  rowsAt: number[];
  /** Canopy: where its lip is (offset) and how high above the top row its back edge sits. */
  roof: { lip: number; h: number; drop: number } | null;
}

const at = (s: Sample, o: number, y: number): P3 => [s.x + s.ox * o, y, s.z + s.oz * o];
const lerp3 = (a: P3, b: P3, t: number): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sameDeck = (a: Deck, b: Deck) => a.off === b.off && a.depth === b.depth && a.base === b.base && a.rise === b.rise && !!a.rel === !!b.rel && !!a.berm === !!b.berm;

export function buildStands(layout: ParkLayout, loop: WallLoop, st: GeoBuilder, seats: GeoBuilder, opts: StandsOptions): StandsResult {
  const slots: number[] = [];
  const yaws: number[] = [];
  const meta: number[] = [];
  const reaches: Array<{ from: number; to: number; out: number; top: number }> = [];
  const concrete = layout.concrete;
  const facade = layout.facade ?? concrete;
  const facadeMat = layout.facadeStyle === "plain" ? 1 : layout.facadeStyle === "glass" ? 4 : 3;
  const slab = mix(concrete, "#c3c5c7", 0.6);
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
    /** Does a neighbouring section carry this deck on past our end? (then no end wall) */
    const continues = (deck: Deck, end: number, bound: number): boolean =>
      layout.stands.some((o) => {
        if (o === spec || (o.back ?? 0) !== back) return false;
        const meets = end < 0 ? Math.abs(o.to - bound) < 0.6 : Math.abs(o.from - bound) < 0.6;
        if (!meets) return false;
        const od = STAND_PRESETS[o.key];
        const j = od.findIndex((d) => sameDeck(d, deck));
        if (j < 0) return false;
        const lowerJ = j === 0 || !!od[j].rel;
        const r = lowerJ ? [o.from, o.to] : j === od.length - 1 && od.length >= 3 && o.top ? o.top : (o.up ?? [o.from, o.to]);
        return end < 0 ? r[1] >= o.to - 0.6 : r[0] <= o.from + 0.6;
      });
    const idx = (beta: number): number => {
      let best = 0;
      for (let i = 1; i <= n; i += 1) if (Math.abs(sm[i].beta - beta) < Math.abs(sm[best].beta - beta)) best = i;
      return best;
    };
    const decks: DeckInfo[] = presets.map((deck, di) => {
      const lower = di === 0 || !!deck.rel;
      const outermost = deck.off + deck.depth >= outer - 0.01;
      let roof: DeckInfo["roof"] = null;
      if (deck.roof) roof = { lip: back + deck.off + deck.depth * 0.3, h: 17, drop: 4 };
      else if (!lower && outermost && deck.rise >= 40 && (spec.cover ?? (spec.from <= -50 || spec.to >= 50))) roof = { lip: back + deck.off + deck.depth * 0.52, h: 15, drop: -5 };
      const range = lower ? null : di === presets.length - 1 && presets.length >= 3 && spec.top ? spec.top : (spec.up ?? null);
      const i0 = range ? idx(Math.max(spec.from, range[0])) : 0;
      const i1 = range ? idx(Math.min(spec.to, range[1])) : n;
      const rows = Math.max(1, Math.round(deck.depth / ROW));
      const rowsAt: number[] = [];
      const taper = !lower && outermost ? (spec.taper ?? 0) : 0;
      const openA = i0 > 0 || !continues(deck, -1, spec.from);
      const openB = i1 < n || !continues(deck, 1, spec.to);
      for (let i = 0; i < n; i += 1) {
        let f = 1;
        if (taper > 0) {
          const dA = openA && spec.from > -179 ? sm[i].s - sm[i0].s + SEG * 0.5 : Infinity;
          const dB = openB && spec.to < 179 ? sm[i1].s - sm[i + 1].s + SEG * 0.5 : Infinity;
          f = Math.min(1, Math.max(0, Math.min(dA, dB) / taper));
        }
        rowsAt.push(Math.max(3, Math.round(rows * (0.3 + 0.7 * f))));
      }
      return { deck, off0: back + deck.off, off1: back + deck.off + deck.depth, rows, lower, roof, i0, i1, rowsAt };
    });
    const lowBack = decks[0].lower ? decks[0].off1 : back;
    const yF = (d: DeckInfo, p: Sample) => d.deck.base + (d.deck.rel ? p.h : 0);
    const has = (d: DeckInfo, i: number) => i >= d.i0 && i < d.i1;
    const offEnd = (d: DeckInfo, i: number) => d.off0 + (d.deck.depth * d.rowsAt[Math.min(n - 1, Math.max(0, i))]) / d.rows;
    const soffit = (d: DeckInfo, p: Sample, o: number) => yF(d, p) - SLAB + d.deck.rise * Math.min(1, Math.max(0, (o - d.off0) / d.deck.depth));
    /** Underside of whatever hangs over a spot (another deck or this deck's canopy). */
    const ceiling = (self: DeckInfo, i: number, p: Sample, o: number, y: number): number => {
      let c = Infinity;
      for (const d of decks) {
        if (d === self || d.lower || !has(d, i) || o < d.off0 - 0.5 || o > offEnd(d, i) + 0.5) continue;
        const sy = soffit(d, p, o);
        if (sy > y) c = Math.min(c, sy);
      }
      if (self.roof && o > self.roof.lip) c = Math.min(c, yF(self, p) + (self.deck.rise * self.rowsAt[Math.min(n - 1, i)]) / self.rows + self.roof.h - 1);
      return c;
    };
    /** Baked light at a seat: full in the open, dimmer the deeper it sits under cover. */
    const light = (self: DeckInfo, i: number, p: Sample, o: number, y: number): number => {
      let cover = 0;
      for (const d of decks) {
        if (d === self || d.lower || !has(d, i) || o < d.off0 || o > offEnd(d, i) + 2) continue;
        if (soffit(d, p, o) > y) cover = Math.max(cover, o - d.off0);
      }
      if (self.roof && o > self.roof.lip) cover = Math.max(cover, (o - self.roof.lip) * 0.6);
      return 1 - 0.46 * Math.min(1, cover / 24);
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
        st.quadG(at(p, back + 4, 0.05), at(q, back + 4, 0.05), at(q, 0, 0.05), at(p, 0, 0.05), floor, 0.74, 0.98);
      }
      st.mat = 0;
    }

    decks.forEach((d, di) => {
      const { deck, off0, rows, lower } = d;
      const outermost = deck.off + deck.depth >= outer - 0.01;
      const tint = layout.seats[deck.tint ?? 0];
      const dRow = deck.depth / rows;
      const hRow = deck.rise / rows;
      const bottom = lower ? (back > 4 ? 0 : GROUND_Y) : 0;
      const purple = layout.purpleRow && deck.tint === 2 && outermost ? Math.floor(rows * 0.63) : -1;
      // A cross-aisle splits a deep lower bowl into field boxes and terrace.
      const walk = lower && !deck.berm && rows >= 22 ? Math.round(rows * 0.42) : -1;
      if (d.i1 - d.i0 < 1) return;
      // Vomitories: tunnel mouths every sixth bay, opening onto the cross-aisle if there is one.
      const nv = Math.min(8, Math.max(3, Math.ceil(7.5 / hRow)));
      const v0 = walk >= 0 ? walk + 1 : Math.round(rows * 0.3);
      const vomOk = !deck.berm && rows >= 12 && v0 + nv <= rows - 2;

      for (let i = d.i0; i < d.i1; i += 1) {
        const p = sm[i];
        const q = sm[i + 1];
        const nR = d.rowsAt[i];
        const off1 = off0 + nR * dRow;
        const rise = nR * hRow;
        const yp = yF(d, p);
        const yq = yF(d, q);
        const ypB = yp + rise;
        const yqB = yq + rise;
        out = Math.max(out, off1);
        top = Math.max(top, ypB + (d.roof ? d.roof.h : 4));
        const mid: Sample = i % 2 ? p : q;

        const vomBay = vomOk && i % 6 === 3 && i > d.i0 && i < d.i1 - 1 && nR === rows;
        const bayShade = 0.95 + 0.1 * hash(Math.floor(i / 3) * 7 + di * 13 + 3);
        if (deck.berm) {
          st.mat = 2;
          st.quadG(at(p, off0, yp), at(q, off0, yq), at(q, off1, yqB), at(p, off1, ypB), "#4f9143", 0.86 + 0.06 * hash(i + di * 31), 1.04);
          st.mat = 0;
        } else {
          for (let r = 0; r < nR; r += 1) {
            const o0 = off0 + r * dRow;
            const o1 = o0 + dRow;
            const y0 = r * hRow;
            const sh = light(d, i, mid, o0 + dRow * 0.5, yF(d, mid) + y0);
            if (vomBay && r >= v0 && r < v0 + nv) {
              if (r === v0) {
                // Vomitory: a tunnel mouth cut into the rake, with a landing and side walls.
                const oB = off0 + (v0 + nv) * dRow;
                const oT = Math.min(oB + 9, off0 + nR * dRow - 0.6);
                const H = nv * hRow;
                const fy = (yb: number) => yb + y0;
                st.mat = 1;
                st.quadG(at(p, o0, fy(yp)), at(q, o0, fy(yq)), at(q, oT, fy(yq)), at(p, oT, fy(yp)), concrete, 0.62 * sh, 0.2);
                for (const e of [p, q]) {
                  const yb = fy(e === p ? yp : yq);
                  st.quad(at(e, o0, yb), at(e, oB, yb), at(e, oB, yb + H + 1.4), at(e, o0, yb + 1.4), concrete, 0.74 * sh);
                  st.quadG(at(e, oB, yb), at(e, oT, yb), at(e, oT, yb + H), at(e, oB, yb + H), concrete, 0.42, 0.16);
                }
                st.quadG(at(p, oB, fy(yp) + H), at(q, oB, fy(yq) + H), at(q, oT, fy(yq) + H), at(p, oT, fy(yp) + H), concrete, 0.4, 0.14);
                st.quad(at(p, oB, fy(yp) + H - 0.6), at(q, oB, fy(yq) + H - 0.6), at(q, oB, fy(yq) + H + 1.4), at(p, oB, fy(yp) + H + 1.4), concrete, 0.86 * sh);
                st.mat = 0;
                st.quad(at(p, oT, fy(yp)), at(q, oT, fy(yq)), at(q, oT, fy(yq) + H), at(p, oT, fy(yp) + H), opts.lit ? "#4a3a22" : "#0d0e11", 1);
                // Section sign over the mouth.
                const sa = lerp3(at(p, oB - 0.1, fy(yp) + H - 0.35), at(q, oB - 0.1, fy(yq) + H - 0.35), 0.3);
                const sb = lerp3(at(p, oB - 0.1, fy(yp) + H - 0.35), at(q, oB - 0.1, fy(yq) + H - 0.35), 0.7);
                st.quad(sa, sb, [sb[0], sb[1] + 1.3, sb[2]], [sa[0], sa[1] + 1.3, sa[2]], layout.trim, 1.25);
              }
              continue;
            }
            const a0 = at(p, o0, yp + y0);
            const b0 = at(q, o0, yq + y0);
            const a1 = at(p, o1, yp + y0);
            const b1 = at(q, o1, yq + y0);
            const u0 = p.s / 7;
            const u1 = q.s / 7;
            seats.quadUv(a0, b0, b1, a1, [u0, SEAT_V.slab[1]], [u1, SEAT_V.slab[1]], [u1, SEAT_V.slab[0]], [u0, SEAT_V.slab[0]], slab, sh);
            const len = Math.hypot(b1[0] - a1[0], b1[2] - a1[2]);
            if (r === walk) {
              seats.quadUv(a1, b1, [b1[0], b1[1] + hRow, b1[2]], [a1[0], a1[1] + hRow, a1[2]], [0, SEAT_V.slab[0]], [0.3, SEAT_V.slab[0]], [0.3, SEAT_V.slab[0] + 0.1], [0, SEAT_V.slab[0] + 0.1], slab, sh * 0.8);
              continue;
            }
            // Seats along the riser (backs, and pans seen from above), broken by an aisle
            // every third bay.
            const g0 = i % 3 === 0 ? AISLE / len : 0;
            const g1 = i % 3 === 2 ? 1 - AISLE / len : 1;
            const count = Math.max(1, Math.round((len * (g1 - g0)) / PITCH));
            const sa = lerp3(a1, b1, g0);
            const sb = lerp3(a1, b1, g1);
            const hS = Math.max(2.7, hRow + 1.3);
            const tintR = r === purple ? "#6a48b0" : tint;
            seats.quadUv(sa, sb, [sb[0], sb[1] + hS, sb[2]], [sa[0], sa[1] + hS, sa[2]], [0, SEAT_V.seat[0]], [count, SEAT_V.seat[0]], [count, SEAT_V.seat[1]], [0, SEAT_V.seat[1]], tintR, sh * bayShade);
            const f0 = at(p, o1 - Math.min(1.6, dRow * 0.55), yp + y0 + 1.35);
            const f1 = at(q, o1 - Math.min(1.6, dRow * 0.55), yq + y0 + 1.35);
            const pa = lerp3(f0, f1, g0);
            const pb = lerp3(f0, f1, g1);
            seats.quadUv(pa, pb, [sb[0], sb[1] + 1.5, sb[2]], [sa[0], sa[1] + 1.5, sa[2]], [0, SEAT_V.pan[0]], [count, SEAT_V.pan[0]], [count, SEAT_V.pan[1]], [0, SEAT_V.pan[1]], tintR, sh * bayShade * 1.06);
            for (const [ga, gb] of [
              [0, g0],
              [g1, 1],
            ]) {
              if (gb - ga < 1e-4) continue;
              const ra = lerp3(a1, b1, ga);
              const rb = lerp3(a1, b1, gb);
              seats.quadUv(ra, rb, [rb[0], rb[1] + hRow, rb[2]], [ra[0], ra[1] + hRow, ra[2]], [0, SEAT_V.step[0]], [0.3, SEAT_V.step[0]], [0.3, SEAT_V.step[1]], [0, SEAT_V.step[1]], slab, sh * 0.9);
            }
          }
          // Aisle handrail up a steep deck.
          if (!lower && i % 3 === 0 && hRow > 1.5 && nR > 6) {
            const e = (AISLE * 0.5) / SEG;
            const ra = lerp3(at(p, off0 + 2 * dRow, yp + 2 * hRow + 2.9), at(q, off0 + 2 * dRow, yq + 2 * hRow + 2.9), e);
            const rb = lerp3(at(p, off0 + (nR - 1) * dRow, yp + (nR - 1) * hRow + 2.9), at(q, off0 + (nR - 1) * dRow, yq + (nR - 1) * hRow + 2.9), e);
            st.beam(ra, rb, 0.22, "#c9ccd0", 1);
          }
        }

        st.mat = 1;
        if (lower) {
          // Front wall down to the floor, and a walkway back from the field wall.
          st.quadG(at(p, off0, bottom), at(q, off0, bottom), at(q, off0, yq), at(p, off0, yp), concrete, 0.66, 0.9);
          if (back <= 4) st.quad([p.x, p.h, p.z], [q.x, q.h, q.z], at(q, off0, yq), at(p, off0, yp), slab, 0.96);
        } else {
          // Fascia with a parapet, the sloped soffit, and (club level) a ribbon board.
          st.mat = 0;
          st.quad(at(p, off0, yp - SLAB), at(q, off0, yq - SLAB), at(q, off0, yq + PARAPET), at(p, off0, yp + PARAPET), layout.trim, 1.05);
          st.quad(at(p, off0 - 0.05, yp + PARAPET - 0.5), at(q, off0 - 0.05, yq + PARAPET - 0.5), at(q, off0 - 0.05, yq + PARAPET), at(p, off0 - 0.05, yp + PARAPET), "#d9dcdf");
          st.mat = 1;
          // Soffit: open air at the lip, deep shade at the back.
          st.quadG(at(p, off0, yp - SLAB), at(q, off0, yq - SLAB), at(q, off1, yqB - SLAB), at(p, off1, ypB - SLAB), concrete, 0.8, 0.36);
          if (i % 3 === 0) st.beam(at(p, off0 + 1, yp - SLAB - 0.8), at(p, off1, ypB - SLAB - 0.8), 1.6, concrete, 0.46);
          // Soffit lighting: a downlight strip a few feet in from the lip.
          if (glow && off1 - off0 > 12) {
            const oL = off0 + 4;
            const yL = (yb: number) => yb - SLAB + (rise * 4) / (off1 - off0) - 0.12;
            const la = lerp3(at(p, oL, yL(yp)), at(q, oL, yL(yq)), 0.3);
            const lb = lerp3(at(p, oL, yL(yp)), at(q, oL, yL(yq)), 0.7);
            const lc = lerp3(at(p, oL + 1.4, yL(yp)), at(q, oL + 1.4, yL(yq)), 0.7);
            const ld = lerp3(at(p, oL + 1.4, yL(yp)), at(q, oL + 1.4, yL(yq)), 0.3);
            glow.quad(la, lb, lc, ld, opts.lit ? [1, 0.95, 0.82] : [0.62, 0.64, 0.66]);
          }
          if (led && di === 1) {
            const r = LED_ROW.ribbon;
            led.quadUv(at(p, off0 - 0.2, yp - SLAB + 0.7), at(q, off0 - 0.2, yq - SLAB + 0.7), at(q, off0 - 0.2, yq + PARAPET - 0.9), at(p, off0 - 0.2, yp + PARAPET - 0.9), [p.s / r.ft, r.v[0]], [q.s / r.ft, r.v[0]], [q.s / r.ft, r.v[1]], [p.s / r.ft, r.v[1]], ribbon);
          }
        }

        // Back wall: up to whatever hangs over it (a concourse or suite level), else a
        // parapet; the outermost deck's is the stadium facade.
        const cp = ceiling(d, i, p, off1 + 0.4, ypB);
        const cq = ceiling(d, i, q, off1 + 0.4, yqB);
        const open = !Number.isFinite(cp) || !Number.isFinite(cq);
        const tp = open ? ypB + 3.5 : cp;
        const tq = open ? yqB + 3.5 : cq;
        if (outermost) {
          const tall = Math.max(tp, tq) - GROUND_Y > 34;
          st.mat = tall ? facadeMat : 1;
          st.aux = Math.max(tp, tq);
          st.quadG(at(p, off1, GROUND_Y), at(q, off1, GROUND_Y), at(q, off1, tq), at(p, off1, tp), facade, tall ? 0.74 : 0.7, tall ? 1.02 : 0.9);
          st.aux = 0;
          st.mat = 0;
          // Cornice and the plaza around the park.
          st.quad(at(p, off1 + 0.5, tp - 2.6), at(q, off1 + 0.5, tq - 2.6), at(q, off1 + 0.5, tq + 0.4), at(p, off1 + 0.5, tp + 0.4), mix(facade, "#f2efe6", 0.55), 0.98);
          st.quad(at(p, off1 + 0.5, tp + 0.4), at(q, off1 + 0.5, tq + 0.4), at(q, off1 - 1.2, tq + 0.4), at(p, off1 - 1.2, tp + 0.4), mix(facade, "#f2efe6", 0.4), 0.9);
          st.mat = 1;
          st.quadG(at(p, off1, GROUND_Y + 0.12), at(q, off1, GROUND_Y + 0.12), at(q, off1 + PLAZA, GROUND_Y + 0.12), at(p, off1 + PLAZA, GROUND_Y + 0.12), "#8e8d87", 0.6, 0.86);
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
        st.mat = 1;

        // Where a tapering deck steps down, close the gap to the taller neighbour.
        if (i + 1 < d.i1 && d.rowsAt[i + 1] !== nR) {
          const o2 = off0 + d.rowsAt[i + 1] * dRow;
          const [oa, ob] = o2 > off1 ? [off1, o2] : [o2, off1];
          const ya = yq + (deck.rise * (oa - off0)) / deck.depth;
          const yb = yq + (deck.rise * (ob - off0)) / deck.depth;
          st.quad(at(q, oa, lower ? bottom : ya - SLAB), at(q, ob, outermost ? GROUND_Y : yb - SLAB), at(q, ob, yb + 3.5), at(q, oa, ya + 3.5), concrete, 0.74);
        }

        if (d.roof) {
          const { h, drop } = d.roof;
          const lip = Math.min(d.roof.lip, off1 - 6);
          const yl = (yb: number) => yb + h - drop;
          const face = layout.frieze ? 5.5 : 2.2;
          // Folded-plate roofs (Dodger Stadium's pavilions) zigzag from bay to bay.
          const zp = layout.canopyStyle === "zigzag" ? (i % 2 ? 3.4 : -3.4) : 0;
          const zq = -zp;
          const roofC = layout.canopy ?? layout.trim;
          st.mat = 5;
          st.quad(at(p, off1 + 1, ypB + h + zp), at(q, off1 + 1, yqB + h + zq), at(q, lip, yl(yqB) + zq), at(p, lip, yl(ypB) + zp), roofC, zp > 0 ? 0.9 : 1.02);
          st.mat = 0;
          st.quadG(at(p, lip, yl(ypB) - 1.4 + zp), at(q, lip, yl(yqB) - 1.4 + zq), at(q, off1 + 1, yqB + h - 1.4 + zq), at(p, off1 + 1, ypB + h - 1.4 + zp), mix(roofC, "#9aa0a6", 0.35), 0.82, 0.5);
          st.quad(at(p, lip, yl(ypB) + 0.3 + zp), at(q, lip, yl(yqB) + 0.3 + zq), at(q, lip, yl(yqB) - face + zq), at(p, lip, yl(ypB) - face + zp), layout.frieze ? "#f4f2ea" : mix(roofC, "#ffffff", 0.12), 1.05);
          if (layout.frieze) {
            // The frieze: a hanging arcade of narrow arched openings.
            const fa = at(p, lip - 0.08, yl(ypB));
            const fb = at(q, lip - 0.08, yl(yqB));
            for (let k = 0; k < 5; k += 1) {
              const c0 = lerp3(fa, fb, (k + 0.22) / 5);
              const c1 = lerp3(fa, fb, (k + 0.78) / 5);
              const cm = lerp3(fa, fb, (k + 0.5) / 5);
              st.quad([c0[0], c0[1] - face, c0[2]], [c1[0], c1[1] - face, c1[2]], [c1[0], c1[1] - 2.3, c1[2]], [c0[0], c0[1] - 2.3, c0[2]], "#59626e", 0.9);
              st.tri([c0[0], c0[1] - 2.3, c0[2]], [c1[0], c1[1] - 2.3, c1[2]], [cm[0], cm[1] - 1.3, cm[2]], "#59626e", 0.9);
            }
          }
          st.mat = 1;
          st.quad(at(p, off1, ypB + 3.5), at(q, off1, yqB + 3.5), at(q, off1, yqB + h), at(p, off1, ypB + h), facade, 0.7);
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
        for (let r = 0; r < nR; r += 1) {
          if (vomBay && r >= v0 && r < v0 + nv) continue;
          const o = off0 + (r + 0.6) * dRow;
          const y0 = r * hRow;
          const a = at(p, o, yp + y0);
          const b = at(q, o, yq + y0);
          if (r === walk) {
            // People on the cross-aisle (rank ≥ 100 marks them as walkers).
            for (let k = 0; k < 2; k += 1) {
              seed += 1;
              if (hash(seed) > 0.3) continue;
              const g = hash(seed + 0.37);
              slots.push(a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g, a[2] + (b[2] - a[2]) * g);
              yaws.push(yaw);
              meta.push(light(d, i, mid, o, yF(d, mid) + y0), 100 + di);
            }
            continue;
          }
          const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
          const g0 = !deck.berm && i % 3 === 0 ? AISLE / len : 0;
          const g1 = !deck.berm && i % 3 === 2 ? 1 - AISLE / len : 1;
          const perRow = Math.max(1, Math.round((len * (g1 - g0)) / PITCH));
          if (!deck.berm && ceiling(d, i, mid, o, yF(d, mid) + y0) - (yF(d, mid) + y0) < 6.4) continue;
          const sh = light(d, i, mid, o, yF(d, mid) + y0);
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

      // Closed ends (unless the neighbouring section carries the deck on).
      st.mat = 1;
      const ends: Array<[number, number, boolean]> = [
        [d.i0, d.i0, d.i0 > 0 || !continues(deck, -1, spec.from)],
        [d.i1, d.i1 - 1, d.i1 < n || !continues(deck, 1, spec.to)],
      ];
      for (const [pi, si, wall] of ends) {
        if (!wall) continue;
        const p = sm[pi];
        const y = yF(d, p);
        const o1 = offEnd(d, si);
        const rise = (deck.rise * (o1 - off0)) / deck.depth;
        if (lower) st.quadG(at(p, off0, bottom), at(p, o1, bottom), at(p, o1, y + rise + 3.5), at(p, off0, y + (deck.berm ? 0 : 2.6)), concrete, 0.62, 0.86);
        else {
          st.quad(at(p, off0, y - SLAB), at(p, o1, y + rise - SLAB), at(p, o1, y + rise + 3.5), at(p, off0, y + PARAPET), concrete, 0.78);
          const c0 = Math.max(off0, lowBack);
          if (c0 < o1 - 1) st.quadG(at(p, c0, GROUND_Y), at(p, o1, GROUND_Y), at(p, o1, soffit(d, p, o1)), at(p, c0, soffit(d, p, c0)), facade, 0.6, 0.8);
        }
        if (d.roof) st.tri(at(p, o1, y + rise + 3.5), at(p, o1, y + rise + d.roof.h), at(p, Math.min(d.roof.lip, o1 - 6), y + rise + d.roof.h - d.roof.drop), concrete, 0.66);
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
