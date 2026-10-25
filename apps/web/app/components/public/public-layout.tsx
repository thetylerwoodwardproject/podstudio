import { Link } from "react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRss } from "@fortawesome/free-solid-svg-icons/faRss";
import { PLATFORM_ICONS, PLATFORM_LABELS, type Platform } from "~/lib/platforms";
import { usePlayer } from "./player-context";
import { brandVars, DEFAULT_BRAND_THEME, type BrandTheme } from "~/lib/brand-theme";

// Shared chrome for the public (listener-facing) pages. Paper theme by
// default; Brand & theme (29b) is applied only when its "Public site" scope
// is on. Everything user-supplied reaches the DOM as React text/attributes;
// the <style> block interpolates only validated hex colours and numbers from
// `brandVars`. No cookies, no third-party scripts (README: "Public pages and
// players: no cookies or third-party trackers").
const LIGHT = { bg: "#f3f1ec", fg: "#1b1a18", muted: "#6b6963", line: "#dcd8cf", surface: "#fbfaf7" };
const DARK = { bg: "#111113", fg: "#ecebe6", muted: "#8f8e88", line: "#26262b", surface: "#18181b" };

function vars(v: Record<string, string>, base: typeof LIGHT) {
  return (
    `--pub-bg:${base.bg};--pub-fg:${base.fg};--pub-muted:${base.muted};--pub-line:${base.line};--pub-surface:${base.surface};` +
    Object.entries(v).map(([k, val]) => `${k}:${val};`).join("")
  );
}

