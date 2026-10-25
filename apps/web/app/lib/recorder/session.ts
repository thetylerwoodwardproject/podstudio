import { createFrameEmitter } from "@/lib/audio/frame-source";
import type { MeterFrame } from "@/lib/audio/types";
import { CAPTURE, type RetakeAnnotation } from "~/lib/capture-contract";
import { CaptureEngine, listInputs, type ChunkOut, type InputDevice } from "./engine";
import { journal, JournalError, type ChunkMeta, type JournalMeta } from "./journal";
import { Uploader } from "./uploader";

// One recording session on the solo screen: ties capture → journal → upload →
// finalize together and exposes plain state for the UI. The three things the plan
// says must never be blurred are tracked separately: chunks *saved locally*,
// chunks the server has *verified*, and whether the finished recording was
// finalized *complete* or *incomplete* (with the lost tail/gap reported).
export type Phase = "idle" | "ready" | "recording" | "finishing" | "done" | "error";

export interface Recovered {
  meta: JournalMeta;
  chunks: number;
  uploaded: number;
  localSamples: number;
  /** Samples the capture clock reached after the last journaled chunk: audio that existed but was never saved. */
  lostTailSamples: number;
}

export interface FinishedInfo {
  recordingId: string;
  status: "complete" | "incomplete";
  durationS: number;
  report: { gaps?: { fromSequence: number; toSequence: number }[]; lostTailSamples?: number; missingSamples?: number } | null;
  retakes: RetakeAnnotation[];
}

export interface SessionState {
  phase: Phase;
  error: string | null;
  /** Local journal write trouble (e.g. quota): audio is still being uploaded from memory but isn't safe on disk. */
  localError: string | null;
  waiting: string | null;
  devices: InputDevice[];
  deviceId: string;
  deviceLabel: string;
  inputRate: number;
  recordingId: string | null;
  elapsedS: number;
  localChunks: number;
  uploadedChunks: number;
  retakes: RetakeAnnotation[];
  finished: FinishedInfo | null;
  /** Finalize was refused because chunks are missing: the owner can retry the upload or finish with the gap. */
  gap: { fromSequence: number; toSequence: number }[] | null;
  recovered: Recovered[];
}

const initial: SessionState = {
  phase: "idle", error: null, localError: null, waiting: null, devices: [], deviceId: "", deviceLabel: "", inputRate: 0, recordingId: null,
  elapsedS: 0, localChunks: 0, uploadedChunks: 0, retakes: [], finished: null, gap: null, recovered: [],
};

const PEAK_SLOTS = 1200; // 60 s of 50 ms meter updates

export class SoloSession {
  state: SessionState = { ...initial };
  readonly meter = createFrameEmitter<MeterFrame>();
  /** Ring of recent peak levels (0..1) for the live waveform. */
  readonly peaks = new Float32Array(PEAK_SLOTS);
  peakHead = 0;
  private subs = new Set<() => void>();
  private engine: CaptureEngine;
  private uploader: Uploader | null = null;
  private meta: JournalMeta | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private progress = 0;
  private mem = new Map<number, { meta: ChunkMeta; bytes: Uint8Array }>();
  private uploaded = new Set<number>();
  private episodeId = "";

  constructor() {
    this.engine = new CaptureEngine({
      onMeter: (peak, rms) => this.onMeter(peak, rms),
      onChunk: (c) => this.onChunk(c),
      onRetake: (sample) => this.onRetake(sample),
      onProgress: (t) => {
        this.progress = t;
        this.set({ elapsedS: t / CAPTURE.sampleRate });
      },
      onError: (m) => this.set({ localError: m }),
    });
  }

