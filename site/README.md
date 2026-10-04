# podstudio.dev

The public project page for Podstudio: plain HTML and CSS in `public/`, no build
step. It follows the Podstudio UI framework (`../docs/ui-framework.md`).

| | |
|---|---|
| `public/index.html` | the page |
| `public/style.css` | its styles (the framework's tokens) |
| `public/404.html` | not found |
| `public/og.png` | the image shown when the link is shared (1200×630) |
| `public/images/` | current app screenshots (see below) |
| `podstudio.dev.caddy` | its Caddy site |
| `deploy.sh` | puts it on the server |

## Preview

```sh
caddy file-server --root site/public --listen 127.0.0.1:8088
# or: npx serve site/public
```

## Deploy

On the same VPS as Podstudio, after Podstudio's installer has set up Caddy:

1. **DNS:** A records for `podstudio.dev` and `www.podstudio.dev` pointing at
   the server.
2. **Deploy:**

   ```sh
   cd ~/podstudio && git pull --ff-only origin main
   sudo ./site/deploy.sh
   ```

It copies `public/` to `/var/www/podstudio.dev` and writes
`/etc/caddy/sites/podstudio.dev.caddy`. Caddy then gets the certificates and
redirects `www.podstudio.dev` to `podstudio.dev`. Run it again after changing
the page. `--no-www` skips the redirect; `--domain` serves another domain.

Caddy serves Podstudio and this page side by side:

- `/etc/caddy/Caddyfile` holds only the global options and
  `import /etc/caddy/sites/*.caddy`;
- each site has its own file in that folder (`deploy/caddy-sites.sh`).

Deploying one never overwrites the other.

If Podstudio was installed with `--proxy nginx`, Caddy can't share ports 80
and 443, and the script stops. Serve `site/public` from Nginx instead.

## Visual refresh · 2026-10-04

The site follows the current Pi-Tuner-inspired app shell: black page and panel
surfaces, zinc dividers, white primary actions, and red reserved for recording
and destructive states. The homepage describes the current desktop editor,
sidebar navigation, mixer, live dBFS/LUFS metering, mobile review and episode
preparation. It still labels the product as in development.

The screenshot set was refreshed together to reflect the current local app
build, using a disposable test account and demo audio for the desktop captures,
never private recordings. Every published image now uses the same Pi-Tuner-
inspired black shell, zinc borders, white primary actions, indigo selections
and signal-color tracks:

- `public/images/editor-current.png`: current dark editor with the compact rail,
  synchronized timeline, track meter and master output dock.
- `public/images/loudness-current.png`: current editor with short-term,
  long-term and range loudness in the master dock.
- `public/images/recording-current.png`: current dark recording setup with the
  script, guest choice and fixed Start session action.
- `public/images/preparation-current.png`: current dark episode preparation page
  with finished-mix review and publishing package controls.
- `public/images/mobile-review-current.png`: current dark phone Session saved
  review with playback, synchronization retry and raw downloads.
- `public/og.png`: current 1200 × 630 social preview based on the dark editor.

The older `editor.png`, `recording.png`, `studio.png` and `export.png` files are
kept for historical references but are not used by the landing page.

Screenshots are illustrative UI captures, not evidence of VPS or real-device
performance. Desktop (1440 px) and phone (390 px) layouts, image loading,
horizontal overflow and FAQ disclosure were checked in Chrome. Publishing the
Git commit does not deploy the live website: run the deployment command above.

HTML asset URLs carry a refresh version so the existing one-day Caddy cache
does not mix the current screenshots with an older palette.
