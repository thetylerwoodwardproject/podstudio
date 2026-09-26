<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg">
    <img src="docs/images/logo-light.svg" alt="Podstudio" width="440">
  </picture>
</p>

<p align="center">
  A free, self-hosted teleprompter and podcast recorder.<br>
  Read your script, record lossless WAV, and keep every retake marked.
</p>

<p align="center">
  <img alt="Status: in development" src="https://img.shields.io/badge/status-in%20development-ff9f0a?style=flat-square">
  <img alt="Version 0.1.0" src="https://img.shields.io/badge/version-0.1.0-26272b?style=flat-square">
  <img alt="Node 22.18+" src="https://img.shields.io/badge/node-22.18%2B-26272b?style=flat-square">
  <img alt="Built with Astro" src="https://img.shields.io/badge/built%20with-Astro-26272b?style=flat-square">
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-26272b?style=flat-square"></a>
</p>

<p align="center">
  <a href="#what-it-does">What it does</a> ·
  <a href="#where-it-stands">Where it stands</a> ·
  <a href="#try-it">Try it</a> ·
  <a href="#put-it-on-a-server">Deploy</a> ·
  <a href="#more-screens">Screens</a> ·
  <a href="docs/roadmap.md">Roadmap</a> ·
  <a href="#made-by">Made by</a>
</p>

> [!WARNING]
> **Podstudio is in active development and changes often.** It isn't released
> yet: expect rough edges, screens that still show example data, and changes
> between versions. Recording, voice follow and exports work today; the first
> real-server test on a VPS is next. Keep your own backups of anything you
> record, and please open an issue if something breaks.

<p align="center">
  <img src="docs/images/recording.png" alt="Recording: the script follows your voice, the current line is marked, and Cough, Retake and Ad-lib are one key away" width="900">
</p>

<table>
  <tr>
    <td width="50%"><img src="docs/images/studio.png" alt="The studio: the episode's script with recording format and scrolling beside it"></td>
    <td width="50%"><img src="docs/images/settings-recording.png" alt="Settings: recording format, noise suppression and marker tones"></td>
  </tr>
  <tr>
    <td align="center"><sub>The studio: script, format and voice follow</sub></td>
    <td align="center"><sub>Recording settings: format, noise suppression, marker tones</sub></td>
  </tr>
</table>

## What it does

Podstudio is for audio podcasts. Record solo, or with **one guest** and an
optional **producer**: everyone talks on their usual call (Zoom, Teams…) and
Podstudio records each person on their own device, losslessly, with the script
kept in step.

