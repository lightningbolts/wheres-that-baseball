/**
 * Graphics quality: a user setting (Auto / High / Medium / Low, persisted) and the tier
 * the 3D view actually runs at.
 *
 * A tier's settings come in two kinds:
 * - boot settings (antialiasing, logarithmic depth, texture resolutions) are fixed when
 *   the WebGL context and the park are built; changing them rebuilds the 3D view.
 * - live settings (pixel ratio, shadow map size, crowd density, clouds) apply on the fly.
 *
 * Auto picks a starting tier from the device (cores, memory, GPU, max texture size); a
 * frame-rate monitor may then step the live settings down. It never steps back up, only
 * applies a step while the picture is covered (a broadcast cut, the inning bumper), and
 * remembers the tier it settled on, so the view never visibly changes during play.
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
/** Auto's settled live tier, keyed to the detected tier it was learned under. */
const AUTO_KEY = "playball.graphics.auto";
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

function loadAutoLive(d: Tier): Tier | null {
  try {
    const v = window.localStorage.getItem(AUTO_KEY);
    const [from, to] = (v ?? "").split(">");
    if (from === d && (ORDER as string[]).includes(to)) return to as Tier;
  } catch {
    // Storage blocked: start at the detected tier.
  }
  return null;
}

function build(): QualityState {
  if (setting === null) setting = loadSetting();
  if (detected === null) {
    detected = classifyDevice(readDeviceInfo());
    autoLive = loadAutoLive(detected);
  }
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
    // Choosing Auto again starts it over from the device's tier.
    window.localStorage.removeItem(AUTO_KEY);
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
 * Auto: the frame-rate monitor lowers the live tier one step, and the device keeps it.
 * Returns whether the tier actually changed.
 */
export function stepAutoTierDown(): boolean {
  const q = getQuality();
  if (q.setting !== "auto") return false;
  const i = Math.max(0, rank(q.live.tier) - 1);
  if (ORDER[i] === q.live.tier) return false;
  autoLive = ORDER[i];
  try {
    window.localStorage.setItem(AUTO_KEY, `${q.detected}>${autoLive}`);
  } catch {
    // Not persisted; still applies for this session.
  }
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
  /** Step down when at least `slowShare` of samples are under target × down. */
  down: number;
  slowShare: number;
  /** After a tier change, wait this long before sampling (shaders, shadow maps rebuild). */
  settleMs: number;
  /** A gap this long between frames (hidden tab, a stall) throws the current sample away. */
  gapMs: number;
}

const GOVERNOR: GovernorOptions = {
  windowMs: 500,
  samples: 8,
  target: 60,
  down: 0.75,
  slowShare: 0.75,
  settleMs: 2000,
  gapMs: 250,
};

/**
 * Auto's frame-rate judge. Feed it every frame's timestamp; it answers true when the live
 * tier should step down. Report a step with `stepped`.
 *
 * Every tier change is visible (the canvas resizes, the shadow map is rebuilt, the crowd
 * thins), so it only ever steps down, and only on a sustained slow spell. It never steps
 * back up: on a capped 60 Hz display a step down reads as headroom straight away, and any
 * step up just sets up the next step down, a flicker every half-minute.
 */
export class FpsGovernor {
  private readonly o: GovernorOptions;
  private winStart = -1;
  private last = -1;
  private frames = 0;
  private fps: number[] = [];
  private holdUntil = 0;

  constructor(o: Partial<GovernorOptions> = {}) {
    this.o = { ...GOVERNOR, ...o };
  }

  frame(now: number): boolean {
    if (now < this.holdUntil) return false;
    const gap = this.last >= 0 && now - this.last > this.o.gapMs;
    this.last = now;
    if (this.winStart < 0 || gap) {
      this.winStart = now;
      this.frames = 0;
      return false;
    }
    this.frames += 1;
    const span = now - this.winStart;
    if (span < this.o.windowMs) return false;
    this.fps.push((this.frames / span) * 1000);
    this.winStart = now;
    this.frames = 0;
    if (this.fps.length < this.o.samples) return false;
    const slow = this.fps.filter((x) => x < this.o.target * this.o.down).length;
    this.fps.shift();
    return slow >= this.o.samples * this.o.slowShare;
  }

  /** The tier stepped down (or a pending step was dropped): start measuring afresh. */
  stepped(now: number): void {
    this.fps = [];
    this.winStart = -1;
    this.holdUntil = now + this.o.settleMs;
  }
}

export function useQuality(): QualityState {
  return useSyncExternalStore(subscribeQuality, getQuality, () => SERVER);
}

export const SETTING_LABEL: Record<QualitySetting, string> = { auto: "Auto", high: "High", medium: "Medium", low: "Low" };
