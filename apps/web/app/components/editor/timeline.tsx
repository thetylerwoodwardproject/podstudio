import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { faEllipsis, faLock, faPalette, faPen, faRepeat, faScissors, faTrashCan, faUpload, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { annotationPositions, clipEnd, withCrossfades, moveClip, projectLength, setClipLevels, trimClip, TRACK_HEIGHT, type ProjectDoc, type TrackKind } from "~/lib/project/document";
import type { Peaks } from "~/lib/project/peaks";
import { cn } from "~/lib/utils";
import { clipAt, clockText, drawTrack, labelHeight, rulerStep, trackColor } from "./draw";
import type { LibraryItem } from "./library-panel";
import { AddTrackMenu, KIND_LABEL, TrackOptions } from "./track-menus";
import { TrackMeter } from "./meters";
import { LIBRARY_DRAG_TYPE } from "./library-sidebar";
import type { FrameEmitter } from "~/lib/audio/frame-source";
import type { MeterFrame } from "~/lib/audio/types";
import { Button } from "~/components/ui/button";
import { ChannelToggle, MuteToggle, SoloToggle } from "~/components/ui/channel-toggle";
import { TrackFader } from "./track-fader";
import { TrackPan } from "./track-pan";
import { fxActive } from "@podstudio/audio/fx";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "~/components/ui/context-menu";

export interface Selection {
  trackId: string | null;
  clipId: string | null;
  /** A time range; `trackIds` limits it to those tracks (absent = every track, e.g. from the ruler). */
  range: { from: number; to: number; trackIds?: string[] } | null;
}

interface Props {
  doc: ProjectDoc;
  peaks: Record<string, Peaks | undefined>;
  spp: number;
  sel: Selection;
  setSel: (s: Selection) => void;
  /** Live (uncommitted) document while dragging; null when not dragging. */
  onPreview: (d: ProjectDoc | null) => void;
  onCommit: (d: ProjectDoc, label: string) => void;
  onSeek: (sample: number) => void;
  onError: (msg: string) => void;
  onTrackUpdate: (trackId: string, patch: { name?: string; muted?: boolean; solo?: boolean; locked?: boolean; height?: number; color?: string | null; gainDb?: number; pan?: number }) => void;
  onDeleteTrack: (trackId: string) => void;
  playheadRef: React.RefObject<HTMLDivElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  dimMuted: boolean;
  onZoom: (factor: number, clientX: number) => void;
  onAddTrack: (kind: TrackKind) => void;
  onAddFromLibrary: (item: LibraryItem) => void;
  onUploadNew: (kind: TrackKind) => void;
  onUploadTo: (trackId: string) => void;
  /** Range tool: a plain drag selects a range even over clips (instead of moving them). */
  rangeTool: boolean;
  loop: { from: number; to: number } | null;
  onMenuAction: (a: MenuAction) => void;
  /** Level meter source for a track. */
  trackMeter: (trackId: string) => FrameEmitter<MeterFrame>;
  /** Advanced layout: lock button, per-track meters, the separate marks lane. Simple shows marks on the ruler. */
  /** Advanced: open the inspector's FX tab for a track. */
  /** Simple: the FX panel to show in a popover from the track's FX button. */
  fxPanel: (track: ProjectDoc["tracks"][number]) => React.ReactNode;
  /** A library item dragged from the sidebar and dropped on a track. */
  onDropLibrary: (item: LibraryItem, trackId: string, at: number) => void;
}

/** What the timeline's right-click menus ask the editor to do. */
export type MenuAction =
  | { kind: "range-gap-tracks" }
  | { kind: "range-ripple-tracks-unsynced" }
  | { kind: "range-gap-all" }
  | { kind: "range-ripple-all" }
  | { kind: "range-split-edges" }
  | { kind: "loop-toggle" }
  | { kind: "range-clear" }
  | { kind: "clip-split"; at: number; clipId: string }
  | { kind: "clip-delete-gap"; clipId: string }
  | { kind: "clip-ripple"; clipId: string }
  | { kind: "select-track-range"; trackId: string; from: number; to: number };

const HEADER_W = 208;
const EDGE_PX = 7;
const RULER_H = 28;

export function Timeline(p: Props) {
  const { doc, spp } = p;
  const total = Math.max(projectLength(doc), doc.sampleRate * 10);
  const contentPx = Math.ceil(total / spp) + 400;
  // Drawing happens into a "tile" three viewports wide that lives in content space, so ordinary
  // scrolling is done by the browser's compositor with zero JavaScript and zero lag. React only
  // hears about it when the viewport gets within half a viewport of the tile's edge.
  const [view, setView] = useState({ left: 0, width: 800, tileLeft: 0, tileWidth: 2400 });
  const onZoomRef = useRef(p.onZoom);
  onZoomRef.current = p.onZoom;
  const contentRef = useRef(contentPx);
  contentRef.current = contentPx;

  useLayoutEffect(() => {
    const el = p.scrollRef.current;
    if (!el) return;
    const measure = (force: boolean) => {
      const width = Math.max(200, el.clientWidth - HEADER_W);
      const left = el.scrollLeft;
      setView((v) => {
        const tileEnd = v.tileLeft + v.tileWidth;
        const atStart = v.tileLeft <= 0;
        const atEnd = tileEnd >= contentRef.current;
        const near = (!atStart && left < v.tileLeft + width * 0.5) || (!atEnd && left + width > tileEnd - width * 0.5);
        if (!force && !near && v.width === width) return v;
        const tileWidth = Math.min(width * 3, Math.max(width, contentRef.current));
        const tileLeft = Math.max(0, Math.min(Math.round(left - width), Math.max(0, contentRef.current - tileWidth)));
        return { left, width, tileLeft, tileWidth };
      });
    };
    measure(true);
    const onScroll = () => measure(false);
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => measure(true));
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
    // re-tile when the zoom (content width) changes
  }, [p.scrollRef, spp]);

  // Mouse wheel (Tyler, 2026-11-02): the wheel scrolls the tracks up/down (native); Shift+wheel scrolls
  // the timeline sideways; Ctrl/⌘+wheel (and a trackpad pinch) zooms around the pointer. Trackpad
  // two-finger swipes stay native in both directions.
  useEffect(() => {
    const el = p.scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        onZoomRef.current(Math.exp(Math.max(-60, Math.min(60, e.deltaY * unit)) * 0.006), e.clientX);
        return;
      }
      if (e.shiftKey) {
        // some browsers already turn Shift+wheel into deltaX; others don't
        e.preventDefault();
        el.scrollLeft += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [p.scrollRef]);

  const anySolo = doc.tracks.some((t) => t.solo);

  return (
    <div ref={p.scrollRef} className="relative min-h-0 flex-1 overflow-auto overscroll-x-contain" data-testid="timeline-scroll">
      <div style={{ width: "100%", minWidth: HEADER_W + contentPx }} className="relative">
        {/* ruler + annotation lane */}
        <div className="sticky top-0 z-30 flex bg-background">
          <div style={{ width: HEADER_W }} className="sticky left-0 z-40 shrink-0 border-b border-r border-border bg-background" />
          <Ruler {...p} view={view} contentPx={contentPx} />
        </div>

        {doc.tracks.map((t) => (
          <TrackRow key={t.id} {...p} track={t} view={view} contentPx={contentPx} dim={p.dimMuted && (anySolo ? !t.solo : t.muted)} />
        ))}
        <AddTrackRow onAdd={p.onAddTrack} onAddFromLibrary={p.onAddFromLibrary} onUploadNew={p.onUploadNew} />
        <div ref={p.playheadRef} style={{ left: HEADER_W, height: "100%" }} className="pointer-events-none absolute top-0 z-20 w-px bg-foreground will-change-transform" data-testid="playhead">
          <div className="absolute -left-[5px] top-0 size-0 border-x-[5.5px] border-t-[8px] border-x-transparent border-t-foreground" />
        </div>
      </div>
    </div>
  );
}

type View = { left: number; width: number; tileLeft: number; tileWidth: number };

function Ruler(p: Props & { view: View; contentPx: number }) {
  const { spp, doc, view } = p;
  const rate = doc.sampleRate;
  const step = rulerStep(spp, rate);
  const first = Math.max(0, Math.floor((view.tileLeft * spp) / rate / step) * step);
  const ticks: number[] = [];
  for (let s = first; s * rate < (view.tileLeft + view.tileWidth) * spp + step * rate; s += step) ticks.push(s);
  const drag = useRef<{ from: number; moved: boolean } | null>(null);
  const at = (e: React.PointerEvent) => Math.max(0, Math.round(((e.clientX - e.currentTarget.getBoundingClientRect().left) * spp)));

  return (
    <div
      className="relative min-w-0 flex-1 cursor-text select-none border-b border-border"
      style={{ minWidth: p.contentPx, height: RULER_H }}
      data-testid="ruler"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { from: at(e), moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const t = at(e);
        if (Math.abs(t - d.from) / spp > 3) {
          d.moved = true;
          p.setSel({ trackId: null, clipId: null, range: { from: Math.min(d.from, t), to: Math.max(d.from, t) } });
        }
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) {
          p.onSeek(at(e));
          p.setSel({ ...p.sel, range: null });
        } else if (d) {
          const t = at(e);
          p.onSeek(Math.min(d.from, t));
        }
      }}
    >
      {ticks.map((s) => (
        <div key={s} className="absolute top-0 h-full border-l border-border/70 pl-1 pt-1.5 font-mono text-[10.5px] text-muted-foreground" style={{ left: (s * rate) / spp }}>
          {clockText(s, step >= 1 ? 0 : Math.abs(step * 10 - Math.round(step * 10)) < 1e-9 ? 1 : 2)}
        </div>
      ))}
      {annotationPositions(doc).map((a) => {
          const x = a.at / spp;
          if (x < view.tileLeft - 80 || x > view.tileLeft + view.tileWidth + 80) return null;
          return (
            <button
              key={a.id}
              type="button"
              title={`${a.label} · ${clockText(a.at / rate, 1)}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                p.onSeek(a.at);
              }}
              style={{ left: x }}
              data-testid={`anno-${a.kind}`}
              className={cn("absolute bottom-0 z-10 flex h-[13px] items-center gap-0.5 rounded-t-sm border-l-2 pl-1 pr-1.5 text-[9.5px] font-semibold leading-none", a.kind === "retake" ? "border-destructive bg-destructive/20 text-destructive" : "border-music bg-music/25 text-music")}
            >
              {a.kind === "retake" ? a.label.replace("Retake ", "R") : <span className="max-w-24 truncate">{a.label}</span>}
            </button>
          );
        })}
      {p.sel.range && <div className={cn("absolute inset-y-0", p.sel.range.trackIds ? "bg-ring/12" : "bg-ring/25")} style={{ left: p.sel.range.from / spp, width: (p.sel.range.to - p.sel.range.from) / spp }} />}
      {p.loop && (
        <div className="pointer-events-none absolute top-0 h-[5px] rounded-b-sm bg-primary" style={{ left: p.loop.from / spp, width: (p.loop.to - p.loop.from) / spp }} data-testid="loop-band" title="Loop" />
      )}
    </div>
  );
}

type DragKind =
  | { kind: "move"; clipId: string; grabDx: number; startX: number }
  | { kind: "trim"; clipId: string; edge: "start" | "end" }
  | { kind: "fade"; clipId: string; side: "in" | "out"; grabT: number; startFade: number }
  | { kind: "range"; from: number; startX: number; clipId: string | null; trackIds: string[] };

/** The tracks from `a` to whichever track row is under the pointer, in timeline order. */
function tracksSpanned(doc: ProjectDoc, a: string, e: { clientX: number; clientY: number }): string[] {
  const row = document.elementsFromPoint(e.clientX, e.clientY).map((el) => (el as HTMLElement).closest?.("[data-track-id]")).find(Boolean) as HTMLElement | undefined;
  const b = row?.dataset.trackId ?? a;
  const ia = doc.tracks.findIndex((t) => t.id === a);
  const ib = doc.tracks.findIndex((t) => t.id === b);
  if (ia < 0 || ib < 0) return [a];
  return doc.tracks.slice(Math.min(ia, ib), Math.max(ia, ib) + 1).map((t) => t.id);
}

/** The top corners of a clip are fade handles: this far in from the edge and down from the top. */
const CORNER_PX = 16;

function TrackRow(p: Props & { track: ProjectDoc["tracks"][number]; view: View; contentPx: number; dim: boolean }) {
  const { doc, track, spp, view } = p;
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<DragKind | null>(null);
  const moved = useRef(false);
  const startDoc = useRef<ProjectDoc | null>(null);
  const selectedHere = p.sel.trackId === track.id;
  const labels = useMemo(() => Object.fromEntries(doc.sources.map((x) => [x.id, x.label])), [doc.sources]);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const [menuOpen, setMenuOpen] = useState(false);
  const [libDrop, setLibDrop] = useState(false);
  // lit when anything changes this track's sound: its FX chain or ducking under the voices
  const fxOn = fxActive(track.fx) || !!doc.ducking?.some((r) => r.enabled && r.targets.includes(track.id));
  const [fxOpen, setFxOpen] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [renameSignal, setRenameSignal] = useState(0);
  // what the right-click on the waveform area landed on
  const [ctxAt, setCtxAt] = useState<{ t: number; inRange: boolean; clipId: string | null } | null>(null);
  const r = p.sel.range;
  const rangeHere = useMemo(() => (r && (!r.trackIds || r.trackIds.includes(track.id)) ? { from: r.from, to: r.to } : null), [r, track.id]);

  // Only this track's clips matter for its drawing; a drag on one track must not redraw the others.
  const own = useMemo(() => doc.clips.filter((c) => c.trackId === track.id), [doc.clips, track.id]);
  // fades as they play: widened to cover crossfades with an overlapping neighbour
  const clips = useMemo(() => [...withCrossfades({ ...doc, clips: own }).values()], [own]); // eslint-disable-line react-hooks/exhaustive-deps
  // stereo meter when the track holds a stereo source or isn't centred
  const stereoTrack = useMemo(() => (track.pan ?? 0) !== 0 || clips.some((c) => doc.sources.find((x) => x.id === c.sourceId)?.channels === 2), [track.pan, clips, doc.sources]);
  const sig = useMemo(() => clips.map((c) => `${c.id}:${c.sourceId}:${c.start}:${c.srcStart}:${c.length}:${c.fadeIn}:${c.fadeOut}`).join("|"), [clips]);
  const stableClips = useRef(clips);
  const lastSig = useRef(sig);
  if (lastSig.current !== sig) {
    lastSig.current = sig;
    stableClips.current = clips;
  }

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(view.tileWidth * dpr);
    c.height = Math.round(track.height * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const styles = getComputedStyle(document.documentElement);
    drawTrack({
      ctx,
      width: view.tileWidth,
      height: track.height,
      spp,
      originPx: view.tileLeft,
      clips: stableClips.current,
      track,
      peaks: p.peaks,
      selectedClipId: p.sel.clipId,
      range: rangeHere,
      dim: p.dim,
      css: (n) => styles.getPropertyValue(n).trim() || "#888",
      labels: labelsRef.current,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, labels, track.kind, track.color, track.height, spp, view.tileLeft, view.tileWidth, p.peaks, p.sel.clipId, rangeHere, p.dim]);

  const sampleAt = useCallback((e: { clientX: number }, el: HTMLElement) => Math.max(0, Math.round((e.clientX - el.getBoundingClientRect().left + view.tileLeft) * spp)), [view.tileLeft, spp]);

  /** Which fade handle (if any) is under the pointer: the top 16 px of a clip, within 16 px of its left or right edge. */
  const cornerAt = (e: { clientX: number; clientY: number }, el: HTMLElement, t: number) => {
    const y = e.clientY - el.getBoundingClientRect().top;
    if (y > labelHeight(track.height) + CORNER_PX - 2) return null;
    const clip = clipAt(doc, track.id, t);
    if (!clip) return null;
    if ((t - clip.start) / spp <= CORNER_PX) return { clip, side: "in" as const };
    if ((clipEnd(clip) - t) / spp <= CORNER_PX) return { clip, side: "out" as const };
    return null;
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return; // right-click opens the menu; it must not start a drag or drop the selection
    e.currentTarget.setPointerCapture(e.pointerId);
    moved.current = false;
    startDoc.current = doc;
    preview.current = null;
    const t = sampleAt(e, e.currentTarget);
    const clip = clipAt(doc, track.id, t);
    // Drag on empty space, Shift+drag anywhere, or any drag with the range tool: select a range on
    // this track (dragging up/down takes in more tracks). A click without moving is a plain click.
    if (!clip || e.shiftKey || p.rangeTool) {
      drag.current = { kind: "range", from: t, startX: e.clientX, clipId: clip?.id ?? null, trackIds: [track.id] };
      return;
    }
    p.setSel({ trackId: track.id, clipId: clip.id, range: null });
    p.onSeek(t);
    if (track.locked) return;
    const corner = cornerAt(e, e.currentTarget, t);
    if (corner) {
      drag.current = { kind: "fade", clipId: clip.id, side: corner.side, grabT: t, startFade: corner.side === "in" ? clip.fadeIn : clip.fadeOut };
      return;
    }
    const nearStart = (t - clip.start) / spp <= EDGE_PX;
    const nearEnd = (clipEnd(clip) - t) / spp <= EDGE_PX;
    if (nearStart) drag.current = { kind: "trim", clipId: clip.id, edge: "start" };
    else if (nearEnd) drag.current = { kind: "trim", clipId: clip.id, edge: "end" };
    else drag.current = { kind: "move", clipId: clip.id, grabDx: t - clip.start, startX: e.clientX };
  };

  const preview = useRef<ProjectDoc | null>(null);
  const raf = useRef(0);
  const latest = useRef<number | null>(null);
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    const t = sampleAt(e, e.currentTarget);
    if (!d) {
      const clip = clipAt(doc, track.id, t);
      if (clip && !track.locked && !p.rangeTool && !e.shiftKey && cornerAt(e, e.currentTarget, t)) {
        e.currentTarget.style.cursor = "ew-resize";
        e.currentTarget.title = "Drag inward to fade";
        return;
      }
      e.currentTarget.title = "";
      const edge = clip && !track.locked && ((t - clip.start) / spp <= EDGE_PX || (clipEnd(clip) - t) / spp <= EDGE_PX);
      e.currentTarget.style.cursor = p.rangeTool || e.shiftKey || !clip ? "text" : edge ? "ew-resize" : track.locked ? "not-allowed" : "grab";
      return;
    }
    if ((d.kind === "move" || d.kind === "range") && Math.abs(e.clientX - d.startX) < 3 && !moved.current) return;
    moved.current = true;
    if (d.kind === "range") d.trackIds = tracksSpanned(doc, track.id, e);
    // At most one document update per frame, however fast the pointer reports.
    latest.current = t;
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; applyDrag(); });
  };

  const applyDrag = () => {
    const d = drag.current;
    const t = latest.current;
    if (!d || t === null) return;
    if (d.kind === "range") {
      p.setSel({ trackId: track.id, clipId: null, range: { from: Math.min(d.from, t), to: Math.max(d.from, t), trackIds: d.trackIds } });
      return;
    }
    const from = startDoc.current ?? doc;
    if (d.kind === "fade") {
      const c = from.clips.find((x) => x.id === d.clipId);
      if (!c) return;
      // the fade follows how far the pointer has travelled since the grab (no jump when you take hold)
      const delta = d.side === "in" ? t - d.grabT : d.grabT - t;
      const r = d.side === "in" ? setClipLevels(from, c.id, { fadeIn: Math.max(0, Math.min(c.length - c.fadeOut, Math.round(d.startFade + delta))) }) : setClipLevels(from, c.id, { fadeOut: Math.max(0, Math.min(c.length - c.fadeIn, Math.round(d.startFade + delta))) });
      if (r.ok) {
        preview.current = r.doc;
        p.onPreview(r.doc);
      }
      return;
    }
    const r = d.kind === "move" ? moveClip(from, d.clipId, Math.max(0, t - d.grabDx)) : trimClip(from, d.clipId, d.edge, t);
    if (r.ok) {
      preview.current = r.doc;
      p.onPreview(r.doc);
    }
  };

  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (raf.current) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    }
    if (d && latest.current !== null) applyDrag(); // settle on the final pointer position
    const lastT = latest.current;
    drag.current = null;
    latest.current = null;
    if (d?.kind === "range") {
      if (!moved.current) {
        // a click: select the clip under it (or just the track) and move the playhead there
        p.setSel({ trackId: track.id, clipId: d.clipId, range: null });
        p.onSeek(d.from);
      } else p.onSeek(Math.min(d.from, lastT ?? d.from));
      return;
    }
    if (!d) return;
    const next = preview.current;
    preview.current = null;
    p.onPreview(null);
    if (moved.current && next && next !== startDoc.current) p.onCommit(next, d.kind === "move" ? "Move clip" : d.kind === "fade" ? "Fade" : "Trim clip");
    else if (moved.current) p.onError("That edit would overlap another clip.");
    startDoc.current = null;
    void e;
  };

  const rangeNames = r?.trackIds ? r.trackIds.map((id) => doc.tracks.find((t) => t.id === id)?.name).filter(Boolean).join(" + ") : "all tracks";
  // the colour/delete popover opens once the context menu has fully closed (else it dismisses it)
  const pendingOptions = useRef<boolean | null>(null);
  const openOptions = (confirm: boolean) => {
    pendingOptions.current = confirm;
  };

  return (
    <div className="flex border-b border-border" style={{ height: track.height }} data-testid={`track-${track.kind}`} data-track-id={track.id}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            style={{ width: HEADER_W }}
            className={cn("sticky left-0 z-20 flex shrink-0 flex-col justify-between border-r border-border bg-background py-2 pl-3.5 pr-2", selectedHere && "bg-accent/50")}
            onClick={() => p.setSel({ ...p.sel, trackId: track.id })}
            onContextMenu={() => p.setSel({ ...p.sel, trackId: track.id })}
            data-testid="track-header"
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: trackColor(track) }} data-testid="track-color-bar" />
            <div className="flex items-center gap-1">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: trackColor(track) }} />
              <TrackName name={track.name} renameSignal={renameSignal} onSelect={() => p.setSel({ ...p.sel, trackId: track.id })} onRename={(n) => p.onTrackUpdate(track.id, { name: n })} />
              {track.locked && <FontAwesomeIcon icon={faLock} className="text-[10px] text-muted-foreground" title="Locked (right-click to unlock)" />}
              <Popover open={fxOpen} onOpenChange={setFxOpen}>
                <PopoverTrigger asChild>
                  <FxButton active={fxOn} open={fxOpen} />
                </PopoverTrigger>
                {/* Hindenburg-style FX: effect list + the selected effect, the same in Simple and Advanced */}
                <PopoverContent align="start" side="bottom" sideOffset={6} collisionPadding={8} className="max-h-[var(--radix-popover-content-available-height)] w-[min(900px,calc(100vw-16px))] overflow-y-auto p-5" data-testid="fx-popover" onClick={(e) => e.stopPropagation()}>
                  {p.fxPanel(track)}
                </PopoverContent>
              </Popover>
              <TrackOptions
                track={track}
                clipCount={clips.length}
                open={menuOpen}
                onOpenChange={(v) => {
                  setMenuOpen(v);
                  if (!v) setAskDelete(false);
                }}
                confirmDelete={askDelete}
                onColor={(c) => p.onTrackUpdate(track.id, { color: c })}
                onDelete={() => {
                  setMenuOpen(false);
                  p.onDeleteTrack(track.id);
                }}
              >
                <Button variant="ghost" size="icon" aria-label={`${track.name} options`} title="Color, delete…" data-testid="track-menu-button" onClick={(e) => e.stopPropagation()} className="size-6 text-[12px] text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground">
                  <FontAwesomeIcon icon={faEllipsis} />
                </Button>
              </TrackOptions>
            </div>
            <div className="flex items-center gap-1.5">
              <MuteToggle size="sm" variant="outline" pressed={track.muted} onPressedChange={(v) => p.onTrackUpdate(track.id, { muted: v })} title="Mute (M)" aria-label="Mute" className="h-6 w-7 min-w-7 px-0 text-[11px]">
                M
              </MuteToggle>
              <SoloToggle size="sm" variant="outline" pressed={track.solo} onPressedChange={(v) => p.onTrackUpdate(track.id, { solo: v })} title="Solo (S)" aria-label="Solo" className="h-6 w-7 min-w-7 px-0 text-[11px]">
                S
              </SoloToggle>
              <TrackFader gainDb={track.gainDb ?? 0} onChange={(g) => p.onTrackUpdate(track.id, { gainDb: g })} className="ml-1 min-w-0 flex-1" />
            </div>
            {track.height >= 90 && <TrackPan pan={track.pan ?? 0} onChange={(v) => p.onTrackUpdate(track.id, { pan: v })} />}
            {/* the track's level (audiocn LevelMeter): L/R when stereo or panned */}
            <div className="mt-auto flex min-w-0 items-center" title="Track level (dBFS)">
              <TrackMeter source={p.trackMeter(track.id)} dim={p.dim} stereo={stereoTrack} />
            </div>
            <ResizeGrip height={track.height} onChange={(h) => p.onTrackUpdate(track.id, { height: h })} />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56" data-testid="track-context-menu" onCloseAutoFocus={(e) => {
            e.preventDefault();
            const want = pendingOptions.current;
            pendingOptions.current = null;
            if (want !== null) {
              setAskDelete(want);
              setMenuOpen(true);
            }
          }}>
          <ContextMenuLabel className="truncate">{track.name} · {KIND_LABEL[track.kind]}</ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => setTimeout(() => setRenameSignal((n) => n + 1), 0)}><FontAwesomeIcon icon={faPen} className="w-4 text-muted-foreground" /> Rename</ContextMenuItem>
          <ContextMenuItem onSelect={() => openOptions(false)} data-testid="ctx-track-colour"><FontAwesomeIcon icon={faPalette} className="w-4 text-muted-foreground" /> Color…</ContextMenuItem>
          {!track.locked && clips.length === 0 && <ContextMenuItem onSelect={() => p.onUploadTo(track.id)}><FontAwesomeIcon icon={faUpload} className="w-4 text-muted-foreground" /> Upload audio here</ContextMenuItem>}
          <ContextMenuSeparator />
          <ContextMenuCheckboxItem checked={track.muted} onCheckedChange={(v) => p.onTrackUpdate(track.id, { muted: !!v })}>Mute<ContextMenuShortcut>M</ContextMenuShortcut></ContextMenuCheckboxItem>
          <ContextMenuCheckboxItem checked={track.solo} onCheckedChange={(v) => p.onTrackUpdate(track.id, { solo: !!v })}>Solo<ContextMenuShortcut>S</ContextMenuShortcut></ContextMenuCheckboxItem>
          <ContextMenuCheckboxItem checked={track.locked} onCheckedChange={(v) => p.onTrackUpdate(track.id, { locked: !!v })}>Lock<ContextMenuShortcut>L</ContextMenuShortcut></ContextMenuCheckboxItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" disabled={track.locked} onSelect={() => (clips.length > 0 ? openOptions(true) : p.onDeleteTrack(track.id))} data-testid="ctx-track-delete"><FontAwesomeIcon icon={faTrashCan} className="w-4" /> Delete track{clips.length > 0 ? "…" : ""}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn("relative min-w-0 flex-1", libDrop && "bg-ring/10 outline-dashed outline-2 -outline-offset-2 outline-ring/60")}
            style={{ minWidth: p.contentPx, height: track.height }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(LIBRARY_DRAG_TYPE) || track.locked) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "copy";
              if (!libDrop) setLibDrop(true);
            }}
            onDragLeave={() => setLibDrop(false)}
            onDrop={(e) => {
              const raw = e.dataTransfer.getData(LIBRARY_DRAG_TYPE);
              setLibDrop(false);
              if (!raw || !canvas.current) return;
              e.preventDefault();
              e.stopPropagation();
              p.onDropLibrary(JSON.parse(raw) as LibraryItem, track.id, sampleAt(e, canvas.current));
            }}
            onContextMenu={(e) => {
              const el = canvas.current;
              if (!el) return;
              const t = sampleAt(e, el);
              const inRange = !!rangeHere && t >= rangeHere.from && t < rangeHere.to;
              const clip = clipAt(doc, track.id, t);
              setCtxAt({ t, inRange, clipId: clip?.id ?? null });
              if (!inRange && clip) p.setSel({ trackId: track.id, clipId: clip.id, range: null });
              else if (!inRange) p.setSel({ ...p.sel, trackId: track.id });
            }}
          >
            <canvas
              ref={canvas}
              data-testid={`canvas-${track.kind}`}
              style={{ position: "absolute", left: view.tileLeft, top: 0, width: view.tileWidth, height: track.height, touchAction: "none" }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={() => {
                drag.current = null;
                p.onPreview(null);
              }}
            />
            {clips.length === 0 && !track.locked && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-3 text-[12.5px] text-muted-foreground" style={{ left: view.tileLeft, width: view.tileWidth }}>
                <Button variant="outline" size="sm" onClick={() => p.onUploadTo(track.id)} data-testid="empty-track-upload" className="pointer-events-auto">Upload audio</Button>
                <span>or drop WAV, MP3, M4A, FLAC files here</span>
              </div>
            )}
            {track.locked && <div className="pointer-events-none absolute inset-0 bg-background/30" style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent 0 8px, rgba(127,127,127,.12) 8px 9px)" }} />}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-72" data-testid="canvas-context-menu">
          {ctxAt?.inRange && r ? (
            <>
              <ContextMenuLabel className="font-normal text-muted-foreground">
                Selection {clockText(r.from / doc.sampleRate, 1)}–{clockText(r.to / doc.sampleRate, 1)} · <span className="text-foreground">{rangeNames}</span>
              </ContextMenuLabel>
              <ContextMenuSeparator />
              {r.trackIds && (
                <>
                  <ContextMenuItem onSelect={() => p.onMenuAction({ kind: "range-gap-tracks" })} data-testid="ctx-range-gap-tracks">
                    <FontAwesomeIcon icon={faScissors} className="w-4 text-muted-foreground" />
                    <span className="flex flex-col"><span>Delete from {rangeNames} only</span><span className="text-[11px] text-muted-foreground">Leaves silence; everything stays in sync</span></span>
                    <ContextMenuShortcut>⌫</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => p.onMenuAction({ kind: "range-ripple-tracks-unsynced" })} data-testid="ctx-range-ripple-tracks">
                    <FontAwesomeIcon icon={faScissors} className="w-4 text-muted-foreground" />
                    <span className="flex flex-col"><span>Cut from {rangeNames} only, close gap</span><span className="text-[11px] text-muted-foreground">Later audio on {r.trackIds.length === 1 ? "this track" : "these tracks"} moves earlier — out of sync with the rest</span></span>
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                </>
              )}
              <ContextMenuItem onSelect={() => p.onMenuAction({ kind: "range-ripple-all" })} data-testid="ctx-range-ripple-all">
                <FontAwesomeIcon icon={faScissors} className="w-4 text-muted-foreground" />
                <span className="flex flex-col"><span>Cut from all tracks, close gap</span><span className="text-[11px] text-muted-foreground">Later audio moves up everywhere</span></span>
                <ContextMenuShortcut>⇧⌫</ContextMenuShortcut>
              </ContextMenuItem>
              {r.trackIds && (
                <ContextMenuItem onSelect={() => p.onMenuAction({ kind: "range-gap-all" })} data-testid="ctx-range-gap-all">
                  <FontAwesomeIcon icon={faScissors} className="w-4 text-muted-foreground" /> Delete from all tracks, leave gap
                </ContextMenuItem>
              )}
              {!r.trackIds && (
                <ContextMenuItem onSelect={() => p.onMenuAction({ kind: "range-gap-tracks" })} data-testid="ctx-range-gap-all">
                  <FontAwesomeIcon icon={faScissors} className="w-4 text-muted-foreground" /> Delete from all tracks, leave gap
                  <ContextMenuShortcut>⌫</ContextMenuShortcut>
                </ContextMenuItem>
              )}
              <ContextMenuItem onSelect={() => p.onMenuAction({ kind: "range-split-edges" })} data-testid="ctx-range-split">
                <FontAwesomeIcon icon={faScissors} className="w-4 rotate-90 text-muted-foreground" /> Split at the selection edges
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuCheckboxItem checked={!!p.loop} onCheckedChange={() => p.onMenuAction({ kind: "loop-toggle" })} data-testid="ctx-loop">
                <FontAwesomeIcon icon={faRepeat} className="mr-1 w-4 text-muted-foreground" /> Loop selection<ContextMenuShortcut>C</ContextMenuShortcut>
              </ContextMenuCheckboxItem>
              <ContextMenuItem onSelect={() => p.onMenuAction({ kind: "range-clear" })}>
                <FontAwesomeIcon icon={faXmark} className="w-4 text-muted-foreground" /> Clear selection<ContextMenuShortcut>Esc</ContextMenuShortcut>
              </ContextMenuItem>
            </>
          ) : ctxAt?.clipId ? (
            <>
              <ContextMenuLabel className="font-normal text-muted-foreground">Clip on {track.name}</ContextMenuLabel>
              <ContextMenuSeparator />
              <ContextMenuItem disabled={track.locked} onSelect={() => p.onMenuAction({ kind: "clip-split", at: ctxAt.t, clipId: ctxAt.clipId! })} data-testid="ctx-clip-split"><FontAwesomeIcon icon={faScissors} className="w-4 text-muted-foreground" /> Split here</ContextMenuItem>
              <ContextMenuItem
                disabled={track.locked}
                onSelect={() => {
                  const c = clips.find((x) => x.id === ctxAt.clipId);
                  if (c) p.onMenuAction({ kind: "select-track-range", trackId: track.id, from: c.start, to: clipEnd(c) });
                }}
              >
                <FontAwesomeIcon icon={faRepeat} className="w-4 text-muted-foreground" /> Select clip as a range
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem disabled={track.locked} onSelect={() => p.onMenuAction({ kind: "clip-delete-gap", clipId: ctxAt.clipId! })} data-testid="ctx-clip-delete"><FontAwesomeIcon icon={faTrashCan} className="w-4 text-muted-foreground" /> Delete clip, leave gap<ContextMenuShortcut>⌫</ContextMenuShortcut></ContextMenuItem>
              <ContextMenuItem disabled={track.locked} onSelect={() => p.onMenuAction({ kind: "clip-ripple", clipId: ctxAt.clipId! })} data-testid="ctx-clip-ripple"><FontAwesomeIcon icon={faTrashCan} className="w-4 text-muted-foreground" /> Ripple delete (all tracks)<ContextMenuShortcut>⇧⌫</ContextMenuShortcut></ContextMenuItem>
            </>
          ) : (
            <>
              <ContextMenuLabel className="font-normal text-muted-foreground">{track.name}</ContextMenuLabel>
              <ContextMenuSeparator />
              {!track.locked && <ContextMenuItem onSelect={() => p.onUploadTo(track.id)}><FontAwesomeIcon icon={faUpload} className="w-4 text-muted-foreground" /> Upload audio here</ContextMenuItem>}
              <ContextMenuItem disabled className="text-[12px]">Drag on a track to select a section</ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

function ResizeGrip({ height, onChange }: { height: number; onChange: (h: number) => void }) {
  const start = useRef<{ y: number; h: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize track"
      aria-valuenow={height}
      aria-valuemin={TRACK_HEIGHT.min}
      aria-valuemax={TRACK_HEIGHT.max}
      title="Drag to resize"
      data-testid="track-resize"
      className="absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-ns-resize hover:bg-ring/40"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { y: e.clientY, h: height };
      }}
      onPointerMove={(e) => start.current && onChange(Math.round(start.current.h + e.clientY - start.current.y))}
      onPointerUp={() => (start.current = null)}
    />
  );
}

function AddTrackRow(p: { onAdd: (kind: TrackKind) => void; onAddFromLibrary: (item: LibraryItem) => void; onUploadNew: (kind: TrackKind) => void }) {
  return (
    <div className="flex h-14 border-b border-border">
      <div style={{ width: HEADER_W }} className="sticky left-0 z-20 flex shrink-0 items-center border-r border-border bg-background px-3">
        <AddTrackMenu onAdd={p.onAdd} onAddFromLibrary={p.onAddFromLibrary} onUploadNew={p.onUploadNew} />
      </div>
      <div className="flex items-center px-4 text-[12.5px] text-muted-foreground">or drop audio files anywhere on the timeline</div>
    </div>
  );
}

/** The track's name: click it to rename in place (Enter or clicking away saves, Esc cancels). */
function TrackName({ name, onSelect, onRename, renameSignal }: { name: string; onSelect: () => void; onRename: (n: string) => void; renameSignal: number }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const done = useRef(false);
  useEffect(() => {
    if (!renameSignal) return;
    setText(name);
    done.current = false;
    setEditing(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameSignal]);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const next = text.trim();
    if (save && next && next !== name) onRename(next.slice(0, 60));
  };
  if (!editing) {
    return (
      <button
        type="button"
        title="Click to rename"
        data-testid="track-title"
        onClick={() => {
          onSelect();
          setText(name);
          done.current = false;
          setEditing(true);
        }}
        className="min-w-0 flex-1 cursor-text truncate rounded px-1 py-0.5 text-left text-[13px] font-medium hover:bg-accent"
      >
        {name}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={text}
      maxLength={60}
      aria-label="Track name"
      data-testid="track-title-input"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
        e.stopPropagation();
      }}
      className="min-w-0 flex-1 rounded border border-ring bg-background px-1 py-0.5 text-[13px] font-medium outline-none"
    />
  );
}

/** The track header's FX toggle: lit when the track has FX doing something. */
/**
 * The track's FX button: an audiocn ChannelToggle like M and S beside it, in the show accent —
 * filled when FX are changing the sound (the same accent as the FX panel's switches), outlined
 * while its panel is open, gray otherwise.
 */
function FxButton({ active, open, onClick, ...props }: { active: boolean; open?: boolean } & Omit<React.ComponentProps<"button">, "type">) {
  return (
    <ChannelToggle
      tone="accent"
      variant="outline"
      size="sm"
      pressed={active}
      title={active ? "FX on — click to edit" : "Add FX (noise reduction, EQ, compressor)"}
      aria-label="FX"
      data-testid="track-fx-button"
      data-open={open ? "" : undefined}
      {...(props as object)}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      className={cn("h-6 min-w-8 px-1.5 text-[10.5px]", open && !active && "border-primary text-primary hover:text-primary")}
    >
      FX
    </ChannelToggle>
  );
}
