# Podstudio server API (sessions with a guest and a producer)

What the Podstudio server provides for guests and producers. It's implemented
in `server/live.ts` (HTTP and the live room) on `server/live-store.ts`
(sessions, codes and tokens in SQLite, so a restart keeps them; tokens are
stored hashed). Guest tracks are kept in `<data>/live/<session>/<role>/`.
`npm run dev` runs the same code with its data in `.podstudio-dev/`.

Everything is same-origin, under `/api/`, over HTTPS (browsers only allow the mic
and storage on https). JSON bodies unless noted. Errors are `{ "error": "..." }`
with a message fit to show the person.

## Roles

- **host**: the account holder. Creates the session, records, and owns the
  session state. Creating a session requires a signed-in account with
  two-factor setup complete.
- **guest**: at most one per session. Records their own track locally and uploads it.
- **producer**: never records. Follows and edits the script, marks retakes,
  ad-libs and pauses, starts/pauses/resumes/stops the session on the shared clock, and manages invite
  codes. Cough is controlled by the person recording; lobby admission is the host’s.

Each person holds a **token** for the session, sent as `Authorization: Bearer <token>`
(or `?token=` on the WebSocket).

## Waiting room

Like Zoom's: a code gets someone a token, but they wait until the host lets
them in, so a leaked code can't bring in strangers or bots.

- `POST /api/join { code, name }` returns a token that is **waiting**. It can
  open the WebSocket, which gets `{ type: "waiting" }` and nothing else; every
  other endpoint answers 401 until they're let in.
- The host's connections get `{ type: "knock", member: { id, role, name } }`, and
  on connecting, `{ type: "knocks", members: [...] }` for everyone waiting.
  `{ type: "knock-gone", id }` when someone leaves the waiting room or is answered.
- The host sends `{ type: "admit", id }` or `{ type: "deny", id }` (ignored from anyone else).
  - Admit: the member gets `{ type: "admitted" }`, then the latest state as if
    they'd just connected, and everyone gets `presence`. An admitted token stays
    admitted when it reconnects. A second guest can't be let in while one is:
    the host gets `{ type: "admit-error", id, error }`.
  - Deny: the token stops working and their socket closes with 4003 "The host
    didn’t let you in".

## Invite codes

- Six digits, `000000`–`999999` (leading zeros allowed). The app shows them as `123 456`.
- One guest code and one producer code per session, unique across open sessions.
- A new code replaces the old one. Revoking clears it and signs out whoever
  joined with it (their WebSocket closes with code 4003).
- Ending a session clears both codes.

## Endpoints

| Method | Path | Who | Does |
|---|---|---|---|
| GET | `/api/health` | anyone | `{ ok: true, server, version, schema, time }`. The app checks this to offer guests at all. |
| POST | `/api/sessions` `{ episodeId }` | host | → `{ sessionId, hostToken, codes: { guest, producer } }` |
| GET | `/api/sessions/:id` | any admitted member | → `{ episodeId, codes? (host, producer), connected: Role[], waiting? (host): Knock[], ended }` |
| POST | `/api/sessions/:id/codes/:role` | host, producer | New code for `guest` or `producer` → `{ code, codes }` |
| DELETE | `/api/sessions/:id/codes/:role` | host, producer | Revoke → `{ codes }` |
| POST | `/api/join` `{ code, name }` | anyone | → `{ sessionId, episodeId, role, token, name, admitted: false }`; 404 for an unknown code. The token waits for the host (see Waiting room). |
| POST | `/api/sessions/:id/end` | host | Ends the session |
| PUT | `/api/sessions/:id/tracks/:role/segments/:n` | that role | Raw PCM for segment `n` (1-based, `application/octet-stream`); 204. Also sends `upload` to the room. An empty body is refused (400): a segment is never empty, so the client retries. |
| PUT | `/api/sessions/:id/tracks/:role/meta` | that role | The track's format and timing (below); 204 |
| GET | `/api/sessions/:id/tracks/:role` | any member | → `{ meta, segments }` (how many segments are stored) |
| GET | `/api/sessions/:id/tracks/:role/segments/:n` | any member | The segment's bytes |

Segments are the recorder's own 5-second files: little-endian PCM at the track's bit
depth, interleaved L R when stereo. Uploading the same `n` again replaces it (the
uploader retries). Track meta:

```json
{ "name": "Sam", "sampleRate": 48000, "bitDepth": 24, "channels": 1,
  "startedAtServer": 1790380000123, "segments": 42, "samples": 10080000, "done": true }
```

## Live room: `wss://…/api/ws?session=:id&token=:token`

The server relays JSON messages to everyone else in the session and adds
`from: <role>`. Close codes: 4001 not signed in, 4003 invite revoked or turned
away, 4009 refused ("A guest is already connected"). Clients reconnect on anything else.

