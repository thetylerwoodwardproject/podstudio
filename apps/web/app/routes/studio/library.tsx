import { useCallback, useEffect, useRef, useState } from "react";
import { faCircleNotch, faPause, faPlay, faTrashCan, faUpload } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

// Library: the show's commonly used audio (intros, outros, stingers, beds, sound effects). Upload
// once, then add it to any episode from the editor's Library button.
interface Item {
  id: string;
  name: string;
  kind: "music" | "sfx";
  status: "queued" | "running" | "ready" | "failed";
  progress: number;
  filename: string | null;
  assetId: string | null;
  durationS: number | null;
  error: string | null;
  cancelRequested: number;
  usedIn: number;
}

const clock = (s: number | null) => (s == null ? "–" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
const ACCEPT = ".wav,.mp3,.m4a,.aac,.flac,.ogg,.opus,.aif,.aiff,.wma,audio/*";

export default function LibraryPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [kind, setKind] = useState<"music" | "sfx">("music");
  const [uploads, setUploads] = useState<{ key: string; name: string; pct: number; error?: string }[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/studio/library/items");
      if (r.ok) setItems((await r.json()).items);
    } catch {
      // next poll retries
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const busy = items?.some((i) => i.status === "queued" || i.status === "running") || uploads.some((u) => !u.error);
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(t);
  }, [busy, refresh]);
  useEffect(() => () => audio.current?.pause(), []);

  const upload = (files: File[]) => {
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      setUploads((u) => [...u, { key, name: file.name, pct: 0 }]);
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", "/studio/library/items");
      xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
      xhr.setRequestHeader("X-Kind", kind);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = (e) => e.lengthComputable && setUploads((u) => u.map((x) => (x.key === key ? { ...x, pct: e.loaded / e.total } : x)));
      const fail = (error: string) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, error } : x)));
      xhr.onerror = () => fail("The upload was interrupted. Try again.");
      xhr.onload = async () => {
        let body: { ok?: boolean; error?: string } = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          // not JSON
        }
        if (xhr.status === 200 && body.ok) {
          await refresh();
          setUploads((u) => u.filter((x) => x.key !== key));
        } else fail(body.error ?? `Upload failed (${xhr.status}).`);
      };
      xhr.send(file);
    }
  };

  const patch = async (id: string, body: object) => {
    const r = await fetch(`/studio/library/items/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) setMessage(j.error ?? "Couldn't save that.");
    await refresh();
  };
  const remove = async (i: Item) => {
    setMessage(null);
    const r = await fetch(`/studio/library/items/${i.id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) setMessage(j.error ?? "Couldn't delete that.");
    await refresh();
  };
  const toggle = (i: Item) => {
    if (!i.assetId) return;
    if (playing === i.id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const a = new Audio(`/studio/assets/${i.assetId}/audio`);
    a.onended = () => setPlaying(null);
    a.onerror = () => {
      setPlaying(null);
      setMessage("Couldn't play that preview.");
    };
    audio.current = a;
    setPlaying(i.id);
    void a.play().catch(() => setPlaying(null));
  };

  return (
    <div
      className="mx-auto max-w-4xl p-6"
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && (e.preventDefault(), setDragging(true))}
      onDragLeave={(e) => !e.relatedTarget && setDragging(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(false);
        upload([...e.dataTransfer.files]);
      }}
    >
      <div className="mb-5 flex items-end gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">Edit</div>
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Intros, outros, stingers, beds and sound effects you use again and again. Upload once, then add them to any episode from the editor.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-secondary p-0.5 text-[12.5px] font-medium" role="group" aria-label="Add as">
            {(["music", "sfx"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} data-testid={`lib-kind-${k}`} className={cn("rounded-md px-3 py-1.5", kind === k ? "bg-background" : "text-muted-foreground hover:text-foreground")}>{k === "sfx" ? "Sound effect" : "Music"}</button>
            ))}
          </div>
          <Button onClick={() => input.current?.click()} data-testid="lib-upload"><FontAwesomeIcon icon={faUpload} /> Upload audio</Button>
          <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" data-testid="lib-input" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; upload(f); }} />
        </div>
      </div>

      {dragging && <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 text-lg font-medium"><div className="rounded-xl border-2 border-dashed border-ring px-8 py-6">Drop audio to add it to the library</div></div>}
      {message && <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px]" role="alert" data-testid="lib-message">{message}</p>}

      {uploads.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1.5" data-testid="lib-uploads">
          {uploads.map((u) => (
            <li key={u.key} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              {u.error ? <span className="text-destructive" role="alert">{u.error}</span> : <span className="text-muted-foreground">Uploading {Math.round(u.pct * 100)}%</span>}
              {u.error && <button type="button" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))} className="text-muted-foreground hover:text-foreground">Dismiss</button>}
            </li>
          ))}
        </ul>
      )}

      {items === null ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground" data-testid="lib-empty">
          Nothing here yet. Upload your intro, outro or a favourite sound effect — or drop files anywhere on this page.
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="lib-list">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5" data-testid="lib-item" data-status={i.status}>
              <button type="button" disabled={i.status !== "ready"} onClick={() => toggle(i)} aria-label={playing === i.id ? `Stop ${i.name}` : `Play ${i.name}`} data-testid="lib-play" className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-[13px] hover:bg-accent disabled:opacity-40">
                {i.status === "ready" ? <FontAwesomeIcon icon={playing === i.id ? faPause : faPlay} /> : i.status === "failed" ? "!" : <FontAwesomeIcon icon={faCircleNotch} spin />}
              </button>
              <NameField value={i.name} onSave={(n) => patch(i.id, { name: n })} />
              <select value={i.kind} onChange={(e) => void patch(i.id, { kind: e.target.value })} aria-label="Default track" data-testid="lib-kind" className="h-8 rounded-md border border-border bg-background px-2 text-[12.5px]">
                <option value="music">Music</option>
                <option value="sfx">Sound effect</option>
              </select>
              <span className="w-12 text-right font-mono text-[12.5px] text-muted-foreground">{clock(i.durationS)}</span>
              <span className="w-28 text-right text-[12px] text-muted-foreground" data-testid="lib-status">
                {i.status === "ready" ? (i.usedIn > 0 ? `Used in ${i.usedIn} episode${i.usedIn === 1 ? "" : "s"}` : "Ready") : i.status === "failed" ? <span className="text-destructive" title={i.error ?? ""}>Failed</span> : i.status === "queued" ? "Queued" : "Converting…"}
              </span>
              <button type="button" onClick={() => void remove(i)} disabled={i.cancelRequested === 1} aria-label={`Delete ${i.name}`} title={i.status === "running" ? "Cancel" : "Delete"} data-testid="lib-delete" className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-40">
                <FontAwesomeIcon icon={faTrashCan} />
              </button>
              {i.status === "failed" && i.error && <span className="sr-only">{i.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NameField({ value, onSave }: { value: string; onSave: (n: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const n = text.trim();
    if (n && n !== value) onSave(n);
    else setText(value);
  };
  return (
    <input
      value={text}
      maxLength={80}
      aria-label="Name"
      data-testid="lib-name"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setText(value);
          e.currentTarget.blur();
        }
      }}
      className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-[14px] font-medium hover:border-border focus:border-ring focus:outline-none"
    />
  );
}
