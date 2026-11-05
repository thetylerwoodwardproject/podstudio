import { useCallback, useEffect, useState } from "react";
import { faDownload, faEllipsis, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Button } from "~/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "~/components/ui/dropdown-menu";
import { PODCAST_LOUDNESS } from "@podstudio/audio/loudness";
import { DELIVERY_PRESETS, type DeliveryPreset } from "@podstudio/audio/delivery";
import { cn } from "~/lib/utils";

interface Job {
  id: string;
  status: "queued" | "running" | "verified" | "failed" | "cancelled";
  progress: number;
  revisionSeq: number;
  kind: "wav" | "mp3";
  settings: { bitDepth?: 16 | 24; sampleRate?: 44100 | 48000; channels?: 1 | 2; preset?: DeliveryPreset };
  summary: {
    frames: number;
    peak: number;
    clipped: number;
    bytes: number;
    sha256: string;
    integratedLufs?: number;
    truePeakDb?: number;
    lra?: number;
    normalise?: { targetLufs: number; inputLufs: number; gainDb: number; capped: boolean; limitedSamples: number; minLimiterGainDb: number; reached: boolean };
    diagnostics?: { code: string; message: string }[];
    preEncode?: { integratedLufs: number; truePeakDb: number };
    attempts?: number;
  } | null;
  error: string | null;
  createdAt: number;
  cancelRequested: number;
  /** This MP3 is already the episode's feed audio. */
  inUse?: boolean;
}

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const num = (v: number | undefined, d = 1) => (v === undefined || !Number.isFinite(v) ? "−∞" : v.toFixed(d).replace("-", "−"));