The server itself:

- answers `{ type: "ping", t }` with `{ type: "pong", t, server: <ms> }` (clients
  estimate the server-clock offset from the quickest of several round trips);
- sends `{ type: "presence", role, connected, roles }` when someone arrives or leaves;
- keeps the latest `state`, `script` and `setup` message and sends them to anyone who connects.

Messages between people (`src/lib/room.ts` has the types):

| type | from | contents |
|---|---|---|
| `state` | host | `{ state: { recording, paused, ended, startedAtServer, word, line, point, markers, scriptVersion, mode, hostName, adlib, cut } }`. The host is the authority; markers are in seconds on the host’s recording clock. Pause/resume is scheduled on the shared clock so host and guest stop accepting samples together, while active pads suspend at their current position. |
| `script` | host, producer | `{ version, text }`: the whole script (import format) after an edit |
| `command` | producer, guest | `{ action }`: `start`, `pause`, `resume`, `stop`, `retake`, `adlib`, `next`, `prev`, `goto {word}`, `section {index}`, `point {index}`, `cough {down}` (guest) |
| `guest` | guest | `{ name, level?, now?, clip?, recording?, uploaded?, pending?, done?, mic?, word?, take? }` about twice a second |
| `hello` | anyone | `{ role, name? }` on connecting |
| `setup` | host | `{ mode, points, hostName, guestName? }`: script mode, talking points and speaker names |

## Timing

The host and guest record `startedAtServer` and a `sync` log:
`{ clock: "server", points: [[frames, serverTimeMs], ...] }`. Each point pairs
captured sample frames with the shared-clock arrival time. The recorder keeps
the least-late chunk of each roughly five-second segment; these points travel
in track metadata. Clock offset is sampled when joining and every minute.

