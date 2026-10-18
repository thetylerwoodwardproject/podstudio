import { type RouteConfig, route, index } from "@react-router/dev/routes";
import { SCREENS } from "./lib/screens";

// Every screen id gets a route (Stage-00: "all 36 screen ids have placeholder
// routes"). Screen 02 (Episodes) is the only one built with real data tonight;
// everything else renders the shared placeholder from routes/screen-placeholder.tsx.
const PLACEHOLDER = "routes/screen-placeholder.tsx";

function stripPrefix(path: string, prefix: string) {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

const studioScreens = SCREENS.filter(
  (s) => s.area === "studio" && s.id !== "02" && s.id !== "01",
);
const guestScreens = SCREENS.filter((s) => s.area === "guest");
const mobileScreens = SCREENS.filter((s) => s.area === "mobile");
const publicScreens = SCREENS.filter((s) => s.area === "public");

export default [
  index("routes/root-redirect.tsx"),

  route("studio", "routes/studio/_layout.tsx", [
    route("episodes", "routes/studio/episodes.tsx"),
    ...studioScreens.map((s) =>
      route(stripPrefix(s.path, "/studio/"), PLACEHOLDER, { id: `screen-${s.id}` }),
    ),
  ]),

  route("login", PLACEHOLDER, { id: "screen-01" }),
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
