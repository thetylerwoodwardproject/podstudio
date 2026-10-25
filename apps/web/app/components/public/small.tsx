import { useState } from "react";
import { formatClock } from "./public-layout";
import { usePlayer } from "./player-context";
import { faShareNodes } from "@fortawesome/free-solid-svg-icons/faShareNodes";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons/faCheck";
import { faCopy } from "@fortawesome/free-solid-svg-icons/faCopy";

/** Copies the RSS URL; the label flips to "Copied" for two seconds. */
export function CopyRss({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="pub-pill"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(new URL(url, location.href).href);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      <FontAwesomeIcon icon={done ? faCheck : faCopy} />
      {done ? "Copied" : "Copy RSS link"}
    </button>
  );
}

/** Clamps long text to three lines with a Show more / Show less toggle (only when it's long). */
export function ShowMore({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 240;
  return (
    <div>
      <p
        className="pub-lead"
        style={!open && long ? { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" } : undefined}
      >
        {text}
      </p>
      {long && (
        <button type="button" className="pub-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/** Episode "Share" panel: copy the link, the link at the current time, or an embed code; native share where the browser has it. */
export function ShareMenu({ path, title, embedPath, trackId }: { path: string; title: string; embedPath: string; trackId: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const p = usePlayer();
  const at = p.current?.id === trackId ? Math.floor(p.time) : 0;
  const abs = (x: string) => new URL(x, typeof location === "undefined" ? "http://x" : location.href).href;
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setDone(key);
      setTimeout(() => setDone((d) => (d === key ? null : d)), 2000);
    } catch {
      /* clipboard blocked */
    }
  }
  const embed = () =>
    `<iframe src="${abs(embedPath)}" width="100%" height="152" style="border:0" loading="lazy" title="Podcast player"></iframe>`;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <div>
      <button type="button" className="pub-pill" aria-expanded={open} aria-controls="share-panel" onClick={() => setOpen((o) => !o)}>
        <FontAwesomeIcon icon={faShareNodes} />
        Share
      </button>
      {open && (
        <div id="share-panel" className="pub-share" role="group" aria-label="Share this episode">
          <button type="button" onClick={() => copy("link", abs(path))}>
            {done === "link" ? "Copied ✓" : "Copy link"}
          </button>
          {at >= 1 && (
            <button type="button" onClick={() => copy("time", `${abs(path)}?t=${at}`)}>
              {done === "time" ? "Copied ✓" : `Copy link at ${formatClock(at)}`}
            </button>
          )}
          <button type="button" onClick={() => copy("embed", embed())}>
            {done === "embed" ? "Copied ✓" : "Copy embed code"}
          </button>
          {canShare && (
            <button type="button" onClick={() => navigator.share({ title, url: abs(path) }).catch(() => {})}>
              Share…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