At export, `src/lib/audio/sync.ts` fits the clocks, corrects measurable drift
with single-frame slips, fills guest gaps with silence and removes guest audio
from host gaps. Both edits use the same cuts; coughs mute only the person's
own track. Older recordings without sync logs use the start-time offset
(`src/lib/audio/align.ts`). Wrapping up can add a manual guest offset of up to
±500 ms. Exported WAVs carry Broadcast WAV timecode, and the optional export
report describes corrections. See [track sync](features.md#keeping-tracks-in-sync).


## Editor project compatibility

`GET /api/takes/:id` additionally returns `segmentBytes`, the byte length of each
PCM segment in order. This lets the editor request only segments overlapping a
playback window, including recordings whose segments differ from five seconds.
Missing files are represented by zero and shown as unavailable audio.
Completed guest uploads in the legacy session store also appear as read-only
`<hostTakeId>-guest` sources through these authenticated GET endpoints. PCM stays
in its existing location; the host recording must reference a session belonging
to the same episode. No room token or audio copy is stored in editor metadata.

`EditorProjectV1` keeps its version and revision protocol. Optional clip
`sourceDuration` permits restoring trims. Optional `sourceMarkers` stores original
aligned marker times so marker display and cough suppression follow clip edits.
Optional `fx.tone` uses the existing ten-band `VoiceTone`, with compressor
`attackMs` (0.1–100, default 10) and `releaseMs` (10–2000, default 150).
When present it overrides the simple EQ and compression controls.

Master settings accept `loudness: custom`, `targetLufs` (−30 to −10),
`ceilingDb` (−3 to −0.1, default −1), and `channels` (1 or 2).
Old records normalize to equivalent processing without a database migration.
`PUT /api/media/:id` remains idempotent for retrying a retained upload. Its
200 MiB limit returns HTTP 413 without resetting the connection.

## Editor projects

Signed-in editor clients store compact, non-destructive project metadata. Audio remains in existing take segments and media files.

| Method | Path | Result |
|---|---|---|
| GET | `/api/editor-projects/:takeId` | `{ project, revision, updatedAt }`; `project` is null and revision is 0 before the first save |
| PUT | `/api/editor-projects/:takeId` with `{ project, baseRevision, force? }` | Saves `EditorProjectV1` and returns the next `{ revision, updatedAt }` |

The take must belong to the episode named by the project. IDs, tracks, clips and numeric clip bounds are validated, and the JSON body is limited to 1 MiB. A stale `baseRevision` returns `409` with the server project and revision. `force: true` is the explicit overwrite action offered by the conflict UI. Database migration 4 creates `editor_projects`; no audio is duplicated in it.

## Account settings

Separate from live-room tokens, `server/user-settings.ts` provides settings
for the fully signed-in account using its session cookie:

| Method | Path | Result |
|---|---|---|
| GET | `/api/me/settings` | `{ settings: object \| null, updatedAt }` |
| PUT | `/api/me/settings` with `{ settings }` | `{ updatedAt }`; settings must be an object, with a 256 KiB request limit |

`updatedAt` is assigned by the server. The browser saves locally immediately,
sends changes after 400 ms, and synchronizes on page load. Recording and
prompter settings sync; the client leaves `recording.deviceId` out of uploads
and preserves its local value when applying server settings.

### Mobile recording review

Phone review reuses the take list/detail/segment readers and existing media IDs;
there is no new review API. Audio previews read at most 30 seconds, while each raw
download fetches only its selected source. Guest tracks share the host's alignment
and recorded-pause removal. Editor edits and FX do not affect raw downloads.

### Editor crossfade metadata

`EditorProjectV1.crossfades` is optional. Each record contains `trackId` and nonempty `from`/`to` clip-ID arrays on that same track. Split fragments may share an envelope; the overlap bounds are derived from current clip positions. The existing authenticated project PUT validates referenced clips and their edge overlap. Older projects without this field retain their previous sound. No new endpoint or database migration is required.

`EditorProjectV1.removedTracks` is optional and stores complete track metadata
for later restoration. The server validates these tracks and requires IDs to be
unique across active and removed tracks. Only active tracks render into the
finished mix; the original take and media files remain untouched.

## Recording deletion and episode preparation (schema 6)

All these routes require a signed-in account with completed two-factor setup.
Same-origin checks apply to writes. Credentials are per account; recording and
library access follow the app’s existing shared-show permissions.

| Method | Route | Result |
|---|---|---|
| GET | `/api/recordings/deleted?episode=:id` | Durable deleted take IDs and recording-group IDs for local reconciliation |
| DELETE | `/api/recordings/:takeId` | Optional `{episodeId, ids, group}` for local-only discovery; grouped permanent deletion; returns `{ids}` only after cleanup |
| GET | `/api/me/ai` | Masked credential status, suffix, validation time and fixed model names; never the key |
| PUT | `/api/me/ai` | `{key}` validates required model access, then stores AES-256-GCM ciphertext |
| POST | `/api/me/ai` | Revalidate existing credentials; no paid generation |
| DELETE | `/api/me/ai` | Remove credential and cancel this account’s active generation jobs |
| POST | `/api/prepared-audio` | `{takeId, episodeId, revision, fingerprint, bytes}`; create/reuse an upload for the saved project’s audio identity |
| PUT | `/api/prepared-audio/:id/chunks/:n` | Raw WAV bytes, zero-based 8 MiB chunks; exact expected chunk size, reusable IDs |
| POST | `/api/prepared-audio/:id/complete` | Validate complete 48 kHz PCM WAV, finalize atomically; serialized/idempotent completion |
| GET / HEAD | `/api/prepared-audio/:id/wav` | Owned prepared WAV; supports a single byte range for native playback |
| PUT | `/api/prepared-audio/:id/ai/:n` | Compressed transcription chunk, maximum 20 MiB |
| PUT | `/api/prepared-audio/:id/ai-manifest` | `{chunks:[{start,end,bytes}]}`; validate 600-second partitions with two-second overlap |
| GET | `/api/episode-packages/:episodeId` | Package, revision, account ID, source-availability/current-state flags |
| POST | `/api/episode-packages/:episodeId` | `{baseRevision,audioId}` attaches current finished audio without replacing approved text |
| PUT | `/api/episode-packages/:episodeId` | `{baseRevision,package}` updates approved materials and per-section timing identities, preserving source/provider suggestions |
| GET | `/api/generation-jobs?episode=:id` | This account’s most recent jobs; supports reopening |
| POST | `/api/generation-jobs` | `{id,episodeId,audioId,section}`; `all`, `title`, `description`, `chapters`, `soundbites`, or `transcript` |
| GET | `/api/generation-jobs/:id` | State, truthful stage text, section and safe error |
| DELETE | `/api/generation-jobs/:id` | Cancel further provider work |
| POST | `/api/generation-jobs/:id/retry` | Explicit retry for failed/interrupted jobs, resuming completed transcription chunks |

Deletion records are committed before files are removed. Take upload retries for
deleted identities or groups return 410; live-track writes recheck deletion after
streaming. Dependencies and active recordings return 409. Repeating deletion
retries cleanup. Packages retain approved text and flag missing audio.

Package writes use revision conflict detection (409 returns the saved version).
Audio fingerprints exclude output-format choices and include audible edits/FX.
Jobs serialize provider work to keep VPS memory low. Restarted active jobs become
`interrupted`; queued jobs resume. Provider errors use safe credential/quota/
connection messages, never provider bodies or tokens. OpenAI responses create
review suggestions, not approved text. The browser assembles the final ZIP.
