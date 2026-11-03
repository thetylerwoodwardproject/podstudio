import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { faArrowLeft, faBackwardStep, faBroom, faEraser, faForwardStep, faKeyboard, faMagnifyingGlassMinus, faMagnifyingGlassPlus, faPause, faPlay, faICursor, faRecordVinyl, faRepeat, faRotateLeft, faXmark, faRotateRight, faScissors, faTrashCan, faUpload } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import {
  addChapter,
  addSourceClip,
  freeSpot,
  addTrack,
  type TrackKind,
  clipEnd,
  cutRange,
  projectLength,
  removeAnnotation,
  removeTrack,
  removeSource,
  setClipLevels,
  splitAt,
  splitClip,
  updateTrack,
  type EditResult,
  type ProjectDoc,
  TRACK_HEIGHT,
} from "~/lib/project/document";
import { canRedo, canUndo, commit, createHistory, redo, undo, type History } from "~/lib/project/history";
import { parsePeaks, type Peaks } from "~/lib/project/peaks";
import { EditorPlayer } from "~/lib/project/player";
import { clockText } from "./draw";
import { Inspector, type Tab as InspectorTab } from "./inspector";
import { FxPanel } from "./fx-panel";
import type { TrackFx } from "@podstudio/audio/fx";
import { TransportMeter, useMeters } from "./meters";
import { DEFAULT_DELIVERY_PRESET, DELIVERY_PRESETS, type DeliveryPreset } from "@podstudio/audio/delivery";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "~/components/ui/dropdown-menu";
import { ExportPanel } from "./export-panel";
import type { LibraryItem } from "./library-panel";
import { RetakePanel } from "./retake-panel";
import { UploadsStrip } from "./uploads-strip";
import { IMPORT_ACCEPT, useImports, type Place } from "./use-imports";
import { Timeline, type MenuAction, type Selection } from "./timeline";

export interface EditorProps {
  episode: { id: string; title: string; number: number | null; showTitle: string };
  project: { revisionId: string; seq: number; doc: ProjectDoc; missing?: { id: string; label: string; clips: number }[] };
  openCleanup?: boolean;
  openExport?: boolean;
  /** The show's default delivery preset (the episode's own, if set, wins). */
  showPreset?: DeliveryPreset;
}

type SaveState = { kind: "saved"; seq: number } | { kind: "dirty" } | { kind: "saving" } | { kind: "error"; message: string } | { kind: "conflict" };

const SAVE_DELAY_MS = 1200;

