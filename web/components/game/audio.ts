/**
 * Synthesized ballpark sounds (WebAudio, no asset downloads): bat crack, mitt pop,
 * umpire call blip, and a crowd bed that swells on big moments.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let crowdGain: GainNode | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.7;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const b = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
  return b;
}

let noise: AudioBuffer | null = null;

function burst(freq: number, q: number, dur: number, gain: number, type: BiquadFilterType = "bandpass") {
  const c = ac();
  if (!c || !master) return;
  noise = noise ?? noiseBuffer(c, 2);
  const src = c.createBufferSource();
  src.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  const t = c.currentTime;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

function tone(freq: number, dur: number, gain: number, type: OscillatorType = "sine", slideTo?: number) {
  const c = ac();
  if (!c || !master) return;
  const o = c.createOscillator();
  o.type = type;
  const t = c.currentTime;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  unlock() {
    ac();
  },
  setMuted(m: boolean) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.7;
  },
  get muted() {
    return muted;
  },
  /** Bat on ball; ev (mph) sets brightness and loudness. */
  crack(ev: number) {
    const k = Math.min(1, Math.max(0.2, (ev - 50) / 60));
    burst(1800 + k * 1600, 2.5, 0.09 + k * 0.08, 0.5 + k * 0.6);
    tone(700 + k * 500, 0.07, 0.25 * k, "triangle", 300);
  },
  foulTip() {
    burst(2600, 4, 0.05, 0.35);
  },
  mitt() {
    burst(380, 1.2, 0.1, 0.9, "lowpass");
    tone(150, 0.08, 0.4, "sine", 70);
  },
  glove() {
    burst(600, 1.5, 0.06, 0.5, "lowpass");
  },
  call(strike: boolean) {
    tone(strike ? 520 : 330, 0.12, 0.08, "square", strike ? 480 : 300);
  },
  /** Crowd bed (call once on game start); `swell` raises it briefly. */
  startCrowd() {
    const c = ac();
    if (!c || !master || crowdGain) return;
    noise = noise ?? noiseBuffer(c, 2);
    const src = c.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 900;
    f.Q.value = 0.4;
    crowdGain = c.createGain();
    crowdGain.gain.value = 0.05;
    src.connect(f).connect(crowdGain).connect(master);
    src.start();
  },
  swell(amount: number, seconds = 3) {
    const c = ac();
    if (!c || !crowdGain) return;
    const t = c.currentTime;
    crowdGain.gain.cancelScheduledValues(t);
    crowdGain.gain.setValueAtTime(crowdGain.gain.value, t);
    crowdGain.gain.linearRampToValueAtTime(0.05 + 0.4 * amount, t + 0.4);
    crowdGain.gain.linearRampToValueAtTime(0.05, t + seconds);
  },
  /** A disappointed crowd: a low "aww" that falls away (no lift of the crowd bed). */
  groan(amount: number) {
    const c = ac();
    if (!c || !master || amount <= 0) return;
    noise = noise ?? noiseBuffer(c, 2);
    const src = c.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.6;
    const t = c.currentTime;
    f.frequency.setValueAtTime(520, t);
    f.frequency.exponentialRampToValueAtTime(240, t + 1.8);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.35 * amount, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random());
    src.stop(t + 2.1);
  },
  /** The building erupts: a big roar on top of the crowd bed that holds, then falls away over `seconds`. */
  cheer(amount: number, seconds = 6) {
    const c = ac();
    if (!c || !master || amount <= 0) return;
    noise = noise ?? noiseBuffer(c, 2);
    const t = c.currentTime;
    for (const [freq, q, k] of [
      [1100, 0.5, 1],
      [2400, 0.8, 0.45],
    ] as const) {
      const src = c.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.5 * amount * k, t + 0.35);
      g.gain.setValueAtTime(0.5 * amount * k, t + seconds * 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
      src.connect(f).connect(g).connect(master);
      src.start(t, Math.random());
      src.stop(t + seconds + 0.1);
    }
    this.swell(amount, seconds);
  },
  /** One firework shell: a low boom and a trailing crackle. */
  firework() {
    burst(140, 0.8, 0.9, 0.9, "lowpass");
    tone(70, 0.5, 0.35, "sine", 38);
    const c = ac();
    if (!c) return;
    setTimeout(() => burst(3200, 1.5, 0.6, 0.18), 180);
  },
  stopCrowd() {
    crowdGain?.disconnect();
    crowdGain = null;
  },
};
