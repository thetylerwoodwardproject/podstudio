/*
 * Hotkey pads, live (handoff §7): every assigned pad decoded into an
 * AudioBuffer up front, so a press plays with no fetch or decode.
 *
 *   source → fade/stop gain → duck gain → pads volume → headphones
 *
 * The pads never touch the mic: they're played on their own AudioContext and
 * are rebuilt for the Pads track at export from the press log (pads-render.ts).
 * The ducker follows the mic's level; the render uses the same attack, release
 * and threshold on the recorded mic.
 */
import { padLength, readLibraryFile, type Pad, type PadSettings } from '../pads';
import type { PadLog, PadPress } from './pads-render';

interface Voice {
  pad: Pad;
  src: AudioBufferSourceNode;
  fade: GainNode;
  /** The pad's level (its saved volume, or where it was ridden to) */
  level: GainNode;
  levelDb: number;
  duck: GainNode;
  /** ctx time it started */
  started: number;
  len: number;
  stopping: boolean;
  logged: PadPress | null;
}

export interface Playing {
  key: number;
  pad: Pad;
  /** Seconds played */
  pos: number;
  len: number;
  stopping: boolean;
  levelDb: number;
}

const HOLD_RELEASE = 0.15;
const DECLICK = 0.01;
const dbToGain = (db: number) => 10 ** (db / 20);

export class PadEngine {
  ctx: AudioContext | null = null;
  pads = new Map<number, Pad>();
  private buffers = new Map<string, AudioBuffer>();
  private voices = new Map<number, Voice>();
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private talking = false;
  settings: PadSettings;
  /** Presses and volume changes while recording */
  log: PadLog = { presses: [], volume: [] };
  /** Session time while recording, or null (rehearsing: nothing is logged) */
  clock: () => number | null = () => null;
  onPress: (p: PadPress) => void = () => {};
  onEnd: (p: PadPress, t: number) => void = () => {};
  /** The most recent press, for the rail */
  latest: { key: number; name: string; at: number } | null = null;

  constructor(settings: PadSettings) {
    this.settings = settings;
  }

  private context() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = dbToGain(this.settings.volumeDb);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.master.connect(this.analyser);
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /** Decode every pad's file now, so presses are instant. */
  async load(pads: Pad[]) {
    const ctx = this.context();
    this.pads = new Map(pads.map((p) => [p.key, p]));
    await Promise.all(
      pads.map(async (p) => {
        if (this.buffers.has(p.fileId)) return;
        try {
          const x = await readLibraryFile(p.fileId);
          const frames = x.length / 2;
          const buf = ctx.createBuffer(2, Math.max(1, frames), 48000);
          const l = buf.getChannelData(0);
          const r = buf.getChannelData(1);
          for (let i = 0; i < frames; i++) {
            l[i] = x[2 * i];
            r[i] = x[2 * i + 1];
          }
          this.buffers.set(p.fileId, buf);
        } catch {
          // Missing from the library (another browser's pad): it shows, but won't play.
        }
      }),
    );
  }

  playable(key: number) {
    const p = this.pads.get(key);
    return !!p && this.buffers.has(p.fileId);
  }

  resume() {
    this.ctx?.resume().catch(() => {});
  }

  /** A pad key went down (or a click). */
  press(key: number) {
    const pad = this.pads.get(key);
    const buf = pad && this.buffers.get(pad.fileId);
    if (!pad || !buf) return false;
    const ctx = this.context();
    this.resume();
    const v = this.voices.get(key);
    if (v && !v.stopping) {
      if (pad.mode === 'loop') return (this.stopVoice(v, pad.fadeOutMs / 1000), true);
      if (pad.mode === 'hold') return true;
      // One-shot: restart from the top.
      this.stopVoice(v, 0);
    }
    const at = ctx.currentTime;
    const len = padLength(pad);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const fade = ctx.createGain();
    const level = ctx.createGain();
    level.gain.value = dbToGain(pad.gainDb);
    const duck = ctx.createGain();
    duck.gain.value = this.duckTarget(pad);
    const g = 1;
    if (pad.fadeInMs > 0) {
      fade.gain.setValueAtTime(0, at);
      fade.gain.linearRampToValueAtTime(g, at + pad.fadeInMs / 1000);
    } else fade.gain.setValueAtTime(g, at);
    if (pad.mode === 'loop') {
      src.loop = true;
      src.loopStart = pad.trimStart;
      src.loopEnd = pad.trimStart + len;
      src.start(at, pad.trimStart);
    } else {
      if (pad.fadeOutMs > 0 && len > pad.fadeOutMs / 1000) {
        fade.gain.setValueAtTime(g, at + len - pad.fadeOutMs / 1000);
        fade.gain.linearRampToValueAtTime(0, at + len);
      }
      src.start(at, pad.trimStart, len);
    }
    src.connect(fade).connect(level).connect(duck).connect(this.master!);
    const t = this.clock();
    const logged: PadPress | null =
      t == null
        ? null
        : {
            t,
            key,
            padId: pad.id,
            name: pad.name,
            color: pad.color,
            fileId: pad.fileId,
            mode: pad.mode,
            gainDb: pad.gainDb,
            fadeInMs: pad.fadeInMs,
            fadeOutMs: pad.fadeOutMs,
            trimStart: pad.trimStart,
            trimEnd: pad.trimEnd,
            duck: pad.duck && this.settings.duck !== false,
            duckDb: pad.duckDb,
          };
    const voice: Voice = { pad, src, fade, level, levelDb: pad.gainDb, duck, started: at, len, stopping: false, logged };
    this.voices.set(key, voice);
    src.onended = () => {
      if (this.voices.get(key) === voice) this.voices.delete(key);
      const end = this.clock();
      if (logged && end != null) this.onEnd(logged, end);
    };
    if (logged) {
      if (!this.log.volume.length) this.log.volume.push({ t: 0, db: this.settings.volumeDb });
      this.log.presses.push(logged);
      this.onPress(logged);
    }
    this.latest = { key, name: pad.name, at: Date.now() };
    return true;
  }

