# UI and website handoff · 2026-10-02

Read this alongside [the main handoff](../handoff.md), `CLAUDE.md`, and
[UI standards](../ui-framework.md). This handoff distinguishes shipped app
functionality, a design preview, and website changes awaiting server deployment.

## App baseline

The app baseline is `9cab78a` (`Add live master loudness and resilient editor
playback`), published to `main` and `feat/ui-build` before this website pass.

- The desktop editor has synchronized tracks, non-destructive edits,
  direct clip movement, range selection, same-track crossfades, track
  removal/restoration, and contextual editing. Source recordings are retained.
- Track meters show processed sample-peak dBFS. The master display switches
  between L/R peak levels and short-term, integrated, and range loudness from
  played audio. These live values are not a full-program export measurement.
- Simple FX uses Clean, Shape and Boost; Advanced exposes vertical ten-band
  EQ and compressor controls. Existing advanced settings retain their sound.
- Editor playback now handles gain changes while preparing audio; the local
  regression covers the reported +10 dB adjustment. Confirm this with the
  user's recording on the VPS before claiming that deployment is resolved.
- Top-right Sonner notifications report real persistence in the editor and
  Settings. Successful save feedback disappears after 2.5 seconds.
- Theme selection is in Settings → General, separate from the prompter's
  reading theme. Mobile remains recording/review/download only, without pads.

## New episode overlay mockup

The user requested a mockup replacing the library's browser-native prompt.
The production action is **New episode**; no new podcast/show model is introduced.

[Open the standalone interactive preview](../design/new-episode/index.html).
[Dark screenshot](../design/new-episode/new-episode-dark.png),
[light screenshot](../design/new-episode/new-episode-light.png), and
[phone screenshot](../design/new-episode/new-episode-phone.png) are included.

- Uses the actual local shadcn Dialog, Input, Button and Spinner plus official
  shadcn-svelte Field, Label and Separator source; MIT attribution is included.
- One title field, help text, inline validation, and Cancel/Create episode actions.
- The upper-right dismissal control shows **only X**, with an accessible Close
  name. Escape and clicking outside also dismiss it.
- Centered 520 px desktop dialog; full-width phone bottom sheet, with corrected
  translation offsets so it stays inside the viewport.
- Creation is simulated. The artifact makes no API calls and saves no data.

The production browser prompt in `src/pages/index.astro` is **not replaced yet**.
Next integration: install the Field components under the normal project alias,
mount the dialog at the existing New episode action, preserve `data-*` hooks,
POST `/api/episodes`, then navigate to `/episodes/:id/script`. Use actual request
pending/error states, prevent duplicate submission, and return focus on dismissal.
Add browser coverage for API failure/retry and successful navigation. No database
or API change is needed.

## Public website refresh

`site/public/` now matches the current Pi-Tuner-inspired shell: black and zinc
surfaces, white primary actions, muted text and the red recording accent. The
homepage describes the editor, sidebar rail, mixer, live dBFS/LUFS output,
current export options, desktop pads and mobile recording/review. It keeps the
in-development and VPS-testing status visible.

New editor, loudness, desktop recording and phone screenshots were captured
from the actual current app with disposable demo data. They contain no private
recordings. The old indigo screenshots remain in the repository only for
historical references and are not used by the landing page.
The social card and favicon match the palette. See [site documentation](../../site/README.md).

Website deployment is separate from the application installer. After this branch
has reached `main`, run on the website VPS:

```sh
cd ~/podstudio
git pull --ff-only origin main
sudo ./site/deploy.sh
```

The script installs static files into `/var/www/podstudio.dev` and reloads Caddy.
It does not rebuild the app. This development session has not run that command
on the VPS; a pushed commit alone is not evidence of live website deployment.

## Verification and remaining work

The mockup was checked in desktop light/dark and phone Chrome viewports for
validation, simulated creation, X, Escape, backdrop dismissal, and viewport fit.
The website was reviewed at 1440 px and 390 px, including image loading,
horizontal overflow, FAQ disclosure, and the 1200 × 630 social card.

Delivery checks: 281 unit/server tests pass, Astro reports zero errors and
warnings, Svelte reports zero errors with seven existing warnings, and the
build passes. All 20 browser flows passed across the initial run and a resumed
remaining-flow run after a session interruption. A pad-test race was corrected
by awaiting Sonner's rendered save toast, then the pad flow passed on rerun.
No audio engine or production app behavior is changed by this pass.

Keep these open:

1. Verify the original four-minute, approximately 12 MB MP3 on the updated VPS.
   It uploaded on retry but repeatedly stalled during playback. Do not close
   the earlier 502 or playback bug based only on local tests.
2. Verify the +10 dB preparation fix against the user's VPS session.
3. Integrate the new-episode overlay into the library after design review.
4. Continue the [phased shadcn migration](../shadcn-component-migration.md),
   preserving accessible names, keyboard controls, data hooks and persistence.
5. Review real iOS Safari and Android Chrome behavior. Emulated phone
   screenshots do not replace real-device tests.

Use a feature branch and Tyler Woodward's configured author identity. Run all
five required checks, push the branch, then fast-forward and push `feat/ui-build`
and `main`. Do not include the unrelated local duplicate `MasterLevelMeter 2.svelte`.
