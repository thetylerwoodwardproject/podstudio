import { useState } from "react";
import { faAnglesLeft, faAnglesRight, faBookmark, faSliders, faVolumeLow, faWandMagicSparkles } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { annotationPositions, GAIN_DB, type Clip, type ProjectDoc } from "~/lib/project/document";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Range } from "~/components/ui/range";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { clockText } from "./draw";
import { DuckingPanel } from "./ducking-panel";
import { TrackFader } from "./track-fader";
import type { Selection } from "./timeline";

interface Props {
  doc: ProjectDoc;
  clip: Clip | null;
  sel: Selection;
  position: () => number;
  rate: number;
  onSeek: (t: number) => void;
  onLevels: (patch: { gainDb?: number; fadeIn?: number; fadeOut?: number }) => void;
  onTrack: (id: string, patch: { name?: string; height?: number; color?: string | null; gainDb?: number }) => void;
  onAddChapter: (label: string) => void;
  onRemoveAnnotation: (id: string) => void;
  onDuck: (op: (d: ProjectDoc) => import("~/lib/project/document").EditResult, group?: string) => void;
  trackHeightRange: { min: number; max: number };
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

type Tab = "clip" | "marks" | "duck";
const TAB_ICON = { clip: faSliders, marks: faBookmark, duck: faVolumeLow } as const;

export function Inspector(p: Props) {
  const [tab, setTab] = useState<Tab>("clip");
  const [chapter, setChapter] = useState("");
  const track = p.doc.tracks.find((t) => t.id === (p.clip?.trackId ?? p.sel.trackId));
  const marks = annotationPositions(p.doc);
  const hidden = p.doc.annotations.length - marks.length;
  const duckCount = p.doc.ducking?.length ?? 0;
  const tabLabel = (t: Tab) => (t === "clip" ? "Clip" : t === "marks" ? "Marks" : "Ducking");
  const tabCount = (t: Tab) => (t === "marks" ? p.doc.annotations.length : t === "duck" ? duckCount : 0);

  if (p.collapsed) {
    return (
      <aside className="flex w-11 min-h-0 flex-col items-center gap-1 border-l border-border bg-background py-2" aria-label="Inspector (collapsed)" data-testid="inspector-rail">
        <Button variant="ghost" size="icon" onClick={() => p.onCollapsedChange(false)} aria-label="Show side panel" title="Show side panel (I)" data-testid="inspector-expand" className="mb-1 size-8 text-[12px] text-muted-foreground">
          <FontAwesomeIcon icon={faAnglesLeft} />
        </Button>
        <div className="mb-1 h-px w-6 bg-border" />
        {(["clip", "marks", "duck"] as const).map((t) => (
          <Button
            key={t}
            variant="ghost"
            size="icon"
            onClick={() => {
              setTab(t);
              p.onCollapsedChange(false);
            }}
            aria-label={tabLabel(t)}
            title={tabLabel(t)}
            data-testid={`inspector-rail-${t}`}
            className="relative size-8 text-[13px] text-muted-foreground"
          >
            <FontAwesomeIcon icon={TAB_ICON[t]} />
            {tabCount(t) > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-secondary px-1 text-center font-mono text-[9.5px] leading-4 text-foreground">{tabCount(t)}</span>}
          </Button>
        ))}
        <span title="Noise reduction, EQ and compression arrive in Stage 05" className="flex size-8 cursor-not-allowed items-center justify-center text-[13px] text-muted-foreground/40">
          <FontAwesomeIcon icon={faWandMagicSparkles} />
        </span>
      </aside>
    );
  }

  return (
    <aside className="flex w-80 min-h-0 flex-col border-l border-border bg-background" aria-label="Inspector" data-testid="inspector">
      <div className="flex shrink-0 items-center gap-1 border-b border-border p-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="min-w-0 flex-1">
          <TabsList className="w-full">
            {(["clip", "marks", "duck"] as const).map((t) => (
              <TabsTrigger key={t} value={t} className="text-[12.5px]">
                {tabLabel(t)}
                {tabCount(t) > 0 || t === "marks" ? <span className="text-muted-foreground">({tabCount(t)})</span> : null}
              </TabsTrigger>
            ))}
            <TabsTrigger value="fx" disabled title="Noise reduction, EQ and compression arrive in Stage 05" className="text-[12.5px]">FX</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="ghost" size="icon" onClick={() => p.onCollapsedChange(true)} aria-label="Hide side panel" title="Hide side panel (I)" data-testid="inspector-collapse" className="size-8 shrink-0 text-[12px] text-muted-foreground">
          <FontAwesomeIcon icon={faAnglesRight} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[13px]">
        {tab === "clip" && (
          <div className="flex flex-col gap-5">
            {track && (
              <section>
                <h3 className="mb-2 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Track</h3>
                <label className="mb-2 block">
                  <span className="mb-1 block text-muted-foreground">Name</span>
                  <Input value={track.name} maxLength={60} onChange={(e) => p.onTrack(track.id, { name: e.target.value })} data-testid="track-name" />
                </label>
                <div className="mb-3">
                  <span className="mb-1.5 block text-muted-foreground">Volume</span>
                  <TrackFader gainDb={track.gainDb ?? 0} onChange={(g) => p.onTrack(track.id, { gainDb: g })} testid="inspector-track-fader" />
                  <p className="mt-1 text-[11.5px] text-muted-foreground">The whole track, after clip gain and fades. Noise cleanup, EQ and compression will go before this fader (Stage 05).</p>
                </div>
                <label className="block">
                  <span className="mb-1 flex justify-between text-muted-foreground"><span>Height</span><span className="font-mono">{track.height}px</span></span>
                  <Range min={p.trackHeightRange.min} max={p.trackHeightRange.max} value={track.height} onChange={(e) => p.onTrack(track.id, { height: Number(e.target.value) })} />
                </label>
              </section>
            )}
            {p.clip ? (
              <section data-testid="clip-inspector">
                <h3 className="mb-2 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Selected clip</h3>
                <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[12px]">
                  <dt className="text-muted-foreground">Starts</dt><dd>{clockText(p.clip.start / p.rate, 2)}</dd>
                  <dt className="text-muted-foreground">Length</dt><dd>{clockText(p.clip.length / p.rate, 2)}</dd>
                  <dt className="text-muted-foreground">From source</dt><dd>{clockText(p.clip.srcStart / p.rate, 2)}</dd>
                </dl>
                <label className="mb-3 block">
                  <span className="mb-1 flex justify-between text-muted-foreground"><span>Gain</span><span className="font-mono" data-testid="gain-readout">{p.clip.gainDb.toFixed(1).replace("-", "−")} dB</span></span>
                  <Range min={-24} max={12} step={0.5} value={Math.max(-24, Math.min(12, p.clip.gainDb))} onChange={(e) => p.onLevels({ gainDb: Math.max(GAIN_DB.min, Number(e.target.value)) })} data-testid="gain" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <Fade label="Fade in" samples={p.clip.fadeIn} rate={p.rate} max={p.clip.length - p.clip.fadeOut} onChange={(n) => p.onLevels({ fadeIn: n })} testid="fade-in" />
                  <Fade label="Fade out" samples={p.clip.fadeOut} rate={p.rate} max={p.clip.length - p.clip.fadeIn} onChange={(n) => p.onLevels({ fadeOut: n })} testid="fade-out" />
                </div>
                <p className="mt-3 text-[12px] text-muted-foreground">Edits never change the recording itself; trim, split and move only change which part of it plays where.</p>
              </section>
            ) : (
              <p className="text-muted-foreground">Click a clip to see its gain and fades. Drag a clip to move it, or its edges to trim.</p>
            )}
          </div>
        )}
        {tab === "duck" && <DuckingPanel doc={p.doc} onEdit={p.onDuck} />}
        {tab === "marks" && (
          <div className="flex flex-col gap-4">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!chapter.trim()) return;
                p.onAddChapter(chapter);
                setChapter("");
              }}
            >
              <Input placeholder="Chapter title at the playhead" value={chapter} maxLength={120} onChange={(e) => setChapter(e.target.value)} data-testid="chapter-title" />
              <Button type="submit" size="sm" variant="outline" data-testid="add-chapter">Add</Button>
            </form>
            <ul className="flex flex-col gap-1" data-testid="marks-list">
              {marks.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => p.onSeek(a.at)} title="Jump to this mark">
                    <span className={cn("rounded-sm px-1.5 py-0.5 text-[10.5px] font-semibold", a.kind === "retake" ? "bg-destructive/20 text-destructive" : "bg-music/25 text-music")}>{a.kind === "retake" ? "RETAKE" : "CHAPTER"}</span>
                    <span className="min-w-0 flex-1 truncate">{a.label}</span>
                    <span className="font-mono text-[12px] text-muted-foreground">{clockText(a.at / p.rate, 1)}</span>
                  </button>
                  {a.kind === "chapter" && <button type="button" aria-label={`Remove ${a.label}`} onClick={() => p.onRemoveAnnotation(a.id)} className="text-muted-foreground hover:text-destructive">×</button>}
                </li>
              ))}
              {marks.length === 0 && <li className="text-muted-foreground">No marks yet.</li>}
            </ul>
            {hidden > 0 && <p className="text-[12px] text-muted-foreground">{hidden} mark{hidden === 1 ? " is" : "s are"} on audio that has been cut. They come back if you undo.</p>}
          </div>
        )}
      </div>
    </aside>
  );
}

function Fade({ label, samples, rate, max, onChange, testid }: { label: string; samples: number; rate: number; max: number; onChange: (n: number) => void; testid: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-muted-foreground">{label} (s)</span>
      <Input
        type="number"
        min={0}
        max={Math.floor(max / rate)}
        step={0.05}
        value={Number((samples / rate).toFixed(2))}
        onChange={(e) => onChange(Math.max(0, Math.min(max, Math.round(Number(e.target.value || 0) * rate))))}
        data-testid={testid}
      />
    </label>
  );
}