| | |
|---|---|
| 🎙️ **Lossless recording** | Mono or stereo WAV at 16 or 24-bit, on the mic's own clock, saved every 5 s and sent to your server as you go |
| 📜 **A prompter that follows you** | Voice follow scrolls the script as you talk and holds your place when you ad-lib |
| ✂️ **Marked, not cut** | Retake, cough and ad-lib are one key each. The raw WAV stays whole; the export adds an edit that keeps your last attempt of each line |
| 👥 **Guest and producer** | A 6-digit code and a waiting room. The guest records on their own device; the producer runs the script and the session from anywhere |
| ⏱️ **Timecode and sync** | Every track logs sync points on a shared session clock. Export corrects drift and gaps between devices, and every WAV carries Broadcast WAV timecode for your editor |
| 📦 **Publish as is, or take it to your DAW** | A ready-to-publish episode at −16 LUFS stereo or −19 LUFS mono (WAV and MP3), with optional levelling of each voice, beside every person's raw and edited WAV for your own post-production |
| 🎛️ **Hotkey pads** | Nine sounds on the number keys, ducked under your voice and saved as their own track |
| 🧹 **Noise suppression** | One fader, like Waves NS1, using DeepFilterNet3 in the browser. The unprocessed files are always kept |
| 🔒 **Yours** | One small Node process with SQLite on your own server, with two-factor sign-in. Recordings go only to your server (voice follow uses the browser's speech recognition) |

Every feature in detail: [docs/features.md](docs/features.md).

## More screens

<table>
  <tr>
    <td width="50%"><img src="docs/images/recording-more.png" alt="The More panel while recording: pause, text size, sections, the mic and what's saved"></td>
    <td width="50%"><img src="docs/images/export.png" alt="Export: the raw WAV with markers, the assembled edit, marker tones and noise suppression"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>More</b>: pause, text size, jump to a section, the mic and what's saved</sub></td>
    <td align="center"><sub><b>Export</b>: raw WAV with markers, the assembled edit, noise suppression</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/script.png" alt="The script editor, with sections and the running word count"></td>
    <td width="50%"><img src="docs/images/sessions.png" alt="Sessions: play a take, open it to export, download the raw WAV"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Script</b>: paste or import, sections from <code>## headings</code></sub></td>
    <td align="center"><sub><b>Sessions</b>: every take, with its markers, ready to play or export</sub></td>
  </tr>
</table>

<table>
  <tr>
    <td width="34%" align="center"><img src="docs/images/phone-recording.png" alt="Recording on a phone: the script, the level meter and the control bar" width="260"></td>
    <td width="66%" valign="middle">
      <h3>On a phone, too</h3>
      <p>The same control bar works on a phone: Cough, Retake and Ad-lib under your thumb, the level meter above them, and the script taking the rest of the screen. iPhones and iPads with iOS 17 or later record through Safari or any other browser; Android works in Chrome.</p>
      <p>A guest can join from their phone with a 6-digit code, and the recording they make there is uploaded to your server as they talk.</p>
      <img src="docs/images/saved.png" alt="Session saved: length, markers, size and format">
      <p><sub><b>Session saved</b>: length, markers, file size, and how much is already on the server</sub></p>
    </td>
  </tr>
</table>

## Where it stands

| | |
|---|---|
| ✅ **Works now** | Solo recording with voice follow, markers and warnings · exports (WAV with cues, Audacity labels, the assembled edit, noise suppression, marker tones, a ready-to-publish episode at −16 LUFS with optional levelling, and MP3) · guest and producer sessions, kept in sync (drift and gap correction, Broadcast WAV timecode) · hotkey pads · accounts with two-factor · episodes, scripts and recordings stored on the server · the guided installer |
| 🚧 **In progress** | First test on a real VPS (the lab environment) · checking iPhone recording on real devices |
| 🗓️ **Next** | Versioned releases with upgrade paths · Whisper transcripts through your own OpenAI key · the mixer view and pad faders on a phone. See [docs/roadmap.md](docs/roadmap.md) |
| 🧪 **Example data for now** | Transcripts, titles, chapters and soundbites (the episode package), the Domain & HTTPS checks, the Controls remotes |

Known gaps and caveats: [docs/features.md#known-gaps](docs/features.md#known-gaps).

## Try it

You need Node 22.18 or later.

```sh
git clone https://github.com/thetylerwoodwardproject/podstudio && cd podstudio
npm install
npm run dev
```

Open **https://localhost:4321** (accept the self-signed certificate once), then
create your account and turn on two-factor. `npm run dev:phone` does the same
but is reachable from phones and other computers on your Wi-Fi.

It runs in Chrome, Edge, Arc and other Chromium browsers on computers and
Android, and in any browser on iPhone and iPad with iOS 17 or later (see
[Browsers](docs/features.md#browsers)).

## Put it on a server

On a VPS (Debian 12 or Ubuntu 22.04+) with a domain pointing at it:

```sh
sudo ./deploy/install.sh
```

The installer walks you through everything:

1. checks the server;
2. checks your domain's DNS;
3. sets up HTTPS, with Caddy by default or Nginx and Certbot if you choose (`--proxy nginx`);
4. offers the firewall and nightly backups;
5. checks HTTPS works;
6. prints a one-time link to create your admin account.

Run it again to upgrade; it backs up the database first. Podstudio idles at
about 120 MB of RAM. The full guide is [docs/deploy.md](docs/deploy.md).

## Made by

<table>
  <tr>
    <td valign="middle">
      Podstudio is made by <b>Tyler Woodward</b>, host of the podcast <a href="https://tylerwoodward.me"><b>The Tyler Woodward Project</b></a>.
      <br><br>
      <a href="https://tylerwoodward.me"><img alt="The Tyler Woodward Project" src="https://img.shields.io/badge/podcast-tylerwoodward.me-ff453a?style=flat-square"></a>
      <a href="https://www.facebook.com/thetylerwoodwardproject"><img alt="Facebook" src="https://img.shields.io/badge/Facebook-thetylerwoodwardproject-26272b?style=flat-square&logo=facebook&logoColor=white"></a>
      <a href="https://www.threads.net/@tylerwoodward.me"><img alt="Threads" src="https://img.shields.io/badge/Threads-@tylerwoodward.me-26272b?style=flat-square&logo=threads&logoColor=white"></a>
      <a href="https://www.instagram.com/tylerwoodward.me"><img alt="Instagram" src="https://img.shields.io/badge/Instagram-@tylerwoodward.me-26272b?style=flat-square&logo=instagram&logoColor=white"></a>
    </td>
  </tr>
</table>

## For developers

- [docs/development.md](docs/development.md): commands, the code layout, and where each design screen lives
- [docs/ui-framework.md](docs/ui-framework.md): the UI framework every screen follows
- [docs/server-api.md](docs/server-api.md): the API for guests and producers
- [docs/roadmap.md](docs/roadmap.md): what's designed and coming next
- [site/](site/README.md): the podstudio.dev landing page

Built with [Astro](https://astro.build) and [Tailwind CSS](https://tailwindcss.com);
noise suppression by [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet).
Credits for everything Podstudio ships are in Settings → About & credits.

## Licence

MIT © 2026 [Tyler Woodward](https://tylerwoodward.me). See [LICENSE](LICENSE).
Bundled third-party work keeps its own licence: DeepFilterNet3 is MIT or
Apache-2.0, and Atkinson Hyperlegible is under the SIL Open Font License.
