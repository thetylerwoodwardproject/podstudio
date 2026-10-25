import { parseNotes, type Inline } from "~/lib/notes";
import { usePlayer, type Track } from "./player-context";

// Renders show notes (plain text) with live links and timestamps. A timestamp
// starts this episode there in the site-wide player; without audio it stays text.
export function ShowNotes({ text, track, queue }: { text: string; track: Track | null; queue?: Track[] }) {
  const player = usePlayer();
  const render = (parts: Inline[]) =>
    parts.map((x, i) => {
      if (x.t === "link") {
        return (
          <a key={i} href={x.href} target="_blank" rel="noopener noreferrer nofollow ugc">
            {x.v}
          </a>
        );
      }
      if (x.t === "time" && track) {
        return (
          <button
            key={i}
            type="button"
            className="pub-ts pub-mono"
            onClick={() => player.play(track, { queue, at: x.seconds })}
            aria-label={`Play from ${x.v}`}
          >
            {x.v}
          </button>
        );
      }
      return <span key={i}>{x.v}</span>;
    });
  return (
    <div className="pub-notes">
      {parseNotes(text).map((b, i) =>
        b.type === "ul" ? (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>{render(it)}</li>
            ))}
          </ul>
        ) : (
          <p key={i} style={{ whiteSpace: "pre-line" }}>
            {render(b.inline)}
          </p>
        ),
      )}
    </div>
  );
}