  // ---- plumbing -------------------------------------------------------------
  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };
  getState = () => this.state;
  private set(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    for (const s of this.subs) s();
  }

  private onMeter(peak: number, rms: number) {
    const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
    this.meter.emit({ channels: [{ peakDb: db(peak), rmsDb: db(rms) }] });
    this.peaks[this.peakHead] = peak;
    this.peakHead = (this.peakHead + 1) % PEAK_SLOTS;
  }

  private source() {
    return {
      meta: async (seq: number) => this.mem.get(seq)?.meta ?? (await journal.listChunks(this.state.recordingId!)).find((c) => c.sequence === seq),
      bytes: async (seq: number) => this.mem.get(seq)?.bytes ?? (await journal.getChunkBytes(this.state.recordingId!, seq)),
    };
  }

  private makeUploader(recordingId: string) {
    this.uploader = new Uploader(recordingId, this.source(), {
      onUploaded: async (seq) => {
        this.uploaded.add(seq);
        this.mem.delete(seq);
        await journal.markUploaded(recordingId, seq).catch(() => {});
        this.set({ uploadedChunks: this.uploaded.size });
      },
      onFatal: (m) => this.set({ error: m, phase: "error" }),
      onWaiting: (w) => this.set({ waiting: w }),
    });
  }

  // ---- setup ---------------------------------------------------------------------
  async loadRecoverable(episodeId: string) {
    this.episodeId = episodeId;
    const out: Recovered[] = [];
    try {
      for (const meta of await journal.listMetas()) {
        if (meta.episodeId !== episodeId) continue;
        // Anything the server already finished is just local clutter.
        const srv = await fetch(`/studio/recordings/${meta.id}`).then((r) => (r.ok ? r.json() : null)).catch(() => undefined);
        if (srv && ["complete", "incomplete"].includes(srv.status)) {
          await journal.deleteRecording(meta.id).catch(() => {});
          continue;
        }
        const chunks = await journal.listChunks(meta.id);
        if (chunks.length === 0) {
          await journal.deleteRecording(meta.id).catch(() => {});
          continue;
        }
        out.push({
          meta,
          chunks: chunks.length,
          uploaded: chunks.filter((c) => c.uploaded).length,
          localSamples: meta.committedSamples,
          lostTailSamples: Math.max(0, meta.progressSamples - meta.committedSamples),
        });
      }
    } catch {
      /* no journal available: nothing to recover */
    }
    this.set({ recovered: out });
  }

  async openMic(deviceId?: string) {
    try {
      await this.engine.close();
      await this.engine.open(deviceId);
      const devices = await listInputs();
      this.set({ phase: "ready", error: null, devices, deviceId: deviceId ?? "", deviceLabel: this.engine.deviceLabel, inputRate: this.engine.inputRate });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.set({ phase: "error", error: /denied|NotAllowed/i.test(m) ? "The browser blocked microphone access. Allow it for this site and try again." : `Couldn't open the microphone: ${m}` });
    }
  }

  // ---- recording -------------------------------------------------------------------
  async start() {
    if (this.state.phase !== "ready") return;
    const res = await fetch("/studio/recordings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ episodeId: this.episodeId, sampleRate: CAPTURE.sampleRate, channels: CAPTURE.channels, device: { label: this.engine.deviceLabel, inputSampleRate: this.engine.inputRate, userAgent: navigator.userAgent } }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok?: boolean; id?: string; error?: string } | null;
    if (!res || !body?.ok || !body.id) {
      this.set({ phase: "error", error: body?.error ?? "Couldn't start the recording — is the server reachable?" });
      return;
    }
    this.mem.clear();
    this.uploaded.clear();
    this.progress = 0;
    this.meta = { id: body.id, episodeId: this.episodeId, startedAtMs: Date.now(), sampleRate: CAPTURE.sampleRate, annotations: [], committedSamples: 0, progressSamples: 0, nextSequence: 0, updatedAtMs: Date.now() };
    try {
      await journal.putMeta(this.meta);
    } catch (err) {
      this.set({ localError: err instanceof JournalError ? err.message : String(err) });
    }
    this.set({ recordingId: body.id, localChunks: 0, uploadedChunks: 0, retakes: [], elapsedS: 0, finished: null, gap: null, error: null, localError: null });
    this.makeUploader(body.id);
    this.engine.begin();
    this.heartbeat = setInterval(() => void this.beat(), 250); // bounds how precisely a lost tail can be measured
    this.set({ phase: "recording" });
  }

  private async beat() {
    if (!this.meta) return;
    this.meta = { ...this.meta, progressSamples: this.progress, updatedAtMs: Date.now() };
    await journal.putMeta(this.meta).catch(() => {});
  }

  retake() {
    if (this.state.phase === "recording") this.engine.retake();
  }

  private onRetake(sample: number) {
    const a: RetakeAnnotation = { type: "retake", sample, atS: sample / CAPTURE.sampleRate };
    const retakes = [...this.state.retakes, a];
    this.set({ retakes });
    if (this.meta) {
      this.meta = { ...this.meta, annotations: retakes };
      void journal.putMeta(this.meta).catch(() => {});
      void fetch(`/studio/recordings/${this.meta.id}/annotations`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ annotations: retakes }) }).catch(() => {});
    }
  }

  private async onChunk(c: ChunkOut) {
    const recId = this.state.recordingId!;
    const meta: ChunkMeta = { recordingId: recId, sequence: c.sequence, firstSample: c.firstSample, sampleCount: c.sampleCount, sha256: c.sha256, uploaded: false };
    try {
      await journal.putChunk(meta, c.bytes);
    } catch (err) {
      // Not safe on disk: say so, and hold it in memory so it can still be uploaded.
      this.set({ localError: err instanceof JournalError ? err.message : String(err) });
      this.mem.set(c.sequence, { meta, bytes: c.bytes });
    }
    if (this.meta) {
      this.meta = { ...this.meta, committedSamples: Math.max(this.meta.committedSamples, c.firstSample + c.sampleCount), nextSequence: c.sequence + 1, progressSamples: Math.max(this.progress, c.firstSample + c.sampleCount) };
      await journal.putMeta(this.meta).catch(() => {});
    }
    this.set({ localChunks: c.sequence + 1 });
    this.uploader?.enqueue(c.sequence);
  }

  async stop() {
    if (this.state.phase !== "recording") return;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.set({ phase: "finishing" });
    await this.engine.stop();
    await this.engine.close();
    await this.finish({ lostTailSamples: 0 });
  }

  /** Waits for the uploads, then asks the server to assemble the WAV. */
  private async finish(opts: { lostTailSamples: number; allowPartial?: boolean; totalSamples?: number; chunkCount?: number }) {
    const recId = this.state.recordingId!;
    this.set({ phase: "finishing", gap: null, error: null });
    await this.uploader!.drain();
    if (this.uploader!.fatal) return;
    const chunkCount = opts.chunkCount ?? this.state.localChunks;
    const totalSamples = opts.totalSamples ?? (this.meta?.committedSamples ?? 0);
    const res = await fetch(`/studio/recordings/${recId}/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunkCount, totalSamples, lostTailSamples: opts.lostTailSamples, allowPartial: opts.allowPartial === true }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as
      | { ok: true; status: "complete" | "incomplete"; durationS: number; report: FinishedInfo["report"] }
      | { ok: false; error: string; missing?: { fromSequence: number; toSequence: number }[] }
      | null;
    if (!res || !body) {
      this.set({ phase: "error", error: "Couldn't reach the server to finish. Your audio is safe on this computer — reload this page to recover it." });
      return;
    }
    if (!body.ok) {
      this.set(body.missing?.length ? { phase: "error", error: body.error, gap: body.missing } : { phase: "error", error: body.error });
      return;
    }
    await journal.deleteRecording(recId).catch(() => {});
    this.set({ phase: "done", finished: { recordingId: recId, status: body.status, durationS: body.durationS, report: body.report, retakes: this.state.retakes } });
  }

  /** After a refused finalize: try the missing uploads again. */
  async retryUploads() {
    const recId = this.state.recordingId!;
    const chunks = await journal.listChunks(recId);
    this.makeUploader(recId);
    for (const c of chunks) if (!this.uploaded.has(c.sequence)) this.uploader!.enqueue(c.sequence);
    await this.finish({ lostTailSamples: 0 });
  }

  /** Accepts the gap: finalize from the contiguous start and keep the report. */
  async finishWithGap() {
    await this.finish({ lostTailSamples: 0, allowPartial: true });
  }

  // ---- recovery --------------------------------------------------------------------
  async resume(r: Recovered, allowPartial = false) {
    const recId = r.meta.id;
    this.meta = r.meta;
    this.set({ recordingId: recId, phase: "finishing", error: null, gap: null, localChunks: r.chunks, retakes: r.meta.annotations, finished: null });
    const srv = (await fetch(`/studio/recordings/${recId}`).then((x) => (x.ok ? x.json() : null)).catch(() => null)) as { chunks?: { haveSequences: number[] } } | null;
    const have = new Set(srv?.chunks?.haveSequences ?? []);
    this.uploaded = new Set(have);
    this.set({ uploadedChunks: have.size });
    this.makeUploader(recId);
    for (const c of await journal.listChunks(recId)) if (!have.has(c.sequence)) this.uploader!.enqueue(c.sequence);
    // The tail the capture clock reached after the last journaled chunk was never saved.
    await this.finish({ lostTailSamples: r.lostTailSamples, allowPartial, totalSamples: r.meta.committedSamples, chunkCount: r.chunks });
    await this.loadRecoverable(this.episodeId);
  }

  async discardRecovered(r: Recovered) {
    await journal.deleteRecording(r.meta.id).catch(() => {});
    await fetch(`/studio/recordings/${r.meta.id}`, { method: "DELETE" }).catch(() => {});
    await this.loadRecoverable(this.episodeId);
  }

  async dispose() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.uploader?.stop();
    await this.engine.close();
  }
}
