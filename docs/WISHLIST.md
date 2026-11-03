# Wish list

Ideas we want eventually but that aren't in the build plan yet. Nothing here is
scheduled. When an item is picked up, it moves into `docs/design/BUILD_PLAN.md`
and `docs/design/STATUS.md` as its own gated stage, and is removed from here.

---

## Auto-posting clips to social networks

**Status:** idea, not scheduled. **Depends on:** Stage 10c (finished, verified
clip renders) and Stage 07 (transcript + AI help for post copy). **Needs first:**
Podstudio running publicly on its real domain with the go-live hardening done
(real TLS, 2FA for admins, sign-in rate limits).

**Already planned (not part of this item):** Podstudio *writes* the posts.
Stage 07 drafts per-platform social copy for each episode, and Stage 10c drafts
a caption for each clip and downloads it with the MP4. You copy and post them
yourself. This item covers only the API connections and posting straight from
Podstudio, now or on a schedule.

### How it would work for you

1. **Connect channels once.** Under Settings → Social, connect each account
   (YouTube, Bluesky, Facebook Page, Instagram, Threads, TikTok, LinkedIn, X).
   This uses each platform's normal sign-in screen. Podstudio shows "Connected as
   @handle" and when the connection expires.
2. **Share from Clips.** On a finished clip, click **Share**. Pick channels and
   review the post text per platform: AI drafts it from the transcript, and you
   edit it. Then choose **Post now** or **Schedule**.
3. **Nothing posts without your click.** AI suggestions never post automatically.
   Each post needs an explicit confirm.
4. **Track it.** Each clip shows its posts per channel: queued, uploading,
   processing, posted (with a link) or failed (with the reason and a Retry button).

### What you'd have to provide

Nothing posts until you connect each account yourself. Podstudio never ships with
credentials.

| Platform | What you provide | How |
|---|---|---|
| Bluesky | Handle + **app password** (made in Bluesky settings, not your real password) | Paste into Settings → Social |
| Mastodon | Instance URL + access token (an app created on your instance, write scope only) | Paste, or sign in with OAuth |
| Threads | A Meta developer app (ID + secret) **and** a sign-in to Threads | Sign in with OAuth; Podstudio renews the long-lived token (about 60 days) |
| Instagram / Facebook | The same Meta app, a Business/Creator account linked to your Page | Sign in with OAuth |
| YouTube | A Google Cloud project with an OAuth client | Sign in with OAuth |
| TikTok | A TikTok developer app | Sign in with OAuth |
| LinkedIn | A LinkedIn developer app | Sign in with OAuth |
| X | A paid X API app, or a Buffer connection | Sign in with OAuth, or route through Buffer |

App IDs and secrets go in server config. Tokens and app passwords are stored encrypted, and
a channel can be disconnected (and its access revoked) at any time.

**Writing posts needs none of this.** The Stage 07 and 10c post drafts only need the AI
provider key that Stage 07 already configures server-side (for example an Anthropic API key).
No social account is touched.

### How it would work underneath

- **One adapter per platform**, each with `connect`, `upload`, `publish`,
  `status` and `disconnect`. The Share screen doesn't care which adapter it's
  using. Buffer can be one adapter, as a fallback for platforms that aren't worth
  doing directly.
- **Your own developer apps.** Podstudio is self-hosted with one owner, so you
  register your own Google, Meta, TikTok and other apps and paste their
  credentials into Podstudio. Podstudio itself never needs approval as a product.
- **The worker does the posting.** A post is a durable job with a dedupe key, so
  retries never double-post. It writes a `social_posts` row (clip, channel, text,
  scheduled time, platform post ID, status) and an `audit_events` row.
- **Two ways video reaches a platform:**
  - *Podstudio sends it* (YouTube, Bluesky, Facebook, TikTok, LinkedIn, X):
    the worker uploads the MP4.
  - *The platform fetches it* (Instagram, Threads, optionally TikTok):
    Podstudio hands over a single-use signed link to the clip that expires in
    about 15 minutes.
- **Webhooks** (Meta, TikTok) report processing and publish results back where
  available. Otherwise the worker polls the post's status.

### Platform notes (check again before starting; these change)

| Platform | Video delivery | Catch |
|---|---|---|
| YouTube Shorts | Podstudio sends | Uploads stay private until the Google project passes an API audit; daily quota allows about 6 uploads |
| Bluesky | Podstudio sends | Easiest; OAuth or app password |
| Facebook Page | Podstudio sends | Fine for your own Page in Meta dev mode |
| Instagram Reels | Platform fetches | Needs a Business/Creator account |
| Threads | Platform fetches | Same as Instagram |
| TikTok | Either | Unaudited apps can only post private videos; public posting needs an audit |
| LinkedIn | Podstudio sends | Straightforward |
| X | Podstudio sends | Real posting needs a paid API tier, so a good one to route through Buffer |

**Prior art:** the TWP social generator already posts to Bluesky, Threads and Mastodon,
with a well-tested queue (retry only failed platforms, missed after 6 hours late, never resend
after a crash, dry run unless prod). Port those rules and adapters; see
`docs/notes/social-generator.md`. Add **Mastodon** to the platform list.

**Suggested order:** Bluesky, Threads and Mastodon (ported from the generator) and YouTube first, then Facebook and LinkedIn, then
Instagram, Threads and TikTok. X goes through Buffer.

### Security

- **Tokens encrypted at rest** (AES-256-GCM), with the key kept outside the DB,
  so off-site DB backups never hold usable tokens. App client secrets stay in
  `deploy/.env`, never in the DB or the UI.
- **Tokens never reach the browser.** Only the worker calls platform APIs, and
  logs strip tokens and `Authorization` headers.
- **OAuth done properly:** authorization code + PKCE, a `state` value tied to
  your session, exact registered redirect URIs, and the narrowest
  post/upload-only scopes.
- **Admin-only,** checked server-side against the DB. Connecting a channel needs
  a fresh password + 2FA check, and every post needs an explicit confirm, so a
  hijacked session can't post silently.
- **Disconnect revokes access** at the platform and deletes the token. Expired
  tokens show "Reconnect" instead of failing silently.
- **Signed media links** are single-use, expire in about 15 minutes, and are
  tied to one post. Unpublished clips are never otherwise reachable.
- **Webhooks** are verified by signature and timestamp, replays are rejected,
  and only the expected event types are accepted.
- **Guardrails:** off by default behind a feature flag; only worker-verified
  renders can be posted; a rate limit per channel; and a one-click **Pause all
  posting** switch.
- **Alerts** on every new channel connection and every failed or unexpected post.
