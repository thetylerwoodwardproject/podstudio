import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests for the pure libs under app/lib (no DB, no React). Separate from
// vite.config.ts so the React Router plugin isn't loaded under test.
export default defineConfig({
  resolve: { alias: { "~": path.resolve(import.meta.dirname, "app") } },
  test: { include: ["app/**/*.test.ts"] },
});
