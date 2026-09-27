/*
 * The Export flow's preview: 30 s of the episode through the export's chain,
 * stage by stage, so each step plays everything up to it with a before and
 * after for its own stage.
 *
 *   Raw       the untouched session over that stretch
 *   Edit      the same stretch of the assembled edit (cuts, coughs muted)
 *   Noise     each voice through noise suppression; Removed is the edit
 *             minus the cleaned audio, so only what's taken away is heard
 *   Tone      each person's EQ and compressor on the cleaned voices
 *             (lib/audio/tone-preview.ts), before and after at the same
 *             loudness
 *   Loudness  the levelling and the loudness target on the toned voices;
 *             before is the toned mix with its level untouched
 *
 * The page supplies the stretch (raw and edit WAVs of each track, the Pads
 * track last with key null); every stage is kept and only made again when
 * its own settings, or an earlier stage's, change. Raw, Edit and Noise play
 * at the same listening level (the edit turned to the target, or −18 LUFS),
 * so moving between steps doesn't jump in level.
 */
import { encodeWav } from './wav.ts';
import { renderMaster, WavReader, type MasterTrack } from './master.ts';
import { TonePreview } from './tone-preview.ts';
import { backgroundReduction, removedPart } from './denoise-core.ts';
import type { VoiceTone } from './tone.ts';
import type { PreviewAudio } from './preview-player.ts';

export type StepId = 'edit' | 'noise' | 'tone' | 'loud' | 'export';
/** Each step's before-and-after choices, "after" last but for Noise's Removed */
export const AB: Record<StepId, string[]> = {
  edit: ['Raw', 'Edit'],
  noise: ['Original', 'Cleaned', 'Removed'],
  tone: ['Before', 'With tone'],
  loud: ['Before', 'Levelled'],
  export: ['Raw', 'Final'],
};
/** Which choice a step starts on: its "after" */
export const AFTER: Record<StepId, number> = { edit: 1, noise: 1, tone: 1, loud: 1, export: 1 };

export type Loudness = 'stereo' | 'mono' | 'off';
export const targetOf = (l: Loudness) => (l === 'stereo' ? -16 : l === 'mono' ? -19 : null);

export interface ChainTrack {
  /** The person's key (their tone), or null for the Pads track */
  key: string | null;
  raw: Blob;
  edit: Blob;
}
export interface ChainSettings {
  ns: number;
  tones: Record<string, VoiceTone>;
  loudness: Loudness;
  level: boolean;
}
export type Denoise = (x: Float32Array, channels: number, rate: number, amount: number) => Promise<Float32Array>;

export interface StageResult {
  audio: PreviewAudio;
  /** Noise: how far the background came down, in dB */
  reduction?: number;
  /** Tone: the render, for each voice's spectrum and level into the compressor */
  tone?: TonePreview;
  /** Loudness: the toned mix as it is, and levelled to the target */
  loud?: { before: TonePreview; after: TonePreview };
}

interface Track {
  key: string | null;
  rate: number;
  channels: number;
  raw: Float32Array;
  edit: Float32Array;
  editWav: Blob;
}

const LISTEN = -18;

async function decode(t: ChainTrack): Promise<Track> {
  const read = async (b: Blob) => {
    const r = await WavReader.open(b);
    return { x: await r.read(r.frames), rate: r.info.sampleRate, channels: r.info.channels };
  };
  const raw = await read(t.raw);
  const edit = await read(t.edit);
  return { key: t.key, rate: edit.rate, channels: edit.channels, raw: raw.x, edit: edit.x, editWav: t.edit };
}

const wav = (x: Float32Array, rate: number, channels: number) => encodeWav([x], { sampleRate: rate, bitDepth: 24, channels: channels as 1 | 2 });
const mono = (x: Float32Array, channels: number) => (channels === 1 ? x : x.filter((_, i) => i % channels === 0));

export class ChainPreview {
  private source: () => Promise<ChainTrack[]>;
  private rate: number;
  private denoise: Denoise;
  private loaded: Promise<Track[]> | null = null;
  private clean: { ns: number; x: Float32Array[] } | null = null;
  private cache = new Map<string, unknown>();

  constructor(source: () => Promise<ChainTrack[]>, rate: number, denoise: Denoise) {
    this.source = source;
    this.rate = rate;
    this.denoise = denoise;
  }

  private tracks() {
    this.loaded ??= this.source().then((ts) => Promise.all(ts.map(decode)));
    return this.loaded;
  }

  /** Kept by key; the oldest go once there are more than a few. */
  private async kept<T>(key: string, make: () => Promise<T>): Promise<T> {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    const v = await make();
    this.cache.set(key, v);
    if (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value!);
    return v;
  }

  /** Each voice cleaned at `ns` (the Pads track as it is). */
  private async cleaned(ns: number, status?: (s: string) => void): Promise<Float32Array[]> {
    const ts = await this.tracks();
    if (ns <= 0) return ts.map((t) => t.edit);
    if (this.clean?.ns === ns) return this.clean.x;
    status?.('Cleaning…');
    const x: Float32Array[] = [];
    for (const t of ts) x.push(t.key == null ? t.edit : await this.denoise(t.edit, t.channels, t.rate, ns));
    this.clean = { ns, x };
    return x;
  }

