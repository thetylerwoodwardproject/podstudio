# Running Podstudio on a VPS

Podstudio is one Node process with a SQLite database and a data folder, behind
Caddy for HTTPS (or Nginx with Certbot, if you prefer). The first real VPS
validation is still pending; confirm memory use and upgrade behaviour in the
[lab checks](roadmap.md#next-stage-a-lab-environment-on-a-real-vps).
Recording is done in the browser; the server stores what's uploaded, so size the
disk for your audio (24-bit / 48 kHz mono is about 520 MB an hour per speaker).

## Before you start

- A server running Debian 12 or Ubuntu 22.04 or later, with a public IP.
- A domain (or subdomain) with an **A record** pointing at the server. The
  installer checks it and tells you what to set if it doesn't.

## Install

```sh
git clone https://github.com/thetylerwoodwardproject/podstudio && cd podstudio
sudo ./deploy/install.sh
```

It walks you through eight steps, checking each one:

1. **This server:** the OS, memory, and how many hours of audio fit on the disk.
   If Podstudio is already installed, it offers to upgrade it instead.
2. **Your domain.**
3. **DNS:** whether the domain points at this server. If it doesn't, it says
   which A record to add and can wait while you fix it.
4. **Web server and certificate:** Caddy (the default: it gets and renews the
   certificate itself) or Nginx with Certbot, and an optional email for Let's
   Encrypt notices. See [Using Nginx instead](#using-nginx-instead).
5. **Firewall:** offers to turn on `ufw` with SSH, 80 and 443 open (SSH first,
   so your session stays up). If your VPS provider has a firewall panel, open
   80 and 443 there too.
6. **Install:** Node 24 and the web server, a `podstudio` system user, the app in
   `/opt/podstudio`, built, and two services:

   | | |
   |---|---|
   | `podstudio` | the app, on `127.0.0.1:4321` (systemd unit: `deploy/podstudio.service`) |
   | `caddy` | HTTPS on your domain, in front of it (`/etc/caddy/sites/podstudio.caddy`, from `deploy/Caddyfile`) |
   | or `nginx` | the same with `--proxy nginx` (`/etc/nginx/sites-available/podstudio`, from `deploy/nginx.conf`; Certbot adds HTTPS) |

7. **Backups:** offers a nightly backup to `/var/backups/podstudio` (see below).
8. **HTTPS:** waits for the certificate and checks the site answers. If it
   doesn't, it says what's usually wrong (DNS, or port 80/443 closed).

Last, it prints a **one-time setup link**. Open it to create the admin account,
then set up two-factor authentication and save the recovery codes. The link is
what stops anyone else who finds the site first from making themselves admin:
without it, the account page won't create an account. Lost it?

```sh
cd /opt/podstudio && sudo -u podstudio env $(cat /etc/podstudio.env | xargs) npm run setup-link
```

For an unattended install (cloud-init, a script), pass everything and it asks
nothing:

```sh
sudo ./deploy/install.sh --domain podcast.example.com --email you@example.com --yes
```

`--proxy nginx` picks Nginx; `--no-firewall` and `--no-backups` skip those
steps; `--help` lists the options.

## Other sites on the same Caddy

`/etc/caddy/Caddyfile` only holds the global options (the certificate email)
and `import /etc/caddy/sites/*.caddy`; each site is its own file in that
folder. Podstudio's is `podstudio.caddy`. Add your own sites there and they
survive reinstalls and upgrades. The landing page is one (`site/`,
`sudo ./site/deploy.sh`; see `site/README.md`).

An install from before this layout has Podstudio's site written into
`/etc/caddy/Caddyfile` itself. The first run of either script moves it to
`sites/podstudio.caddy` and keeps a backup of the old file beside it.

## Using Nginx instead

Caddy is the default because it needs no setup: HTTPS just works and renews
itself. If you already run Nginx, or prefer it:

```sh
sudo ./deploy/install.sh --proxy nginx
```

(or answer `nginx` at step 4). The installer then:

- installs `nginx`, `certbot` and `python3-certbot-nginx`;
- writes `/etc/nginx/sites-available/podstudio` from `deploy/nginx.conf` and
  enables it. That config passes WebSockets through for the live room, keeps
  the `Host` header (Podstudio checks it, see "Not from this server" below),
  allows 210 MB uploads and streams them instead of buffering them;
- turns off Nginx's stock welcome site if it's still enabled;
- runs `certbot --nginx`, which adds the HTTPS server block and the redirect
  from http. Certbot's systemd timer renews the certificate
  (`systemctl list-timers | grep certbot`). If it can't get one yet (DNS, or
  port 80 closed), the installer prints the exact command to run once that's
  fixed.

The choice is saved as `PODSTUDIO_PROXY` in `/etc/podstudio.env`, so upgrades
keep it. To switch later, run the installer again with `--proxy caddy` or
`--proxy nginx`: it sets up the new one and stops the other, so they don't
both try to use ports 80 and 443.

Settings are in `/etc/podstudio.env`:

```sh
PODSTUDIO_DATA=/var/lib/podstudio      # database, recordings, pad sounds
PODSTUDIO_ORIGIN=https://podcast.example.com
HOST=127.0.0.1
PORT=4321
```

## What's where

```
/var/lib/podstudio/
  podstudio.db          accounts, settings, episodes, scripts, pads, sessions (SQLite, WAL)
  takes/<id>/           your recordings: seg-000001.pcm … + meta.json
  live/<session>/guest/ guests' recordings
  media/                pad sounds (WAV)
```

## Backups

The database can be copied safely while it runs with SQLite's backup command;
the audio is plain files. The installer offers to set this up as
`/etc/cron.d/podstudio-backup`; to do it by hand (`sudo crontab -e`):

```sh
15 3 * * * sqlite3 /var/lib/podstudio/podstudio.db ".backup '/var/backups/podstudio/podstudio.db'" && rsync -a --delete /var/lib/podstudio/takes /var/lib/podstudio/live /var/lib/podstudio/media /var/backups/podstudio/
```

Then copy `/var/backups` off the server (rsync to another machine, restic,
your VPS provider's snapshots). To restore: stop the service, put
`podstudio.db` and the folders back in `/var/lib/podstudio`, `chown -R
podstudio:podstudio`, start it.

## Upgrading

```sh
cd podstudio && git pull
sudo ./deploy/install.sh
```

It sees the existing install, shows the version you have and the one you're
installing, and asks before going on. The database is copied to
`/var/backups/podstudio/pre-<old version>-<date>.db` first, then the new version
is built, migrated on start and restarted. Your recordings and settings aren't
touched. Sessions and invite codes survive a restart, so a guest who's connected
reconnects on their own.

To roll back: check out the previous version and run the installer again, then
`sudo systemctl stop podstudio`, copy that `pre-…db` file to
`/var/lib/podstudio/podstudio.db`, `chown podstudio:podstudio` it, and start it.

## Day to day

```sh
systemctl status podstudio            # running?
journalctl -u podstudio -f            # its log
sudo systemctl restart podstudio

# Locked out:
cd /opt/podstudio
sudo -u podstudio env $(cat /etc/podstudio.env | xargs) npm run reset-password -- tyler
sudo -u podstudio env $(cat /etc/podstudio.env | xargs) npm run reset-2fa -- tyler   # lost phone and codes
```

## "Not from this server"

Changes (signing up, saving a script) are only accepted from Podstudio's own
pages. The error says which address the page was on and which ones the server
answers to. Usually one of these:

- **You opened it at another address** (the IP, `www.`, an old domain). Use the
  domain you installed with, or list every address you use, comma-separated:
  `PODSTUDIO_ORIGIN=https://podcast.example.com,https://www.example.com` in
  `/etc/podstudio.env`, then `sudo systemctl restart podstudio`.
- **Another proxy or a tunnel in front** (Nginx, Cloudflare Tunnel, ngrok) that
  rewrites the Host header (the installer's Nginx config doesn't). Podstudio also trusts `X-Forwarded-Host` and
  `Forwarded: host=`, so have the proxy send one of them (Nginx:
  `proxy_set_header Host $host;`), or set `PODSTUDIO_ORIGIN` as above.

`journalctl -u podstudio` logs each refusal with the headers it got.

## Without a domain

Browsers only allow the microphone on HTTPS, so another device can't record from
`http://<ip>`. For a server on your own network with no domain, run
`npm run preview` (HTTPS with a self-signed certificate; accept the warning once
on each device), or give Caddy an internal certificate by replacing the domain
in the Caddyfile with your hostname and adding `tls internal`.
