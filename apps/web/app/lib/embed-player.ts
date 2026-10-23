import { esc } from "~/lib/feed-xml";

// Pure HTML builder for the embeddable player document (`/{show}/embed/*`).
// Honest about its state: no audio exists yet, so this renders the real
// show/episode metadata in the README's player tokens with an "Audio isn't
// available yet" status — it has no <audio> element, play button, chapters or
// transcript, and says so. No cookies, no scripts from other origins; the one
// inline script only reports its height to the parent for auto-resize.
export type EmbedTheme = "dark" | "light" | "auto";
export type EmbedAccent = "amber" | "teal" | "ink";

export interface EmbedOptions {
  player: "audio" | "video";
  theme: EmbedTheme;
  accent: EmbedAccent;
  follow: boolean;
}

export interface EmbedView {
  showTitle: string;
  showUrl: string;
  episodes: { title: string; number: number | null; url: string }[]; // 1 for a single episode/latest, N for the whole show
  mode: "single" | "playlist";
}

// README 28 tokens. Accent pairs are [dark-mode, light-mode]; amber's are the
// spec's own, teal/ink are chosen to keep ≥3:1 against each background.
const TOKENS = {
  dark: { bg: "#151517", fg: "#ecebe6", muted: "#8f8e88", line: "#26262b" },
  light: { bg: "#ffffff", fg: "#1b1a18", muted: "#6b6963", line: "#e3dfd6" },
};
const ACCENTS: Record<EmbedAccent, { dark: string; light: string }> = {
  amber: { dark: "#e8b04a", light: "#c47f12" },
  teal: { dark: "#3fb8a5", light: "#178a92" },
  ink: { dark: "#ecebe6", light: "#1b1a18" },
};

export function parseEmbedOptions(q: URLSearchParams): EmbedOptions {
  const pick = <T extends string>(v: string | null, allowed: readonly T[], d: T): T =>
    allowed.includes(v as T) ? (v as T) : d;
  return {
    player: pick(q.get("player"), ["audio", "video"] as const, "audio"),
    theme: pick(q.get("theme"), ["dark", "light", "auto"] as const, "dark"),
    accent: pick(q.get("accent"), ["amber", "teal", "ink"] as const, "amber"),
    follow: q.get("follow") !== "0",
  };
}

function vars(mode: "dark" | "light", accent: EmbedAccent) {
  const t = TOKENS[mode];
  return `--bg:${t.bg};--fg:${t.fg};--muted:${t.muted};--line:${t.line};--accent:${ACCENTS[accent][mode]};`;
}

export function embedHtml(view: EmbedView, o: EmbedOptions) {
  const base = o.theme === "light" ? "light" : "dark";
  const css =
    `:root{${vars(base, o.accent)}color-scheme:${o.theme === "auto" ? "light dark" : base}}` +
    (o.theme === "auto" ? `@media (prefers-color-scheme:light){:root{${vars("light", o.accent)}}}` : "") +
    `*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}` +
    `.card{padding:14px 16px;border:1px solid var(--line);min-height:100px}` +
    `.show{font-size:12px;color:var(--muted);text-decoration:none}` +
    `h1{font-size:16px;margin:2px 0 6px}h1 a{color:inherit;text-decoration:none}` +
    `.status{color:var(--muted);font-size:13px;border-left:3px solid var(--accent);padding-left:10px;margin:8px 0}` +
    `ol{margin:8px 0 0;padding:0;list-style:none}li{padding:6px 0;border-top:1px solid var(--line)}li a{color:var(--fg);text-decoration:none}` +
    `li span{color:var(--muted);margin-right:8px}.follow{display:inline-block;margin-top:8px;color:var(--accent);font-weight:600;text-decoration:none}` +
    (o.player === "video" ? `.stage{aspect-ratio:16/9;background:#000;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;margin-bottom:10px}` : "");

  const ep = view.episodes[0];
  const body =
    view.mode === "single"
      ? ep
        ? `<h1><a href="${esc(ep.url)}" target="_blank" rel="noopener">${esc(ep.title)}</a></h1>`
        : `<h1>No episode yet</h1>`
      : `<h1>${esc(view.showTitle)}</h1><ol>${view.episodes
          .map(
            (e) =>
              `<li><span>${e.number ?? ""}</span><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a></li>`,
          )
          .join("")}</ol>`;

  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${esc(view.showTitle)}</title><style>${css}</style></head><body>` +
    `<div class="card">` +
    (o.player === "video" ? `<div class="stage">Video isn't available yet</div>` : "") +
    `<a class="show" href="${esc(view.showUrl)}" target="_blank" rel="noopener">${esc(view.showTitle)}</a>${body}` +
    `<div class="status">Audio isn't available yet.</div>` +
    (o.follow ? `<a class="follow" href="${esc(view.showUrl)}" target="_blank" rel="noopener">Follow</a>` : "") +
    `</div>` +
    `<script>(function(){function s(){parent.postMessage({type:"podstudio:resize",height:document.documentElement.scrollHeight},"*")}` +
    `addEventListener("load",s);if(window.ResizeObserver)new ResizeObserver(s).observe(document.body)})()</script>` +
    `</body></html>`
  );
}

/** The `<iframe>` the oEmbed endpoint and snippet generator hand out. */
export function iframeHtml(src: string, o: EmbedOptions) {
  const height = o.player === "video" ? 360 : 152;
  return `<iframe src="${esc(src)}" width="100%" height="${height}" style="border:0" loading="lazy" title="Podcast player" allow="autoplay"></iframe>`;
}

export function embedScript() {
  return `(function(){
var s=document.currentScript;var origin=s&&s.src?new URL(s.src).origin:"";
function build(el){
  var t=el.getAttribute("data-podstudio");if(!t||el.__ps)return;el.__ps=1;
  var p=new URLSearchParams();
  ["player","theme","accent"].forEach(function(k){var v=el.getAttribute("data-"+k);if(v)p.set(k,v)});
  ["chapters","transcript","follow"].forEach(function(k){if(el.getAttribute("data-"+k)==="0")p.set(k,"0")});
  var parts=t.split("/");var f=document.createElement("iframe");
  f.src=origin+"/"+encodeURIComponent(parts[0])+"/embed/"+encodeURIComponent(parts[1]||"latest")+"?"+p.toString();
  f.style.cssText="border:0;width:100%;height:"+(el.getAttribute("data-player")==="video"?"360":"152")+"px";
  f.loading="lazy";f.title="Podcast player";f.setAttribute("allow","autoplay");
  el.appendChild(f);
  window.addEventListener("message",function(e){
    if(e.source===f.contentWindow&&e.data&&e.data.type==="podstudio:resize"&&typeof e.data.height==="number")f.style.height=e.data.height+"px";
  });
}
function init(){[].forEach.call(document.querySelectorAll("[data-podstudio]"),build)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
`;
}
