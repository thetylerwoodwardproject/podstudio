// Browser preview of the edited timeline. Streams the private WAV in 10 s windows with HTTP
// Range requests (24-bit PCM → Float32), keeps only a few windows in memory, and schedules
// each piece of the plan on the audio clock — so a 2-hour session never sits decoded in RAM
// and cuts play gaplessly. The plan (`planPieces`) is shared with the future worker render.
import { pcm24ToFloat } from "~/lib/capture-contract";
import type { ProjectDoc } from "./document";
import { panGains, triggerTrackIds, withCrossfades, type Clip, type Track } from "./document";
import { FX_LATENCY, fxActive } from "@podstudio/audio/fx";
import workletUrl from "./audio-worklet.ts?worker&url";

// The DeepFilterNet wasm (compiled once) and model bytes, fetched the first time a project opens.
const DFN_VERSION = "1"; // bump with packages/audio/dfn so browsers refetch
let dfnAssets: Promise<{ module: WebAssembly.Module; model: ArrayBuffer }> | null = null;
function loadDfnAssets() {
  return (dfnAssets ??= (async () => {
    const [wasm, model] = await Promise.all([
      WebAssembly.compileStreaming(fetch(`/studio/dfn/df_bg.wasm?v=${DFN_VERSION}`)),
      fetch(`/studio/dfn/DeepFilterNet3_onnx.tar.gz?v=${DFN_VERSION}`).then((r) => {
        if (!r.ok) throw new Error(`model ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);
    return { module: wasm, model };
  })().catch((e) => {
    dfnAssets = null;
    throw e;
  }));
}

/** Where the preview's AudioWorklet module is served (also used by the browser parity test). */
export const AUDIO_WORKLET_URL = workletUrl;
if (typeof window !== "undefined") (window as unknown as { __podstudioWorklet?: string }).__podstudioWorklet = workletUrl;
import { duckGains, newDuckState } from "@podstudio/audio/duck";
import { mixTrackBlocks, triggerSignal } from "@podstudio/audio/render";
import { WINDOW_SAMPLES, gainBreakpoints, planPieces, type Piece } from "./plan";

const WAV_HEADER = 44;
const LOOKAHEAD_S = 4;
const TICK_MS = 250;
const MAX_WINDOWS = 10;
/** Ducking gain is handed to Web Audio as a curve with one point per 10 ms (linear in between). */
const DUCK_STEP_S = 0.01;
/** De-click ramp at a loop's seam. */
const SEAM_S = 0.004;

export interface PlayerSource {
  assetId: string;
  totalSamples: number;
  /** 1 (mono) or 2 (stereo, interleaved in the WAV). */
  channels?: 1 | 2;
}

/** What the master meter worklet reports, about every 4096 samples. */
export interface MeterReport {
  peak: [number, number];
  rms: [number, number];
  stereo: { m: number; s: number; i?: number; lra?: number; tp: number };
  mono: { m: number; s: number; i?: number; lra?: number; tp: number };
}

interface Bus {
  /** Where the track's pieces arrive (summed, up-mixed to stereo). */
  input: GainNode;
  /** The track's FX chain (AudioWorklet running packages/audio/src/fx.ts). */
  fx: AudioWorkletNode;
  fxSig: string;
  gr: number;
  /** The track's fader. */
  fader: GainNode;
  panL: GainNode;
  panR: GainNode;
  analyserL: AnalyserNode;
  analyserR: AnalyserNode;
}

export class EditorPlayer {
  private ctx: AudioContext | null = null;
  private doc: ProjectDoc;
  private windows = new Map<string, Promise<AudioBuffer | null>>(); // insertion order = LRU
  private nodes: { src: AudioBufferSourceNode; gain: GainNode; end: number }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private playing = false;
  private t0 = 0; // timeline sample the run started from
  private c0 = 0; // ctx.currentTime when it started
  private scheduledTo = 0; // timeline sample up to which pieces are scheduled
  private gen = 0; // bumped on every (re)start so late fetches don't schedule stale audio
  onEnded: (() => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  private idle = 0;
  /** Loop region (timeline samples). Playback that reaches `to` jumps back to `from`, gaplessly. */
  private loop: { from: number; to: number } | null = null;
  /** Metering: a bus (gain → analyser) per track into a master bus, which a tap reads sample-accurately. */
  /** @internal exposed for diagnostics */
  buses = new Map<string, Bus>();
  private master: GainNode | null = null;
  private meterNode: AudioWorkletNode | null = null;
  private moduleReady: Promise<void> | null = null;
  private meterBuf: Float32Array<ArrayBuffer> | null = null;
  /** Every block of the master mix while playing (mono, at the project rate). */
  /** Master levels and loudness from the meter worklet, while playing. */
  onMeter: ((r: MeterReport) => void) | null = null;
  /** Clips with crossfade-widened fades, for the current doc (built lazily). */
  private xf: Map<string, Clip> | null = null;

  constructor(doc: ProjectDoc, private sources: Record<string, PlayerSource>) {
    this.doc = doc;
    // a read-only handle for diagnosing the live audio graph from the browser console / tests
    if (typeof window !== "undefined") (window as unknown as { __podstudioPlayer?: EditorPlayer }).__podstudioPlayer = this;
  }

  setSources(sources: Record<string, PlayerSource>) {
    this.sources = sources;
  }

  get isPlaying() {
    return this.playing;
  }

  get sampleRate() {
    return this.doc.sampleRate;
  }

  /** Current timeline position in samples (while stopped: where it will start). */
  position(): number {
    return this.wrap(this.rawPosition());
  }

  /** Samples elapsed on the run's own clock, without loop wrapping. */
  private rawPosition(): number {
    if (!this.playing || !this.ctx) return this.t0;
    return Math.round(this.t0 + (this.ctx.currentTime - this.c0) * this.doc.sampleRate);
  }

  /** Is the loop in effect for this run? (A run that starts after the loop's end plays straight on.) */
  private looping() {
    return this.loop !== null && this.t0 < this.loop.to;
  }

  private wrap(raw: number): number {
    const l = this.loop;
    if (!l || !this.looping() || raw < l.to) return raw;
    return l.from + ((raw - l.to) % (l.to - l.from));
  }

  /** Split a stretch of the run's clock into the timeline stretches it plays (more than one when it crosses the loop end). */
  private segments(a: number, b: number): { raw: number; tl: number; len: number }[] {
    const l = this.loop;
    if (!l || !this.looping()) return [{ raw: a, tl: a, len: b - a }];
    const out: { raw: number; tl: number; len: number }[] = [];
    const len = l.to - l.from;
    let r = a;
    while (r < b) {
      if (r < l.to) {
        const e = Math.min(b, l.to);
        out.push({ raw: r, tl: r, len: e - r });
        r = e;
      } else {
        const k = Math.floor((r - l.to) / len);
        const e = Math.min(b, l.to + (k + 1) * len);
        out.push({ raw: r, tl: l.from + (r - l.to - k * len), len: e - r });
        r = e;
      }
    }
    return out;
  }

  /** Set or clear the loop region. Regions shorter than 0.25 s are ignored. */
  setLoop(loop: { from: number; to: number } | null) {
    const ok = loop && loop.to - loop.from >= 0.25 * this.doc.sampleRate ? { from: Math.max(0, Math.round(loop.from)), to: Math.round(loop.to) } : null;
    if (ok?.from === this.loop?.from && ok?.to === this.loop?.to) return;
    const pos = this.position();
    this.loop = ok;
    if (this.playing) void this.start(pos);
    else this.t0 = pos;
  }

  /** The edit changed (or mute/solo moved): re-plan from where we are. */
  setDoc(doc: ProjectDoc) {
    const prev = this.doc;
    this.doc = doc;
    this.xf = null;
    this.applyTrackGains();
    // a fader move (or rename, colour, height, lock) doesn't change what plays: no restart, no glitch
    const sameAudio =
      prev.clips === doc.clips &&
      prev.sources === doc.sources &&
      prev.ducking === doc.ducking &&
      prev.tracks.length === doc.tracks.length &&
      prev.tracks.every((t, i) => t.id === doc.tracks[i]!.id && t.muted === doc.tracks[i]!.muted && t.solo === doc.tracks[i]!.solo);
    if (sameAudio) return;
    if (this.playing) void this.start(this.position());
  }

  async play(from: number) {
    await this.start(from);
  }

  seek(to: number) {
    if (this.playing) void this.start(to);
    else this.t0 = Math.max(0, to);
  }

  pause() {
    if (!this.playing) return;
    this.t0 = this.position();
    this.stopNodes();
    this.playing = false;
    this.gen++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.ctx?.suspend();
  }

  /** Start integrated loudness / LRA / true peak again. */
  resetLoudness() {
    this.meterNode?.port.postMessage({ type: "reset" });
  }

  /**
   * A track's current spectrum (after its FX, fader and pan; left side) as `bands`
   * log-spaced bands from 20 Hz to 20 kHz, each 0..1 over −90…−10 dBFS. False when not playing.
   */
  trackSpectrum(trackId: string, bands: Float32Array): boolean {
    const b = this.buses.get(trackId);
    if (!b || !this.playing || !this.ctx) return false;
    const a = b.analyserL;
    const bins = new Float32Array(a.frequencyBinCount);
    a.getFloatFrequencyData(bins);
    const nyq = this.ctx.sampleRate / 2;
    const n = bands.length;
    for (let i = 0; i < n; i++) {
      const f0 = 20 * Math.pow(1000, i / n);
      const f1 = 20 * Math.pow(1000, (i + 1) / n);
      const k0 = Math.max(1, Math.floor((f0 / nyq) * bins.length));
      const k1 = Math.max(k0 + 1, Math.ceil((f1 / nyq) * bins.length));
      let mx = -200;
      for (let k = k0; k < k1 && k < bins.length; k++) if (bins[k]! > mx) mx = bins[k]!;
      bands[i] = Math.max(0, Math.min(1, (mx + 90) / 80));
    }
    return true;
  }

  /** The track compressor's gain reduction (dB, ≤ 0) over the last ~50 ms. */
  trackGainReduction(trackId: string): number {
    return this.playing ? (this.buses.get(trackId)?.gr ?? 0) : 0;
  }

  /** Peak and RMS of what a track is playing right now, left and right (linear; 0 when silent or stopped). */
  trackLevel(trackId: string): { peak: number; rms: number; peakR: number; rmsR: number } {
    const b = this.buses.get(trackId);
    if (!b || !this.playing) return { peak: 0, rms: 0, peakR: 0, rmsR: 0 };
    const read = (a: AnalyserNode) => {
      const n = a.fftSize;
      if (!this.meterBuf || this.meterBuf.length !== n) this.meterBuf = new Float32Array(n);
      a.getFloatTimeDomainData(this.meterBuf);
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const v = this.meterBuf[i]!;
        const x = Math.abs(v);
        if (x > peak) peak = x;
        sum += v * v;
      }
      return { peak, rms: Math.sqrt(sum / n) };
    };
    const l = read(b.analyserL);
    const r = read(b.analyserR);
    return { peak: l.peak, rms: l.rms, peakR: r.peak, rmsR: r.rms };
  }

  /** Faders and pans live on the bus, so moving one is instant (no re-plan). Same balance law as the render. */
  private applyTrackGains() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const [id, b] of this.buses) {
      const t = this.doc.tracks.find((x) => x.id === id);
      b.fader.gain.setTargetAtTime(t?.gainDb ? Math.pow(10, t.gainDb / 20) : 1, now, 0.01);
      const [pl, pr] = panGains(t?.pan);
      b.panL.gain.setTargetAtTime(pl, now, 0.01);
      b.panR.gain.setTargetAtTime(pr, now, 0.01);
      this.sendFx(b, t?.fx);
    }
  }

  private sendFx(b: Bus, fx: Track["fx"]) {
    const active = fxActive(fx) ? fx : null;
    const sig = JSON.stringify(active);
    if (sig === b.fxSig) return;
    b.fxSig = sig;
    b.fx.port.postMessage({ type: "fx", fx: active });
  }

  private bus(trackId: string): AudioNode {
    const ctx = this.ctx!;
    if (!this.master) {
      this.master = ctx.createGain();
      // stereo master: L/R meter what the speakers get
      this.master.channelCount = 2;
      this.master.channelCountMode = "explicit";
      this.master.channelInterpretation = "speakers";
      this.master.connect(ctx.destination);
      // BS.1770 meter worklet on the master; it must reach the destination to run (its output is silent)
      this.meterNode = new AudioWorkletNode(ctx, "podstudio-meter", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers" });
      const mute = ctx.createGain();
      mute.gain.value = 0;
      this.master.connect(this.meterNode);
      this.meterNode.connect(mute);
      mute.connect(ctx.destination);
      this.meterNode.port.onmessage = (e: MessageEvent) => {
        if (e.data?.type === "levels" && this.playing) this.onMeter?.(e.data as MeterReport);
      };
    }
    let b = this.buses.get(trackId);
    if (!b) {
      // input (mono pieces up-mixed to both sides) → fader → split → pan gains → merge → master, with L/R analysers
      const input = ctx.createGain();
      input.channelCount = 2;
      input.channelCountMode = "explicit";
      input.channelInterpretation = "speakers";
      const fader = ctx.createGain();
      fader.channelCount = 2;
      fader.channelCountMode = "explicit";
      const split = ctx.createChannelSplitter(2);
      const panL = ctx.createGain();
      const panR = ctx.createGain();
      const merge = ctx.createChannelMerger(2);
      const analyserL = ctx.createAnalyser();
      const analyserR = ctx.createAnalyser();
      analyserL.fftSize = analyserR.fftSize = 2048;
      const tfx = this.doc.tracks.find((x) => x.id === trackId)?.fx;
      const fx = new AudioWorkletNode(ctx, "podstudio-fx", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers", processorOptions: { fx: fxActive(tfx) ? tfx : null } });
      input.connect(fx);
      fx.connect(fader);
      fader.connect(split);
      split.connect(panL, 0);
      split.connect(panR, 1);
      panL.connect(merge, 0, 0);
      panR.connect(merge, 0, 1);
      panL.connect(analyserL);
      panR.connect(analyserR);
      merge.connect(this.master);
      const t = this.doc.tracks.find((x) => x.id === trackId);
      fader.gain.value = t?.gainDb ? Math.pow(10, t.gainDb / 20) : 1;
      const [pl, pr] = panGains(t?.pan);
      panL.gain.value = pl;
      panR.gain.value = pr;
      const bus: Bus = { input, fx, fxSig: "", gr: 0, fader, panL, panR, analyserL, analyserR };
      fx.port.onmessage = (e: MessageEvent) => {
        if (e.data?.type === "dfn") this.dfnAnswered(bus, e.data as { ok: boolean; error?: string });
        if (e.data?.type === "gr") bus.gr = e.data.db;
      };
      this.sendFx(bus, t?.fx);
      b = bus;
      this.buses.set(trackId, b);
      this.shipDfn(bus);
    }
    return b.input;
  }

  /** Noise-reduction model state, for the FX panel: idle until the first track exists, then loading → ready (or failed). */
  dfnStatus: "idle" | "loading" | "ready" | "failed" = "idle";
  onDfnStatus: ((s: "idle" | "loading" | "ready" | "failed") => void) | null = null;
  private setDfnStatus(s: EditorPlayer["dfnStatus"]) {
    this.dfnStatus = s;
    this.onDfnStatus?.(s);
  }

  /** Give this audio context the DeepFilterNet model (compiled once per page; every FX node in the context shares it). */
  private shipDfn(bus: Bus) {
    if (this.dfnStatus !== "idle") return;
    this.setDfnStatus("loading");
    loadDfnAssets().then(
      (a) => bus.fx.port.postMessage({ type: "dfn", module: a.module, model: a.model.slice(0) }),
      (err) => {
        console.error("Noise reduction model failed to load", err);
        this.setDfnStatus("failed");
      },
    );
  }

  private dfnAnswered(bus: Bus, r: { ok: boolean; error?: string }) {
    if (!r.ok) {
      console.error("Noise reduction model failed to start", r.error);
      this.setDfnStatus("failed");
      return;
    }
    this.setDfnStatus("ready");
    // build the models now, while nothing is playing: building one takes ~0.5 s
    const wanted = this.doc.tracks.filter((t) => t.fx?.on && t.fx.nr.on).length * 2 + 2;
    bus.fx.port.postMessage({ type: "dfn-prepare", count: Math.min(8, wanted) });
  }

  dispose() {
    this.pause();
    if (this.meterNode) this.meterNode.port.onmessage = null;
    this.buses.clear();
    this.windows.clear();
    void this.ctx?.close();
    this.ctx = null;
  }

  private stopNodes() {
    for (const n of this.nodes) {
      try {
        n.src.onended = null;
        n.src.stop();
      } catch {
        // already stopped
      }
      n.src.disconnect();
      n.gain.disconnect();
    }
    this.nodes = [];
  }

  private async start(from: number) {
    const gen = ++this.gen;
    this.stopNodes();
    this.ctx ??= new AudioContext({ sampleRate: this.doc.sampleRate });
    await (this.moduleReady ??= this.ctx.audioWorklet.addModule(workletUrl));
    if (gen !== this.gen) return;
    if (this.ctx.state !== "running") await this.ctx.resume();
    this.t0 = Math.max(0, from);
    // Give the first windows a moment to arrive before the clock starts.
    this.scheduledTo = this.t0;
    this.playing = true;
    this.c0 = this.ctx.currentTime + 0.15;
    this.idle = 0;
    if (this.timer) clearInterval(this.timer);
    await this.schedule(gen);
    if (gen !== this.gen) return;
    this.timer = setInterval(() => void this.schedule(gen), TICK_MS);
  }

  private key(p: Piece) {
    return `${p.sourceId}:${Math.floor(p.srcStart / WINDOW_SAMPLES)}`;
  }

  private load(sourceId: string, win: number): Promise<AudioBuffer | null> {
    const k = `${sourceId}:${win}`;
    const hit = this.windows.get(k);
    if (hit) {
      this.windows.delete(k);
      this.windows.set(k, hit);
      return hit;
    }
    const src = this.sources[sourceId];
    const first = win * WINDOW_SAMPLES;
    const p = (async () => {
      if (!src || first >= src.totalSamples) return null;
      const count = Math.min(WINDOW_SAMPLES, src.totalSamples - first);
      const ch = src.channels === 2 ? 2 : 1;
      const fb = 3 * ch; // bytes per frame
      const res = await fetch(`/studio/assets/${src.assetId}/audio`, { headers: { Range: `bytes=${WAV_HEADER + first * fb}-${WAV_HEADER + (first + count) * fb - 1}` } });
      if (res.status !== 206 && res.status !== 200) throw new Error(`audio ${res.status}`);
      const pcm = pcm24ToFloat(new Uint8Array(await res.arrayBuffer()));
      const frames = Math.floor(pcm.length / ch);
      const buf = this.ctx!.createBuffer(ch, frames, this.doc.sampleRate);
      if (ch === 1) buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
      else {
        // de-interleave L/R
        const l = new Float32Array(frames);
        const r = new Float32Array(frames);
        for (let i = 0; i < frames; i++) {
          l[i] = pcm[2 * i]!;
          r[i] = pcm[2 * i + 1]!;
        }
        buf.copyToChannel(l, 0);
        buf.copyToChannel(r, 1);
      }
      return buf;
    })();
    p.catch(() => this.windows.delete(k));
    this.windows.set(k, p);
    while (this.windows.size > MAX_WINDOWS) this.windows.delete(this.windows.keys().next().value!);
    return p;
  }

  private async schedule(gen: number) {
    const ctx = this.ctx;
    if (!ctx || gen !== this.gen || !this.playing) return;
    const rate = this.doc.sampleRate;
    const nowRaw = this.rawPosition();
    const horizon = nowRaw + LOOKAHEAD_S * rate;
    const from = Math.max(this.scheduledTo, nowRaw - Math.round(0.05 * rate));
    if (from >= horizon) return;
    this.scheduledTo = horizon;
    try {
      for (const seg of this.segments(from, horizon)) {
        const l = this.looping() ? this.loop : null;
        // the seam where the loop jumps back gets a few ms of fade on each side, so it doesn't click
        const seam = { in: !!l && seg.tl === l.from && seg.raw >= l.to, out: !!l && seg.tl + seg.len === l.to };
        await this.scheduleSegment(gen, seg.tl, seg.tl + seg.len, seg.raw - seg.tl, seam);
        if (gen !== this.gen) return;
      }
    } catch (e) {
      this.onError?.(e instanceof Error ? e.message : "Playback failed");
      this.pause();
      return;
    }
    // End of the project: nothing left to schedule and nothing still playing.
    let end = 0;
    for (const c of this.doc.clips) end = Math.max(end, c.start + c.length);
    if (this.position() >= end && this.nodes.length === 0) {
      this.t0 = end;
      this.pause();
      this.onEnded?.();
    }
  }

  /** Schedule timeline [from, to) to sound `shift` samples later on the run's clock. */
  private async scheduleSegment(gen: number, from: number, to: number, shift: number, seam: { in: boolean; out: boolean }) {
    const ctx = this.ctx!;
    const rate = this.doc.sampleRate;
    // every track runs through an FX worklet with FX_LATENCY of delay: start everything that much early
    const c0 = this.c0 - FX_LATENCY / rate;
    const pieces = planPieces(this.doc, from, to);
    // ducking: the same trigger measurement and gain smoothing the export uses, on the audio
    // already loaded for the pieces; a short run-up lets the follower settle after a seek
    const duckCurves = new Map<string, { origin: number; gains: Float32Array }>();
    for (const rule of this.doc.ducking ?? []) {
      if (!rule.enabled || !pieces.some((p) => rule.targets.includes(p.trackId))) continue;
      const pre = Math.round(Math.min(4, (3 * rule.releaseMs + rule.attackMs) / 1000) * rate);
      const origin = Math.max(0, from - pre);
      const len = to - origin;
      const ids = new Set(triggerTrackIds(this.doc, rule));
      const windowOf = async (sourceId: string, win: number) => {
        const b = await this.load(sourceId, win);
        return b ? Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c)) : [new Float32Array(WINDOW_SAMPLES)];
      };
      const tracks = await mixTrackBlocks(this.doc, origin, len, windowOf, ids);
      duckCurves.set(rule.id, { origin, gains: duckGains(triggerSignal(this.doc, rule, tracks, len), rule, rate, newDuckState()) });
    }
    if (gen !== this.gen) return;
    await Promise.all(
      pieces.map(async (p) => {
        const buf = await this.load(p.sourceId, Math.floor(p.srcStart / WINDOW_SAMPLES));
        if (!buf || gen !== this.gen) return;
        const clip = (this.xf ??= withCrossfades(this.doc)).get(p.clipId);
        if (!clip) return;
        const nominal = c0 + (p.start + shift - this.t0) / rate;
        let when = nominal;
        let offset = (p.srcStart % WINDOW_SAMPLES) / rate;
        let dur = p.length / rate;
        // If loading was slow and the piece has started, play the remainder instead of a burst.
        const late = ctx.currentTime - when;
        if (late > 0) {
          if (late >= dur) return;
          when += late;
          offset += late;
          dur -= late;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const gain = ctx.createGain();
        const bp = gainBreakpoints(clip, p);
        gain.gain.setValueAtTime(bp[0]![1], when);
        for (const [t, g] of bp.slice(1)) gain.gain.linearRampToValueAtTime(g, c0 + (t + shift - this.t0) / rate);
        // one more gain stage per ducking rule that turns this track down (rules multiply)
        let tail: AudioNode = src.connect(gain);
        const extra: GainNode[] = [];
        const fadeIn = seam.in && p.start === from && late <= 0;
        const fadeOut = seam.out && p.start + p.length === to;
        if (fadeIn || fadeOut) {
          const g = ctx.createGain();
          const ramp = Math.min(SEAM_S, dur / 2);
          if (fadeIn) {
            g.gain.setValueAtTime(0, when);
            g.gain.linearRampToValueAtTime(1, when + ramp);
          }
          if (fadeOut) {
            g.gain.setValueAtTime(1, when + dur - ramp);
            g.gain.linearRampToValueAtTime(0, when + dur);
          }
          tail = tail.connect(g);
          extra.push(g);
        }
        for (const rule of this.doc.ducking ?? []) {
          const curve = duckCurves.get(rule.id);
          if (!curve || !rule.targets.includes(p.trackId)) continue;
          const duck = ctx.createGain();
          const first = p.start + Math.round((when - nominal) * rate); // timeline sample where playback actually begins
          const n = Math.max(2, Math.ceil(dur / DUCK_STEP_S) + 1);
          const values = new Float32Array(n);
          for (let k = 0; k < n; k++) values[k] = curve.gains[Math.min(curve.gains.length - 1, Math.max(0, first - curve.origin + Math.round((k * dur * rate) / (n - 1))))] ?? 1;
          duck.gain.setValueCurveAtTime(values, Math.max(when, ctx.currentTime), dur);
          tail = tail.connect(duck);
          extra.push(duck);
        }
        tail.connect(this.bus(p.trackId));
        src.start(when, offset, dur);
        const node = { src, gain, end: when + dur };
        this.nodes.push(node);
        src.onended = () => {
          src.disconnect();
          gain.disconnect();
          for (const e of extra) e.disconnect();
          this.nodes = this.nodes.filter((n) => n !== node);
        };
      }),
    );
  }
}
