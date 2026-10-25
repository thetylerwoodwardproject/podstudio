import { esc } from "~/lib/feed-xml";

// Pure HTML builder for the embeddable player document (`/{show}/embed/*`).
// A working audio player in the README's player tokens: play/pause, −15 / +30,
// scrubber, time, speed, Media Session (lock-screen controls), and playlist
// selection for the whole-show embed. An episode without a verified MP3 shows
// "Audio isn't available" instead of a dead play button. Not built because the
// data doesn't exist: chapters (scrubber division, current-chapter chip),
// transcript chip, and a real video player (the video option still shows a
// colour-bars "Video not available" stage above the audio controls). No cookies, no
// scripts from other origins; the one inline script drives the <audio> element,
// reports its height to the parent for auto-resize, and forwards play / pause /
// ended / timeupdate to the host page (embed.js re-fires them as DOM events).
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
  }[]; // 1 for a single episode/latest, N for the whole show
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
    `*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 Geist,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}` +
    `.mono,.t,li .n,li .d{font-family:ui-monospace,"JetBrains Mono",Menlo,monospace;font-variant-numeric:tabular-nums}` +
    `.card{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--bg)}` +
    `.main{display:flex;gap:16px;padding:16px}` +
    `.art{width:104px;height:104px;border-radius:10px;object-fit:cover;flex:none;background:repeating-linear-gradient(135deg,var(--line) 0 8px,transparent 8px 16px)}` +
    `.col{flex:1;min-width:0;display:flex;flex-direction:column}` +
    `.head{display:flex;align-items:center;gap:10px;justify-content:space-between}` +
    `.show{font-size:12px;color:var(--muted);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.show:hover{color:var(--fg)}` +
    `.follow{flex:none;font-size:12px;font-weight:600;color:var(--fg);text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:3px 12px}.follow:hover{border-color:var(--muted)}` +
    `h1{font-size:18px;line-height:1.25;letter-spacing:-.015em;font-weight:700;margin:4px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}h1 a{color:inherit;text-decoration:none}h1 a:hover{text-decoration:underline}` +
    `.ctl{display:flex;align-items:center;gap:10px;margin-top:auto;padding-top:10px}` +
    `.ctl button{font:inherit;cursor:pointer;color:var(--muted);background:none;border:0;padding:4px 2px;font-size:12px}.ctl button:hover{color:var(--fg)}` +
    `.ctl .play{width:44px;height:44px;border-radius:50%;background:var(--fg);color:var(--bg);display:flex;align-items:center;justify-content:center;padding:0;flex:none}.ctl .play:hover{color:var(--bg);filter:brightness(.92)}` +
    `.ctl .play svg{width:16px;height:16px;fill:currentColor}.ctl .play svg[data-i=play]{margin-left:2px}` +
    `.ctl .t{font-size:12px;color:var(--muted);white-space:nowrap}` +
    `.ctl #spd{border:1px solid var(--line);border-radius:6px;padding:2px 7px;color:var(--fg)}` +
    `button:focus-visible,input[type=range]:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}` +
    `input[type=range]{-webkit-appearance:none;appearance:none;flex:1;min-width:60px;height:22px;background:transparent;margin:0;cursor:pointer}` +
    `input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:linear-gradient(to right,var(--accent) var(--p,0%),var(--line) var(--p,0%))}` +
    `input[type=range]::-moz-range-track{height:4px;border-radius:2px;background:linear-gradient(to right,var(--accent) var(--p,0%),var(--line) var(--p,0%))}` +
    `input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:var(--accent);border:0;margin-top:-4px}` +
    `input[type=range]::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:var(--accent);border:0}` +
    `.status{color:var(--muted);font-size:13px;margin-top:10px}` +
    `ol{margin:0;padding:0;list-style:none;border-top:1px solid var(--line);max-height:216px;overflow-y:auto}` +
    `li{border-bottom:1px solid var(--line)}li:last-child{border-bottom:0}` +
    `li button{all:unset;box-sizing:border-box;cursor:pointer;display:flex;gap:12px;align-items:center;width:100%;padding:9px 16px}li button:hover{background:color-mix(in srgb,var(--fg) 5%,transparent)}` +
    `li .n{width:26px;font-size:12px;color:var(--muted)}li .tt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}li .d{font-size:12px;color:var(--muted)}` +
    `li[aria-current=true] .tt{color:var(--accent);font-weight:700}li button[disabled]{cursor:default;opacity:.45}li button[disabled]:hover{background:none}li button:focus-visible{outline-offset:-2px}` +
    `.foot{padding:0 16px 14px}` +
    `@media (max-width:420px){.art{width:64px;height:64px}.main{gap:12px;padding:12px}.ctl{gap:6px}.ctl #back,.ctl #fwd{display:none}}` +
    // Off-air look for the (not yet built) video player: SMPTE-style colour bars
    // with the message in a black station-ID rectangle.
    (o.player === "video"
      ? `.stage{position:relative;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#131313}` +
        `.stage i{position:absolute;left:0;right:0}` +
        `.stage .b1{top:0;height:67%;background:linear-gradient(to right,#c0c0c0 0 14.28%,#c0c000 0 28.57%,#00c0c0 0 42.85%,#00c000 0 57.14%,#c000c0 0 71.42%,#c00000 0 85.71%,#0000c0 0)}` +
        `.stage .b2{top:67%;height:10%;background:linear-gradient(to right,#0000c0 0 14.28%,#131313 0 28.57%,#c000c0 0 42.85%,#131313 0 57.14%,#00c0c0 0 71.42%,#131313 0 85.71%,#c0c0c0 0)}` +
        `.stage .b3{top:77%;bottom:0;background:linear-gradient(to right,#00214c 0 17.85%,#fff 0 35.7%,#32006a 0 53.5%,#131313 0 71.4%,#0a0a0a 0)}` +
        `.stage span{position:relative;background:#000;color:#fff;border:2px solid #fff;padding:10px 22px;font:700 clamp(11px,3.2vw,17px)/1 ui-monospace,"JetBrains Mono",Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}`
      : "");

  const ep = view.episodes[0];
  const label = view.mode === "single" && ep?.number != null ? `${view.showTitle} · Ep. ${ep.number}` : view.showTitle;
  const heading =
    view.mode === "single"
      ? ep
        ? `<h1 id="title"><a href="${esc(ep.url)}" target="_blank" rel="noopener">${esc(ep.title)}</a></h1>`
        : `<h1>No episode yet</h1>`
      : `<h1 id="title">${esc(view.showTitle)}</h1>`;
  const list =
    view.mode === "playlist"
      ? `<ol>${view.episodes
          .map(
            (e, i) =>
              `<li data-i="${i}"><button type="button"${e.audioUrl ? "" : " disabled"}><span class="n">${e.number ?? ""}</span><span class="tt">${esc(e.title)}</span><span class="d">${e.durationS ? fmtTime(e.durationS) : ""}</span></button></li>`,
          )
          .join("")}</ol>`
      : "";
  const first = view.episodes[0];
  const playable = view.episodes.some((e) => e.audioUrl);
  const art = view.artworkUrl ? `<img class="art" src="${esc(view.artworkUrl)}" alt="" width="104" height="104">` : `<div class="art" aria-hidden="true"></div>`;
  const controls = playable
    ? `<audio id="a" preload="none"></audio><div class="ctl">` +
      `<button type="button" id="pp" class="play" aria-label="Play">${ICON_PLAY}</button>` +
      `<button type="button" id="back" class="mono" aria-label="Back 15 seconds">−15</button>` +
      `<button type="button" id="fwd" class="mono" aria-label="Forward 30 seconds">+30</button>` +
      `<input type="range" id="seek" min="0" max="1000" value="0" step="1" aria-label="Seek">` +
      `<span class="t" id="time">0:00 / ${fmtTime(first?.durationS ?? 0)}</span>` +
      `<button type="button" id="spd" class="mono" aria-label="Playback speed">1×</button></div>` +
      `<div class="status" id="msg" role="status" hidden></div>`
    : `<div class="status">Audio isn't available${view.mode === "playlist" ? " yet" : " for this episode yet"}.</div>`;
  // Plain JSON for the script; "<" escaped so a title can never close the tag.
  const data = JSON.stringify({
    show: view.showTitle,
    art: view.artworkUrl ?? null,
    eps: view.episodes.map((e) => ({ id: e.id ?? null, t: e.title, a: e.audioUrl ?? null, d: e.durationS ?? null })),
  }).replace(/</g, "\\u003c");

  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${esc(view.showTitle)}</title><style>${css}</style></head><body>` +
    `<div class="card">` +
    (o.player === "video" ? `<div class="stage" role="img" aria-label="Video not available"><i class="b1"></i><i class="b2"></i><i class="b3"></i><span>Video not available</span></div>` : "") +
    `<div class="main">${art}<div class="col">` +
    `<div class="head"><a class="show" href="${esc(view.showUrl)}" target="_blank" rel="noopener">${esc(label)}</a>` +
    (o.follow ? `<a class="follow" href="${esc(view.showUrl)}" target="_blank" rel="noopener">Follow</a>` : "") +
    `</div>${heading}${view.mode === "single" ? controls : ""}</div></div>` +
    (view.mode === "playlist" ? `<div class="foot" style="padding:0 16px 4px">${controls}</div>${list}` : "") +
    `</div>` +
    `<script type="application/json" id="d">${data}</script>` +
    `<script>${PLAYER_JS}</script>` +
    `</body></html>`
  );
}

export function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(x).padStart(2, "0")}`;
}

