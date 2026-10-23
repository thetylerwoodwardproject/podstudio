// Registry of the 36 mockup screens (ids match `docs/design/Podstudio v2.dc.html`
// badges and `docs/design/README.md`). Tonight's shell gives every screen a route
// so navigation never 404s; only `real: true` screens render actual data — the
// rest render the shared placeholder. See docs/design/stages/STAGE-00.md.
export type ScreenArea =
  | "studio" // authenticated studio app, behind /studio
  | "guest" // no-account guest join flow (paper theme)
  | "mobile" // deferred Stage 12 PWA, paper theme
  | "public"; // hosted public/listener-facing pages

export type ScreenSection =
  | "Account & episodes"
  | "Record"
  | "Edit"
  | "Publish & share"
  | "Podcast hosting"
  | "Public page & embeds"
  | "Analytics & discovery"
  | "Server"
  | "Mobile host app";

export interface ScreenDef {
  id: string; // mockup badge id, e.g. "02", "13b"
  label: string;
  path: string; // app route path
  area: ScreenArea;
  section: ScreenSection;
  inSidebar: boolean; // show in the studio sidebar nav
  real: boolean; // true = built with live data tonight; false = placeholder
  note?: string;
}

export const SCREENS: ScreenDef[] = [
  // Account & episodes
  { id: "01", label: "Sign in", path: "/login", area: "studio", section: "Account & episodes", inSidebar: false, real: false },
  { id: "02", label: "Episodes", path: "/studio/episodes", area: "studio", section: "Account & episodes", inSidebar: true, real: true },

  // Record
  { id: "03", label: "Remote session", path: "/studio/record/remote-session", area: "studio", section: "Record", inSidebar: false, real: false },
  { id: "04", label: "Guest join", path: "/guest/join", area: "guest", section: "Record", inSidebar: false, real: false },
  { id: "05", label: "Guest phone", path: "/guest/phone", area: "guest", section: "Record", inSidebar: false, real: false },
  { id: "06", label: "Recording with a guest + show prep", path: "/studio/record", area: "studio", section: "Record", inSidebar: true, real: false },
  { id: "07", label: "Solo prompter", path: "/studio/record/solo", area: "studio", section: "Record", inSidebar: false, real: false },

  // Edit
  { id: "08", label: "Editor", path: "/studio/editor", area: "studio", section: "Edit", inSidebar: true, real: false },
  { id: "09", label: "Retake cleanup", path: "/studio/editor/retakes", area: "studio", section: "Edit", inSidebar: false, real: false },
  { id: "10", label: "Transcript", path: "/studio/editor/transcript", area: "studio", section: "Edit", inSidebar: false, real: false },
  { id: "11", label: "Episode details", path: "/studio/episodes/:id", area: "studio", section: "Edit", inSidebar: false, real: true },
  { id: "12", label: "Export", path: "/studio/export", area: "studio", section: "Edit", inSidebar: false, real: false },

  // Publish & share
  { id: "13", label: "Clips", path: "/studio/clips", area: "studio", section: "Publish & share", inSidebar: true, real: false },
  { id: "13b", label: "Short video style", path: "/studio/clips/style", area: "studio", section: "Publish & share", inSidebar: false, real: false },
  { id: "14", label: "Publish to feed", path: "/studio/publish", area: "studio", section: "Publish & share", inSidebar: false, real: false },

  // Podcast hosting
  { id: "15", label: "Feed overview", path: "/studio/feed", area: "studio", section: "Podcast hosting", inSidebar: true, real: true, note: "Episode counts + recent-episodes table are real; downloads/listeners need OP3 (Stage 11), deferred honestly rather than faked" },
  { id: "16", label: "Show tags", path: "/studio/feed/tags", area: "studio", section: "Podcast hosting", inSidebar: false, real: true },
  { id: "16b", label: "Lock & verify", path: "/studio/feed/lock-verify", area: "studio", section: "Podcast hosting", inSidebar: false, real: true, note: "TXT records real; unlock deferred until email delivery is chosen" },
  { id: "17", label: "Storage", path: "/studio/storage", area: "studio", section: "Podcast hosting", inSidebar: true, real: true, note: "Target config, test-connection and routing are real; nothing uploads to them yet (Stage 02)" },
  { id: "17b", label: "Move podcast", path: "/studio/storage/move", area: "studio", section: "Podcast hosting", inSidebar: false, real: false },

  // Public page & embeds (admin config lives in studio; the pages themselves are public)
  { id: "27", label: "Embed players", path: "/studio/public/embeds", area: "studio", section: "Public page & embeds", inSidebar: true, real: true, note: "Config form + the three code tabs are real (stored under shows.settings.embed); live preview and working embed URLs deferred (need screen 28 player, /embed route, embed.js, /oembed)" },
  { id: "28", label: "Player themes", path: "/studio/public/embeds/themes", area: "studio", section: "Public page & embeds", inSidebar: false, real: false },
  { id: "29", label: "Public page links", path: "/studio/public/links", area: "studio", section: "Public page & embeds", inSidebar: true, real: true, note: "Social links CRUD + reordering (plain up/down, not dnd-kit) are real; website is read-only here (edit in 16); live preview deferred (needs public page 25, not built)" },
  { id: "29b", label: "Brand & theme", path: "/studio/public/brand", area: "studio", section: "Public page & embeds", inSidebar: false, real: false },
  { id: "25", label: "Public show page", path: "/public/show", area: "public", section: "Public page & embeds", inSidebar: false, real: false },
  { id: "26", label: "Episode page on a phone", path: "/public/episode-phone", area: "public", section: "Public page & embeds", inSidebar: false, real: false },
  { id: "30", label: "Public episode page", path: "/public/episode", area: "public", section: "Public page & embeds", inSidebar: false, real: false },

  // Analytics & discovery
  { id: "31", label: "Analytics", path: "/studio/analytics", area: "studio", section: "Analytics & discovery", inSidebar: true, real: false },
  { id: "32", label: "Podroll", path: "/studio/podroll", area: "studio", section: "Analytics & discovery", inSidebar: false, real: false },

  // Server
  { id: "18", label: "Server settings", path: "/studio/settings/server", area: "studio", section: "Server", inSidebar: true, real: true, note: "Users (add/role/remove) are real; domain is read-only facts, not a status badge; AI keys/LiveKit deferred (no stage reached)" },

  // Mobile host app (deferred — Stage 12)
  { id: "19", label: "Mobile home", path: "/mobile/home", area: "mobile", section: "Mobile host app", inSidebar: false, real: false, note: "Deferred to Stage 12" },
  { id: "20", label: "Choose your mic", path: "/mobile/mic", area: "mobile", section: "Mobile host app", inSidebar: false, real: false, note: "Deferred to Stage 12" },
  { id: "21", label: "Solo recording", path: "/mobile/record", area: "mobile", section: "Mobile host app", inSidebar: false, real: false, note: "Deferred to Stage 12" },
  { id: "22", label: "Invite a guest", path: "/mobile/invite", area: "mobile", section: "Mobile host app", inSidebar: false, real: false, note: "Deferred to Stage 12" },
  { id: "23", label: "Recording with a guest", path: "/mobile/guest-record", area: "mobile", section: "Mobile host app", inSidebar: false, real: false, note: "Deferred to Stage 12" },
  { id: "24", label: "Saved", path: "/mobile/saved", area: "mobile", section: "Mobile host app", inSidebar: false, real: false, note: "Deferred to Stage 12" },
];

export const SIDEBAR_SECTIONS: ScreenSection[] = [
  "Account & episodes",
  "Record",
  "Edit",
  "Publish & share",
  "Podcast hosting",
  "Public page & embeds",
  "Analytics & discovery",
  "Server",
];

export function sidebarScreens() {
  return SIDEBAR_SECTIONS.map((section) => ({
    section,
    screens: SCREENS.filter((s) => s.section === section && s.inSidebar),
  })).filter((g) => g.screens.length > 0);
}

export function screenByPath(path: string) {
  return SCREENS.find((s) => s.path === path);
}