export function ExportPanel({ episodeId, saved, revisionSeq, onClose, episodePreset, onEpisodePreset }: { episodeId: string; saved: boolean; revisionSeq: number | null; onClose: () => void; episodePreset: DeliveryPreset | null; onEpisodePreset: (p: DeliveryPreset | null) => void }) {
  const [format, setFormat] = useState<"mp3" | "wav">("mp3");
  const [bitDepth, setBitDepth] = useState<16 | 24>(24);
  const [sampleRate, setSampleRate] = useState<44100 | 48000>(48000);
  const [wavChannels, setChannels] = useState<1 | 2>(1);
  const [showPreset, setShowPreset] = useState<DeliveryPreset | null>(null);
  const [picked, setPicked] = useState<DeliveryPreset | null>(episodePreset);
  const preset: DeliveryPreset = picked ?? episodePreset ?? showPreset ?? "mp3-128-stereo";
  const channels = format === "mp3" ? (DELIVERY_PRESETS[preset].channels as 1 | 2) : wavChannels;
  const target = channels === 1 ? PODCAST_LOUDNESS.mono : PODCAST_LOUDNESS.stereo;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/studio/projects/${episodeId}/exports`);
      if (r.ok) {
        const b = await r.json();
        setJobs(b.exports);
        setShowPreset(b.showPreset ?? null);
      }
    } catch {
      // keep what we have; the next poll retries
    }
  }, [episodeId]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(t);
  }, [refresh]);

  /** An export started with "Export & use for episode": attach it the moment it is verified. */
  const [pendingUse, setPendingUse] = useState<string | null>(null);
  const start = async (thenUse = false) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/studio/projects/${episodeId}/exports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(format === "mp3" ? { format, preset } : { format, bitDepth, sampleRate, channels }) });
      const b = await r.json();
      if (!b.ok) setError(b.error ?? "Couldn't start the export.");
      else if (thenUse && format === "mp3") setPendingUse(b.id);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const [using, setUsing] = useState<string | null>(null);
  const [useError, setUseError] = useState<string | null>(null);
  /** Make a finished MP3 the episode's feed audio, without downloading it and uploading it again. */
  /** A finished WAV can't go in the feed: make an MP3 of the same edit (the chosen preset), and use it when it's ready. */
  const convertAndUse = async (fromJobId: string) => {
    setUsing(fromJobId);
    setUseError(null);
    try {
      const r = await fetch(`/studio/projects/${episodeId}/exports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format: "mp3", preset, fromJobId }) });
      const b = await r.json();
      if (!b.ok) setUseError(b.error ?? "Couldn't start the conversion.");
      else setPendingUse(b.id);
      await refresh();
    } finally {
      setUsing(null);
    }
  };
  const useAsAudio = async (id: string) => {
    setUsing(id);
    setUseError(null);
    try {
      const r = await fetch(`/studio/exports/${id}/use`, { method: "POST" });
      const b = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !b?.ok) setUseError(b?.error ?? `Couldn't use that file (${r.status}).`);
      await refresh();
    } finally {
      setUsing(null);
    }
  };

  useEffect(() => {
    if (!pendingUse) return;
    const j = jobs.find((x) => x.id === pendingUse);
    if (!j) return;
    if (j.status === "verified") {
      setPendingUse(null);
      void useAsAudio(j.id);
    } else if (j.status === "failed" || j.status === "cancelled") setPendingUse(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, pendingUse]);

  const remove = async (id: string) => {
    await fetch(`/studio/exports/${id}`, { method: "DELETE" });
    await refresh();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[8vh]" role="dialog" aria-modal="true" aria-label="Export" data-testid="export-dialog" onClick={onClose}>
      <div className="flex max-h-[80vh] w-[620px] max-w-[94vw] flex-col rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          <h2 className="text-[15px] font-semibold">Export</h2>
          <div className="flex gap-1 text-[13px]" role="tablist">
            <span role="tab" aria-selected className="rounded-md bg-accent px-2.5 py-1 font-medium">Audio</span>
            <span role="tab" aria-disabled title="Video export arrives in Stage 10a" className="cursor-not-allowed px-2.5 py-1 text-muted-foreground/50">Video</span>
            <span role="tab" aria-disabled title="Editor-project export arrives in Stage 10d" className="cursor-not-allowed px-2.5 py-1 text-muted-foreground/50">Editor project</span>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close export" onClick={onClose} className="ml-auto text-muted-foreground"><FontAwesomeIcon icon={faXmark} /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[13px]">
          <div className="grid grid-cols-[88px_1fr] items-center gap-x-4 gap-y-2.5">
            <span className="text-muted-foreground">Format</span>
            <ToggleGroup type="single" variant="outline" size="sm" value={format} onValueChange={(v) => v && setFormat(v as "mp3" | "wav")} aria-label="Format">
              <ToggleGroupItem value="mp3" data-testid="fmt-mp3" className="px-3">MP3 (for the feed)</ToggleGroupItem>
              <ToggleGroupItem value="wav" data-testid="fmt-wav" className="px-3">WAV (master)</ToggleGroupItem>
            </ToggleGroup>
            {format === "mp3" ? (
              <>
                <span className="self-start pt-2 text-muted-foreground">Quality</span>
                <div className="flex flex-col gap-1.5">
                  <ToggleGroup type="single" variant="outline" size="sm" value={preset} onValueChange={(v) => v && setPicked(v as DeliveryPreset)} aria-label="MP3 preset" className="w-full">
                    {(Object.keys(DELIVERY_PRESETS) as DeliveryPreset[]).map((k) => (
                      <ToggleGroupItem key={k} value={k} data-testid={`preset-${k}`} className="h-auto flex-1 flex-col gap-0 px-2 py-1.5" title={`${DELIVERY_PRESETS[k].label} — ${DELIVERY_PRESETS[k].hint}`}>
                        <span className="text-[12.5px] font-medium">{DELIVERY_PRESETS[k].kbps} kbps {DELIVERY_PRESETS[k].channels === 1 ? "mono" : "stereo"}</span>
                        <span className="text-[10.5px] font-normal text-muted-foreground">{DELIVERY_PRESETS[k].hint}</span>
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <div className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
                    <span data-testid="preset-source">{episodePreset ? "Saved for this episode" : `Show default${showPreset ? "" : " (128 kbps stereo)"}`}</span>
                    {(preset !== episodePreset || preset !== showPreset || episodePreset) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[11.5px]" data-testid="preset-more">· Change default</Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {preset !== episodePreset && <DropdownMenuItem data-testid="preset-keep" onSelect={() => onEpisodePreset(preset)}>Use this for this episode</DropdownMenuItem>}
                          {preset !== showPreset && (
                            <DropdownMenuItem
                              data-testid="preset-show-default"
                              onSelect={async () => {
                                await fetch(`/studio/projects/${episodeId}/exports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ showDefault: preset }) });
                                await refresh();
                              }}
                            >
                              Make this the show default
                            </DropdownMenuItem>
                          )}
                          {episodePreset && <DropdownMenuItem onSelect={() => { onEpisodePreset(null); setPicked(null); }}>Back to the show default</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <span className="text-muted-foreground">Details</span>
                <div className="flex flex-wrap items-center gap-2">
                  <ToggleGroup type="single" variant="outline" size="sm" value={String(bitDepth)} onValueChange={(v) => v && setBitDepth(Number(v) as 16 | 24)} aria-label="Bit depth">
                    <ToggleGroupItem value="16" data-testid="bd-16" className="px-3">16-bit</ToggleGroupItem>
                    <ToggleGroupItem value="24" data-testid="bd-24" className="px-3">24-bit</ToggleGroupItem>
                  </ToggleGroup>
                  <ToggleGroup type="single" variant="outline" size="sm" value={String(sampleRate)} onValueChange={(v) => v && setSampleRate(Number(v) as 44100 | 48000)} aria-label="Sample rate">
                    <ToggleGroupItem value="44100" data-testid="sr-441" className="px-3">44.1 kHz</ToggleGroupItem>
                    <ToggleGroupItem value="48000" data-testid="sr-48" className="px-3">48 kHz</ToggleGroupItem>
                  </ToggleGroup>
                  <ToggleGroup type="single" variant="outline" size="sm" value={String(wavChannels)} onValueChange={(v) => v && setChannels(Number(v) as 1 | 2)} aria-label="Channels">
                    <ToggleGroupItem value="1" data-testid="ch-mono" className="px-3">Mono</ToggleGroupItem>
                    <ToggleGroupItem value="2" data-testid="ch-stereo" className="px-3">Stereo</ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </>
            )}
          </div>
          <p className="mt-3 text-[12px] text-muted-foreground" data-testid="export-target">
            Normalized to <b className="font-semibold text-foreground">{target} LUFS</b>, true peak ≤ {PODCAST_LOUDNESS.truePeakDb} dBTP — the podcast standard for {channels === 1 ? "mono" : "stereo"}. Exports your saved edit, as you hear it.
          </p>

          <h3 className="mb-2 mt-6 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Exports</h3>
          {useError && <p className="mb-2 text-[12.5px] text-destructive" role="alert" data-testid="export-use-error">{useError}</p>}
          <ul className="flex flex-col gap-1.5" data-testid="export-list">
            {jobs.length === 0 && <li className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-muted-foreground">Nothing exported yet.</li>}
            {jobs.map((j) => (
              <li key={j.id} className="rounded-lg border border-border px-3 py-2" data-testid="export-job" data-status={j.status}>
                <div className="flex items-center gap-2">
                  <Status job={j} />
                  <span className="min-w-0 truncate font-medium" data-testid="export-label">{j.kind === "mp3" && j.settings.preset ? `MP3 · ${DELIVERY_PRESETS[j.settings.preset].kbps} kbps ${DELIVERY_PRESETS[j.settings.preset].channels === 2 ? "stereo" : "mono"}` : `WAV · ${j.settings.bitDepth}-bit · ${(j.settings.sampleRate ?? 48000) / 1000} kHz · ${j.settings.channels === 2 ? "stereo" : "mono"}`}</span>
                  {j.inUse && <span className="shrink-0 text-[11.5px] font-medium text-ok" data-testid="export-in-use">✓ In the feed</span>}
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    {j.status === "verified" && j.kind === "mp3" && (j.inUse ? (
                      <a href={`/studio/publish?episode=${episodeId}`} data-testid="export-publish" className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90">Publish →</a>
                    ) : (
                      <Button size="sm" className="h-7 px-3 text-[12px]" onClick={() => void useAsAudio(j.id)} disabled={using !== null} data-testid="export-use">{using === j.id ? "Adding…" : "Use for episode"}</Button>
                    ))}
                    {j.status === "verified" && j.kind === "wav" && (
                      <Button size="sm" className="h-7 px-3 text-[12px]" onClick={() => void convertAndUse(j.id)} disabled={using !== null || pendingUse !== null} title={`A WAV can't go in the feed. This makes an MP3 of the same edit (${DELIVERY_PRESETS[preset].kbps} kbps ${DELIVERY_PRESETS[preset].channels === 2 ? "stereo" : "mono"}) and uses it.`} data-testid="export-convert-use">{using === j.id ? "Converting…" : "Convert & use"}</Button>
                    )}
                    {j.status === "queued" || j.status === "running" ? (
                      <button type="button" onClick={() => void remove(j.id)} disabled={j.cancelRequested === 1} data-testid="export-remove" className="h-7 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">{j.cancelRequested ? "Canceling…" : "Cancel"}</button>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="More" data-testid="export-more"><FontAwesomeIcon icon={faEllipsis} /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {j.status === "verified" && (
                            <DropdownMenuItem asChild>
                              <a href={`/studio/exports/${j.id}`} download data-testid="export-download"><FontAwesomeIcon icon={faDownload} />Download</a>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem variant="destructive" onSelect={() => void remove(j.id)} data-testid="export-remove">Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </span>
                </div>
                {(j.status === "running" || j.status === "queued") && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={Math.round(j.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.max(2, j.progress * 100)}%` }} />
                  </div>
                )}
                {j.status === "verified" && j.summary && (
                  <p className="mt-1 font-mono text-[11.5px] text-muted-foreground" data-testid="export-summary">
                    {j.summary.integratedLufs !== undefined && (
                      <span data-testid="export-loudness">
                        {num(j.summary.integratedLufs)} LUFS · {num(j.summary.truePeakDb)} dBTP
                        {" · "}
                      </span>
                    )}
                    {mb(j.summary.bytes)}
                    {j.summary.clipped > 0 && <span className="ml-2 text-destructive">{j.summary.clipped} samples clipped</span>}
                  </p>
                )}
                {j.status === "verified" && j.summary?.normalise && !j.summary.normalise.reached && (
                  <p className="mt-1 text-[12px] text-destructive" data-testid="export-not-reached">
                    Didn't reach {j.summary.normalise.targetLufs} LUFS{j.summary.normalise.capped ? " — the mix is very quiet" : ""}; check the levels.
                  </p>
                )}
                {j.status === "verified" && (j.summary?.diagnostics?.length ?? 0) > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-1" data-testid="export-diagnostics">
                    {j.summary!.diagnostics!.map((d) => (
                      <li key={d.code} className="rounded-md bg-meter-warn/10 px-2 py-1 text-[12px] text-foreground">{d.message}</li>
                    ))}
                  </ul>
                )}
                {j.status === "failed" && <p className="mt-1.5 text-[12.5px] text-destructive" data-testid="export-error">{j.error}</p>}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-t border-border px-5 py-3">
          {format === "mp3" ? (
            <>
              <Button onClick={() => void start(true)} disabled={!saved || busy || pendingUse !== null || using !== null} data-testid="start-export-use">
                {pendingUse ? "Exporting…" : using ? "Adding…" : "Export & use for episode"}
              </Button>
              <Button variant="outline" onClick={() => void start()} disabled={!saved || busy} data-testid="start-export">Export MP3</Button>
            </>
          ) : (
            <Button onClick={() => void start()} disabled={!saved || busy} data-testid="start-export">Export WAV</Button>
          )}
          {!saved && <span className="text-[12px] text-muted-foreground">Waiting for your edits to finish saving…</span>}
          {error && <span className="text-[12.5px] text-destructive" role="alert">{error}</span>}
        </div>
      </div>
    </div>
  );
}

function Status({ job }: { job: Job }) {
  const label = job.status === "running" ? `Rendering ${Math.round(job.progress * 100)}%` : job.status === "verified" ? "Verified" : job.status === "queued" ? "Queued" : job.status === "failed" ? "Failed" : "Canceled";
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", job.status === "verified" ? "bg-ok/20 text-ok" : job.status === "failed" ? "bg-destructive/20 text-destructive" : "bg-secondary text-muted-foreground")}>{label}</span>;
}