export function publicCss(brand: BrandTheme) {
  const light = vars(brandVars(brand, "light"), LIGHT);
  const dark = vars(brandVars(brand, "dark"), DARK);
  return `
.pub{${light}background:var(--pub-bg);color:var(--pub-fg);min-height:100vh;font-family:Geist,system-ui,sans-serif;line-height:1.55;-webkit-font-smoothing:antialiased}
.pub[data-appearance=dark]{${dark}}
@media (prefers-color-scheme:dark){.pub[data-appearance=auto]{${dark}}}
.pub a{color:var(--brand-link)}
.pub :focus-visible{outline:2px solid var(--brand-accent);outline-offset:2px;border-radius:4px}
.pub-mono{font-family:"JetBrains Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
.pub-wrap{max-width:1120px;margin:0 auto;padding:0 32px}
.pub h1{font-size:clamp(34px,5.6vw,60px);line-height:1.04;letter-spacing:-0.035em;font-weight:700;margin:0;text-wrap:balance}
.pub h2{font-size:22px;letter-spacing:-0.015em;font-weight:700;margin:0 0 14px}
.pub-muted{color:var(--pub-muted)}
.pub-eyebrow{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--pub-muted);font-weight:500}

.pub-header{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--pub-bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--pub-line)}
.pub-header .pub-wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:64px}
.pub-brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-0.01em;color:var(--pub-fg)!important;text-decoration:none;min-width:0}
.pub-brand img,.pub-brand i{width:30px;height:30px;border-radius:8px;object-fit:cover;flex:none;background:var(--brand-tint)}
.pub-brand span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pub-nav{display:flex;align-items:center;gap:2px}
.pub-nav a{color:var(--pub-muted);text-decoration:none;padding:8px 12px;min-height:44px;display:inline-flex;align-items:center;font-size:14px;border-radius:8px}
.pub-nav a:hover{color:var(--pub-fg)}
.pub-nav a.pub-nav-cta{color:var(--pub-fg);font-weight:600}

.pub-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 18px;background:var(--brand-accent);color:var(--brand-on-accent)!important;border:1px solid transparent;border-radius:var(--brand-radius-control);text-decoration:none;font-weight:600;font-size:14px;cursor:pointer}
.pub-btn:hover{filter:brightness(1.06)}
.pub-btn-ghost{background:transparent;color:var(--pub-fg)!important;border-color:var(--pub-line)}
.pub-btn-ghost:hover{background:var(--pub-surface);filter:none}
.pub-pill{display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 14px;border:1px solid var(--pub-line);background:var(--pub-surface);color:var(--pub-fg)!important;border-radius:999px;font-size:13.5px;font-weight:600;text-decoration:none}
.pub-pill:hover{border-color:var(--pub-muted)}
.pub-pill svg{width:14px;height:14px}
.pub-pill-accent{background:var(--brand-accent);color:var(--brand-on-accent)!important;border-color:transparent}

.pub-hero{display:grid;grid-template-columns:240px minmax(0,1fr);gap:44px;align-items:center;padding:56px 0 8px}
.pub-art{width:100%;aspect-ratio:1;border-radius:calc(var(--brand-radius-card) + 4px);object-fit:cover;background:var(--brand-tint);box-shadow:0 24px 48px -24px rgba(0,0,0,.45),0 0 0 1px color-mix(in srgb,var(--pub-fg) 8%,transparent)}
.pub-lead{font-size:19px;line-height:1.55;max-width:640px;margin:16px 0 0;color:color-mix(in srgb,var(--pub-fg) 88%,var(--pub-muted))}
.pub-hosts{display:flex;align-items:center;gap:12px;margin:20px 0 0;font-size:14px;color:var(--pub-muted)}
.pub-avatars{display:flex}
.pub-avatar{width:30px;height:30px;border-radius:50%;background:var(--brand-tint);color:var(--pub-fg);border:2px solid var(--pub-bg);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;margin-left:-8px;flex:none}
.pub-avatars .pub-avatar:first-child{margin-left:0}
.pub-follow{display:flex;gap:8px;flex-wrap:wrap;margin-top:22px}

.pub-section{margin-top:64px}
.pub-section-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.pub-section-head h2{margin:0}
.pub-card{border:1px solid var(--pub-line);background:var(--pub-surface);border-radius:var(--brand-radius-card);padding:22px}
.pub-tint{background:var(--brand-tint);border-radius:var(--brand-radius-card);padding:18px 22px}

.pub-latest{display:grid;grid-template-columns:112px minmax(0,1fr);gap:22px;align-items:start}
.pub-latest .pub-art{border-radius:14px;box-shadow:none}
.pub-latest h3{font-size:26px;line-height:1.15;letter-spacing:-0.02em;font-weight:700;margin:2px 0 6px}
.pub-latest h3 a{color:inherit;text-decoration:none}
.pub-latest h3 a:hover{text-decoration:underline}
.pub-clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin:10px 0 0;color:color-mix(in srgb,var(--pub-fg) 85%,var(--pub-muted))}

.pub-list{border-top:1px solid var(--pub-line)}
.pub-ep{display:grid;grid-template-columns:44px minmax(0,1fr);gap:16px;align-items:start;padding:18px 10px;margin:0 -10px;border-bottom:1px solid var(--pub-line)}
.pub-ep:hover{background:var(--pub-surface)}
.pub-ep .go{width:44px;height:44px;border-radius:50%;border:1px solid var(--pub-line);background:transparent;display:inline-flex;align-items:center;justify-content:center;color:var(--pub-fg);font-size:13px;cursor:pointer;padding:0}
.pub-ep .go:hover:not(:disabled),.pub-ep[aria-current=true] .go{background:var(--brand-accent);border-color:var(--brand-accent);color:var(--brand-on-accent)}
.pub-ep .go:disabled{opacity:.4;cursor:default}
.pub-ep .ti{display:block;font-size:18px;line-height:1.3;font-weight:700;letter-spacing:-0.015em;color:var(--pub-fg)!important;text-decoration:none}
.pub-ep .ti:hover{text-decoration:underline}
.pub-ep[aria-current=true] .ti{color:var(--brand-link)!important}
.pub-ep .sn{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:4px 0 0;font-size:14.5px;color:color-mix(in srgb,var(--pub-fg) 80%,var(--pub-muted))}
.pub-ep .mt{margin-top:8px;font-size:12.5px;color:var(--pub-muted);display:flex;flex-wrap:wrap;gap:2px 8px}
.pub-ep .mt .g{font-family:Geist,system-ui,sans-serif}
.pub-ep .mt span+span::before{content:"•";margin-right:8px;opacity:.6}
.pub-badge{font-size:11px;border:1px solid var(--pub-line);border-radius:999px;padding:1px 8px;color:var(--pub-muted)}
.pub-pager{display:flex;gap:8px;margin-top:18px;align-items:center}

.pub-recs{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
.pub-rec{display:flex;flex-direction:column;gap:6px}
.pub-rec b{font-size:16px;letter-spacing:-0.01em}
.pub-rec a{color:inherit;text-decoration:none}.pub-rec a:hover{text-decoration:underline}

.pub-support{display:flex;gap:14px;align-items:flex-start}
.pub-support .ic{width:36px;height:36px;border-radius:50%;background:var(--brand-tint);display:inline-flex;align-items:center;justify-content:center;flex:none;color:var(--brand-link)}

.pub-footer{border-top:1px solid var(--pub-line);margin-top:88px;padding:28px 0 36px;font-size:13px;color:var(--pub-muted)}
.pub-footer .pub-wrap{display:flex;gap:12px 22px;align-items:center;flex-wrap:wrap}
.pub-footer a{color:var(--pub-muted);text-decoration:none}.pub-footer a:hover{color:var(--pub-fg)}
.pub-links{display:flex;gap:2px;flex-wrap:wrap}
.pub-links a{display:inline-flex;align-items:center;justify-content:center;min-width:40px;min-height:40px;color:var(--pub-fg)!important}

/* Episode page */
.pub-crumb{font-size:13px;color:var(--pub-muted);margin-bottom:16px}
.pub-crumb a{color:var(--pub-muted);text-decoration:none}.pub-crumb a:hover{color:var(--pub-fg)}
.pub-meta{display:flex;flex-wrap:wrap;gap:8px 18px;margin:16px 0 0;font-size:14px;color:var(--pub-muted)}
.pub-meta span{display:inline-flex;align-items:center;gap:7px}.pub-meta svg{width:14px;height:14px;opacity:.8}
.pub-ep-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:48px;margin-top:32px;align-items:start}
.pub-notes p{margin:0 0 14px;font-size:16.5px;line-height:1.7;max-width:68ch}
.pub-notes ul{margin:0 0 14px;padding-left:22px;max-width:68ch;font-size:16.5px;line-height:1.7}
.pub-notes li{margin:2px 0}
.pub-notes a{overflow-wrap:anywhere}
.pub-notes>:last-child{margin-bottom:0}
.pub-notes li>p{margin:0}
.pub-notes h2,.pub-notes h3,.pub-notes h4,.pub-notes h5,.pub-notes h6{font-weight:700;letter-spacing:-0.01em;line-height:1.25;margin:1.4em 0 .5em}
.pub-notes h2{font-size:22px}.pub-notes h3{font-size:19px}.pub-notes h4,.pub-notes h5,.pub-notes h6{font-size:16.5px}
.pub-notes>:first-child{margin-top:0}
.pub-notes blockquote{margin:0 0 14px;padding:2px 0 2px 16px;border-left:3px solid var(--brand-accent);color:color-mix(in srgb,var(--pub-fg) 85%,var(--pub-muted));max-width:68ch}
.pub-notes hr{border:0;border-top:1px solid var(--pub-line);margin:22px 0}
.pub-notes img{max-width:100%;height:auto;border-radius:var(--brand-radius-card);display:block;margin:6px 0 16px}
.pub-notes pre{background:var(--pub-surface);border:1px solid var(--pub-line);border-radius:10px;padding:12px 14px;overflow-x:auto;font-size:13.5px;line-height:1.55;margin:0 0 14px}
.pub-notes code{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:.9em;background:var(--pub-surface);border-radius:5px;padding:1px 5px}
.pub-notes pre code{background:none;padding:0}
.pub-notes table{border-collapse:collapse;width:100%;max-width:100%;display:block;overflow-x:auto;margin:0 0 16px;font-size:15px}
.pub-notes th,.pub-notes td{border:1px solid var(--pub-line);padding:8px 12px;text-align:left;vertical-align:top}
.pub-notes th{background:var(--pub-surface);font-weight:600}
.pub-notes caption{caption-side:bottom;color:var(--pub-muted);font-size:13px;padding-top:6px}
.pub-notes figure{margin:0 0 16px}.pub-notes figcaption{color:var(--pub-muted);font-size:13px;margin-top:6px}
.pub-notes details{border:1px solid var(--pub-line);border-radius:10px;padding:10px 14px;margin:0 0 14px;max-width:68ch}
.pub-notes summary{cursor:pointer;font-weight:600}
.pub-notes iframe{display:block;width:100%;max-width:720px;aspect-ratio:16/9;height:auto;border:0;border-radius:var(--brand-radius-card);margin:6px 0 16px}
.pub-notes iframe[src*="open.spotify.com"]{aspect-ratio:auto;height:232px}
.pub-notes mark{background:var(--brand-tint);color:inherit;padding:0 3px;border-radius:3px}
.pub-notes.pub-lead{max-width:640px}.pub-notes.pub-lead p{font-size:inherit;margin:0 0 .7em}
.pub-ts{background:var(--brand-tint);color:var(--brand-link);border:0;border-radius:6px;padding:1px 7px;font-size:.88em;cursor:pointer}
.pub-ts:hover{filter:brightness(1.15)}
.pub-people{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.pub-person{display:flex;align-items:center;gap:12px;padding:14px 16px}
.pub-person .pub-avatar{width:40px;height:40px;font-size:13px;margin:0;border:0}
.pub-person b{display:block;letter-spacing:-0.01em}.pub-person small{color:var(--pub-muted);font-size:12.5px;text-transform:capitalize}
.pub-next{display:flex;gap:12px;align-items:center;padding:12px 0;border-top:1px solid var(--pub-line);text-decoration:none;color:var(--pub-fg)!important}
.pub-next img,.pub-next i{width:48px;height:48px;border-radius:8px;object-fit:cover;background:var(--brand-tint);flex:none}
.pub-next b{display:block;font-size:14.5px;letter-spacing:-0.01em;line-height:1.3}
.pub-next:hover b{text-decoration:underline}
.pub-side{display:flex;flex-direction:column;gap:20px}

/* Site-wide player bar + search */
.pub-sticky{position:fixed;left:0;right:0;bottom:0;z-index:30;background:color-mix(in srgb,var(--pub-surface) 94%,transparent);backdrop-filter:blur(12px);border-top:1px solid var(--pub-line);box-shadow:0 -12px 30px -18px rgba(0,0,0,.5);transition:transform .2s ease}
.pub-sticky[data-hidden=true]{transform:translateY(110%);pointer-events:none}
.pub-sticky-in{max-width:1120px;margin:0 auto;padding:10px 32px;display:flex;align-items:center;gap:10px}
.pub-sticky img,.pub-sticky i{width:44px;height:44px;border-radius:8px;object-fit:cover;flex:none;background:var(--brand-tint)}
.pub-sticky .meta{min-width:0;flex:0 1 240px;display:flex;flex-direction:column}
.pub-sticky .meta a{color:var(--pub-fg);font-weight:600;font-size:14px;letter-spacing:-0.01em;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pub-sticky .meta a:hover{text-decoration:underline}
.pub-sticky .meta small{color:var(--pub-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pub-sticky .scrub{flex:1 1 160px;min-width:80px}
.pp-play.small{width:40px;height:40px;font-size:13px}
.pub-has-player{padding-bottom:84px}
.pub-search{display:flex;gap:8px;margin:0 0 14px}
.pub-search input{flex:1;min-width:0;height:44px;border:1px solid var(--pub-line);background:var(--pub-surface);color:var(--pub-fg);border-radius:var(--brand-radius-control);padding:0 14px;font:inherit;font-size:15px}
.pub-search input::placeholder{color:var(--pub-muted)}
.pub-more{background:none;border:0;padding:0;margin-top:8px;color:var(--brand-link);font:inherit;font-size:14px;font-weight:600;cursor:pointer}
.pub-dirs{display:flex;gap:8px;flex-wrap:wrap}

.pub-share{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.pub-share button{min-height:38px;padding:0 14px;border-radius:999px;border:1px solid var(--pub-line);background:var(--pub-surface);color:var(--pub-fg);font:500 13px Geist,system-ui,sans-serif;cursor:pointer}
.pub-share button:hover{border-color:var(--pub-muted)}
.pub-hosts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.pub-profile{display:flex;gap:16px;align-items:flex-start;text-decoration:none;color:var(--pub-fg)!important}
.pub-profile:hover b{text-decoration:underline}
.pub-profile .pic{width:72px;height:72px;border-radius:50%;object-fit:cover;flex:none;background:var(--brand-tint);display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:20px;color:var(--pub-fg)}
.pub-profile b{display:block;font-size:17px;letter-spacing:-0.01em}
.pub-profile small{display:block;color:var(--pub-muted);font-size:12.5px;text-transform:capitalize;margin-top:1px}
.pub-profile p{margin:8px 0 0;font-size:14px;color:color-mix(in srgb,var(--pub-fg) 82%,var(--pub-muted));display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.pub-person-hero{display:flex;gap:32px;align-items:center;padding:48px 0 4px;flex-wrap:wrap}
.pub-person-hero .pic{width:168px;height:168px;border-radius:50%;object-fit:cover;background:var(--brand-tint);display:inline-flex;align-items:center;justify-content:center;font-size:48px;font-weight:700;flex:none;box-shadow:0 20px 40px -22px rgba(0,0,0,.5)}
.pub-pn{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:40px}
.pub-pn a{display:block;border:1px solid var(--pub-line);background:var(--pub-surface);border-radius:var(--brand-radius-card);padding:14px 16px;text-decoration:none;color:var(--pub-fg)!important}
.pub-pn a:hover{border-color:var(--pub-muted)}
.pub-pn small{display:block;color:var(--pub-muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px}
.pub-pn b{letter-spacing:-0.01em;line-height:1.3}
.pub-pn .r{text-align:right}

/* Audio player */
.pp{margin-top:16px}
.pp-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pp-play{width:52px;height:52px;border-radius:50%;border:0;background:var(--brand-accent);color:var(--brand-on-accent);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none;font-size:16px}
.pp-play:hover{filter:brightness(1.08)}
.pp-btn{height:34px;min-width:34px;padding:0 10px;border-radius:999px;border:1px solid var(--pub-line);background:transparent;color:var(--pub-fg);font:500 12px "JetBrains Mono",monospace;cursor:pointer}
.pp-btn:hover{border-color:var(--pub-muted)}
.pp-scrub{flex:1 1 220px;min-width:140px}
.pp-time{font-size:12.5px;color:var(--pub-muted);white-space:nowrap}
.pp-range{-webkit-appearance:none;appearance:none;width:100%;height:24px;background:transparent;cursor:pointer;margin:0;display:block}
.pp-range::-webkit-slider-runnable-track{height:5px;border-radius:3px;background:linear-gradient(to right,var(--brand-accent) var(--p,0%),var(--pub-line) var(--p,0%))}
.pp-range::-moz-range-track{height:5px;border-radius:3px;background:linear-gradient(to right,var(--brand-accent) var(--p,0%),var(--pub-line) var(--p,0%))}
.pp-range::-webkit-slider-thumb{-webkit-appearance:none;width:15px;height:15px;border-radius:50%;background:var(--brand-accent);border:2px solid var(--pub-bg);margin-top:-5px}
.pp-range::-moz-range-thumb{width:11px;height:11px;border-radius:50%;background:var(--brand-accent);border:2px solid var(--pub-bg)}
.pp-msg{font-size:13px;color:var(--pub-muted);margin-top:8px}

@media (max-width:860px){
  .pub-ep-grid{grid-template-columns:minmax(0,1fr)}
  .pub-pn{grid-template-columns:minmax(0,1fr)}
}
@media (max-width:700px){
  .pub-wrap{padding:0 20px}
  .pub-hero{grid-template-columns:1fr;gap:24px;padding-top:32px}
  .pub-hero .pub-art{width:min(100%,220px)}
  .pub-latest{grid-template-columns:72px minmax(0,1fr);gap:14px}
  .pub-latest h3{font-size:21px}
  .pub-ep{grid-template-columns:40px minmax(0,1fr);gap:12px}
  .pub-ep .go{width:40px;height:40px}
  .pub-ep .ti{font-size:16.5px}
  .pub-sticky-in{padding:8px 14px;flex-wrap:wrap;gap:8px}
  .pub-sticky .meta{flex:1 1 120px}
  .pub-sticky .scrub{order:9;flex:1 1 100%}
  .pub-sticky .tm{display:none}
  .pub-sticky .pp-btn:not(.x):not([aria-label^=Playback]){display:none}
  .pub-nav a:not(.pub-nav-cta){display:none}
  .pub-section{margin-top:48px}
}
@media (prefers-reduced-motion:no-preference){.pub-ep,.pub-pill,.pub-btn{transition:background .15s,border-color .15s,filter .15s}}
`;
}