export function EditorStage({ episode, project, openCleanup, openExport, showPreset }: EditorProps) {
  const [hist, setHist] = useState<History>(() => createHistory(project.doc));
  const [draft, setDraft] = useState<ProjectDoc | null>(null);
  const [sel, setSel] = useState<Selection>({ trackId: project.doc.tracks[0]?.id ?? null, clipId: null, range: null });
  const [playing, setPlaying] = useState(false);
  const [spp, setSpp] = useState(0);
  const [peaks, setPeaks] = useState<Record<string, Peaks | undefined>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "saved", seq: project.seq });
  const [cleanup, setCleanup] = useState(!!openCleanup);
  const [exporting, setExporting] = useState(!!openExport);
  // sources whose audio no longer exists (e.g. a take deleted from the Record screen)
  const [missingAll] = useState(project.missing ?? []);
  const missingIds = useMemo(() => new Set(missingAll.map((m) => m.id)), [missingAll]);
  const missingRef = useRef(missingIds);
  missingRef.current = missingIds;
  const [rangeTool, setRangeTool] = useState(false);
  const [meterMode, setMeterMode] = useState<"dbfs" | "lufs">("dbfs");
  useEffect(() => {
    try {
      const m = localStorage.getItem("podstudio.editor.meter");
      if (m === "lufs" || m === "dbfs") setMeterMode(m);
    } catch {}
  }, []);
  const changeMeterMode = (m: "dbfs" | "lufs") => {
    setMeterMode(m);
    try {
      localStorage.setItem("podstudio.editor.meter", m);
    } catch {}
  };
  const [loopOn, setLoopOn] = useState(false);
  // inspector collapsed: remembered per browser (read after mount so SSR markup matches)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("podstudio.editor.inspector") === "collapsed") setInspectorCollapsed(true);
    } catch {}
  }, []);
  const toggleInspector = useCallback((v?: boolean) => {
    setInspectorCollapsed((cur) => {
      const next = v ?? !cur;
      try {
        localStorage.setItem("podstudio.editor.inspector", next ? "collapsed" : "open");
      } catch {}
      return next;
    });
  }, []);

  const present = hist.present;
  const shown = draft ?? present;
  const rate = shown.sampleRate;
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const posRef = useRef(0);
  const playerRef = useRef<EditorPlayer | null>(null);
  const docRef = useRef(present);
  docRef.current = present;
  const sppRef = useRef(spp);
  sppRef.current = spp;
  const baseRev = useRef(project.revisionId);
  const savedDoc = useRef<ProjectDoc>(project.doc);
  const savedSeq = useRef(project.seq);
  const saving = useRef(false);

  const flash = useCallback((m: string) => {
    setToast(m);
    window.clearTimeout((flash as unknown as { t?: number }).t);
    (flash as unknown as { t?: number }).t = window.setTimeout(() => setToast(null), 4500);
  }, []);

  // ---- uploading audio onto tracks -------------------------------------------------------
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingPlace = useRef<Place | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadMenu, setUploadMenu] = useState(false);

  const inspectorCollapsedRef = useRef(false);
  try {
    if (typeof window !== "undefined") {
      inspectorCollapsedRef.current = localStorage.getItem("podstudio.editor.inspector") === "collapsed";
    }
  } catch {}
  // ---- initial zoom: fit the whole project -------------------------------------------
  useEffect(() => {
    if (spp) return;
    // main column = window − inspector (320) − track headers (208) − a little margin
    // right side: the side panel (320), or its 44 px rail
    const right = inspectorCollapsedRef.current ? 44 : 320;
    const avail = Math.max(300, window.innerWidth - right - 208 - 40);
    const len = Math.max(projectLength(project.doc), rate * 10);
    setSpp(Math.max(16, Math.ceil(len / avail / 8) * 8));
  }, [spp, project.doc, rate]);

  // ---- peaks (one overview per source, loaded as sources appear) -----------------------
  const [peakErr, setPeakErr] = useState<string | null>(null);
  const peakRequested = useRef(new Set<string>());
  useEffect(() => {
    for (const s of present.sources) {
      if (peakRequested.current.has(s.id) || missingRef.current.has(s.id)) continue;
      peakRequested.current.add(s.id);
      fetch(`/studio/assets/${s.assetId}/peaks`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`peaks ${r.status}`);
          const pk = parsePeaks(new Uint8Array(await r.arrayBuffer()));
          if (!pk) throw new Error("bad peaks file");
          setPeaks((cur) => ({ ...cur, [s.id]: pk }));
        })
        .catch((e) => setPeakErr(e.message));
    }
  }, [present.sources]);

  // ---- player ---------------------------------------------------------------------------
  useEffect(() => {
    const sources: Record<string, { assetId: string; totalSamples: number; channels?: 1 | 2 }> = {};
    for (const s of docRef.current.sources) if (!missingRef.current.has(s.id)) sources[s.id] = { assetId: s.assetId, totalSamples: s.totalSamples, channels: s.channels };
    const pl = new EditorPlayer(docRef.current, sources);
    pl.onEnded = () => setPlaying(false);
    pl.onError = (m) => {
      setPlaying(false);
      flash(`Playback stopped: ${m}`);
    };
    playerRef.current = pl;
    return () => {
      pl.dispose();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash]);

  useEffect(() => {
    const pl = playerRef.current;
    if (!pl) return;
    const sources: Record<string, { assetId: string; totalSamples: number; channels?: 1 | 2 }> = {};
    for (const s of present.sources) if (!missingIds.has(s.id)) sources[s.id] = { assetId: s.assetId, totalSamples: s.totalSamples, channels: s.channels };
    pl.setSources(sources);
    pl.setDoc(present);
  }, [present, missingIds]);

  // ---- meters ------------------------------------------------------------------------------
  const trackIdList = useMemo(() => present.tracks.map((t) => t.id), [present.tracks]);
  // meters measure loudness the way the delivery preset will: stereo (−16) or mono (−19)
  const layout = DELIVERY_PRESETS[present.delivery?.preset ?? showPreset ?? DEFAULT_DELIVERY_PRESET].channels === 1 ? "mono" : "stereo";
  const meters = useMeters(playerRef, rate, trackIdList, playing, layout);

  // ---- playhead animation ---------------------------------------------------------------
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const pl = playerRef.current;
      const pos = pl ? pl.position() : posRef.current;
      posRef.current = pos;
      const x = pos / (sppRef.current || 1);
      if (playheadRef.current) playheadRef.current.style.transform = `translateX(${x}px)`;
      if (clockRef.current) clockRef.current.textContent = clockText(pos / rate, 1);
      const sc = scrollRef.current;
      if (sc && pl?.isPlaying) {
        const vx = x - sc.scrollLeft;
        const vw = sc.clientWidth - 208;
        if (vx > vw - 40 || vx < 0) sc.scrollLeft = Math.max(0, x - vw * 0.15);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rate]);

  const seek = useCallback((t: number) => {
    const len = projectLength(docRef.current);
    const to = Math.max(0, Math.min(t, len));
    posRef.current = to;
    playerRef.current?.seek(to);
  }, []);

  const togglePlay = useCallback(async () => {
    const pl = playerRef.current;
    if (!pl) return;
    if (pl.isPlaying) {
      pl.pause();
      setPlaying(false);
      posRef.current = pl.position();
    } else {
      const len = projectLength(docRef.current);
      let from = posRef.current;
      if (from >= len - 1) from = 0;
      const l = loopRef.current;
      if (l && (from < l.from || from >= l.to)) from = l.from;
      setPlaying(true);
      await pl.play(from);
    }
  }, []);

  // ---- loop: the selected range, when switched on --------------------------------------------
  const loop = useMemo(() => (loopOn && sel.range ? { from: sel.range.from, to: sel.range.to } : null), [loopOn, sel.range]);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  useEffect(() => {
    if (!sel.range) setLoopOn(false);
  }, [sel.range]);
  useEffect(() => {
    playerRef.current?.setLoop(loop);
  }, [loop]);
  const toggleLoop = useCallback(() => {
    if (!sel.range) {
      flash("Drag across a track (or the ruler) to select the part to loop.");
      return;
    }
    const next = !loopOn;
    const l = sel.range;
    // switching the loop on with the playhead outside it: jump to its start
    if (next && (posRef.current < l.from || posRef.current >= l.to)) {
      posRef.current = l.from;
      playerRef.current?.seek(l.from);
    }
    setLoopOn(next);
  }, [sel.range, loopOn, flash]);

  // ---- edits -----------------------------------------------------------------------------
  const apply = useCallback(
    (r: EditResult, opts: { group?: string; clearSel?: boolean } = {}) => {
      if (!r.ok) {
        flash(r.error);
        return false;
      }
      setHist((h) => commit(h, r.doc, { group: opts.group }));
      setDraft(null);
      if (opts.clearSel) setSel((s) => ({ ...s, clipId: null, range: null }));
      return true;
    },
    [flash],
  );

  const imports = useImports({
    episodeId: episode.id,
    getDoc: () => docRef.current,
    getPlayhead: () => posRef.current,
    apply: (r) => apply(r),
    flash,
  });
  const chooseFiles = (place: Place) => {
    pendingPlace.current = place;
    setUploadMenu(false);
    fileInput.current?.click();
  };
  const selectedTrack = () => docRef.current.tracks.find((t) => t.id === sel.trackId) ?? docRef.current.tracks[0];
  const addFromLibrary = (item: LibraryItem, where: "selected" | "new") => {
    if (!item.assetId || item.durationS == null) return;
    const d = docRef.current;
    const track = d.tracks.find((t) => t.id === sel.trackId);
    const source = { id: crypto.randomUUID(), assetId: item.assetId, label: item.name, totalSamples: Math.round(item.durationS * d.sampleRate), ...(item.channels === 2 ? { channels: 2 as const } : {}) };
    const known = d.sources.find((s) => s.assetId === item.assetId);
    if (known) source.totalSamples = known.totalSamples;
    const useSelected = where === "selected" && track && !track.locked;
    const want = Math.round(posRef.current);
    const r = useSelected ? addSourceClip(d, { source, trackId: track.id, at: freeSpot(d, track.id, want, source.totalSamples) }) : addSourceClip(d, { source, newTrack: { kind: item.kind }, at: want });
    if (apply(r)) {
      flash(`Added “${item.name}” to the timeline.`);
    }
  };
  /** Drop a library item on a track at a time (from the sidebar's drag and drop); next free spot if it's taken. */
  const addLibraryAt = (item: LibraryItem, trackId: string, at: number) => {
    if (!item.assetId || item.durationS == null) return;
    const d = docRef.current;
    const track = d.tracks.find((t) => t.id === trackId);
    if (!track || track.locked) return flash(track ? `“${track.name}” is locked.` : "No such track.");
    const known = d.sources.find((s) => s.assetId === item.assetId);
    const source = { id: crypto.randomUUID(), assetId: item.assetId, label: item.name, totalSamples: known?.totalSamples ?? Math.round(item.durationS * d.sampleRate), ...(item.channels === 2 ? { channels: 2 as const } : {}) };
    if (apply(addSourceClip(d, { source, trackId, at: freeSpot(d, trackId, Math.max(0, Math.round(at)), source.totalSamples) }))) flash(`Added “${item.name}” to “${track.name}”.`);
  };
  const onFiles = (files: File[], place?: Place) => {
    if (files.length === 0) return;
    const t = selectedTrack();
    imports.start(files, place ?? (t && !t.locked ? { trackId: t.id } : { newTrack: "music" }));
  };

  const doSplit = useCallback(() => {
    const d = docRef.current;
    const at = Math.round(posRef.current);
    if (sel.clipId) {
      const c = d.clips.find((x) => x.id === sel.clipId);
      if (c && at > c.start && at < clipEnd(c)) return void apply(splitClip(d, c.id, at));
    }
    apply(splitAt(d, at));
  }, [sel.clipId, apply]);

  const doDelete = useCallback(
    (ripple: boolean) => {
      const d = docRef.current;
      let from: number | null = null;
      let to: number | null = null;
      let trackIds: string[] | undefined;
      if (sel.range) {
        from = sel.range.from;
        to = sel.range.to;
        // a range on some tracks: "leave gap" cuts just those; ripple cuts every track so nothing drifts out of sync
        if (!ripple && sel.range.trackIds) trackIds = sel.range.trackIds;
      } else if (sel.clipId) {
        const c = d.clips.find((x) => x.id === sel.clipId);
        if (c) {
          from = c.start;
          to = clipEnd(c);
          if (!ripple) trackIds = [c.trackId];
        }
      }
      if (from === null || to === null) return flash("Select a clip, or drag across a track or the ruler to select a range.");
      apply(cutRange(d, from, to, { ripple, trackIds }), { clearSel: true });
    },
    [sel.clipId, sel.range, apply, flash],
  );

  const onMenuAction = useCallback(
    (a: MenuAction) => {
      const d = docRef.current;
      const r = sel.range;
      const cut = (from: number, to: number, opts: Parameters<typeof cutRange>[3], done: string) => {
        if (apply(cutRange(d, from, to, opts), { clearSel: true })) flash(done);
      };
      switch (a.kind) {
        case "range-gap-tracks":
          if (r) cut(r.from, r.to, { ripple: false, trackIds: r.trackIds }, "Deleted — the gap is left as silence.");
          return;
        case "range-ripple-tracks-unsynced":
          if (r) cut(r.from, r.to, { ripple: true, trackIds: r.trackIds, unsynced: true }, "Cut and closed the gap on the selected track only. Ctrl+Z to undo.");
          return;
        case "range-gap-all":
          if (r) cut(r.from, r.to, { ripple: false }, "Deleted on every track — the gap is left as silence.");
          return;
        case "range-ripple-all":
          if (r) cut(r.from, r.to, { ripple: true }, "Cut from every track.");
          return;
        case "range-split-edges": {
          if (!r) return;
          const one = splitAt(d, r.from, r.trackIds);
          const two = splitAt(one.ok ? one.doc : d, r.to, r.trackIds);
          if (two.ok) apply(two);
          else if (one.ok) apply(one);
          else flash(one.error);
          return;
        }
        case "loop-toggle":
          return toggleLoop();
        case "range-clear":
          return setSel((s) => ({ ...s, range: null }));
        case "clip-split":
          return void apply(splitClip(d, a.clipId, Math.round(a.at)));
        case "clip-delete-gap":
        case "clip-ripple": {
          const c = d.clips.find((x) => x.id === a.clipId);
          if (c) cut(c.start, clipEnd(c), a.kind === "clip-ripple" ? { ripple: true } : { ripple: false, trackIds: [c.trackId] }, a.kind === "clip-ripple" ? "Ripple deleted on every track." : "Clip deleted.");
          return;
        }
        case "select-track-range":
          return setSel({ trackId: a.trackId, clipId: null, range: { from: a.from, to: a.to, trackIds: [a.trackId] } });
      }
    },
    [sel.range, apply, flash, toggleLoop],
  );

  const onTrackUpdate = useCallback(
    (trackId: string, patch: Parameters<typeof updateTrack>[2]) =>
      apply(updateTrack(docRef.current, trackId, patch), { group: patch.height !== undefined ? `h-${trackId}` : patch.name !== undefined ? `n-${trackId}` : patch.color !== undefined ? `c-${trackId}` : patch.gainDb !== undefined ? `g-${trackId}` : patch.pan !== undefined ? `p-${trackId}` : undefined }),
    [apply],
  );
  // FX edits on one track merge into one undo step while you turn a knob
  // FX edits merge into one undo step only while you keep working the same control (one knob turn);
  // switching something else on or off is its own step
  const onFx = useCallback(
    (trackId: string, fx: TrackFx | null) => {
      const before = docRef.current.tracks.find((t) => t.id === trackId)?.fx;
      const parts = ["on", "nr", "hpf", "lpf", "comp"] as const;
      const changed = !fx || !before ? "all" : [...parts.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(fx[k])), ...(["low", "mid", "high"] as const).filter((b) => JSON.stringify(before.eq[b]) !== JSON.stringify(fx.eq[b])).map((b) => `eq-${b}`)].join(",");
      // a switch flip is its own step; a knob drag (same part, value only) merges
      const isSwitch = !!fx && !!before && parts.some((k) => k !== "on" && (before[k] as { on?: boolean }).on !== (fx[k] as { on?: boolean }).on);
      const toggledMaster = !!fx && !!before && before.on !== fx.on;
      apply(updateTrack(docRef.current, trackId, { fx }), { group: changed === "all" || isSwitch || toggledMaster ? undefined : `fx-${trackId}-${changed}` });
    },
    [apply],
  );
  const [inspectorTab, setInspectorTab] = useState<{ tab: InspectorTab; n: number } | null>(null);
  const onDeleteTrack = useCallback(
    (trackId: string) => {
      const t = docRef.current.tracks.find((x) => x.id === trackId);
      if (t && apply(removeTrack(docRef.current, trackId))) flash(`Deleted “${t.name}”. Ctrl+Z brings it back.`);
    },
    [apply, flash],
  );

  const doUndo = useCallback(() => {
    setHist((h) => undo(h));
    setDraft(null);
  }, []);
  const doRedo = useCallback(() => {
    setHist((h) => redo(h));
    setDraft(null);
  }, []);

  // a cut that shortens the project must not strand the playhead beyond the end
  useEffect(() => {
    const len = projectLength(present);
    if (posRef.current > len) seek(len);
  }, [present, seek]);

  // keep the selection valid after undo/redo/cuts
  useEffect(() => {
    setSel((s) => {
      const clipOk = !s.clipId || present.clips.some((c) => c.id === s.clipId);
      const trackOk = !s.trackId || present.tracks.some((t) => t.id === s.trackId);
      return clipOk && trackOk ? s : { trackId: trackOk ? s.trackId : present.tracks[0]?.id ?? null, clipId: clipOk ? s.clipId : null, range: s.range };
    });
  }, [present]);

  // ---- autosave ---------------------------------------------------------------------------
  const flushSave = useCallback(async (opts: { keepalive?: boolean; force?: boolean } = {}) => {
    if (saving.current) return;
    const doc = docRef.current;
    if (doc === savedDoc.current) return;
    saving.current = true;
    setSave({ kind: "saving" });
    try {
      const res = await fetch(`/studio/projects/${episode.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseRevisionId: baseRev.current, document: doc, label: "Autosave" }),
        keepalive: opts.keepalive,
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        baseRev.current = body.revisionId;
        savedDoc.current = doc;
        savedSeq.current = body.seq;
        setSave(docRef.current === doc ? { kind: "saved", seq: body.seq } : { kind: "dirty" });
      } else if (res.status === 409) {
        conflict.current = body.current ?? null;
        setSave({ kind: "conflict" });
      } else {
        setSave({ kind: "error", message: body.error ?? `Save failed (${res.status})` });
      }
    } catch {
      setSave({ kind: "error", message: "Couldn't reach the server — your edits are kept in this tab; retrying." });
    } finally {
      saving.current = false;
    }
  }, [episode.id]);
  const conflict = useRef<{ revisionId: string; seq: number; doc: ProjectDoc } | null>(null);

  useEffect(() => {
    if (save.kind === "conflict") return;
    if (present === savedDoc.current) {
      // back at exactly what the server has (undo then redo): nothing to save
      setSave((s) => (s.kind === "saving" ? s : { kind: "saved", seq: savedSeq.current }));
      return;
    }
    setSave((s) => (s.kind === "saving" ? s : { kind: "dirty" }));
    const t = window.setTimeout(() => void flushSave(), SAVE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [present, save.kind, flushSave]);

  // retry after an error
  useEffect(() => {
    if (save.kind !== "error") return;
    const t = window.setTimeout(() => void flushSave(), 5000);
    return () => window.clearTimeout(t);
  }, [save.kind, flushSave]);

  useEffect(() => {
    const onHide = () => {
      if (docRef.current !== savedDoc.current) void flushSave({ keepalive: true });
    };
    window.addEventListener("pagehide", onHide);
    const warn = (e: BeforeUnloadEvent) => {
      if (docRef.current !== savedDoc.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", warn);
    };
  }, [flushSave]);

  const resolveConflict = (choice: "theirs" | "mine") => {
    const cur = conflict.current;
    if (!cur) return;
    if (choice === "theirs") {
      baseRev.current = cur.revisionId;
      savedDoc.current = cur.doc;
      savedSeq.current = cur.seq;
      setHist(createHistory(cur.doc));
      setSave({ kind: "saved", seq: cur.seq });
    } else {
      baseRev.current = cur.revisionId;
      setSave({ kind: "dirty" });
    }
    conflict.current = null;
  };

  // ---- keyboard ----------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // shortcuts stay off while typing — but a fader/pan (range input) or a checkbox isn't typing:
      // after touching a fader, Ctrl+Z, Space, M/S… must still work (arrows are kept by the control itself)
      const typing = !!el && ((el.tagName === "INPUT" && !["range", "checkbox", "radio", "button"].includes((el as HTMLInputElement).type)) || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (typing) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      const d = docRef.current;
      if (mod && k.toLowerCase() === "z") {
        e.preventDefault();
        return e.shiftKey ? doRedo() : doUndo();
      }
      if (mod && k.toLowerCase() === "y") {
        e.preventDefault();
        return doRedo();
      }
      if (mod || e.altKey) return;
      const tr = d.tracks.find((t) => t.id === sel.trackId);
      switch (k) {
        case " ":
          e.preventDefault();
          if (el?.tagName === "BUTTON") (el as HTMLButtonElement).blur();
          return void togglePlay();
        case "x":
        case "X":
          return doSplit();
        case "Delete":
        case "Backspace":
          e.preventDefault();
          // Delete leaves a gap (safe); Shift+Delete ripples (closes the gap on every track)
          return doDelete(e.shiftKey);
        case "m":
        case "M":
          return void (tr && onTrackUpdate(tr.id, { muted: !tr.muted }));
        case "s":
        case "S":
          return void (tr && onTrackUpdate(tr.id, { solo: !tr.solo }));
        case "l":
        case "L":
          return void (tr && onTrackUpdate(tr.id, { locked: !tr.locked }));
        case "ArrowUp":
        case "ArrowDown": {
          e.preventDefault();
          const i = d.tracks.findIndex((t) => t.id === sel.trackId);
          const n = d.tracks[Math.max(0, Math.min(d.tracks.length - 1, i + (k === "ArrowUp" ? -1 : 1)))];
          return void (n && setSel((s) => ({ ...s, trackId: n.id, clipId: null })));
        }
        case "+":
        case "=":
        case "-":
        case "_":
          return void (tr && onTrackUpdate(tr.id, { height: tr.height + (k === "-" || k === "_" ? -24 : 24) }));
        case "ArrowLeft":
        case "ArrowRight": {
          e.preventDefault();
          const step = (e.shiftKey ? 10 : 1) * rate * (k === "ArrowLeft" ? -1 : 1);
          return seek(posRef.current + step);
        }
        case "Home":
          return seek(0);
        case "End":
          return seek(projectLength(d));
        case "i":
        case "I":
          return toggleInspector();
        case "r":
        case "R":
          return setRangeTool((v) => !v);
        case "c":
        case "C":
          return toggleLoop();
        case "Escape":
          return setSel((s) => ({ ...s, clipId: null, range: null }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel.trackId, doSplit, doDelete, doUndo, doRedo, onTrackUpdate, togglePlay, seek, rate, toggleInspector, toggleLoop]);

  // ---- zoom ----------------------------------------------------------------------------------
  // Zoom around a point: the playhead (buttons) or the pointer (Ctrl/⌘+wheel, pinch).
  const zoom = useCallback(
    (factor: number, clientX?: number) => {
      const sc = scrollRef.current;
      if (!sc) return;
      const old = sppRef.current;
      const longest = projectLength(docRef.current) || rate * 60;
      // zooming out stops at "the whole project fits"; zooming in at 16 samples per pixel
      const fit = Math.max(16, longest / Math.max(300, sc.clientWidth - 248));
      const next = Math.max(16, Math.min(old * factor, Math.max(fit, Math.min(old, fit))));
      if (Math.abs(next - old) < 1e-6) return;
      const left = sc.getBoundingClientRect().left + 208;
      const viewX = clientX !== undefined ? clientX - left : Math.max(0, Math.min(posRef.current / old - sc.scrollLeft, sc.clientWidth - 248));
      const sample = (sc.scrollLeft + viewX) * old;
      setSpp(next);
      requestAnimationFrame(() => {
        sc.scrollLeft = Math.max(0, sample / next - viewX);
      });
    },
    [rate],
  );

  // only the ones still in the document (removing them, then undoing, brings the banner back)
  const missing = missingAll.filter((m) => present.sources.some((s) => s.id === m.id));
  const retakeCount = present.annotations.filter((a) => a.kind === "retake").length;
  const rangeTracksLabel = !sel.range?.trackIds ? "all tracks" : sel.range.trackIds.map((id) => shown.tracks.find((t) => t.id === id)?.name).filter(Boolean).join(", ");
  const selectedClip = shown.clips.find((c) => c.id === sel.clipId) ?? null;
  const total = projectLength(shown);
  const saveText = useMemo(() => {
    switch (save.kind) {
      case "saved":
        return `Saved · revision ${save.seq}`;
      case "dirty":
        return "Unsaved changes…";
      case "saving":
        return "Saving…";
      case "error":
        return save.message;
      case "conflict":
        return "Changed elsewhere";
    }
  }, [save]);

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-background text-foreground"
      data-testid="editor-stage"
      onDragEnter={(e) => e.dataTransfer.types.includes("Files") && setDragging(true)}
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDragLeave={(e) => !e.relatedTarget && setDragging(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(false);
        onFiles([...e.dataTransfer.files]);
      }}
    >
      {dragging && <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-background/70 text-lg font-medium" data-testid="drop-overlay"><div className="rounded-xl border-2 border-dashed border-ring px-8 py-6">Drop audio to add it to “{selectedTrack()?.name}”</div></div>}
      {/* one slim toolbar, Hindenburg-style: small icons with tiny labels */}
      <header className="flex h-[52px] shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 [&>*]:shrink-0" role="toolbar" aria-label="Editor">
        <Link to={`/studio/episodes/${episode.id}`} className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Back to episode" title="Back to episode">
          <FontAwesomeIcon icon={faArrowLeft} />
        </Link>
        <div className="w-[clamp(120px,16vw,240px)] pr-2" title={episode.title}>
          <div className="truncate whitespace-nowrap text-[13.5px] font-semibold leading-tight" data-testid="editor-title">{episode.title}</div>
          <div className="truncate whitespace-nowrap text-[11px] leading-tight text-muted-foreground">{episode.showTitle}{episode.number != null ? ` · Ep. ${episode.number}` : ""}</div>
        </div>
        <Sep />
        <ToolButton icon={faRotateLeft} label="Undo" title="Undo (Ctrl+Z)" onClick={doUndo} disabled={!canUndo(hist)} testid="undo" />
        <ToolButton icon={faRotateRight} label="Redo" title="Redo (Ctrl+Shift+Z)" onClick={doRedo} disabled={!canRedo(hist)} testid="redo" />
        <Sep />
        {<ToolButton icon={faICursor} label="Range" title="Range tool (R): drag over clips to select instead of moving them. Shift+drag does this any time." onClick={() => setRangeTool((v) => !v)} pressed={rangeTool} testid="range-tool" />}
        <ToolButton icon={faScissors} label="Split" title="Split at the playhead (X)" onClick={doSplit} testid="split" />
        <ToolButton icon={faEraser} label="Delete" title="Delete the selection, leave a gap (Delete)" onClick={() => doDelete(false)} testid="gap-delete" />
        <ToolButton icon={faTrashCan} label="Ripple" title="Ripple delete: later audio moves up on every track (Shift+Delete)" onClick={() => doDelete(true)} testid="ripple-delete" />
        <Sep />
        <DropdownMenu open={uploadMenu} onOpenChange={setUploadMenu}>
          <DropdownMenuTrigger asChild>
            <ToolButton icon={faUpload} label="Import" title="Add an audio file" testid="upload-menu" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="font-normal text-muted-foreground">Import audio to…</DropdownMenuLabel>
            <DropdownMenuItem data-testid="upload-selected" onSelect={() => { const t = selectedTrack(); chooseFiles(t && !t.locked ? { trackId: t.id } : { newTrack: "music" }); }}><span className="truncate">“{selectedTrack()?.name ?? "track"}”</span></DropdownMenuItem>
            <DropdownMenuSeparator />
            {(["music", "sfx", "guest", "host"] as const).map((k) => (
              <DropdownMenuItem key={k} data-testid={`upload-new-${k}`} onSelect={() => chooseFiles({ newTrack: k })}>New {k === "sfx" ? "SFX" : k} track</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <ToolButton icon={faRecordVinyl} label="Library" title="The show's reusable audio" onClick={() => { toggleInspector(false); setInspectorTab((t) => ({ tab: "library", n: (t?.n ?? 0) + 1 })); }} testid="open-library" />
        <input ref={fileInput} type="file" multiple accept={IMPORT_ACCEPT} className="hidden" data-testid="upload-input" onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ""; onFiles(files, pendingPlace.current ?? undefined); pendingPlace.current = null; }} />
        <ToolButton icon={faBroom} label={retakeCount > 0 ? `Retakes ${retakeCount}` : "Retakes"} title="Find and remove retakes" onClick={() => setCleanup((v) => !v)} pressed={cleanup} testid="open-cleanup" />
        <div className="min-w-2 flex-1" />
        <nav aria-label="Episode workflow" className="hidden rounded-md bg-secondary p-0.5 text-[12px] font-medium xl:flex">
          <span aria-current="page" className="rounded bg-background px-2 py-0.5">Edit</span>
          <span aria-disabled title="Transcripts arrive in Stage 07" className="cursor-not-allowed px-2 py-0.5 text-muted-foreground/50">Transcript</span>
          <Link to={`/studio/publish?episode=${episode.id}`} className="px-2 py-0.5 text-muted-foreground hover:text-foreground">Publish</Link>
        </nav>
        <span data-testid="save-status" className={cn("ml-2 hidden whitespace-nowrap text-[11.5px] lg:inline", save.kind === "error" || save.kind === "conflict" ? "max-w-[220px] truncate text-destructive" : "text-muted-foreground")} aria-live="polite">{saveText}</span>
        <Button size="sm" onClick={() => setExporting(true)} data-testid="open-export" className="ml-2">Export</Button>
      </header>

      {save.kind === "conflict" && (
        <div className="flex items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-[13px]" role="alert" data-testid="conflict-banner">
          <span className="flex-1">This project was saved somewhere else (another tab or device) since you opened it. Autosave is paused so nothing gets overwritten.</span>
          <Button size="sm" variant="outline" onClick={() => resolveConflict("theirs")}>Load the newer version</Button>
          <Button size="sm" variant="outline" onClick={() => resolveConflict("mine")}>Keep my version</Button>
        </div>
      )}
      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-[13px]" role="alert" data-testid="missing-audio-banner">
          <span className="min-w-0 flex-1">
            {missing.length === 1 ? <>The audio for <b>“{missing[0]!.label}”</b> no longer exists</> : <>{missing.length} sources' audio no longer exists</>} (the take was deleted). {missing.reduce((n, m) => n + m.clips, 0)} clip{missing.reduce((n, m) => n + m.clips, 0) === 1 ? "" : "s"} can't play, and edits can't be saved until {missing.reduce((n, m) => n + m.clips, 0) === 1 ? "it's" : "they're"} removed. Everything else plays.
          </span>
          <Button
            size="sm"
            variant="destructive"
            data-testid="remove-missing"
            onClick={() => {
              let d = docRef.current;
              for (const m of missing) d = removeSource(d, m.id);
              if (apply({ ok: true, doc: d }, { clearSel: true })) {
                flash("Removed the clips whose audio was gone.");
              }
            }}
          >
            Remove {missing.reduce((n, m) => n + m.clips, 0) === 1 ? "that clip" : "those clips"}
          </Button>
        </div>
      )}
      {peakErr && <div className="border-b border-border bg-accent/40 px-4 py-1.5 text-[12.5px] text-muted-foreground">Couldn't load the waveform ({peakErr}). Editing and playback still work.</div>}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto_auto]">
        <main className="flex min-h-0 flex-col">
          {spp > 0 && (
            <Timeline
              doc={shown}
              peaks={peaks}
              spp={spp}
              sel={sel}
              setSel={setSel}
              onPreview={setDraft}
              onCommit={(d) => apply({ ok: true, doc: d })}
              onSeek={seek}
              onError={flash}
              onTrackUpdate={onTrackUpdate}
              playheadRef={playheadRef}
              scrollRef={scrollRef}
              dimMuted
              onZoom={zoom}
              onAddTrack={(kind: TrackKind) => apply({ ok: true, doc: addTrack(docRef.current, kind) })}
              onAddFromLibrary={(item) => addFromLibrary(item, "new")}
              onUploadNew={(kind) => chooseFiles({ newTrack: kind })}
              onDeleteTrack={onDeleteTrack}
              rangeTool={rangeTool}
              loop={loop}
              onMenuAction={onMenuAction}
              trackMeter={meters.trackSource}
              fxPanel={(t) => <FxPanel track={t} doc={shown} onFx={(fx) => onFx(t.id, fx)} onGain={(g) => onTrackUpdate(t.id, { gainDb: g })} onDuck={(op, group) => void apply(op(docRef.current), { group })} player={playerRef} playing={playing} />}
              onDropLibrary={(item, trackId, at) => addLibraryAt(item, trackId, at)}
              onUploadTo={(trackId) => chooseFiles({ trackId })}
            />
          )}
          <UploadsStrip items={imports.items} onCancel={(id) => void imports.cancel(id)} onDismissLocal={imports.dismissLocal} />
          {cleanup ? (
            <RetakePanel
              doc={present}
              onClose={() => setCleanup(false)}
              onApply={(r, summary) => {
                if (apply(r, { clearSel: true })) flash(summary);
              }}
              onFocusRange={(from, to) => {
                setSel((s) => ({ ...s, clipId: null, range: { from, to } }));
                seek(Math.max(0, from - rate));
                const sc = scrollRef.current;
                if (sc) sc.scrollLeft = Math.max(0, from / sppRef.current - 120);
              }}
            />
          ) : null}
          {/* transport, pinned to the bottom like a DAW */}
          <div className="grid h-[60px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-border bg-card/60 px-3" data-testid="transport">
            <div className="flex min-w-0 items-center gap-2">
              <ShortcutsButton />
              {sel.range && (
                <div className="flex min-w-0 items-center gap-1 rounded-md border border-ring/40 bg-ring/10 py-0.5 pl-2.5 pr-0.5 shadow-xs text-[12px]" data-testid="range-chip">
                  <span className="truncate font-mono tabular-nums" title={rangeTracksLabel}>
                    {clockText(sel.range.from / rate, 1)}–{clockText(sel.range.to / rate, 1)} <span className="text-muted-foreground">· {((sel.range.to - sel.range.from) / rate).toFixed(1)} s</span>
                    <span className="hidden text-muted-foreground xl:inline"> · {rangeTracksLabel}</span>
                  </span>
                  {sel.range.trackIds && (
                    <Button variant="ghost" size="sm" onClick={() => onMenuAction({ kind: "range-gap-tracks" })} title={`Delete from ${rangeTracksLabel} only, leaving silence (Delete)`} data-testid="range-delete-tracks" className="ml-1 h-6 px-1.5 text-[12px]">Delete from {sel.range.trackIds.length === 1 ? rangeTracksLabel : "these"}</Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => doDelete(true)} title="Cut this section from every track and close the gap (Shift+Delete). Right-click for more." data-testid="range-cut" className="h-6 px-1.5 text-[12px]"><FontAwesomeIcon icon={faScissors} className="text-[10.5px]" /> Cut all</Button>
                  <Button variant="ghost" size="icon" onClick={() => setSel((s2) => ({ ...s2, range: null }))} aria-label="Clear selection" title="Clear selection (Esc)" className="size-6 text-muted-foreground"><FontAwesomeIcon icon={faXmark} /></Button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Tool label="Back to start (Home)" onClick={() => seek(0)} icon={faBackwardStep} testid="to-start" />
              <Button size="icon" variant="default" onClick={() => void togglePlay()} aria-label={playing ? "Pause" : "Play"} title="Play / pause (Space)" data-testid="play" className="size-10 rounded-full"><FontAwesomeIcon icon={playing ? faPause : faPlay} /></Button>
              <Tool label="To end (End)" onClick={() => seek(total)} icon={faForwardStep} testid="to-end" />
              <Button size="icon" variant="ghost" onClick={toggleLoop} aria-pressed={loopOn} aria-label="Loop selection" title={sel.range ? "Loop the selection (C)" : "Select a range to loop (C)"} data-testid="loop" className={cn(loopOn ? "bg-primary/15 text-primary hover:bg-primary/25 hover:text-primary" : !sel.range && "text-muted-foreground/60")}>
                <FontAwesomeIcon icon={faRepeat} />
              </Button>
              <span className="ml-3 whitespace-nowrap rounded-md bg-background/70 px-3 py-1 font-mono tabular-nums shadow-[inset_0_0_0_1px_var(--border)]" data-testid="clock"><span ref={clockRef} className="text-[19px] font-semibold">0:00.0</span><span className="text-[12px] text-muted-foreground"> / {clockText(total / rate, 1)}</span></span>
              {<span className="ml-2 hidden lg:inline-flex"><TransportMeter master={meters.master} loud={meters.loud} readout={meters.readout} mode={meterMode} onMode={changeMeterMode} layout={layout} /></span>}
            </div>
            <div className="flex items-center justify-end gap-1">
              <Tool label="Zoom out" onClick={() => zoom(2)} icon={faMagnifyingGlassMinus} testid="zoom-out" />
              <Tool label="Zoom in" onClick={() => zoom(0.5)} icon={faMagnifyingGlassPlus} testid="zoom-in" />
            </div>
          </div>
        </main>
        {<Inspector
          doc={shown}
          clip={selectedClip}
          sel={sel}
          position={() => posRef.current}
          rate={rate}
          onSeek={seek}
          onLevels={(patch) => selectedClip && apply(setClipLevels(docRef.current, selectedClip.id, patch), { group: `lv-${selectedClip.id}` })}
          onTrack={onTrackUpdate}
          onAddChapter={(label) => {
            const d = docRef.current;
            const pos = Math.round(posRef.current);
            const hit = d.clips.map((c) => (pos >= c.start && pos < clipEnd(c) ? { c, sample: c.srcStart + (pos - c.start) } : null)).find(Boolean);
            if (!hit) return flash("Put the playhead on audio to add a chapter.");
            apply(addChapter(d, hit.c.sourceId, hit.sample, label));
          }}
          onAddLibrary={(item) => addFromLibrary(item, "new")}
          onRemoveAnnotation={(id) => apply({ ok: true, doc: removeAnnotation(docRef.current, id) })}
          trackHeightRange={TRACK_HEIGHT}
          collapsed={inspectorCollapsed}
          onCollapsedChange={toggleInspector}
          openTab={inspectorTab ?? undefined}
          player={playerRef}
          playing={playing}
          loudness={{ readout: meters.readout, onReset: meters.reset, layout }}
        />}
      </div>
      {exporting && (
        <ExportPanel
          episodeId={episode.id}
          saved={save.kind === "saved"}
          revisionSeq={save.kind === "saved" ? save.seq : null}
          onClose={() => setExporting(false)}
          episodePreset={present.delivery?.preset ?? null}
          onEpisodePreset={(preset) => {
            const d = docRef.current;
            const { delivery: _drop, ...rest } = d;
            apply({ ok: true, doc: preset ? { ...d, delivery: { preset } } : rest });
          }}
        />
      )}
      {toast && <div role="status" className="pointer-events-none fixed bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-md border border-border bg-card px-4 py-2 text-[13px] shadow-lg" data-testid="toast">{toast}</div>}
    </div>
  );
}

function Sep() {
  return <div className="mx-1 h-7 w-px bg-border" aria-hidden />;
}

/** Toolbar button: icon over a tiny label (labels drop away on narrow screens). */
function ToolButton({ icon, label, title, onClick, disabled, pressed, testid, ...rest }: { icon: Parameters<typeof FontAwesomeIcon>[0]["icon"]; label: string; title: string; onClick?: () => void; disabled?: boolean; pressed?: boolean; testid?: string } & Omit<React.ComponentProps<"button">, "onClick">) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      title={title}
      data-testid={testid}
      {...rest}
      className={cn("h-11 min-w-11 flex-col gap-0.5 px-2 py-1 text-muted-foreground hover:text-foreground", pressed && "bg-accent text-foreground", rest.className)}
    >
      <FontAwesomeIcon icon={icon} className="text-[14px]" />
      <span className="hidden text-[10px] font-medium leading-none lg:block">{label}</span>
    </Button>
  );
}

function Tool({ label, icon, onClick, disabled, testid }: { label: string; icon: Parameters<typeof FontAwesomeIcon>[0]["icon"]; onClick: () => void; disabled?: boolean; testid?: string }) {
  return (
    <Button size="icon" variant="ghost" onClick={onClick} disabled={disabled} aria-label={label} title={label} data-testid={testid}>
      <FontAwesomeIcon icon={icon} />
    </Button>
  );
}


const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["X", "Split at the playhead"],
  ["Delete", "Delete selection, leave a gap (selected tracks)"],
  ["Shift+Delete", "Ripple delete: close the gap on every track"],
  ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"],
  ["M · S · L", "Mute · solo · lock track"],
  ["↑ ↓", "Previous / next track"],
  ["+ −", "Track height"],
  ["← →", "Nudge playhead (Shift: 10 s)"],
  ["Home · End", "Start · end"],
  ["I", "Show / hide side panel"],
  ["Wheel · Shift+wheel", "Scroll tracks · scroll the timeline sideways"],
  ["Ctrl+wheel", "Zoom"],
  ["Drag on a track", "Select a section (drag up/down for more tracks)"],
  ["Shift+drag · R", "Select over clips · range tool"],
  ["Drag ruler", "Select across all tracks"],
  ["C", "Loop the selection"],
  ["Drag clip corner", "Fade in / out"],
  ["Right-click track", "Color, delete"],
];

function ShortcutsButton() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" data-testid="shortcuts" className="text-muted-foreground">
          <FontAwesomeIcon icon={faKeyboard} /> <span className="hidden md:inline">Shortcuts</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 p-3" aria-label="Keyboard shortcuts" data-testid="shortcuts-popover">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt><kbd className="whitespace-nowrap rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[11px]">{k}</kbd></dt>
              <dd className="text-muted-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
