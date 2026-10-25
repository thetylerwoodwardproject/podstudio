import sanitizeHtml from "sanitize-html";
import { parseNotes, type Inline } from "~/lib/notes";

// Descriptions (episode show notes, show description, person bios) are rich text:
// the studio's editor produces HTML, older entries are plain text. This module is
// the single gate for that HTML.
//
// Public pages accept a generous set of HTML — headings, lists, quotes, tables,
// images, code, details/summary and iframes from a short list of embed hosts — but
// never scripts, styles, event handlers, forms or `javascript:` URLs. That limit is
// not cosmetic: the public site shares an origin with the studio login, so a stray
// <script> in a description would run with the admin's session. Sanitising happens
// when a description is saved *and* again whenever it is rendered.
//
// Podcast apps get a smaller set (`sanitizeFeedHtml`) inside CDATA, which is what
// Apple Podcasts and Spotify accept; plain text (snippets, meta tags, JSON-LD,
// itunes:summary) comes from `htmlToText`.

const EMBED_HOSTS = ["www.youtube.com", "www.youtube-nocookie.com", "player.vimeo.com", "open.spotify.com", "embed.podcasts.apple.com"];

const looksLikeHtml = (s: string) => /<\/?[a-z][a-z0-9]*(\s[^>]*)?>/i.test(s);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inlineHtml(parts: Inline[]) {
  return parts
    .map((x) => (x.t === "link" ? `<a href="${esc(x.href)}">${esc(x.v)}</a>` : esc(x.v)))
    .join("")
    .replace(/\n/g, "<br>");
}

/** Plain-text notes → HTML (paragraphs, bullet lists, links). Already-HTML input is returned as is. */
export function toHtml(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  if (looksLikeHtml(s)) return s;
  return parseNotes(s)
    .map((b) => (b.type === "ul" ? `<ul>${b.items.map((it) => `<li>${inlineHtml(it)}</li>`).join("")}</ul>` : `<p>${inlineHtml(b.inline)}</p>`))
    .join("");
}

const linkTransform = (_tag: string, attribs: Record<string, string>) => ({
  tagName: "a",
  attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow ugc" },
});

/** The public-page allowlist. */
export function sanitizeRichHtml(raw: string | null | undefined): string {
  const html = toHtml(raw);
  if (!html) return "";
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "hr", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code", "ul", "ol", "li", "a", "strong", "b", "em", "i", "u", "s", "del", "ins",
      "mark", "sub", "sup", "small", "span", "div", "figure", "figcaption", "img", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
      "details", "summary", "iframe", "abbr", "cite", "kbd", "dl", "dt", "dd",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      iframe: ["src", "width", "height", "title", "allowfullscreen", "loading"],
      th: ["colspan", "rowspan", "scope"],
      td: ["colspan", "rowspan"],
      ol: ["start"],
      abbr: ["title"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["https"], iframe: ["https"] },
    allowedIframeHostnames: EMBED_HOSTS,
    allowProtocolRelative: false,
    transformTags: {
      a: linkTransform,
      h1: "h2", // the page title is the only h1
      img: (_t, a) => ({ tagName: "img", attribs: { ...a, loading: "lazy" } }),
      iframe: (_t, a) => ({ tagName: "iframe", attribs: { ...a, loading: "lazy", title: a.title || "Embedded content" } }),
    },
    // Tags that arrive empty after cleaning (stray <p></p>, an iframe with a dropped src) are removed.
    exclusiveFilter: (f) => (f.tag === "iframe" && !f.attribs.src) || (f.tag === "img" && !f.attribs.src),
  });
}

/** The smaller set podcast apps render (inside CDATA in the feed). */
export function sanitizeFeedHtml(raw: string | null | undefined): string {
  const html = toHtml(raw);
  if (!html) return "";
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "ul", "ol", "li", "a", "strong", "b", "em", "i", "u", "s", "blockquote", "h2", "h3", "h4", "code", "pre"],
    allowedAttributes: { a: ["href"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: { h1: "h2", h5: "h4", h6: "h4" },
  });
}

/** Plain text of a description (any format): for list snippets, <meta>, JSON-LD and itunes:summary. */
export function htmlToText(raw: string | null | undefined): string {
  const html = toHtml(raw);
  if (!html) return "";
  const spaced = html.replace(/<\/(p|li|h[1-6]|blockquote|div|tr)>|<br\s*\/?>/gi, " ");
  return sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** What gets stored: sanitised HTML, or null when the editor was left effectively empty. */
export function cleanForStorage(raw: string | null | undefined): string | null {
  const html = sanitizeRichHtml(raw);
  if (!htmlToText(html) && !/<(img|iframe|hr)\b/i.test(html)) return null;
  return html;
}