  private async mix(parts: { x: Float32Array | Blob; rate: number; channels: number }[], channels: 1 | 2, o: { gain?: number; lufs?: number }) {
    const tracks: MasterTrack[] = parts.map((p) => ({ wav: p.x instanceof Blob ? p.x : wav(p.x, p.rate, p.channels), level: false }));
    const out: Float32Array[] = [];
    const r = await renderMaster(tracks, { rate: this.rate, channels, lufs: o.lufs ?? null, levelling: false, gain: o.gain }, async (y) => void out.push(y.slice()));
    const y = new Float32Array(out.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of out) (y.set(p, at), (at += p.length));
    return { y, measured: r.measured };
  }

  /** The gain that brings the edit to the listening level. */
  private async listenGain(channels: 1 | 2, level: number) {
    const ts = await this.tracks();
    return this.kept(`gain|${channels}|${level}`, async () => {
      const { measured } = await this.mix(ts.map((t) => ({ x: t.editWav, rate: t.rate, channels: t.channels })), channels, { gain: 0 });
      return Number.isFinite(measured) ? Math.min(30, level - measured) : 0;
    });
  }

  private async plain(which: 'raw' | 'edit', channels: 1 | 2, gain: number) {
    const ts = await this.tracks();
    return this.kept(`${which}|${channels}|${gain}`, async () => (await this.mix(ts.map((t) => ({ x: t[which], rate: t.rate, channels: t.channels })), channels, { gain })).y);
  }

  private async toneRender(s: ChainSettings, channels: 1 | 2, o: { lufs: number | null; levelling: boolean }, before: boolean, status?: (s: string) => void) {
    const ts = await this.tracks();
    const clean = await this.cleaned(s.ns, status);
    const tp = await this.kept(`tp|${s.ns}|${channels}|${o.lufs}|${o.levelling}`, async () =>
      Object.assign(new TonePreview(ts.map((t, i) => ({ key: t.key, wav: t.key == null ? t.editWav : wav(clean[i], t.rate, t.channels) })), { rate: this.rate, channels, ...o }), { made: '' }),
    );
    const want = JSON.stringify(s.tones) + before;
    if (tp.made !== want) {
      status?.('Rendering…');
      await tp.render(s.tones, before);
      tp.made = want;
    }
    return tp as TonePreview;
  }

  /** The audio for a step's choices, with what the step shows alongside. */
  async stage(step: StepId, s: ChainSettings, status?: (s: string) => void): Promise<StageResult> {
    status?.('Getting 30 s of the episode ready…');
    const ts = await this.tracks();
    const channels: 1 | 2 = s.loudness === 'mono' ? 1 : 2;
    const target = targetOf(s.loudness);
    const level = target ?? LISTEN;
    const audio = (options: Float32Array[]): PreviewAudio => ({ options, channels, rate: this.rate });
    const gain = await this.listenGain(channels, level);

    if (step === 'edit') return { audio: audio([await this.plain('raw', channels, gain), await this.plain('edit', channels, gain)]) };

    if (step === 'noise') {
      const edit = await this.plain('edit', channels, gain);
      const clean = await this.cleaned(s.ns, status);
      if (s.ns <= 0) return { audio: audio([edit, edit, new Float32Array(edit.length)]), reduction: 0 };
      const cleanMix = await this.kept(`clean|${s.ns}|${channels}|${gain}`, async () => (await this.mix(ts.map((t, i) => ({ x: clean[i], rate: t.rate, channels: t.channels })), channels, { gain })).y);
      const voices = ts.map((t, i) => ({ t, i })).filter(({ t }) => t.key != null);
      const removed = await this.kept(`removed|${s.ns}|${channels}|${gain}`, async () =>
        (await this.mix(voices.map(({ t, i }) => ({ x: removedPart(t.edit, clean[i]), rate: t.rate, channels: t.channels })), channels, { gain })).y,
      );
      const [{ t, i }] = voices;
      return { audio: audio([edit, cleanMix, removed]), reduction: backgroundReduction(mono(t.edit, t.channels), mono(clean[i], t.channels), t.rate) };
    }

    if (step === 'tone') {
      const tone = await this.toneRender(s, channels, { lufs: level, levelling: false }, true, status);
      return { audio: audio([tone.before!.mix, tone.toned!.mix]), tone };
    }

    const before = await this.toneRender(s, channels, { lufs: null, levelling: false }, false, status);
    const after = await this.toneRender(s, channels, { lufs: target, levelling: s.level }, false, status);
    if (step === 'loud') return { audio: audio([before.toned!.mix, after.toned!.mix]), loud: { before, after } };
    return { audio: audio([await this.plain('raw', channels, gain), after.toned!.mix]), loud: { before, after } };
  }
}
