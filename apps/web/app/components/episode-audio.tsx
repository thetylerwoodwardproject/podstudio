import { useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { Button } from "~/components/ui/button";

export type EpisodeAudio = {
  id: string;
  filename: string | null;
  bytes: number | null;
  sha256: string | null;
  durationS: number | null;
  sampleRate: number | null;
  channels: number | null;
} | null;

function formatBytes(n: number | null) {
  if (n == null) return "—";
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

function formatLength(s: number | null) {
  if (s == null) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// Sends the file as the raw request body (not multipart) so the server can
// stream it to storage; XHR rather than fetch only because it reports progress.
export function EpisodeAudioSection({
  episodeId,
  audio,
  storageReady,
}: {
  episodeId: string;
  audio: EpisodeAudio;
  storageReady: boolean;
}) {
  const revalidator = useRevalidator();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const url = `/studio/episodes/${episodeId}/audio`;

  function upload(file: File) {
    setError(null);
    setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    xhr.setRequestHeader("Content-Type", "audio/mpeg");
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        revalidator.revalidate();
      } else {
        let message = `Upload failed (${xhr.status}).`;
        try {
          message = JSON.parse(xhr.responseText).error ?? message;
        } catch {
          /* keep default */
        }
        setError(message);
      }
    };
    xhr.onerror = () => {
      setProgress(null);
      setError("Upload failed — the connection dropped. Nothing was saved; try again.");
    };
    xhr.send(file);
    if (input.current) input.current.value = "";
  }

  async function remove() {
    setError(null);
    const res = await fetch(url, { method: "DELETE" });
    setConfirmRemove(false);
    if (!res.ok) setError("Couldn't remove the audio.");
    revalidator.revalidate();
  }

  const uploading = progress !== null;
  return (
    <section className="space-y-3" aria-labelledby="audio-heading">
      <h2 id="audio-heading" className="text-[15px] font-semibold">
        Audio
      </h2>
      {audio ? (
        <div className="rounded-[14px] border border-border bg-card p-4 text-[13px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{audio.filename ?? "episode.mp3"}</span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11.5px] text-muted-foreground">
              Server verified
            </span>
          </div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
            <dt>Length</dt>
            <dd className="font-mono">{formatLength(audio.durationS)}</dd>
            <dt>Size</dt>
            <dd className="font-mono">{formatBytes(audio.bytes)}</dd>
            <dt>Format</dt>
            <dd className="font-mono">
              MP3 · {audio.sampleRate ? `${audio.sampleRate / 1000} kHz` : "?"} ·{" "}
              {audio.channels === 1 ? "mono" : audio.channels === 2 ? "stereo" : "?"}
            </dd>
            <dt>SHA-256</dt>
            <dd className="break-all font-mono text-[11.5px]">{audio.sha256}</dd>
          </dl>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          {storageReady
            ? "No audio uploaded yet."
            : "No storage target is routed for feed media yet — set one up in Storage before uploading."}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={input}
          type="file"
          accept=".mp3,audio/mpeg"
          className="sr-only"
          id="audio-file"
          disabled={!storageReady || uploading}
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!storageReady || uploading}
          onClick={() => input.current?.click()}
        >
          {audio ? "Replace MP3" : "Upload MP3"}
        </Button>
        {audio &&
          !uploading &&
          (confirmRemove ? (
            <>
              <span className="text-[13px] text-muted-foreground">Remove the audio file?</span>
              <Button type="button" size="sm" variant="destructive" onClick={remove}>
                Confirm remove
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmRemove(true)}>
              Remove
            </Button>
          ))}
        {uploading && (
          <span className="text-[13px] text-muted-foreground" role="status">
            Uploading… {progress}%{progress === 100 ? " — verifying" : ""}
          </span>
        )}
      </div>
      {error && (
        <p className="text-[13px] text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
