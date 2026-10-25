import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useFetcher } from "react-router";
import { LevelMeter } from "@/components/ui/level-meter";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { CAPTURE, RETAKE_TONE } from "~/lib/capture-contract";
import { SoloSession, type Recovered } from "~/lib/recorder/session";
import { LiveWaveform } from "./waveform";

// Screen 07 (Solo prompter), Stage 03 scope: a plain scrolling script (manual or
// steady), input picker + live meter, recording with retake (K), the honest
// local / uploaded / verified counters, recovery of an interrupted take, and basic
// playback. "Follow my voice" arrives with the voice-following prompter (Stage 13).
export interface StageProps {
  episode: { id: string; title: string; number: number | null; showTitle: string; script: string };
  recordings: {
    id: string;
    status: "recording" | "finalizing" | "complete" | "incomplete" | "failed";
    startedAt: number;
    totalSamples: number | null;
    annotations: { atS: number }[];
    report: { gaps?: unknown[]; lostTailSamples?: number; missingSamples?: number } | null;
    bytes: number | null;
  }[];
  storageReady: boolean;
}

const clock = (s: number) => {
  const t = Math.floor(Math.max(0, s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(t % 60).padStart(2, "0")}`;
};
const mb = (b: number | null) => (b == null ? "" : `${(b / 1024 / 1024).toFixed(1)} MB`);

export function SoloStage({ episode, recordings, storageReady }: StageProps) {
  const sessionRef = useRef<SoloSession | null>(null);
  sessionRef.current ??= new SoloSession();
  const session = sessionRef.current;
  const st = useSyncExternalStore(session.subscribe, session.getState, session.getState);

  const [script, setScript] = useState(episode.script);
  const [prompting, setPrompting] = useState(false);
  const [mode, setMode] = useState<"steady" | "manual">("manual");
  const [speed, setSpeed] = useState(30);
  const [size, setSize] = useState(44);
  const [mirror, setMirror] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const saver = useFetcher();
  const deleter = useFetcher();
  const scrollRef = useRef<HTMLDivElement>(null);

  // ---- lifecycle -----------------------------------------------------------------
  useEffect(() => {
    void session.loadRecoverable(episode.id);
    // If the browser already has mic permission, open it so the meter is live on arrival.
    navigator.permissions?.query({ name: "microphone" as PermissionName }).then((p) => p.state === "granted" && void session.openMic()).catch(() => {});
    return () => void session.dispose();
  }, [session, episode.id]);

  const recording = st.phase === "recording";
  useEffect(() => {
    if (!recording) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recording]);

  // Retake on K (not while typing).
  const retake = useCallback(() => session.retake(), [session]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key.toLowerCase() !== "k" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT" || el.isContentEditable) return;
      e.preventDefault();
      retake();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [retake]);

  const lastRetakes = st.retakes.length;
  useEffect(() => {
    if (lastRetakes === 0) return;
    const r = st.retakes[lastRetakes - 1]!;
    setToast(`RETAKE · tone dropped at ${clock(r.atS)}`);
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [lastRetakes, st.retakes]);

  // Steady scroll.
  useEffect(() => {
    if (!prompting || !recording || mode !== "steady") return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const el = scrollRef.current;
      if (el) el.scrollTop += (speed * (now - last)) / 1000;
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [prompting, recording, mode, speed]);

  // Save the script (debounced) — it is the only thing this screen writes to the episode.
  const dirty = script !== episode.script;
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => saver.submit({ intent: "save-script", script }, { method: "post" }), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script]);

  useEffect(() => {
    if (st.phase === "done") window.dispatchEvent(new Event("podstudio:take-finished"));
  }, [st.phase]);

  const marks = useMemo(() => ({ ageSlots: () => session.state.retakes.map((r) => Math.round((session.state.elapsedS - r.atS) * 20)) }), [session]);
  const head = useCallback(() => session.peakHead, [session]);

  const saved = st.localChunks;
  const verified = st.uploadedChunks;
  const idle = st.phase === "idle" || st.phase === "ready" || st.phase === "error";

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background text-foreground" data-testid="solo-stage">
      {/* top bar */}
      <header className="flex h-14 items-center gap-4 border-b border-border px-4">
        <div className="flex items-center gap-2 text-[15px] font-bold tracking-tight">
          <span className="flex size-[18px] items-center justify-center rounded-full border-2 border-destructive">
            <span className="size-1.5 rounded-full bg-destructive" />
          </span>
          Podstudio
        </div>
        <div className="min-w-0 border-l border-border pl-4">
          <div className="truncate text-[13px] font-semibold">
            {episode.number != null ? `Ep. ${episode.number} · ` : ""}
            {episode.title}
          </div>
          <div className="text-[11.5px] text-muted-foreground">{episode.showTitle} · Solo</div>
        </div>
        <div className="flex flex-1 justify-center">
          {recording ? (
            <div className="flex items-center gap-2 rounded-full border border-destructive/50 px-3 py-1" data-testid="rec-pill">
              <span className="rounded-full bg-destructive px-2 py-0.5 text-[10.5px] font-bold tracking-wide text-white">REC</span>
              <span className="font-mono text-[15px] tabular-nums" data-testid="timer">
                {clock(st.elapsedS)}
              </span>
            </div>
          ) : st.phase === "finishing" ? (
            <span className="text-[13px] text-muted-foreground" data-testid="finishing">
              Finishing — {verified} of {saved} chunks verified…
            </span>
          ) : null}
        </div>
        <Link to={`/studio/episodes/${episode.id}`} className="rounded-lg border border-input px-3 py-1.5 text-[13px] font-medium hover:bg-accent">
          Back to episode
        </Link>
        {st.phase === "done" ? (
          <Button onClick={() => void session.openMic()} data-testid="new-take">
            New take
          </Button>
        ) : recording ? (
          <Button variant="destructive" onClick={() => void session.stop()} data-testid="stop">
            Stop
          </Button>
        ) : (
          <Button onClick={() => { setPrompting(true); void session.start(); }} disabled={st.phase !== "ready" || !storageReady} data-testid="record">
            ● Record
          </Button>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px]">
        {/* script */}
        <section className="flex min-h-0 flex-col border-r border-border">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-2.5">
            <div className="inline-flex rounded-lg border border-input p-0.5 text-[13px]" role="group" aria-label="Prompter mode">
              <button type="button" disabled title="Arrives with the voice-following prompter" className="rounded-md px-3 py-1 text-muted-foreground opacity-50">
                Follow my voice
              </button>
              {(["steady", "manual"] as const).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cn("rounded-md px-3 py-1", mode === m ? "bg-accent font-semibold" : "text-muted-foreground hover:text-foreground")}>
                  {m === "steady" ? "Steady scroll" : "Manual"}
                </button>
              ))}
            </div>
            {mode === "steady" && (
              <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                Speed
                <input type="range" min={5} max={150} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Scroll speed" />
              </label>
            )}
            <div className="ml-auto flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              Text
              <button type="button" aria-label="Smaller text" onClick={() => setSize((s) => Math.max(20, s - 4))} className="rounded-md border border-input px-2 py-0.5 hover:bg-accent">
                A−
              </button>
              <span className="w-7 text-center font-mono text-foreground">{size}</span>
              <button type="button" aria-label="Larger text" onClick={() => setSize((s) => Math.min(96, s + 4))} className="rounded-md border border-input px-2 py-0.5 hover:bg-accent">
                A+
              </button>
              <button type="button" aria-pressed={mirror} onClick={() => setMirror((m) => !m)} className={cn("ml-2 rounded-md border border-input px-2 py-0.5 hover:bg-accent", mirror && "bg-accent text-foreground")}>
                Mirror
              </button>
            </div>
          </div>

          {st.recovered.length > 0 && idle && (
            <div className="border-b border-border bg-destructive/10 px-5 py-3" role="alert" data-testid="recovered">
              {st.recovered.map((r) => (
                <RecoveredRow key={r.meta.id} r={r} onResume={(partial) => void session.resume(r, partial)} onDiscard={() => void session.discardRecovered(r)} />
              ))}
            </div>
          )}

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
            {st.phase === "done" && st.finished ? (
              <Finished f={st.finished} />
            ) : prompting && st.phase !== "ready" ? (
              <div style={{ fontSize: size, lineHeight: 1.3, transform: mirror ? "scaleX(-1)" : undefined }} className="mx-auto max-w-4xl whitespace-pre-wrap font-semibold tracking-tight" data-testid="prompter">
                {script.trim() ? script : <span className="text-muted-foreground">No script — just talk.</span>}
              </div>
            ) : (
              <div className="mx-auto max-w-3xl">
                <label htmlFor="script" className="mb-2 block text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
                  Script (optional) {saver.state !== "idle" ? "· saving…" : dirty ? "· unsaved" : "· saved"}
                </label>
                <textarea
                  id="script"
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  readOnly={recording}
                  placeholder="Write or paste what you want to say. It scrolls while you record. Press K any time to mark a retake."
                  className="min-h-[360px] w-full resize-y rounded-xl border border-input bg-transparent p-4 text-[17px] leading-relaxed outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
            )}
          </div>

          {toast && (
            <div className="pointer-events-none absolute left-1/2 top-[72px] -translate-x-1/2 rounded-full bg-host px-5 py-2 text-[14px] font-bold text-black shadow-lg" role="status" data-testid="toast">
              {toast}
            </div>
          )}

          {/* waveform + retake */}
          <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-4 border-t border-border px-5 py-3">
            <div>
              <div className="mb-1 flex justify-between text-[11.5px] text-muted-foreground">
                <span>
                  <span className="mr-1.5 inline-block size-2 rounded-sm bg-host" />
                  You · last 60 s
                </span>
                <span>
                  <span className="mr-1.5 inline-block size-2 rounded-sm bg-destructive" />
                  retake tone · {RETAKE_TONE.freqHz / 1000} kHz · {RETAKE_TONE.durationMs} ms
                </span>
              </div>
              <div className="h-[84px] rounded-lg bg-muted/40">
                <LiveWaveform peaks={session.peaks} head={head} active={recording} marks={marks} />
              </div>
            </div>
            <button
              type="button"
              onClick={retake}
              disabled={!recording}
              data-testid="retake"
              className="flex flex-col items-center justify-center rounded-xl border border-host/50 bg-host/10 text-host transition hover:bg-host/20 disabled:opacity-40"
            >
              <span className="text-[18px] font-extrabold tracking-wide">RETAKE</span>
              <span className="mt-1 text-[12px] opacity-80">
                Back to start of line · <kbd className="rounded border border-host/50 px-1.5 font-mono text-[11px]">K</kbd>
              </span>
            </button>
          </div>
        </section>

        {/* right panel */}
        <aside className="flex min-h-0 flex-col gap-5 overflow-y-auto p-4">
          <section>
            <h2 className="mb-2 text-[12px] uppercase tracking-[0.08em] text-muted-foreground">Microphone</h2>
            {st.phase === "idle" || (st.phase === "error" && st.devices.length === 0) ? (
              <Button variant="outline" size="sm" onClick={() => void session.openMic()} data-testid="enable-mic">
                Enable microphone
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                <select
                  aria-label="Input device"
                  value={st.deviceId}
                  disabled={recording || st.phase === "finishing"}
                  onChange={(e) => void session.openMic(e.target.value || undefined)}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-[13px] outline-none"
                  data-testid="device"
                >
                  {st.deviceId === "" && <option value="">{st.deviceLabel || "Default microphone"}</option>}
                  {st.devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId} className="bg-popover">
                      {d.label}
                    </option>
                  ))}
                </select>
                <div data-testid="meter">
                  <LevelMeter source={session.meter} size="lg" variant="segmented" minDb={-60} maxDb={0} />
                </div>
                <p className="text-[11.5px] text-muted-foreground">
                  Capturing {CAPTURE.sampleRate / 1000} kHz mono, {CAPTURE.bitDepth}-bit WAV{st.inputRate && st.inputRate !== CAPTURE.sampleRate ? ` · device runs at ${st.inputRate / 1000} kHz and is resampled` : ""}. Echo cancelling, noise suppression and auto-gain are off.
                </p>
              </div>
            )}
            {!storageReady && <p className="mt-2 text-[12.5px] text-destructive">No private storage target is routed for recordings — set one up in Storage.</p>}
          </section>

          <section data-testid="status">
            <h2 className="mb-2 text-[12px] uppercase tracking-[0.08em] text-muted-foreground">This take</h2>
            <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-[13px]">
              <dt className="text-muted-foreground">Saved on this computer</dt>
              <dd className="font-mono tabular-nums" data-testid="saved">{saved} chunk{saved === 1 ? "" : "s"}</dd>
              <dt className="text-muted-foreground">Verified by the server</dt>
              <dd className="font-mono tabular-nums" data-testid="verified">{verified} of {saved}</dd>
            </dl>
            {st.waiting && <p className="mt-2 text-[12.5px] text-host" role="status" data-testid="waiting">{st.waiting}</p>}
            {st.localError && <p className="mt-2 text-[12.5px] text-destructive" role="alert" data-testid="local-error">{st.localError}</p>}
            <p className="mt-2 text-[11.5px] text-muted-foreground">Audio stays on this computer until the server has checked it, so a dropped connection or a closed tab doesn't lose it.</p>
          </section>

          <section>
            <h2 className="mb-2 flex justify-between text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
              <span>Retakes</span>
              <span className="normal-case tracking-normal">{st.retakes.length}</span>
            </h2>
            {st.retakes.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">Press K when you flub a line. A tone goes into the recording and the spot is marked, so cleanup can find it.</p>
            ) : (
              <ul className="flex flex-col gap-1" data-testid="retakes">
                {st.retakes.map((r, i) => (
                  <li key={r.sample} className="flex items-center gap-2 text-[13px]">
                    <span className="flex size-5 items-center justify-center rounded bg-host font-mono text-[11px] font-bold text-black">{i + 1}</span>
                    <span className="font-mono">{clock(r.atS)}</span>
                    <span className="text-muted-foreground">sample {r.sample.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {recordings.length > 0 && (
            <section>
              <h2 className="mb-2 text-[12px] uppercase tracking-[0.08em] text-muted-foreground">Earlier takes</h2>
              <ul className="flex flex-col gap-3" data-testid="takes">
                {recordings.map((r) => (
                  <li key={r.id} className="rounded-lg border border-border p-2.5 text-[12.5px]">
                    <div className="flex items-center justify-between gap-2">
                      <span>{new Date(r.startedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px]", r.status === "complete" ? "bg-ok/15 text-ok" : r.status === "incomplete" ? "bg-host/15 text-host" : "bg-muted text-muted-foreground")}>
                        {r.status === "complete" ? "Verified" : r.status === "incomplete" ? "Incomplete" : r.status}
                      </span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {r.totalSamples ? clock(r.totalSamples / CAPTURE.sampleRate) : "—"} · {r.annotations.length} retake{r.annotations.length === 1 ? "" : "s"} {r.bytes ? `· ${mb(r.bytes)}` : ""}
                    </div>
                    {r.status === "incomplete" && r.report && (
                      <p className="mt-1 text-host">
                        {r.report.lostTailSamples ? `About ${(r.report.lostTailSamples / CAPTURE.sampleRate).toFixed(1)} s at the end was never saved. ` : ""}
                        {r.report.missingSamples ? `${(r.report.missingSamples / CAPTURE.sampleRate).toFixed(1)} s didn't upload. ` : ""}
                      </p>
                    )}
                    {(r.status === "complete" || r.status === "incomplete") && <audio controls preload="none" src={`/studio/recordings/${r.id}/audio`} className="mt-2 w-full" aria-label="Play this take" />}
                    <button type="button" onClick={() => deleter.submit({ intent: "delete-recording", id: r.id }, { method: "post" })} className="mt-2 text-[12px] text-destructive underline underline-offset-2">
                      Delete take
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {st.error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-[13px]" role="alert" data-testid="error">
              <p>{st.error}</p>
              {st.gap && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => void session.retryUploads()}>
                    Try the upload again
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => void session.finishWithGap()} data-testid="finish-gap">
                    Finish with the gap
                  </Button>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function RecoveredRow({ r, onResume, onDiscard }: { r: Recovered; onResume: (allowPartial: boolean) => void; onDiscard: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[13px]">
      <div className="min-w-[260px] flex-1">
        <b>Found an interrupted recording</b> from {new Date(r.meta.startedAtMs).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}: {clock(r.localSamples / CAPTURE.sampleRate)} saved on this computer ({r.chunks} chunk{r.chunks === 1 ? "" : "s"}, {r.uploaded} already verified by the server).
        {r.lostTailSamples > 0 && <> About <b>{(r.lostTailSamples / CAPTURE.sampleRate).toFixed(1)} s</b> at the end was never saved — capture can't continue after the tab stopped.</>}
      </div>
      <Button size="sm" onClick={() => onResume(false)} data-testid="recover">
        Upload &amp; finish
      </Button>
      <Button size="sm" variant="outline" onClick={onDiscard}>
        Discard
      </Button>
    </div>
  );
}

function Finished({ f }: { f: NonNullable<ReturnType<SoloSession["getState"]>["finished"]> }) {
  const lost = (f.report?.lostTailSamples ?? 0) / CAPTURE.sampleRate;
  const missing = (f.report?.missingSamples ?? 0) / CAPTURE.sampleRate;
  return (
    <div className="mx-auto max-w-2xl" data-testid="finished">
      <div className={cn("mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] font-semibold", f.status === "complete" ? "bg-ok/15 text-ok" : "bg-host/15 text-host")}>
        {f.status === "complete" ? "Server verified" : "Saved, but incomplete"}
      </div>
      <h1 className="text-3xl font-bold tracking-tight">{f.status === "complete" ? "Recording saved" : "Recording saved with a gap"}</h1>
      <p className="mt-2 text-muted-foreground">
        {clock(f.durationS)} · {f.retakes.length} retake{f.retakes.length === 1 ? "" : "s"} marked · {CAPTURE.sampleRate / 1000} kHz {CAPTURE.bitDepth}-bit mono WAV
      </p>
      {f.status === "incomplete" && (
        <p className="mt-3 rounded-lg border border-host/40 bg-host/10 p-3 text-[14px] text-host" data-testid="incomplete-note">
          {lost > 0 && <>About {lost.toFixed(1)} s at the end was never saved. </>}
          {missing > 0 && <>{missing.toFixed(1)} s did not make it to the server. </>}
          The audio before that is intact; nothing was stitched across the gap.
        </p>
      )}
      <audio controls src={`/studio/recordings/${f.recordingId}/audio`} className="mt-5 w-full" aria-label="Play the recording" data-testid="playback" />
      <p className="mt-4 text-[13px] text-muted-foreground">Press Record again for another take, or go back to the episode.</p>
    </div>
  );
}
