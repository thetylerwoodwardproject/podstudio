import { esc } from "~/lib/feed-xml";
import { linkColor, onAccent } from "~/lib/brand-theme";

// Options, theme tokens and snippets for the embeddable player (`/{show}/embed/*`). The player
// itself is a React route built from audiocn's AudioPlayer and TrackList
// (components/embed/embed-player.tsx); embed.js turns a data-podstudio div into its iframe.
export type EmbedTheme = "dark" | "light" | "auto";
/** The six palette accents; amber/teal/ink still work for snippets pasted before 2026-11-02. */
export type EmbedAccent = "black" | "gold" | "cyan" | "lime" | "coral" | "lavender" | "amber" | "teal" | "ink";
const EMBED_ACCENT_IDS = ["black", "gold", "cyan", "lime", "coral", "lavender", "amber", "teal", "ink"] as const;

export interface EmbedOptions {
  player: "audio" | "video";
  theme: EmbedTheme;
  accent: EmbedAccent;
  follow: boolean;
}

export interface EmbedView {
  showTitle: string;
  showUrl: string;
  /** Absolute URL of the show artwork, when one is set. */
  artworkUrl?: string | null;
  /** `audioUrl` is the public media URL, null when the episode has no verified MP3. */
  episodes: {
    id?: string;
    title: string;
    number: number | null;
    url: string;
    audioUrl?: string | null;
    durationS?: number | null;
    /** Absolute URL of this episode's own cover; the show artwork is used when absent. */
    artworkUrl?: string | null;
  }[]; // 1 for a single episode/latest, N for the whole show
  mode: "single" | "playlist";
}

// README 28 tokens. Accent pairs are [dark-mode, light-mode]. The palette colors are used as-is
// (black shows as bone on dark); text on the accent is picked for contrast (onAccent).
const TOKENS = {
  dark: { bg: "#151517", fg: "#ecebe6", muted: "#8f8e88", line: "#26262b" },
  light: { bg: "#ffffff", fg: "#1b1a18", muted: "#6b6963", line: "#e3dfd6" },
};
const ACCENTS: Record<EmbedAccent, { dark: string; light: string }> = {
  black: { dark: "#ecebe6", light: "#000000" },
  gold: { dark: "#fabf47", light: "#fabf47" },
  cyan: { dark: "#00fff5", light: "#00fff5" },
  lime: { dark: "#beff00", light: "#beff00" },
  coral: { dark: "#ff807f", light: "#ff807f" },
  lavender: { dark: "#c7bff6", light: "#c7bff6" },
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
    accent: pick(q.get("accent"), EMBED_ACCENT_IDS, "gold"),
    follow: q.get("follow") !== "0",
  };
}

/** shadcn/audiocn tokens for one theme: the README 28 player tokens, the accent as `--primary`. */
function vars(mode: "dark" | "light", accent: EmbedAccent) {
  const t = TOKENS[mode];
  const a = ACCENTS[accent][mode];
  return (
    `--bg:${t.bg};--fg:${t.fg};--line:${t.line};--accent:${a};` +
    `--background:${t.bg};--foreground:${t.fg};--card:${t.bg};--card-foreground:${t.fg};--muted:${t.line};--muted-foreground:${t.muted};` +
    `--border:${t.line};--input:${t.line};--ring:${a};--primary:${a};--primary-foreground:${onAccent(a)};--secondary:${t.line};--secondary-foreground:${t.fg};` +
    `--accent-foreground:${t.fg};--emb-link:${linkColor(a, mode)};`
  );
}

/**
 * The embed document's stylesheet: theme tokens (theme=auto follows the OS), the page background,
 * artwork placeholder, narrow-iframe tweaks and, for the video option, the off-air color bars.
 */
export function embedThemeCss(o: EmbedOptions) {
  const base = o.theme === "light" ? "light" : "dark";
  return (
    `:root{${vars(base, o.accent)}color-scheme:${o.theme === "auto" ? "light dark" : base}}` +
    (o.theme === "auto" ? `@media (prefers-color-scheme:light){:root{${vars("light", o.accent)}}}` : "") +
    `html,body{margin:0;background:var(--bg);color:var(--fg)}body{font-size:14px;line-height:1.45}` +
    // Accent as *text* (the playing row's number/title) must stay readable: gold or lime on a
    // white embed is under 2:1, so text uses the accent stepped to 4.5:1 against the background.
    `[aria-current=true] [class*="text-primary"]{color:var(--emb-link)}` +
    `.emb-art{width:104px;height:104px;border-radius:10px;object-fit:cover;flex:none;background:repeating-linear-gradient(135deg,var(--line) 0 8px,transparent 8px 16px)}` +
    `@media (max-width:640px){.emb-vol .player-volume-slider{display:none}}.emb-skip{color:var(--muted-foreground)}.emb-skip:hover{color:var(--fg)}` +
    `@media (max-width:420px){.emb-art{width:64px;height:64px}.emb-main{gap:12px;padding:12px}.emb-vol{display:none}}` +
    (o.player === "video"
      ? `.emb-stage{position:relative;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#131313}` +
        `.emb-stage i{position:absolute;left:0;right:0}` +
        `.emb-stage .b1{top:0;height:67%;background:linear-gradient(to right,#c0c0c0 0 14.28%,#c0c000 0 28.57%,#00c0c0 0 42.85%,#00c000 0 57.14%,#c000c0 0 71.42%,#c00000 0 85.71%,#0000c0 0)}` +
        `.emb-stage .b2{top:67%;height:10%;background:linear-gradient(to right,#0000c0 0 14.28%,#131313 0 28.57%,#c000c0 0 42.85%,#131313 0 57.14%,#00c0c0 0 71.42%,#131313 0 85.71%,#c0c0c0 0)}` +
        `.emb-stage .b3{top:77%;bottom:0;background:linear-gradient(to right,#00214c 0 17.85%,#fff 0 35.7%,#32006a 0 53.5%,#131313 0 71.4%,#0a0a0a 0)}` +
        `.emb-stage span{position:relative;background:#000;color:#fff;border:2px solid #fff;padding:10px 22px;font:700 clamp(11px,3.2vw,17px)/1 ui-monospace,"JetBrains Mono",Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}`
      : "")
  );
}

export function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(x).padStart(2, "0")}`;
}

/** The `<iframe>` the oEmbed endpoint and snippet generator hand out. */
export function iframeHtml(src: string, o: EmbedOptions) {
  const height = o.player === "video" ? 400 : 196;
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
  f.style.cssText="border:0;width:100%;height:"+(el.getAttribute("data-player")==="video"?"400":"196")+"px";
  f.loading="lazy";f.title="Podcast player";f.setAttribute("allow","autoplay");
  el.appendChild(f);
  window.addEventListener("message",function(e){
    if(e.source!==f.contentWindow||!e.data||typeof e.data.type!=="string")return;
    if(e.data.type==="podstudio:resize"){if(typeof e.data.height==="number")f.style.height=e.data.height+"px";return}
    if(/^podstudio:(play|pause|ended|timeupdate)$/.test(e.data.type))
      el.dispatchEvent(new CustomEvent(e.data.type,{bubbles:true,detail:{id:e.data.id,currentTime:e.data.currentTime,duration:e.data.duration}}));
  });
}
function init(){[].forEach.call(document.querySelectorAll("[data-podstudio]"),build)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
`;
}
