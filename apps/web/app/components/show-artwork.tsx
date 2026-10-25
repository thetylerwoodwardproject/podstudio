import { useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { Button } from "~/components/ui/button";

// Show artwork (itunes:image). Uploads go straight to /studio/feed/artwork, which
// checks the image (PNG/JPEG, square, 1400–3000 px) and reads it back from the
// bucket before it counts. Outside the show-tags <form>: it saves immediately.
export interface ArtworkView {
  url: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  contentType: string;
}

export function ShowArtwork({
  artwork,
  storageReady,
  endpoint = "/studio/feed/artwork",
  heading = "Show artwork",
  rules = "PNG or JPEG, square, between 1400×1400 and 3000×3000 pixels, up to 5 MB.",
  missing = "Apple Podcasts and Spotify won't accept a feed without artwork.",
  noun = "artwork",
  sectionId = "artwork",
}: {
  artwork: ArtworkView | null;
  storageReady: boolean;
  /** Upload endpoint (PUT raw image / DELETE). Defaults to the show artwork route. */
  endpoint?: string;
  heading?: string;
  rules?: string;
  missing?: string;
  noun?: string;
  sectionId?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { revalidate } = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function send(init: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, init);
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !body?.ok) setError(body?.error ?? `Upload failed (${res.status}).`);
      else await revalidate();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
      setConfirmRemove(false);
      if (input.current) input.current.value = "";
    }
  }

  function onPick(file: File | undefined) {
    if (file) void send({ method: "PUT", body: file });
  }

  return (
    <section id={sectionId} className="mb-6 flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5" data-testid="artwork-section">
      <h2 className="text-sm font-semibold text-muted-foreground">{heading}</h2>
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex size-36 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-secondary text-center text-xs text-muted-foreground">
          {artwork ? (
            <img src={artwork.url} alt={heading} className="size-full object-cover" data-testid="artwork-img" />
          ) : (
            `No ${noun}`
          )}
        </div>
        <div className="flex min-w-[260px] flex-1 flex-col gap-3">
          {artwork ? (
            <div className="text-[13px]" data-testid="artwork-facts">
              <span className="font-medium text-ok">Server verified</span>
              <span className="text-muted-foreground">
                {" "}
                {artwork.width != null && artwork.height != null ? ` · ${artwork.width}×${artwork.height}` : ""} · {artwork.contentType === "image/png" ? "PNG" : "JPEG"}
                {artwork.bytes != null && ` · ${(artwork.bytes / 1024).toFixed(0)} KB`}
              </span>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">{missing}</p>
          )}
          <p className="text-[12.5px] text-muted-foreground">{rules}</p>
          {!storageReady && (
            <p className="text-[12.5px] text-destructive">No storage target is routed for feed media — set one up in Storage first.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={input}
              id="artwork-file"
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              disabled={busy || !storageReady}
              onChange={(e) => onPick(e.target.files?.[0])}
            />
            <Button type="button" size="sm" disabled={busy || !storageReady} onClick={() => input.current?.click()}>
              {busy ? "Working…" : artwork ? `Replace ${noun}` : `Upload ${noun}`}
            </Button>
            {artwork &&
              (confirmRemove ? (
                <>
                  <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => send({ method: "DELETE" })}>
                    Confirm remove
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setConfirmRemove(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirmRemove(true)}>
                  Remove
                </Button>
              ))}
          </div>
          {error && (
            <p role="alert" className="text-[13px] text-destructive" data-testid="artwork-error">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