const ICON_PLAY = `<svg viewBox="0 0 24 24" data-i="play" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
const ICON_PAUSE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`;

// The in-iframe player. Plain ES5, no dependencies. Messages to the host page:
// podstudio:resize (height) and podstudio:play|pause|ended|timeupdate
// ({ id, currentTime, duration }).
const PLAYER_JS =
  `(function(){var P=parent;function post(m){try{P.postMessage(m,"*")}catch(e){}}` +
  `function size(){post({type:"podstudio:resize",height:document.documentElement.scrollHeight})}` +
  `addEventListener("load",size);if(window.ResizeObserver)new ResizeObserver(size).observe(document.body);` +
  `var a=document.getElementById("a");if(!a)return;` +
  `var D=JSON.parse(document.getElementById("d").textContent),E=D.eps,cur=0;` +
  `var pp=document.getElementById("pp"),seek=document.getElementById("seek"),tm=document.getElementById("time"),sp=document.getElementById("spd"),msg=document.getElementById("msg"),ti=document.getElementById("title");` +
  `var PLAY=${JSON.stringify(ICON_PLAY)},PAUSE=${JSON.stringify(ICON_PAUSE)},RATES=[1,1.25,1.5,2],ri=0;` +
  `function f(s){s=Math.max(0,Math.floor(s||0));var h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return(h?h+":"+(m<10?"0":""):"")+m+":"+(x<10?"0":"")+x}` +
  `function dur(){return isFinite(a.duration)&&a.duration>0?a.duration:(E[cur]&&E[cur].d)||0}` +
  `function paint(){var d=dur();seek.value=d?Math.round(a.currentTime/d*1000):0;seek.style.setProperty("--p",(d?Math.min(100,a.currentTime/d*100):0)+"%");tm.textContent=f(a.currentTime)+" / "+f(Math.round(d));seek.setAttribute("aria-valuetext",f(a.currentTime)+" of "+f(Math.round(d)))}` +
  `function say(t){msg.hidden=!t;msg.textContent=t||""}` +
  `function mark(){[].forEach.call(document.querySelectorAll("li[data-i]"),function(li){li.setAttribute("aria-current",String(+li.getAttribute("data-i")===cur))})}` +
  `function meta(){var e=E[cur];if(ti&&document.querySelectorAll("li[data-i]").length&&e)ti.textContent=e.t;` +
  `if("mediaSession" in navigator&&window.MediaMetadata&&e)navigator.mediaSession.metadata=new MediaMetadata({title:e.t,artist:D.show,album:D.show,artwork:D.art?[{src:D.art}]:[]})}` +
  `function load(i,go){var e=E[i];if(!e||!e.a)return;cur=i;if(a.getAttribute("src")!==e.a){a.src=e.a;a.playbackRate=RATES[ri]}say("");mark();meta();paint();if(go)start()}` +
  `function start(){var p=a.play();if(p&&p.catch)p.catch(function(){say("Couldn't start playback.")})}` +
  `pp.addEventListener("click",function(){if(!a.getAttribute("src")){var i=E[cur]&&E[cur].a?cur:E.findIndex(function(e){return e.a});if(i<0)return;load(i,true);return}a.paused?start():a.pause()});` +
  `document.getElementById("back").addEventListener("click",function(){a.currentTime=Math.max(0,a.currentTime-15)});` +
  `document.getElementById("fwd").addEventListener("click",function(){a.currentTime=Math.min(dur()||1e9,a.currentTime+30)});` +
  `seek.addEventListener("input",function(){if(!a.getAttribute("src")){var i=E[cur]&&E[cur].a?cur:E.findIndex(function(e){return e.a});if(i<0)return;load(i,false)}var d=dur();if(d)a.currentTime=seek.value/1000*d;paint()});` +
  `sp.addEventListener("click",function(){ri=(ri+1)%RATES.length;a.playbackRate=RATES[ri];sp.textContent=RATES[ri]+"×"});` +
  `function ev(t){var e=E[cur]||{};post({type:"podstudio:"+t,id:e.id,currentTime:a.currentTime,duration:dur()})}` +
  `a.addEventListener("play",function(){pp.innerHTML=PAUSE;pp.setAttribute("aria-label","Pause");ev("play")});` +
  `a.addEventListener("pause",function(){pp.innerHTML=PLAY;pp.setAttribute("aria-label","Play");ev("pause")});` +
  `a.addEventListener("timeupdate",function(){paint();ev("timeupdate")});` +
  `a.addEventListener("loadedmetadata",paint);a.addEventListener("durationchange",paint);` +
  `a.addEventListener("waiting",function(){say("Loading…")});a.addEventListener("playing",function(){say("")});` +
  `a.addEventListener("error",function(){say("Couldn't load the audio.")});` +
  `a.addEventListener("ended",function(){ev("ended");var n=cur+1;while(n<E.length&&!E[n].a)n++;if(n<E.length)load(n,true)});` +
  `[].forEach.call(document.querySelectorAll("li[data-i] button"),function(b){b.addEventListener("click",function(){load(+b.parentNode.getAttribute("data-i"),true)})});` +
  `if("mediaSession" in navigator){var ms=navigator.mediaSession,h=function(n,fn){try{ms.setActionHandler(n,fn)}catch(e){}};` +
  `h("play",start);h("pause",function(){a.pause()});h("seekbackward",function(){a.currentTime=Math.max(0,a.currentTime-15)});h("seekforward",function(){a.currentTime+=30})}` +
  `var first=E.findIndex(function(e){return e.a});if(first>=0){cur=first;mark();meta();paint()}` +
  `})()`;

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
