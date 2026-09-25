# Running Podstudio on a VPS

Podstudio is one Node process with a SQLite database and a data folder, behind
Caddy for HTTPS. A 1 GB VPS is plenty: the server idles around 100 MB of RAM.
Recording is done in the browser; the server stores what's uploaded, so size the
disk for your audio (24-bit / 48 kHz mono is about 520 MB an hour per speaker).

## Before you start

- A server running Debian 12 or Ubuntu 22.04 or later, with a public IP.
- A domain (or subdomain) with an **A record** (and AAAA, if you use IPv6)
  pointing at it. Caddy gets the certificate from Let's Encrypt, which needs it.
- Ports **80** and **443** open. With `ufw`:

  ```sh
  sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
  ```

## Install

```sh
git clone <your copy of Podstudio> podstudio && cd podstudio
sudo ./deploy/install.sh podcast.example.com
```

That installs Node 24 and Caddy, creates a `podstudio` system user, copies the
app to `/opt/podstudio`, builds it, and starts two services:

| | |
|---|---|
| `podstudio` | the app, on `127.0.0.1:4321` (systemd unit: `deploy/podstudio.service`) |
| `caddy` | HTTPS on your domain, in front of it (`/etc/caddy/Caddyfile`, from `deploy/Caddyfile`) |

Then open `https://podcast.example.com`: the first visit asks you to create the
admin account and turn on two-factor authentication. Save the recovery codes.

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
  podstudio.db          accounts, episodes, scripts, pads, sessions (SQLite, WAL)
  takes/<id>/           your recordings: seg-000001.pcm … + meta.json
  live/<session>/guest/ guests' recordings
  media/                pad sounds (WAV)
```

## Backups

The database can be copied safely while it runs with SQLite's backup command;
the audio is plain files. A nightly job (`sudo crontab -e`):

```sh
15 3 * * * sqlite3 /var/lib/podstudio/podstudio.db ".backup '/var/backups/podstudio.db'" && rsync -a --delete /var/lib/podstudio/takes /var/lib/podstudio/live /var/lib/podstudio/media /var/backups/podstudio/
```

Then copy `/var/backups` off the server (rsync to another machine, restic,
your VPS provider's snapshots). To restore: stop the service, put
`podstudio.db` and the folders back in `/var/lib/podstudio`, `chown -R
podstudio:podstudio`, start it.

## Upgrading

```sh
cd podstudio && git pull
sudo ./deploy/install.sh podcast.example.com
```

It copies the new version, builds it, and restarts. The database is migrated on
start; your data folder isn't touched otherwise. Sessions and invite codes
survive a restart, so a guest who's connected reconnects on their own.

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

## Without a domain

Browsers only allow the microphone on HTTPS, so another device can't record from
`http://<ip>`. For a server on your own network with no domain, run
`npm run preview` (HTTPS with a self-signed certificate; accept the warning once
on each device), or give Caddy an internal certificate by replacing the domain
in the Caddyfile with your hostname and adding `tls internal`.
