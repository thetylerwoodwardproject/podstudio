import { type RouteConfig, route, index } from "@react-router/dev/routes";
import { SCREENS } from "./lib/screens";

// Every screen id gets a route (Stage-00: "all 36 screen ids have placeholder
// routes"). Screens with real: true in the registry have their own route file;
// everything else renders the shared placeholder from routes/screen-placeholder.tsx.
const PLACEHOLDER = "routes/screen-placeholder.tsx";
const REAL_SCREEN_IDS = ["01", "02", "11", "16", "16b", "17"]; // handled explicitly below, not generated

function stripPrefix(path: string, prefix: string) {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

const studioScreens = SCREENS.filter(
  (s) => s.area === "studio" && !REAL_SCREEN_IDS.includes(s.id),
);
const guestScreens = SCREENS.filter((s) => s.area === "guest");
const mobileScreens = SCREENS.filter((s) => s.area === "mobile");
const publicScreens = SCREENS.filter((s) => s.area === "public");

export default [
  index("routes/root-redirect.tsx"),

  route("studio", "routes/studio/_layout.tsx", [
    route("episodes", "routes/studio/episodes.tsx"),
    route("episodes/:id", "routes/studio/episode-detail.tsx", { id: "screen-11" }),
    route("feed/tags", "routes/studio/show-tags.tsx", { id: "screen-16" }),
    route("feed/lock-verify", "routes/studio/lock-verify.tsx", { id: "screen-16b" }),
    route("storage", "routes/studio/storage.tsx", { id: "screen-17" }),
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
] satisfies RouteConfig;
