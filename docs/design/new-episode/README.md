# New episode dialog mockup

Interactive design preview, 2026-10-02. Open `index.html` locally; no server, account, or API is needed. It does not create episodes.

- Replaces the browser `prompt()` used by the library’s **New episode** action.
- One title field with help and inline validation, then **Cancel** and **Create episode**.
- Only the X is visible in the upper-right. It retains the accessible name “Close”. X, Escape, or clicking the backdrop dismisses the dialog.
- Desktop: centered 520 px dialog. Phone: bottom sheet.
- Dark/lime and light/indigo themes use the current app tokens. Close the dialog to use the preview theme controls.
- Creation displays a simulated loading state and a preview result. Production should POST `/api/episodes` then open `/episodes/:id/script`, show real API errors, and prevent duplicate submissions.

## Components and credits

Built with the project’s locally adapted shadcn-svelte Dialog, Input, Button and Spinner; the official Nova Field, Label and Separator source from the [shadcn-svelte registry](https://www.shadcn-svelte.com/docs/components/field); and the existing More Shadcn Svelte-derived Status Dot. These are MIT licensed. See the adjacent LICENSE.md and the app’s `public/vendor/` notices.

`NewEpisodeMockup.svelte.txt` records the layout and interaction design. It imports temporary Field copies through `@mock`; production integration should install these into `src/components/shadcn/field` and use the project aliases. The HTML is a bundled, standalone review artifact, not a production route.

Reviewed desktop light/dark and phone screenshots. Checked empty-title validation, simulated creation, X, Escape and backdrop dismissal. Production integration and browser-prompt replacement remain next work.
