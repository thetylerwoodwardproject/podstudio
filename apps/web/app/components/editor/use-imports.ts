import { useCallback, useEffect, useRef, useState } from "react";
import { addSourceClip, freeSpot, type EditResult, type ProjectDoc, type TrackKind } from "~/lib/project/document";

export type Place = { trackId: string } | { newTrack: TrackKind };

interface ServerImport {
  id: string;
  status: "queued" | "running" | "verified" | "failed" | "cancelled";
  progress: number;
  settings: { filename?: string; place?: { trackId?: string; newTrack?: TrackKind } };
  summary: { samples: number; channels?: 1 | 2; label: string; durationS: number } | null;
  error: string | null;
  assetId: string | null;
  cancelRequested: number;
}

export interface ImportItem {
  key: string;
  name: string;
  phase: "uploading" | "decoding" | "failed";
  /** 0..1 */
  pct: number;
  error?: string;
  /** Server job id (to cancel/dismiss). */
  jobId?: string;
}

const ACCEPT = ".wav,.mp3,.m4a,.aac,.flac,.ogg,.opus,.aif,.aiff,.wma,.mp4,.mov,.webm,audio/*";
export const IMPORT_ACCEPT = ACCEPT;

/**
 * Upload audio onto tracks: the browser sends the original file, the worker decodes it, and when
 * it is ready the clip is placed at the playhead (or the next free spot) as one undoable edit.
 */
export function useImports(opts: {
  episodeId: string;
  getDoc: () => ProjectDoc;
  getPlayhead: () => number;
  apply: (r: EditResult) => boolean;
  flash: (m: string) => void;
}) {
  const { episodeId } = opts;
  const [local, setLocal] = useState<ImportItem[]>([]);
  const [server, setServer] = useState<ServerImport[]>([]);
  const tried = useRef(new Set<string>());
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const [poll, setPoll] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/studio/projects/${episodeId}/imports`);
      if (r.ok) setServer((await r.json()).imports);
    } catch {
      // next poll retries
    }
  }, [episodeId]);

  useEffect(() => {
    void refresh();
  }, [refresh, poll]);

  const active = server.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    if (!active && local.every((l) => l.phase !== "uploading")) return;
    const t = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(t);
  }, [active, local, refresh]);

  // Place anything that has finished decoding and isn't in the project yet.
  useEffect(() => {
    // Chain through the results: React hasn't re-rendered between two placements in one pass,
    // so each one must start from the document the previous one produced.
    let doc = optsRef.current.getDoc();
    for (const j of server) {
      if (j.status !== "verified" || !j.assetId || !j.summary || tried.current.has(j.id)) continue;
      if (doc.sources.some((s) => s.assetId === j.assetId)) {
        tried.current.add(j.id);
        continue;
      }
      tried.current.add(j.id);
      const hint = j.settings.place ?? {};
      const trackId = hint.trackId && doc.tracks.some((t) => t.id === hint.trackId) ? hint.trackId : undefined;
      const source = { id: crypto.randomUUID(), assetId: j.assetId, label: j.summary.label, totalSamples: j.summary.samples, ...(j.summary.channels === 2 ? { channels: 2 as const } : {}) };
      const want = optsRef.current.getPlayhead();
      const at = trackId ? freeSpot(doc, trackId, want, source.totalSamples) : Math.round(want);
      const r = addSourceClip(doc, trackId ? { source, trackId, at } : { source, newTrack: { kind: hint.newTrack ?? "music" }, at });
      if (optsRef.current.apply(r)) {
        if (r.ok) doc = r.doc;
        optsRef.current.flash(`Added “${j.summary.label}” to the timeline.`);
      }
    }
  }, [server]);

  const start = useCallback(
    (files: File[], place: Place) => {
      for (const file of files) {
        const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
        setLocal((l) => [...l, { key, name: file.name, phase: "uploading", pct: 0 }]);
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", `/studio/projects/${episodeId}/imports`);
        xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
        xhr.setRequestHeader("X-Place", encodeURIComponent(JSON.stringify(place)));
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.upload.onprogress = (e) => e.lengthComputable && setLocal((l) => l.map((x) => (x.key === key ? { ...x, pct: e.loaded / e.total } : x)));
        const fail = (message: string) => setLocal((l) => l.map((x) => (x.key === key ? { ...x, phase: "failed", error: message } : x)));
        xhr.onerror = () => fail("The upload was interrupted. Check your connection and try again.");
        xhr.onload = async () => {
          let body: { ok?: boolean; error?: string } = {};
          try {
            body = JSON.parse(xhr.responseText);
          } catch {
            // not JSON
          }
          if (xhr.status === 200 && body.ok) {
            await refresh(); // show the server's job before the local "uploading" row goes away
            setLocal((l) => l.filter((x) => x.key !== key));
          } else fail(body.error ?? `Upload failed (${xhr.status}).`);
        };
        xhr.send(file);
      }
    },
    [episodeId, refresh],
  );

  const cancel = useCallback(
    async (jobId: string) => {
      await fetch(`/studio/exports/${jobId}`, { method: "DELETE" });
      setPoll((n) => n + 1);
    },
    [],
  );

  const dismissLocal = (key: string) => setLocal((l) => l.filter((x) => x.key !== key));

  const items: ImportItem[] = [
    ...local,
    ...server
      .filter((j) => j.status === "queued" || j.status === "running" || j.status === "failed")
      .map((j): ImportItem => ({ key: j.id, jobId: j.id, name: j.settings.filename ?? "audio", phase: j.status === "failed" ? "failed" : "decoding", pct: j.progress, error: j.error ?? undefined })),
  ];
  return { items, start, cancel, dismissLocal, refresh: () => setPoll((n) => n + 1) };
}
