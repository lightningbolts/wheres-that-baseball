/**
 * Graphics quality: a user setting (Auto / High / Medium / Low, persisted) and the tier
 * the 3D view actually runs at.
 *
 * A tier's settings come in two kinds:
 * - boot settings (antialiasing, logarithmic depth, texture resolutions) are fixed when
 *   the WebGL context and the park are built; changing them rebuilds the 3D view.
 * - live settings (pixel ratio, shadow map size, crowd density, clouds) apply on the fly.
 *
 * Auto picks a starting tier from the device (cores, memory, GPU, max texture size) and
 * then a frame-rate monitor steps the live settings down (and back up, never above the
 * starting tier) while the game runs.
 */
import { useSyncExternalStore } from "react";

export type QualitySetting = "auto" | "high" | "medium" | "low";
export type Tier = "high" | "medium" | "low";

export interface QualityProfile {
  tier: Tier;
  // ---- boot (rebuild the view to change) ----
  /** MSAA on the default framebuffer. */
  antialias: boolean;
  /**
   * Logarithmic depth: keeps layered surfaces (chalk on dirt on grass, ads on walls) apart
   * through long lenses, at the cost of early depth rejection on every pixel.
   */
  logDepth: boolean;
  /** Per-person uniform atlas: 2 = 1024² canvases, 1 = 512². */
  atlasScale: 1 | 2;
  /** Mowing-pattern texture size (px square). */
  mow: number;
  // ---- live ----
  /** Device pixel ratio range for the canvas. */
  dpr: [number, number];
  /** Key-light shadow map size (px square). */
  shadowMap: number;
  /** Fraction of the crowd drawn. */
  crowd: number;
  /** Procedural clouds in the sky shader (a 4-octave noise over every sky pixel). */
  clouds: boolean;
}

export const PROFILES: Record<Tier, QualityProfile> = {
  high: { tier: "high", antialias: true, logDepth: true, atlasScale: 2, mow: 2048, dpr: [1, 1.5], shadowMap: 4096, crowd: 1, clouds: true },
  medium: { tier: "medium", antialias: true, logDepth: true, atlasScale: 1, mow: 2048, dpr: [1, 1], shadowMap: 2048, crowd: 0.6, clouds: true },
  low: { tier: "low", antialias: false, logDepth: false, atlasScale: 1, mow: 1024, dpr: [0.75, 0.75], shadowMap: 1024, crowd: 0.3, clouds: false },
};

const ORDER: Tier[] = ["low", "medium", "high"];
const rank = (t: Tier) => ORDER.indexOf(t);
const lower = (a: Tier, b: Tier): Tier => (rank(a) <= rank(b) ? a : b);

export interface DeviceInfo {
  /** navigator.hardwareConcurrency */
  cores?: number;
  /** navigator.deviceMemory (GB; Chrome caps it at 8) */
  memory?: number;
  /** WebGL renderer string (unmasked where the browser allows). */
  renderer?: string;
  /** gl.MAX_TEXTURE_SIZE */
  maxTexture?: number;
  /** A phone-sized screen. */
  smallScreen?: boolean;
  /** No WebGL2 context could be created at all. */
  noWebGL2?: boolean;
}

/** The starting tier for a device: the weakest any one signal points to. */
export function classifyDevice(d: DeviceInfo): Tier {
  let t: Tier = "high";
  const r = (d.renderer ?? "").toLowerCase();
  if (d.noWebGL2) return "low";
  // Software rasterizers: everything on the CPU.
  if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(r)) return "low";
  if (d.maxTexture !== undefined && d.maxTexture <= 4096) t = lower(t, "low");
  if (d.cores !== undefined) t = lower(t, d.cores <= 2 ? "low" : d.cores <= 4 ? "medium" : "high");
  if (d.memory !== undefined) t = lower(t, d.memory <= 2 ? "low" : d.memory <= 4 ? "medium" : "high");
  if (d.smallScreen) t = lower(t, "medium");
  if (r) {
    // Older Intel integrated graphics (HD 2000-5xxx, GMA) and old mobile GPUs.
    if (/hd graphics [2-5]\d{3}\b|gma|mali-[4t]|adreno \(tm\) [2-4]\d\d|powervr|videocore/.test(r)) t = lower(t, "low");
    // Other integrated / mobile GPUs (Intel UHD, Iris, recent Mali/Adreno) — but not Intel Arc.
    else if (/intel|mali|adreno|apple a\d/.test(r) && !/\barc\b/.test(r)) t = lower(t, "medium");
  }
  return t;
}

let device: DeviceInfo | null = null;

/** Probe the browser once (a throwaway WebGL2 context, released right away). */
export function readDeviceInfo(): DeviceInfo {
  if (device) return device;
  const d: DeviceInfo = {};
  if (typeof window === "undefined") return d;
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (nav.hardwareConcurrency) d.cores = nav.hardwareConcurrency;
  if (nav.deviceMemory) d.memory = nav.deviceMemory;
  d.smallScreen = Math.min(window.screen?.width ?? 2000, window.screen?.height ?? 2000) < 600;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (!gl) d.noWebGL2 = true;
    else {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      d.renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
      d.maxTexture = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || undefined;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    // Leave the GPU unknown.
  }
  device = d;
  return d;
}

// ---------- the setting and the live tier ----------

const KEY = "playball.graphics";
const SETTINGS: QualitySetting[] = ["auto", "high", "medium", "low"];

