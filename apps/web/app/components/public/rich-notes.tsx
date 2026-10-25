import { useEffect, useRef, useState } from "react";
import { usePlayer, type Track } from "./player-context";

// Renders sanitised description HTML (the server ran it through sanitizeRichHtml —
// see lib/rich-text.server.ts). After mount, bare timestamps ("12:34", "1:02:03") in
// the text become buttons that start this episode there in the site-wide player;
// text inside links, code and existing buttons is left alone.
const TS = /(?<![\d:])((?:\d{1,2}:)?[0-5]?\d:[0-5]\d)(?![\d:])/g;
const HAS_TS = new RegExp(TS.source); // non-global: `test` on a /g regex is stateful
const SKIP = new Set(["A", "BUTTON", "PRE", "CODE", "SCRIPT", "STYLE", "TEXTAREA", "IFRAME"]);

function seconds(ts: string) {
  const p = ts.split(":").map(Number);
  return p.length === 3 ? p[0]! * 3600 + p[1]! * 60 + p[2]! : p[0]! * 60 + p[1]!;
}

export function RichNotes({ html, track, queue }: { html: string; track?: Track | null; queue?: Track[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const player = usePlayer();

  useEffect(() => {
    const root = ref.current;
    if (!root || !track) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        for (let p = n.parentElement; p && p !== root; p = p.parentElement) if (SKIP.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        return HAS_TS.test(n.nodeValue ?? "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
    for (const node of nodes) {
      const text = node.nodeValue ?? "";
      const frag = document.createDocumentFragment();
      let last = 0;
      TS.lastIndex = 0;
      for (const m of text.matchAll(TS)) {
        frag.append(text.slice(last, m.index));
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pub-ts pub-mono";
        b.dataset.seek = String(seconds(m[1]!));
        b.setAttribute("aria-label", `Play from ${m[1]}`);
        b.textContent = m[1]!;
        frag.append(b);
        last = m.index! + m[0].length;
      }
      frag.append(text.slice(last));
      node.replaceWith(frag);
    }
  }, [html, track?.id]);

  return (
    <div
      ref={ref}
      className="pub-notes"
      onClick={(e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>("button[data-seek]");
        if (b && track) player.play(track, { queue, at: Number(b.dataset.seek) });
      }}
      // Safe: `html` is server-sanitised (allowlist; no script, styles, handlers or javascript: URLs).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Clamps long rich text with Show more / Show less (used for the show description in the hero). */
export function RichClamp({ html, long }: { html: string; long: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div
        className="pub-notes pub-lead"
        style={!open && long ? { maxHeight: "6.4em", overflow: "hidden", WebkitMaskImage: "linear-gradient(#000 60%, transparent)", maskImage: "linear-gradient(#000 60%, transparent)" } : undefined}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {long && (
        <button type="button" className="pub-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