export function SocialLinks({ links, labelled = false }: { links: { platform: string; value: string }[]; labelled?: boolean }) {
  if (links.length === 0) return null;
  return (
    <div className={labelled ? "pub-follow" : "pub-links"} style={labelled ? { marginTop: 0 } : undefined}>
      {links.map((l) => {
        const icon = PLATFORM_ICONS[l.platform as Platform];
        if (!icon) return null;
        const label = PLATFORM_LABELS[l.platform as Platform];
        return labelled ? (
          <a key={l.platform} className="pub-pill" href={l.value} target="_blank" rel="me noopener">
            <FontAwesomeIcon icon={icon} />
            {label}
          </a>
        ) : (
          <a key={l.platform} href={l.value} target="_blank" rel="me noopener" aria-label={label} title={label}>
            <FontAwesomeIcon icon={icon} className="h-5 w-5" />
          </a>
        );
      })}
    </div>
  );
}

type LayoutShow = {
  slug: string;
  title: string;
  brand: BrandTheme;
  feedUrl: string | null;
  fundingUrl: string | null;
  artworkUrl?: string | null;
};

export function PublicChrome({
  show,
  links,
  children,
}: {
  show: LayoutShow;
  links: { platform: string; value: string }[];
  children: React.ReactNode;
}) {
  // With the Public-site scope off, fall back to the stock paper theme.
  const brand: BrandTheme = show.brand.scopes.publicSite
    ? show.brand
    : { ...DEFAULT_BRAND_THEME, appearance: "light" };
  const player = usePlayer();
  return (
    <div className={`pub${player.current ? " pub-has-player" : ""}`} data-appearance={brand.appearance}>
      <style dangerouslySetInnerHTML={{ __html: publicCss(brand) }} />
      <header className="pub-header">
        <div className="pub-wrap">
          <Link to={`/${show.slug}`} className="pub-brand">
            {show.artworkUrl ? <img src={show.artworkUrl} alt="" width={30} height={30} /> : <i aria-hidden />}
            <span>{show.title}</span>
          </Link>
          <nav className="pub-nav" aria-label="Main">
            <a href={`/${show.slug}#episodes`}>Episodes</a>
            <a href={`/${show.slug}#about`}>About</a>
            {show.fundingUrl && <a href={`/${show.slug}#support`}>Support</a>}
            <a className="pub-nav-cta" href={`/${show.slug}#follow`}>
              Follow
            </a>
          </nav>
        </div>
      </header>
      {children}
      <footer className="pub-footer">
        <div className="pub-wrap">
          <span>
            © {new Date().getFullYear()} {show.title}
          </span>
          <a href={`/${show.slug}/feed`}>
            <FontAwesomeIcon icon={faRss} style={{ width: 11, marginRight: 6 }} />
            RSS feed
          </a>
          <span style={{ flex: 1 }} />
          <SocialLinks links={links} />
          <span>Hosted with Podstudio</span>
        </div>
      </footer>
    </div>
  );
}

export function formatDuration(s: number | null) {
  if (!s) return "";
  if (s < 60) return `${s} sec`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} hr ${m} min` : `${m} min`;
}

/** m:ss / h:mm:ss for list columns and the player. */
export function formatClock(s: number | null | undefined) {
  if (s == null) return "";
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const x = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
}

export function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}
