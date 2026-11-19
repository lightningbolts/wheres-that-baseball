"use client";

import { useEffect, useRef } from "react";
import { getTeamColor } from "@/lib/mlb/teamColors";
import type { CelebrationView } from "@/components/game/controller";

/** Kicker over the title, by what kind of party it is. */
function kicker(c: CelebrationView): string {
  if (c.stake === "world-series") return "World Series";
  if (c.stake === "pennant") return "Pennant";
  if (c.stake === "series-clinch") return "Postseason";
  if (c.stake === "clinch-division" || c.stake === "clinch-wildcard") return "Clinched";
  if (c.stake === "elimination-save") return "Postseason";
  if (c.feat) return "History";
  if (c.walkoff) return "Walk-off";
  return "Final";
}

/**
 * The postgame card over the on-field celebration: the headline, what it means, and a way
 * past it. A click anywhere below the HUD bar (or Space / Esc) skips to the final screen.
 * Big moments get fireworks over the park and, for a pennant or a title, confetti.
 */
export function CelebrationOverlay({ celebration: c, onSkip }: { celebration: CelebrationView | null; onSkip: () => void }) {
  if (!c) return null;
  const color = getTeamColor(c.winnerTeamId);
  const gold = c.stake === "world-series" || c.stake === "pennant";
  const big = !c.subdued && (gold || !!c.feat || c.style === "walkoff" || c.style === "huddle" || c.style === "dogpile");
  const titleTone = c.subdued ? "text-white/80" : gold ? "bg-gradient-to-b from-amber-100 via-amber-300 to-amber-600 bg-clip-text text-transparent" : c.tone === "good" ? "text-emerald-200" : "text-white";
  return (
    <div className="absolute inset-x-0 bottom-0 top-12 z-20 cursor-pointer" onClick={onSkip} role="button" aria-label="Skip the celebration" tabIndex={-1}>
      {!c.subdued && (c.fireworks || c.confetti) && <Sky fireworks={c.fireworks} confetti={c.confetti} color={color} />}
      <div className="pointer-events-none absolute inset-x-0 top-[12%] flex justify-center px-4">
        <div className={`animate-play_in text-center ${c.subdued ? "rounded-xl bg-black/45 px-5 py-2 backdrop-blur" : "rounded-2xl bg-black/35 px-7 py-4 shadow-2xl backdrop-blur-sm"}`} style={c.subdued ? undefined : { boxShadow: `0 0 0 2px ${color}88, 0 20px 60px rgba(0,0,0,0.5)` }}>
          <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/70">{kicker(c)}</div>
          <div className={`font-black uppercase tracking-tight ${big ? "text-4xl sm:text-6xl" : c.subdued ? "text-2xl sm:text-3xl" : "text-3xl sm:text-5xl"} ${titleTone}`} style={big && !gold ? { textShadow: `0 3px 0 ${color}, 0 0 28px ${color}aa` } : undefined}>
            {gold ? `★ ${c.title} ★` : c.title}
          </div>
          {c.sub && <div className={`mt-1 ${c.subdued ? "text-xs" : "text-sm sm:text-base"} text-white/85`}>{c.sub}</div>}
        </div>
      </div>
      <button
        className="absolute bottom-3 right-3 rounded-md border border-white/20 bg-black/55 px-3 py-1.5 text-xs font-semibold text-white/90 backdrop-blur hover:bg-black/75"
        onClick={(e) => {
          e.stopPropagation();
          onSkip();
        }}
        title="Skip to the final (Space / Esc)"
      >
        Skip ▸
      </button>
    </div>
  );
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  kind: 0 | 1;
  rot: number;
}

const PALETTE = ["#ffd75e", "#ff6b6b", "#7cc7ff", "#ffffff", "#9cf3a8", "#ff9de2"];

/** Fireworks bursting over the park and confetti drifting down, on a 2D canvas over the scene. */
function Sky({ fireworks, confetti, color }: { fireworks: boolean; confetti: boolean; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const x = cv.getContext("2d");
    if (!x) return;
    let raf = 0;
    let last = performance.now();
    let nextShell = 0.2;
    let nextConfetti = 0;
    const sparks: Spark[] = [];
    const colors = [color, ...PALETTE];
    const resize = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    let t = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (fireworks && t >= nextShell) {
        nextShell = t + 0.35 + Math.random() * 0.6;
        const cx = w * (0.15 + Math.random() * 0.7);
        const cy = h * (0.08 + Math.random() * 0.3);
        const c = colors[Math.floor(Math.random() * colors.length)];
        const n = 46 + Math.floor(Math.random() * 30);
        const sp = 90 + Math.random() * 90;
        for (let i = 0; i < n; i += 1) {
          const a = (i / n) * Math.PI * 2 + Math.random() * 0.1;
          const v = sp * (0.6 + Math.random() * 0.4);
          sparks.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 1.1 + Math.random() * 0.6, color: c, kind: 0, rot: 0 });
        }
      }
      if (confetti && t >= nextConfetti && t < 14) {
        nextConfetti = t + 0.03;
        for (let i = 0; i < 3; i += 1)
          sparks.push({ x: Math.random() * w, y: -10, vx: (Math.random() - 0.5) * 40, vy: 40 + Math.random() * 60, life: 0, max: 7, color: colors[Math.floor(Math.random() * colors.length)], kind: 1, rot: Math.random() * 6 });
      }
      x.clearRect(0, 0, w, h);
      x.globalCompositeOperation = "lighter";
      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const s = sparks[i];
        s.life += dt;
        if (s.life >= s.max || s.y > h + 20) {
          sparks.splice(i, 1);
          continue;
        }
        if (s.kind === 0) {
          s.vx *= 1 - 1.6 * dt;
          s.vy = s.vy * (1 - 1.6 * dt) + 60 * dt;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          const a = 1 - s.life / s.max;
          x.globalAlpha = a;
          x.fillStyle = s.color;
          x.beginPath();
          x.arc(s.x, s.y, 1.2 + 1.3 * a, 0, Math.PI * 2);
          x.fill();
        }
      }
      x.globalCompositeOperation = "source-over";
      for (const s of sparks) {
        if (s.kind !== 1) continue;
        s.x += (s.vx + Math.sin(t * 2 + s.rot) * 20) * dt;
        s.y += s.vy * dt;
        s.rot += dt * 5;
        x.globalAlpha = Math.min(1, (s.max - s.life) / 1.5);
        x.fillStyle = s.color;
        x.save();
        x.translate(s.x, s.y);
        x.rotate(s.rot);
        x.fillRect(-3, -1.5, 6, 3);
        x.restore();
      }
      x.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [fireworks, confetti, color]);
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}
