# Notes: the TWP social generator (tylerwoodward.me/social-generator)

Reviewed 2026-11-03 from `/var/www/dev.tylerwoodward.me` on tylerwoodward.me (read only;
nothing there was changed). Latest commit at review: `c4c798d`. These notes are the reference
for Podstudio's social features: Stage 07 (post copy), Stage 10c (clips and graphics) and the
auto-posting item in `docs/WISHLIST.md`.

## What it is

A private, signed-in page with five tabs, one episode picker shared by all of them, and the
last 24 episodes preloaded (title, art, description, category, transcript path, archive ordinal).

| Tab | What it makes |
|---|---|
| **Posts** | One design in three image sizes: Instagram 1080×1350, X and Facebook landscape. Headline or Quote template, five imagery layouts, darken slider, wordmark style, waveform on/off, own image upload |
| **Carousel** | Instagram carousel, 1080×1350 slides: cover, 3–6 Claude-written text/quote slides, closing "listen" slide, plus caption. ZIP export |
| **Video** | Reel/Shorts 1080×1920 from an uploaded audio clip: trim, animated bars, progress bar + timer, 90-second warning. MP4 rendered **in the browser** |
| **Artwork** | 3000×3000 podcast cover and a YouTube thumbnail; the title shrinks to fit |
| **Compose** | Posts to Bluesky, Threads and Mastodon now or scheduled; Claude helps write it; attach any image or video made in the other tabs |

## How it's built

- **Page:** Astro 7 + Svelte 5 + Tailwind 4, static (`src/pages/social-generator.astro`,
  `src/components/SocialStudio.svelte` plus one component per tab).
- **Renderers:** plain Canvas 2D (`src/lib/social/*.ts`). The preview and the export are the same
  drawing ("what you see is what you post"). Every size is a percent of the image width, so one
  design scales to every format.
- **Layouts** (`layout.ts`): Split, Full bleed, Framed, Corner, Band, None. The default comes from
  the episode's place in the whole archive (`ordinal % 5`), so consecutive episodes rotate looks
  automatically and an episode always gets the same one.
- **Audio bars** (`audio.ts`): its own FFT computes bar heights per frame (30 fps, 24 bars)
  **once**, so the preview and the export draw identical frames. The audio clock drives the preview.