  /** A pad key came up: a hold pad fades out. */
  release(key: number) {
    const v = this.voices.get(key);
    if (v && v.pad.mode === 'hold' && !v.stopping) this.stopVoice(v, HOLD_RELEASE);
  }

  private stopVoice(v: Voice, fade: number) {
    const ctx = this.ctx!;
    const at = ctx.currentTime;
    const f = Math.max(DECLICK, fade);
    v.stopping = true;
    v.fade.gain.cancelScheduledValues(at);
    v.fade.gain.setValueAtTime(v.fade.gain.value, at);
    v.fade.gain.linearRampToValueAtTime(0, at + f);
    try {
      v.src.stop(at + f + 0.01);
    } catch {}
    const t = this.clock();
    if (v.logged && t != null && v.logged.stop == null) {
      v.logged.stop = t;
      v.logged.stopFade = fade;
    }
    // It stays listed (as fading) until its source ends.
  }

  /** Ride a playing pad's level (press and slide on a phone). Logged for the Pads track. */
  setLevel(key: number, db: number) {
    const v = this.voices.get(key);
    if (!v || !this.ctx) return;
    v.levelDb = db;
    v.level.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, 0.015);
    const t = this.clock();
    if (v.logged && t != null) (v.logged.levels ??= []).push({ t, db });
  }

  /**
   * A light tick in the headphones as a riding fader clicks into a detent.
   * Straight to the output: not through the pads bus or its meter, and not in
   * the log, so it's never on the Pads track.
   */
  tick() {
    const ctx = this.ctx;
    if (!ctx) return;
    const at = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = 2400;
    g.gain.setValueAtTime(0.05, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.012);
    osc.connect(g).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.015);
  }

  /** Stop one pad, fading over `seconds`. */
  stop(key: number, seconds = 0) {
    const v = this.voices.get(key);
    if (v && !v.stopping) this.stopVoice(v, seconds);
  }

  /** 0: stop everything. */
  stopAll() {
    for (const v of [...this.voices.values()]) this.stopVoice(v, 0);
  }

  /** Shift+0: fade everything out over `seconds`. */
  fadeAll(seconds = 2) {
    for (const v of [...this.voices.values()]) if (!v.stopping) this.stopVoice(v, seconds);
  }

  setVolume(db: number) {
    this.settings.volumeDb = db;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, 0.02);
    const t = this.clock();
    if (t != null) this.log.volume.push({ t, db });
  }

  private duckTarget(pad: Pad) {
    return pad.duck && this.settings.duck !== false && this.talking ? dbToGain(-pad.duckDb) : 1;
  }

  /** The mic's level (dBFS), about 30 times a second: ducks the pads that duck. */
  voice(db: number) {
    const talking = db > this.settings.threshold;
    if (talking === this.talking || !this.ctx) return;
    this.talking = talking;
    const tau = (talking ? this.settings.duckAttackMs : this.settings.duckReleaseMs) / 1000;
    for (const v of this.voices.values()) v.duck.gain.setTargetAtTime(this.duckTarget(v.pad), this.ctx.currentTime, tau);
  }

  /** Whether something that ducks is playing under the voice right now. */
  get ducking() {
    return this.talking && this.settings.duck !== false && [...this.voices.values()].some((v) => v.pad.duck);
  }

  playing(): Playing[] {
    const now = this.ctx?.currentTime ?? 0;
    return [...this.voices.entries()].map(([key, v]) => ({ key, pad: v.pad, pos: now - v.started, len: v.len, stopping: v.stopping, levelDb: v.levelDb }));
  }

  /** Output peak, dBFS. */
  level(): number {
    if (!this.analyser) return -Infinity;
    const x = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(x);
    let peak = 0;
    for (const v of x) peak = Math.max(peak, Math.abs(v));
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  }

  /** Whether the output looks like laptop speakers rather than headphones. */
  async onSpeakers(): Promise<boolean> {
    try {
      const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
      const sink = (this.ctx as AudioContext & { sinkId?: string })?.sinkId || 'default';
      const out = outs.find((d) => d.deviceId === sink) ?? outs.find((d) => d.deviceId === 'default') ?? outs[0];
      return !!out && /speaker|built-in output|macbook/i.test(out.label) && !/headphone/i.test(out.label);
    } catch {
      return false;
    }
  }
}
