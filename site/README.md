# podstudio.dev

The coming-soon page for Podstudio: plain HTML and CSS in `public/`, no build
step. It follows the Podstudio UI framework (`../docs/ui-framework.md`).

| | |
|---|---|
| `public/index.html` | the page |
| `public/style.css` | its styles (the framework's tokens) |
| `public/404.html` | not found |
| `public/og.png` | the image shown when the link is shared (1200×630) |
| `public/images/` | screenshots, copied from `../docs/images/` |
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
   cd podstudio && git pull
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