- **Video encode** (`encode.ts`): mediabunny (WebCodecs) to H.264 + AAC, loaded only on the Video
  tab, with a WASM AAC fallback (needs `wasm-unsafe-eval` and a blob: worker in that page's CSP).
- **Server:** one dependency-free Node service, `server/social.mjs` on `127.0.0.1:4014`, behind
  nginx at `/api/social/`. Queue is a JSON file (`~/.local/state/twp/scheduled.json`).
  Platform clients are in `tools/social-post.mjs`, shared with the site's announcers.
- **Sign-in gate:** nginx `auth_request` to `server/auth.mjs` (`:4013`). One user, scrypt password
  **and** TOTP code, a code works once, 5 failures/IP/15 min and 30/hour overall, signed
  HttpOnly + Secure + SameSite=Strict cookie for 12 h, one generic error message, same-origin POSTs.
  The gated page is `no-store` and `noindex`.
- **systemd hardening** (`deploy/twp-social.service`): runs as `tyler`, `ProtectSystem=strict` with
  only three writable paths, `NoNewPrivileges`, `PrivateTmp`/`PrivateDevices`, `MemoryMax=192M`.

## How the AI writing works (most relevant to Stage 07)

- Model `claude-sonnet-5-5`, effort low, **JSON-schema structured output** for every call, with
  the API's server-side fallback on a decline. Refusal and max-tokens each get their own plain
  error message.
- **The prompt has two parts:**
  1. **Voice**: editable from the page, saved to `~/.config/twp/voice.md`, last 20 versions kept,
     "Reset to default" removes the file so future default changes take effect.
  2. **Rules**: fixed in code, because the schema, the limits and the link card depend on them
     (per-platform limits, hashtag rules, "don't put the URL in the text").
- **Modes:** `clean` (fix and tighten your draft, keep your opinions), `draft` (write from the
  episode, using your draft as notes), `split` (one version per platform), `carousel` (slides +
  caption) and `caption` (caption for slides you edited).
- **Inputs:** episode label/title/category/description, your draft or notes, and for carousels the
  transcript (capped at 40k characters, loaded server-side from a validated path).
- **Quote rule:** quote slides are word for word from the transcript, cleaned only of filler like
  "um"; with no transcript there are no quote slides. Never invent facts, quotes, numbers or guests.
- **Default voice** (worth seeding as Podstudio's TWP show voice): first person, plain, like
  talking to someone in the same building; lead with the point, not "In this episode"; no hype
  words, clickbait, rhetorical-question openers or exclamation pile-ups; at most one emoji.
- Limits: 30 Claude calls an hour, 16 KB request bodies, every output re-trimmed server-side.

## Platform rules it encodes

| Platform | Limit and how it's counted | Other rules |
|---|---|---|
| Bluesky | 300 **graphemes** | Up to 3 hashtags at the end; link facets built from the text; link card from the page's og: tags (image ≤ 950 KB) unless media is attached; images ≤ 1 MB |
| Threads | 500 code points | **No hashtags**; one *topic* (≤ 50 chars, no periods or "&", "&" becomes "and"); media fetched by Threads from a public URL |
| Mastodon | 500, **every link counts as 23** | Gets the Bluesky text; link appended if not in the text; idempotency key per post |
| Instagram caption | ≤ 1,500 characters | Hook first line, 2–4 short paragraphs, "Full episode: link in bio.", 3–5 hashtags last |
| Reels / Shorts | Warn past ~90 s | 1080×1920 |

## How posting works (reference for the wish-list item)

- Credentials: Bluesky **app password**, Threads long-lived token (renewed daily, about 60-day
  expiry), Mastodon access token. All are plain env/JSON files in `~/.config/twp/`. They're never
  sent to the browser; the page only learns which platforms are set up.
- Queue rules worth copying exactly:
  - one send at a time (a promise chain), so nothing posts twice;
  - **retry only the platforms that failed**, never the ones that worked;
  - a post **more than 6 hours late** (box was down) is marked *missed*, not sent late;
  - a post caught mid-send by a restart is marked *failed*, never resent automatically;
  - schedule at most 60 days ahead, times entered in Central and converted across DST;
  - last 200 finished posts kept.
- **Dry run unless it's prod:** posting is real only when the code runs from the prod checkout
  and the request came through `tylerwoodward.me`. Dev records what it would have sent, so two
  checkouts can't double-post.
- Media: uploads streamed to disk with per-type caps (8 MB images, 100 MB video), random UUID
  names, served publicly only so Threads can fetch them, deleted once the post goes out, and
  orphans swept after 2 hours.

## What Podstudio should take from it

**Stage 07: post copy (added to the checklist)**
- Two-part prompt: an editable, versioned show **voice** (seeded from the default above) plus
  fixed rules and a JSON schema in code.
- The `clean` / `draft` / `split` modes, the Threads topic, and a hashtag list as structured fields.
- The exact counting rules above as **one shared validator** used by the editor's live counters
  and the server.
- An AI rate limit and clear refusal/too-long errors.

**Stage 10c: graphics and video (added to the checklist)**
- **Social images** (Instagram 1080×1350, X, Facebook) and an **Instagram carousel** with
  AI-written text/quote slides and caption. Neither was in the Podstudio plan.
- **Per-episode layout rotation** by archive ordinal as the default look.
- Per-frame bar data computed once, shared by preview and render. This matches 10c's
  deterministic-envelope rule already.
- "Use in post": any render can be attached to a post draft, and everything exports as one ZIP.
- Cover art (3000×3000) and a YouTube thumbnail with fit-to-size titles. This fits Episode
  details/branding better than Clips; it's noted in 10c for now.

**Wish list (auto-posting)**
- Port the queue rules and the dry-run-unless-prod guard as they are.
- Bluesky, Threads and Mastodon already work here, so they're the natural first three adapters
  in Podstudio. Add **Mastodon** to the list; it wasn't on it.
- Podstudio should go further on secrets: tokens encrypted at rest instead of plain files,
  because Podstudio's DB is backed up off-site.

**Already better in Podstudio's plan:** server-side video rendering (no browser WebCodecs/CSP
exceptions), safe-zone-aware placement, captions from real word timings, brand/custom highlight
colors.

## Why it's stronger inside Podstudio: it already has the data

The TWP generator only sees what the site build hands it: title, description, category, cover
and a transcript file. Podstudio owns the whole episode, so the social tools can use all of it
with no copying or uploading:

- **Edited transcript with word timings and speakers.** Quotes come from what's actually in the
  final cut (not cut material), with exact timestamps, and the speaker is known.
- **Chapters and soundbites.** Natural slide topics, clip candidates and "jump to" lines.
- **People.** Guest names and their social handles from `people.socials`, so each platform's post
  can tag the guest correctly (e.g. @handle on Bluesky, Threads and Mastodon).
- **Show links, brand and artwork.** Real destination links (only platforms you actually set up),
  the brand accent and the show/episode art are applied automatically.
- **Publish schedule.** When an episode is scheduled, drafts and graphics can be ready (for
  review) in time for release, with the real episode URL.
- **Clips and renders.** Each finished clip already has its transcript span, so its caption
  writes itself from what's said in it.
- **Analytics (Stage 11).** OP3 listens around each post's time can show which posts actually
  drove listens, and inform the voice over time (no third-party trackers).
- **One voice per show.** Saved with the show, versioned, and used by every tool.

## Open question

The generator and Podstudio will overlap once Stage 10c ships. Either Podstudio replaces it, or
the generator stays as a standalone tool for episodes not made in Podstudio. Decide before 10c.
