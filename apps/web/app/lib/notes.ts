// Show notes → safe structure. Notes are plain text; this finds the parts worth
// making interactive — web links, "12:34" timestamps and bullet lines — and hands
// back tokens for React to render as elements. Nothing is ever turned into HTML, so
// there is nothing to sanitize; only http(s) links are recognised (a `javascript:`
// string stays plain text).
export type Inline =
  | { t: "text"; v: string }
  | { t: "link"; href: string; v: string }
  | { t: "time"; seconds: number; v: string };
export type Block = { type: "p"; inline: Inline[] } | { type: "ul"; items: Inline[][] };

const TOKEN = /(https?:\/\/[^\s<>"]+)|(?<![\d:])((?:\d{1,2}:)?[0-5]?\d:[0-5]\d)(?![\d:])/g;

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    const at = m.index!;
    if (at > last) out.push({ t: "text", v: line.slice(last, at) });
    if (m[1]) {
      // Trailing punctuation belongs to the sentence, not the link.
      const raw = m[1].replace(/[.,;:!?)\]'"]+$/, "");
      try {
        const u = new URL(raw);
        out.push({ t: "link", href: u.toString(), v: raw });
        if (raw.length < m[1].length) out.push({ t: "text", v: m[1].slice(raw.length) });
      } catch {
        out.push({ t: "text", v: m[1] });
      }
    } else {
      const parts = m[2]!.split(":").map(Number);
      const seconds = parts.length === 3 ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]! : parts[0]! * 60 + parts[1]!;
      out.push({ t: "time", seconds, v: m[2]! });
    }
    last = at + m[0].length;
  }
  if (last < line.length) out.push({ t: "text", v: line.slice(last) });
  // merge neighbouring text pieces (e.g. a link's trimmed trailing comma + what follows)
  return out.reduce<Inline[]>((acc, x) => {
    const prev = acc[acc.length - 1];
    if (x.t === "text" && prev?.t === "text") prev.v += x.v;
    else acc.push(x);
    return acc;
  }, []);
}

const BULLET = /^\s*(?:[-*•])\s+(.*)$/;

export function parseNotes(text: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of text.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    // Within a chunk, runs of bullet lines become a list and the lines around them
    // (e.g. a "Chapters:" lead-in) stay paragraphs; single newlines are line breaks.
    let para: string[] = [];
    let items: Inline[][] = [];
    const flushPara = () => {
      if (!para.length) return;
      const inline: Inline[] = [];
      para.forEach((l, i) => {
        if (i > 0) inline.push({ t: "text", v: "\n" });
        inline.push(...parseInline(l));
      });
      blocks.push({ type: "p", inline });
      para = [];
    };
    const flushList = () => {
      if (!items.length) return;
      blocks.push({ type: "ul", items });
      items = [];
    };
    for (const l of chunk.split("\n").filter((x) => x.trim())) {
      const m = BULLET.exec(l);
      if (m) {
        flushPara();
        items.push(parseInline(m[1]!));
      } else {
        flushList();
        para.push(l);
      }
    }
    flushPara();
    flushList();
  }
  return blocks;
}
