import { useEffect, useMemo, useRef, useState } from "react";
import { faCircleCheck, faPlay, faStop, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { cutRange, cutRanges, sourceToEdited, type EditResult, type ProjectDoc } from "~/lib/project/document";
import { EditorPlayer } from "~/lib/project/player";
import { RETAKE_DEFAULTS, proposeCut } from "~/lib/project/retake";
import { fetchSamples } from "~/lib/project/source-audio";
import { clockText } from "./draw";

interface Row {
  annotationId: string;
  label: string;
  sourceId: string;
  /** Proposed cut in source samples (editable). */
  from: number;
  to: number;
  toneStart: number;
  toneFound: boolean;
  startLimited: boolean;
  endLimited: boolean;
  checked: boolean;
}

type Load = { kind: "loading" } | { kind: "ready"; rows: Row[] } | { kind: "error"; message: string };

interface Props {
  doc: ProjectDoc;
  onApply: (r: EditResult, summary: string) => void;
  onClose: () => void;
  onFocusRange: (from: number, to: number) => void;
}

const NUDGE = 0.1;

export function RetakePanel({ doc, onApply, onClose, onFocusRange }: Props) {
  const rate = doc.sampleRate;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [active, setActive] = useState<string | null>(null);
  const [auditioning, setAuditioning] = useState<string | null>(null);
  const auditionPlayer = useRef<EditorPlayer | null>(null);
  const stopTimer = useRef<number | null>(null);
  // Analyse once per set of marks; later edits don't rerun it (the user may have adjusted rows).
  const marks = useMemo(() => doc.annotations.filter((a) => a.kind === "retake"), [doc.annotations]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const rows: Row[] = [];
        for (const a of marks) {
          const src = doc.sources.find((s) => s.id === a.sourceId);
          if (!src) continue;
          const back = Math.round(RETAKE_DEFAULTS.maxLookbackS * rate);
          const fwd = Math.round((RETAKE_DEFAULTS.maxLookaheadS + 1) * rate);
          const winStart = Math.max(0, a.sample - back);
          const win = await fetchSamples(src.assetId, src.totalSamples, winStart, a.sample + fwd - winStart);
          const p = proposeCut(win, winStart, a.sample, rate);
          rows.push({ annotationId: a.id, label: a.label, sourceId: a.sourceId, from: p.from, to: p.to, toneStart: p.toneStart, toneFound: p.toneFound, startLimited: p.startLimited, endLimited: p.endLimited, checked: true });
        }
        if (live) setLoad({ kind: "ready", rows });
      } catch (e) {
        if (live) setLoad({ kind: "error", message: e instanceof Error ? e.message : "Couldn't analyse the audio" });
      }
    })();
    return () => {
      live = false;
    };
    // analyse when the panel opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (stopTimer.current) window.clearTimeout(stopTimer.current);
      auditionPlayer.current?.dispose();
    },
    [],
  );

  const setRows = (fn: (rows: Row[]) => Row[]) => setLoad((l) => (l.kind === "ready" ? { kind: "ready", rows: fn(l.rows) } : l));
  const patch = (id: string, p: Partial<Row>) => setRows((rows) => rows.map((r) => (r.annotationId === id ? { ...r, ...p } : r)));

  /** Timeline range for a row, or why it can't be applied (already cut / spans a cut). */
  const place = (r: Row): { from: number; to: number } | { problem: string } => {
    const a = sourceToEdited(doc, r.sourceId, r.from);
    const b = sourceToEdited(doc, r.sourceId, r.to - 1);
    if (a === null || b === null) return { problem: "Part of this is already cut" };
    if (b - a !== r.to - 1 - r.from) return { problem: "Spans an earlier cut" };
    return { from: a, to: b + 1 };
  };

  const stopAudition = () => {
    if (stopTimer.current) window.clearTimeout(stopTimer.current);
    auditionPlayer.current?.pause();
    setAuditioning(null);
  };

  const audition = async (r: Row, mode: "join" | "removed") => {
    const where = place(r);
    if ("problem" in where) return;
    stopAudition();
    const sources: Record<string, { assetId: string; totalSamples: number }> = {};
    for (const s of doc.sources) sources[s.id] = { assetId: s.assetId, totalSamples: s.totalSamples };
    auditionPlayer.current?.dispose();
    let previewDoc = doc;
    let start: number;
    let ms: number;
    if (mode === "join") {
      const cut = cutRange(doc, where.from, where.to, { ripple: true });
      if (!cut.ok) return;
      previewDoc = cut.doc;
      start = Math.max(0, where.from - 2 * rate);
      ms = ((where.from - start) / rate + 2) * 1000;
    } else {
      start = where.from;
      ms = ((where.to - where.from) / rate) * 1000;
    }
    const pl = new EditorPlayer(previewDoc, sources);
    auditionPlayer.current = pl;
    setAuditioning(`${r.annotationId}:${mode}`);
    await pl.play(start);
    stopTimer.current = window.setTimeout(stopAudition, Math.min(ms, 20_000));
  };

  const rows = load.kind === "ready" ? load.rows : [];
  const placed = rows.map((r) => ({ r, where: place(r) }));
  const chosen = placed.filter((p) => p.r.checked && !("problem" in p.where)) as { r: Row; where: { from: number; to: number } }[];
  const removedS = chosen.reduce((n, p) => n + (p.where.to - p.where.from), 0) / rate;
  const overlapping = chosen.some((p, i) => chosen.some((q, j) => i !== j && p.where.from < q.where.to && q.where.from < p.where.to));

  return (
    <section className="flex h-[330px] shrink-0 flex-col border-t border-border bg-background" aria-label="Retake cleanup" data-testid="retake-panel">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-3">
        <h2 className="shrink-0 whitespace-nowrap text-[14px] font-semibold">Retake cleanup</h2>
        <span className="min-w-0 truncate text-[12.5px] text-muted-foreground" title="Each cut runs from where the flubbed phrase began, through the tone, to where the redo begins.">Each cut runs from the flubbed phrase, through the tone, to the redo. Listen, nudge, then apply.</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="whitespace-nowrap text-[12.5px] text-muted-foreground" data-testid="retake-summary">{chosen.length} cut{chosen.length === 1 ? "" : "s"} · removes {removedS.toFixed(1)} s</span>
          <Button
            size="sm"
            disabled={chosen.length === 0 || overlapping}
            data-testid="apply-cuts"
            onClick={() => {
              stopAudition();
              const r = cutRanges(doc, chosen.map((c) => c.where), { ripple: true });
              onApply(r, `Removed ${chosen.length} retake${chosen.length === 1 ? "" : "s"} (−${removedS.toFixed(1)} s). Undo brings them back.`);
              if (r.ok) onClose();
            }}
          >
            Apply {chosen.length} cut{chosen.length === 1 ? "" : "s"}
          </Button>
          <button type="button" aria-label="Close retake cleanup" onClick={() => { stopAudition(); onClose(); }} className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><FontAwesomeIcon icon={faXmark} /></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {load.kind === "loading" && <p className="p-4 text-[13px] text-muted-foreground" data-testid="retake-loading">Listening for the pauses around each retake…</p>}
        {load.kind === "error" && <p className="p-4 text-[13px] text-destructive">Couldn't analyse the audio: {load.message}</p>}
        {load.kind === "ready" && rows.length === 0 && <p className="p-4 text-[13px] text-muted-foreground" data-testid="retake-empty">No retake marks in this project. Press K while recording to mark one.</p>}
        {rows.length > 0 && (
          <table className="w-full text-[13px]" data-testid="retake-table">
            <thead className="sticky top-0 bg-background text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              <tr><th className="w-10 px-3 py-2"><span className="sr-only">Apply</span></th><th className="px-2 py-2">Retake</th><th className="px-2 py-2">Cut starts</th><th className="px-2 py-2">Cut ends</th><th className="px-2 py-2">Removes</th><th className="px-2 py-2">Listen</th><th className="px-2 py-2">Notes</th></tr>
            </thead>
            <tbody>
              {placed.map(({ r, where }) => {
                const problem = "problem" in where ? where.problem : null;
                return (
                  <tr key={r.annotationId} data-testid="retake-row" onClick={() => { setActive(r.annotationId); if (!problem) onFocusRange((where as { from: number }).from, (where as { to: number }).to); }} className={cn("border-t border-border", active === r.annotationId && "bg-accent/40", problem && "opacity-60")}>
                    <td className="px-3 py-2"><input type="checkbox" checked={r.checked && !problem} disabled={!!problem} onChange={(e) => patch(r.annotationId, { checked: e.target.checked })} aria-label={`Apply cut for ${r.label}`} data-testid="retake-check" /></td>
                    <td className="px-2 py-2 font-medium">{r.label}</td>
                    <td className="px-2 py-2"><Edge value={r.from} rate={rate} max={r.toneStart} onChange={(v) => patch(r.annotationId, { from: v })} testid="from" /></td>
                    <td className="px-2 py-2"><Edge value={r.to} rate={rate} min={r.toneStart} onChange={(v) => patch(r.annotationId, { to: v })} testid="to" /></td>
                    <td className="px-2 py-2 font-mono text-[12.5px]">{((r.to - r.from) / rate).toFixed(1)} s</td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <AudBtn on={auditioning === `${r.annotationId}:join`} disabled={!!problem} onClick={() => (auditioning === `${r.annotationId}:join` ? stopAudition() : void audition(r, "join"))} label="Hear the join" testid="hear-join" />
                        <AudBtn on={auditioning === `${r.annotationId}:removed`} disabled={!!problem} onClick={() => (auditioning === `${r.annotationId}:removed` ? stopAudition() : void audition(r, "removed"))} label="Hear what's removed" testid="hear-removed" />
                      </div>
                    </td>
                    <td className="px-2 py-2 text-[12px] text-muted-foreground">
                      {problem ? <span className="text-foreground">{problem}</span> : (
                        <span className="flex flex-col gap-0.5">
                          <span className="flex items-center gap-1.5"><FontAwesomeIcon icon={r.toneFound ? faCircleCheck : faTriangleExclamation} className={r.toneFound ? "text-ok" : "text-destructive"} />{r.toneFound ? "Tone found in the audio" : "Tone not found; using the mark"}</span>
                          {(r.startLimited || r.endLimited) && <span>No pause found {r.startLimited ? "before" : "after"} — check the {r.startLimited ? "start" : "end"}</span>}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function Edge({ value, rate, min, max, onChange, testid }: { value: number; rate: number; min?: number; max?: number; onChange: (v: number) => void; testid: string }) {
  const step = (d: number) => {
    let v = value + Math.round(d * rate);
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(Math.max(0, v));
  };
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" className="size-6 rounded border border-border text-[12px] text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); step(-NUDGE); }} aria-label={`${testid} 0.1 s earlier`} data-testid={`${testid}-earlier`}>−</button>
      <span className="w-[68px] text-center font-mono text-[12.5px]" data-testid={`${testid}-value`}>{clockText(value / rate, 2)}</span>
      <button type="button" className="size-6 rounded border border-border text-[12px] text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); step(NUDGE); }} aria-label={`${testid} 0.1 s later`} data-testid={`${testid}-later`}>+</button>
    </span>
  );
}

function AudBtn({ on, disabled, onClick, label, testid }: { on: boolean; disabled: boolean; onClick: () => void; label: string; testid: string }) {
  return (
    <button type="button" disabled={disabled} title={label} aria-label={label} aria-pressed={on} data-testid={testid} onClick={(e) => { e.stopPropagation(); onClick(); }} className={cn("flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-[11.5px] font-medium disabled:opacity-40", on ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>
      <FontAwesomeIcon icon={on ? faStop : faPlay} className="text-[9px]" />{testid === "hear-join" ? "Join" : "Removed"}
    </button>
  );
}
