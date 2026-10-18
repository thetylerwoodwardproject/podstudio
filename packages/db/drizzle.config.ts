import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./src/migrations",
  dbCredentials: {
    url: process.env.PODSTUDIO_DB_PATH ?? "/data/podstudio.db",
  },
});
