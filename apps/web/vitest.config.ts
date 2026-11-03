import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests for the pure libs under app/lib and server-rendered components (no DB, no browser). Separate from
// vite.config.ts so the React Router plugin isn't loaded under test.
export default defineConfig({
  resolve: { alias: { "~": path.resolve(import.meta.dirname, "app"), "@": path.resolve(import.meta.dirname, "app") } },
  test: { include: ["app/**/*.test.ts", "app/**/*.test.tsx"] },
});
