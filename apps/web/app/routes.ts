import { type RouteConfig, route, index } from "@react-router/dev/routes";
import { SCREENS } from "./lib/screens";

// Every screen id gets a route (Stage-00: "all 36 screen ids have placeholder
// routes"). Screens with real: true in the registry have their own route file;
// everything else renders the shared placeholder from routes/screen-placeholder.tsx.
const PLACEHOLDER = "routes/screen-placeholder.tsx";
const REAL_SCREEN_IDS = ["01", "02", "11", "15", "16", "16b", "17", "18", "27", "29", "29b", "14", "31", "32"]; // handled explicitly below, not generated

function stripPrefix(path: string, prefix: string) {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

const studioScreens = SCREENS.filter(
  (s) => s.area === "studio" && !REAL_SCREEN_IDS.includes(s.id),
);
const guestScreens = SCREENS.filter((s) => s.area === "guest");
const mobileScreens = SCREENS.filter((s) => s.area === "mobile");
const publicScreens = SCREENS.filter((s) => s.area === "public" && !s.real);

export default [
  index("routes/root-redirect.tsx"),

  route("studio", "routes/studio/_layout.tsx", [
    route("episodes", "routes/studio/episodes.tsx"),
    route("episodes/:id", "routes/studio/episode-detail.tsx", { id: "screen-11" }),
    route("episodes/:id/audio", "routes/studio/episode-audio.ts"),
    route("feed", "routes/studio/feed-overview.tsx", { id: "screen-15" }),
    route("feed/tags", "routes/studio/show-tags.tsx", { id: "screen-16" }),
    route("feed/artwork", "routes/studio/show-artwork.ts"),
    route("feed/lock-verify", "routes/studio/lock-verify.tsx", { id: "screen-16b" }),
    route("storage", "routes/studio/storage.tsx", { id: "screen-17" }),
    route("settings/server", "routes/studio/server-settings.tsx", { id: "screen-18" }),
    route("public/embeds", "routes/studio/embeds.tsx", { id: "screen-27" }),
    route("publish", "routes/studio/publish.tsx", { id: "screen-14" }),
    route("podroll", "routes/studio/podroll.tsx", { id: "screen-32" }),
    route("analytics", "routes/studio/analytics.tsx", { id: "screen-31" }),
    route("public/brand", "routes/studio/brand.tsx", { id: "screen-29b" }),
    route("public/links", "routes/studio/public-links.tsx", { id: "screen-29" }),
    ...studioScreens.map((s) =>
      route(stripPrefix(s.path, "/studio/"), PLACEHOLDER, { id: `screen-${s.id}` }),
    ),
  ]),

  route("api/auth/*", "routes/api.auth.$.ts"),

  route("login", "routes/login.tsx", { id: "screen-01" }),
  ...guestScreens.map((s) =>
    route(stripPrefix(s.path, "/"), PLACEHOLDER, { id: `screen-${s.id}` }),
  ),
  ...mobileScreens.map((s) =>
    route(stripPrefix(s.path, "/"), PLACEHOLDER, { id: `screen-${s.id}` }),
  ),
  ...publicScreens.map((s) =>
    route(stripPrefix(s.path, "/"), PLACEHOLDER, { id: `screen-${s.id}` }),
  ),

  // Real public pages. Dynamic `:showSlug` ranks below every static route above
  // (studio, login, guest/*, mobile/*, public/*, api/*), so it can't shadow them.
  route("embed.js", "routes/embed-js.ts"),
  route("oembed", "routes/oembed.ts"),
  route(":showSlug/embed/:target", "routes/embed.ts"),
  route(":showSlug/feed", "routes/feed.ts"),
  route(":showSlug/media/:publicId/:file?", "routes/media.ts"),
  route(":showSlug/artwork/:file", "routes/artwork.ts"),
  route(":showSlug", "routes/public/show.tsx", { id: "screen-25" }),
  route(":showSlug/episodes/:publicId/:slug?", "routes/public/episode.tsx", { id: "screen-30" }),
] satisfies RouteConfig;