export interface QualityState {
  setting: QualitySetting;
  /** Tier the view was built at (boot settings). */
  boot: QualityProfile;
  /** Tier the live settings run at (Auto may sit below `boot`). */
  live: QualityProfile;
  /** Auto's device-based starting tier. */
  detected: Tier;
}

function loadSetting(): QualitySetting {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v && (SETTINGS as string[]).includes(v)) return v as QualitySetting;
  } catch {
    // Storage blocked: stay on Auto.
  }
  return "auto";
}

let setting: QualitySetting | null = null;
let detected: Tier | null = null;
/** Auto only: where the frame-rate monitor has moved the live tier. */
let autoLive: Tier | null = null;
let snap: QualityState | null = null;
const listeners = new Set<() => void>();

const SERVER: QualityState = { setting: "auto", boot: PROFILES.high, live: PROFILES.high, detected: "high" };

function build(): QualityState {
  if (setting === null) setting = loadSetting();
  if (detected === null) detected = classifyDevice(readDeviceInfo());
  const boot = setting === "auto" ? detected : setting;
  const live = setting === "auto" ? lower(autoLive ?? boot, boot) : setting;
  return { setting, boot: PROFILES[boot], live: PROFILES[live], detected };
}

function changed() {
  snap = build();
  for (const l of listeners) l();
}

export function getQuality(): QualityState {
  if (typeof window === "undefined") return SERVER;
  if (!snap) snap = build();
  return snap;
}

export function subscribeQuality(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setQualitySetting(s: QualitySetting): void {
  setting = s;
  autoLive = null;
  try {
    window.localStorage.setItem(KEY, s);
  } catch {
    // Not persisted; still applies for this session.
  }
  changed();
}

/** Next setting in the Auto → High → Medium → Low cycle. */
export function nextSetting(s: QualitySetting): QualitySetting {
  return SETTINGS[(SETTINGS.indexOf(s) + 1) % SETTINGS.length];
}

/**
 * Auto: the frame-rate monitor moves the live tier one step (never above the starting tier).
 * Returns whether the tier actually changed.
 */
export function stepAutoTier(dir: -1 | 1): boolean {
  const q = getQuality();
  if (q.setting !== "auto") return false;
  const i = Math.min(rank(q.boot.tier), Math.max(0, rank(q.live.tier) + dir));
  if (ORDER[i] === q.live.tier) return false;
  autoLive = ORDER[i];
  changed();
  return true;
}

export interface GovernorOptions {
  /** Length of one frame-rate sample, ms. */
  windowMs: number;
  /** Samples per verdict. */
  samples: number;
  /** Frame rate the game aims for. Fixed: a scene that never reaches it must still step down. */
  target: number;
  /** Step down when most samples are under target × down… */
  down: number;
  /** …and back up when most are over target × up. */
  up: number;
  /** Stop adjusting after this many real reversals (down then up, or up then down). */
  maxReversals: number;
  /** After a tier change, wait this long before sampling (shaders, shadow maps rebuild). */
  settleMs: number;
  /** A gap this long between frames (hidden tab, a stall) throws the current sample away. */
  gapMs: number;
}

const GOVERNOR: GovernorOptions = { windowMs: 500, samples: 6, target: 60, down: 0.75, up: 0.95, maxReversals: 3, settleMs: 2000, gapMs: 250 };

/**
 * Auto's frame-rate judge. Feed it every frame's timestamp; it answers -1 (step down),
 * 1 (step up) or 0. Report what the step did with `stepped`: steps that leave the tier
 * where it was (already at the top or bottom) never count toward giving up.
 */
export class FpsGovernor {
  private readonly o: GovernorOptions;
  private winStart = -1;
  private last = -1;
  private frames = 0;
  private fps: number[] = [];
  private lastDir = 0;
  private holdUntil = 0;
  reversals = 0;
  stopped = false;

  constructor(o: Partial<GovernorOptions> = {}) {
    this.o = { ...GOVERNOR, ...o };
  }

  frame(now: number): -1 | 0 | 1 {
    if (this.stopped || now < this.holdUntil) return 0;
    const gap = this.last >= 0 && now - this.last > this.o.gapMs;
    this.last = now;
    if (this.winStart < 0 || gap) {
      this.winStart = now;
      this.frames = 0;
      return 0;
    }
    this.frames += 1;
    const span = now - this.winStart;
    if (span < this.o.windowMs) return 0;
    this.fps.push((this.frames / span) * 1000);
    this.winStart = now;
    this.frames = 0;
    if (this.fps.length < this.o.samples) return 0;
    const slow = this.fps.filter((f) => f < this.o.target * this.o.down).length;
    const fast = this.fps.filter((f) => f >= this.o.target * this.o.up).length;
    this.fps = [];
    const half = this.o.samples / 2;
    return slow > half ? -1 : fast > half ? 1 : 0;
  }

  stepped(dir: -1 | 1, changedTier: boolean, now: number): void {
    if (!changedTier) return;
    if (this.lastDir !== 0 && dir !== this.lastDir) this.reversals += 1;
    this.lastDir = dir;
    this.fps = [];
    this.winStart = -1;
    this.holdUntil = now + this.o.settleMs;
    if (this.reversals >= this.o.maxReversals) this.stopped = true;
  }
}

export function useQuality(): QualityState {
  return useSyncExternalStore(subscribeQuality, getQuality, () => SERVER);
}

export const SETTING_LABEL: Record<QualitySetting, string> = { auto: "Auto", high: "High", medium: "Medium", low: "Low" };
