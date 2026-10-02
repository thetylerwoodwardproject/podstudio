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

## Visual refresh · 2026-10-02

The site follows the app’s dark palette: indigo page and panel surfaces,
lime primary actions, and red reserved for the recording mark. The homepage
now describes the desktop editor, mobile recording/review, non-destructive
editing, and current export options. It still labels the product as in development.

Fresh screenshots were captured from the actual local app at commit `9cab78a`,
using a disposable test account and demo audio, never private recordings:

- `public/images/editor.png`: synchronized host, guest and pads, with live meters.
- `public/images/recording.png`: desktop recording demonstration.
- `public/images/phone-recording.png`: phone recording demonstration, without pads.
- `public/og.png`: updated 1200 × 630 social card using the editor screenshot.

Screenshots are illustrative UI captures, not evidence of VPS or real-device
performance. Desktop (1440 px) and phone (390 px) layouts, image loading,
horizontal overflow and FAQ disclosure were checked in Chrome. Publishing the
Git commit does not deploy the live website: run the deployment command above.

HTML asset URLs carry a refresh version so the existing one-day Caddy cache
does not mix the old palette/screenshots with the updated page.
