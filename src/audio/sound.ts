// Every sound is made here with the Web Audio API; there are no audio files.
// Chimes are struck free-free bars: a fundamental plus the bar's real inharmonic overtones (2.756, 5.404 and 8.933
// times the fundamental), each dying away faster than the one below. Bells, wooden knocks, glass clicks and the tray
// are built the same way from oscillators and filtered noise. A harder hit is louder and brighter.

import { NOTES } from '../board/board.ts';

const BAR = [1, 2.756, 5.404, 8.933];

export class Sound {
  ctx: AudioContext | null = null;
  private out!: GainNode;
  private dry!: GainNode;
  private wet!: GainNode;
  private noise!: AudioBuffer;
  private rollGain: GainNode | null = null;
  private voices = 0;
  muted = false;
  volume = 0.55;

  /** Create the audio graph. Call from a user gesture only. */
  start(): boolean {
    if (this.ctx) { void this.ctx.resume(); return true; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : this.volume;
    this.out.connect(comp).connect(ctx.destination);
    this.dry = ctx.createGain(); this.dry.connect(this.out);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.22;
    const verb = ctx.createConvolver();
    verb.buffer = this.room(ctx);
    this.wet.connect(verb).connect(this.out);
    // One second of white noise, reused for clicks, knocks and the rolling sound.
    const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = n.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) >>> 0; d[i] = (s / 2 ** 31) - 1; }
    this.noise = n;
    this.startRolling();
    void ctx.resume();
    return true;
  }

  /** A small wooden room: decaying stereo noise, darker as it fades. */
  private room(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 1.3);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    let s = 777;
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const t = i / len;
        const k = 0.35 + 0.6 * t; // more smoothing later: high end dies first
        lp = lp * k + ((s / 2 ** 31) - 1) * (1 - k);
        d[i] = lp * Math.pow(1 - t, 2.4) * 1.6;
      }
    }
    return b;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.out.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.03);
  }

  suspend(): void { if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend(); }
  resume(): void { if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume(); }

  get live(): boolean { return !!this.ctx && this.ctx.state === 'running' && !this.muted; }

  private pan(x: number): StereoPannerNode {
    const p = this.ctx!.createStereoPanner();
    p.pan.value = Math.max(-0.6, Math.min(0.6, (x - 4.5) / 7));
    p.connect(this.dry);
    p.connect(this.wet);
    return p;
  }

  private voice(sec: number): boolean {
    if (this.voices > 40) return false;
    this.voices++;
    setTimeout(() => { this.voices--; }, sec * 1000 + 50);
    return true;
  }

  /** Map impact speed (pitches per second) to 0..1. */
  private level(speed: number, full: number): number {
    return Math.min(1, Math.pow(speed / full, 0.75));
  }

  private partial(dest: AudioNode, f: number, gain: number, decay: number, t: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(Math.max(gain * 0.0005, 1e-5), t + decay * 6.9);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + decay * 6.9 + 0.02);
  }

  private burst(dest: AudioNode, t: number, gain: number, len: number, filter: BiquadFilterType, f: number, q = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bq = ctx.createBiquadFilter();
    bq.type = filter; bq.frequency.value = f; bq.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(1e-4, t + len);
    src.connect(bq).connect(g).connect(dest);
    src.start(t, (t * 7.3) % 0.8);
    src.stop(t + len + 0.02);
  }

  /** A struck chime bar. */
  chime(note: number, speed: number, x: number, when = 0): void {
    if (!this.live || !this.voice(2.5)) return;
    const t = this.ctx!.currentTime + when;
    const f = NOTES[note].hz;
    const v = this.level(speed, 13);
    const bright = 0.35 + 0.65 * v;
    const dest = this.pan(x);
    const g = 0.2 * v + 0.015;
    const decays = [2.4, 0.75, 0.28, 0.12].map((d) => d * Math.pow(523 / f, 0.35));
    const gains = [1, 0.32 * bright, 0.14 * bright * bright, 0.05 * bright * bright];
    BAR.forEach((r, i) => { if (f * r < 15000) this.partial(dest, f * r, g * gains[i], decays[i], t); });
    // A whisper of beating, as a real bar on soft mounts has.
    this.partial(dest, f * 1.0016, g * 0.18, decays[0] * 0.8, t);
    // The glass tick of the marble meeting metal.
    this.burst(dest, t, 0.05 * v, 0.012, 'highpass', 5200, 0.7);
  }

  /** A small cast brass bell: inharmonic partials with a shimmer from two close pitches. */
  bell(speed: number, x: number, when = 0): void {
    if (!this.live || !this.voice(2)) return;
    const t = this.ctx!.currentTime + when;
    const v = this.level(speed, 12);
    const f = 1567.98; // G6, inside the scale
    const dest = this.pan(x);
    const g = 0.12 * v + 0.01;
    const parts: [number, number, number][] = [[1, 1, 1.5], [1.0042, 0.6, 1.3], [2.37, 0.45 * (0.5 + v), 0.6], [3.93, 0.22 * v, 0.35], [5.6, 0.12 * v, 0.18]];
    for (const [r, a, d] of parts) this.partial(dest, f * r, g * a, d, t);
    this.burst(dest, t, 0.06 * v, 0.02, 'bandpass', 6000, 1.5);
  }

  /** A soft knock of glass on sanded beech. */
  knock(speed: number, x: number, when = 0, deep = false): void {
    if (!this.live || !this.voice(0.3)) return;
    const t = this.ctx!.currentTime + when;
    const v = this.level(speed, 16);
    if (v < 0.06) return;
    const dest = this.pan(x);
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const f0 = deep ? 150 : 210 + 60 * v;
    o.frequency.setValueAtTime(f0 * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f0, t + 0.02);
    const g = ctx.createGain();
    const a = (deep ? 0.22 : 0.16) * v;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(a, t + 0.002);
    g.gain.exponentialRampToValueAtTime(1e-4, t + (deep ? 0.16 : 0.09));
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + 0.2);
    this.burst(dest, t, 0.09 * v, deep ? 0.06 : 0.035, 'bandpass', deep ? 700 : 1200, 1.2);
  }

  /** Two glass marbles meeting. */
  glass(speed: number, x: number, when = 0): void {
    if (!this.live || !this.voice(0.2)) return;
    const t = this.ctx!.currentTime + when;
    const v = this.level(speed, 10);
    const dest = this.pan(x);
    this.partial(dest, 3300, 0.05 * v, 0.018, t);
    this.partial(dest, 5100, 0.03 * v, 0.012, t);
    this.burst(dest, t, 0.04 * v, 0.01, 'highpass', 4000);
  }

  /** The hollow box of the catch tray. */
  tray(speed: number, x: number, when = 0): void {
    this.knock(speed, x, when, true);
  }

  private startRolling(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 320; bp.Q.value = 0.8;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    this.rollGain = ctx.createGain(); this.rollGain.gain.value = 0;
    src.connect(bp).connect(lp).connect(this.rollGain).connect(this.dry);
    src.start();
  }

  /** The quiet rumble of marbles rolling in wooden grooves; level is the sum of their speeds. */
  rolling(level: number): void {
    if (!this.ctx || !this.rollGain) return;
    const g = Math.min(0.09, level * 0.006);
    this.rollGain.gain.setTargetAtTime(this.muted ? 0 : g, this.ctx.currentTime, 0.05);
  }
}
