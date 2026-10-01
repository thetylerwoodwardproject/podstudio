# Podstudio

A self-hosted teleprompter and podcast recorder: Astro + Tailwind in the
browser, one Node process (`server/`) with SQLite behind Caddy. See README.md.

## UI

Follow [docs/ui-framework.md](docs/ui-framework.md) on every screen: past,
present and future. Use its tokens and the
[component-choice map](docs/ui-framework.md#component-choice-during-the-migration):
locally adapted shadcn components in interactive Svelte panels, and matching
server-rendered controls in plain Astro pages. Avoid one-off styles; use
sentence case, units in mono, a real minus sign (−). When a screen changes,
check it against the framework and take a screenshot.

## Working here

- `npm test` runs the unit and server tests; `npx astro check`,
  `npx svelte-check` and `npm run build` must pass.
- Node 22.18+ (TypeScript runs directly).
- Database changes are new numbered migrations in `server/migrations.ts`;
  never edit a released one (see docs/roadmap.md, lab environment: upgrades
  must work from every released version).
- Future work that's designed but not built goes in `docs/roadmap.md`.
