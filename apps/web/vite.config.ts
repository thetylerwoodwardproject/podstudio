import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  ssr: {
    // better-sqlite3 ships a native .node binding, located at runtime via the
    // `bindings` package's __filename-based lookup. Vite's SSR bundler treats
    // @podstudio/db as app source (it's a workspace package, not node_modules)
    // and was inlining both into build/server/index.js — which Node then loads
    // as ESM (per this app's "type": "module"), where __filename doesn't exist.
    // Keep both external so they're requirable at their real on-disk paths.
    external: ["better-sqlite3", "bindings"],
  },
});
