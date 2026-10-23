import { Link } from "react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { PLATFORM_ICONS, PLATFORM_LABELS, type Platform } from "~/lib/platforms";
import { brandVars, DEFAULT_BRAND_THEME, type BrandTheme } from "~/lib/brand-theme";

// Shared chrome for the public (listener-facing) pages. Paper theme by
// default; Brand & theme (29b) is applied only when its "Public site" scope
// is on. Everything user-supplied reaches the DOM as React text/attributes;
// the <style> block interpolates only validated hex colours and numbers from
// `brandVars`. No cookies, no third-party scripts (README: "Public pages and
// players: no cookies or third-party trackers").
const LIGHT = { bg: "#ffffff", fg: "#1b1a18", muted: "#6b6963", line: "#e3dfd6" };
const DARK = { bg: "#151517", fg: "#ecebe6", muted: "#8f8e88", line: "#26262b" };

function vars(v: Record<string, string>, base: typeof LIGHT) {
  return (
    `--pub-bg:${base.bg};--pub-fg:${base.fg};--pub-muted:${base.muted};--pub-line:${base.line};` +
    Object.entries(v).map(([k, val]) => `${k}:${val};`).join("")
  );
}

export function publicCss(brand: BrandTheme) {
  const light = vars(brandVars(brand, "light"), LIGHT);
  const dark = vars(brandVars(brand, "dark"), DARK);
  return `
.pub{${light}background:var(--pub-bg);color:var(--pub-fg);min-height:100vh;font-family:Geist,system-ui,sans-serif;line-height:1.55}
.pub[data-appearance=dark]{${dark}}
@media (prefers-color-scheme:dark){.pub[data-appearance=auto]{${dark}}}
.pub a{color:var(--brand-link)}
.pub-wrap{max-width:880px;margin:0 auto;padding:0 20px}
.pub-header{border-bottom:1px solid var(--pub-line)}
.pub-header .pub-wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:56px;flex-wrap:wrap}
.pub-nav{display:flex;gap:4px;flex-wrap:wrap}
.pub-nav a{color:var(--pub-fg);text-decoration:none;padding:12px;min-height:44px;display:inline-flex;align-items:center;font-size:14px}
.pub-brand{font-weight:600;color:var(--pub-fg)!important;text-decoration:none}
.pub-btn{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;background:var(--brand-accent);color:var(--brand-on-accent)!important;border-radius:var(--brand-radius-control);text-decoration:none;font-weight:500;font-size:14px}
.pub-btn-ghost{background:transparent;color:var(--pub-fg)!important;border:1px solid var(--pub-line)}
.pub-card{border:1px solid var(--pub-line);border-radius:var(--brand-radius-card);padding:20px}
.pub-tint{background:var(--brand-tint);border-radius:var(--brand-radius-card);padding:16px 20px}
.pub-muted{color:var(--pub-muted)}
.pub-row{display:flex;gap:16px;align-items:baseline;padding:14px 0;border-top:1px solid var(--pub-line)}
.pub-row a.t{color:var(--pub-fg);text-decoration:none;font-weight:500}
.pub-row a.t:hover{text-decoration:underline}
.pub-badge{font-size:11px;border:1px solid var(--pub-line);border-radius:999px;padding:1px 8px;color:var(--pub-muted)}
.pub-footer{border-top:1px solid var(--pub-line);margin-top:48px;padding:24px 0}
.pub h1{font-size:32px;line-height:1.15;letter-spacing:-0.02em;margin:0}
.pub h2{font-size:18px;margin:0 0 12px}
.pub-links{display:flex;gap:4px;flex-wrap:wrap}
.pub-links a{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;color:var(--pub-fg)}
@media (max-width:600px){.pub h1{font-size:26px}.pub-row{flex-wrap:wrap;gap:4px 12px}}
`;
}

export function SocialLinks({ links }: { links: { platform: string; value: string }[] }) {
  if (links.length === 0) return null;
  return (
    <div className="pub-links">
      {links.map((l) => {
        const icon = PLATFORM_ICONS[l.platform as Platform];
        if (!icon) return null;
        const label = PLATFORM_LABELS[l.platform as Platform];
        return (
          <a key={l.platform} href={l.value} target="_blank" rel="me noopener" aria-label={label} title={label}>
            <FontAwesomeIcon icon={icon} className="h-5 w-5" />
          </a>
        );
      })}
    </div>
  );
}

export function PublicLayout({
  show,
  links,
  children,
}: {
  show: { slug: string; title: string; brand: BrandTheme; feedUrl: string | null; fundingUrl: string | null };
  links: { platform: string; value: string }[];
  children: React.ReactNode;
}) {
  // With the Public-site scope off, fall back to the stock paper theme.
  const brand: BrandTheme = show.brand.scopes.publicSite
    ? show.brand
    : { ...DEFAULT_BRAND_THEME, appearance: "light" };
  return (
    <div className="pub" data-appearance={brand.appearance}>
      <style dangerouslySetInnerHTML={{ __html: publicCss(brand) }} />
      <header className="pub-header">
        <div className="pub-wrap">
          <Link to={`/${show.slug}`} className="pub-brand">
            {show.title}
          </Link>
          <nav className="pub-nav" aria-label="Main">
            <a href={`/${show.slug}#episodes`}>Episodes</a>
            <a href={`/${show.slug}#about`}>About</a>
            {show.fundingUrl && <a href={`/${show.slug}#support`}>Support</a>}
          </nav>
        </div>
      </header>
      {children}
      <footer className="pub-footer">
        <div className="pub-wrap" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <span className="pub-muted" style={{ fontSize: 13 }}>
            {show.title}
          </span>
          <SocialLinks links={links} />
        </div>
      </footer>
    </div>
  );
}

export function formatDuration(s: number | null) {
  if (!s) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} hr ${m} min` : `${m} min`;
}

export function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
