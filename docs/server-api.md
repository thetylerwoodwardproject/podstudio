# Podstudio server API (sessions with a guest and a producer)

What the Podstudio server needs to provide for guests and producers. The app
already speaks it; `dev/relay.ts` is a stand-in that implements it for testing
(`npm run dev`, `npm run preview`), keeping sessions in memory and tracks in
`.podstudio-dev/`. The real server replaces the stand-in with no app changes.

Everything is same-origin, under `/api/`, over HTTPS (browsers only allow the mic
and storage on https). JSON bodies unless noted. Errors are `{ "error": "..." }`
with a message fit to show the person.

## Roles

- **host**: the account holder. Creates the session, records, and owns the
  session state. (Until sign-in exists, whoever creates a session is its host.)
- **guest**: at most one per session. Records their own track locally and uploads it.
- **producer**: never records. Follows and edits the script, marks retakes,
  ad-libs, pauses and cuts, starts/pauses/stops the session, manages the guest.

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
| GET | `/api/health` | anyone | `{ ok: true, server, time }`. The app checks this to offer guests at all. |
| POST | `/api/sessions` `{ episodeId }` | host | → `{ sessionId, hostToken, codes: { guest, producer } }` |
| GET | `/api/sessions/:id` | any admitted member | → `{ episodeId, codes? (host, producer), connected: Role[], waiting? (host): Knock[], ended }` |
| POST | `/api/sessions/:id/codes/:role` | host, producer | New code for `guest` or `producer` → `{ code, codes }` |
| DELETE | `/api/sessions/:id/codes/:role` | host, producer | Revoke → `{ codes }` |
| POST | `/api/join` `{ code, name }` | anyone | → `{ sessionId, episodeId, role, token, name, admitted: false }`; 404 for an unknown code. The token waits for the host (see Waiting room). |
| POST | `/api/sessions/:id/end` | host | Ends the session |
| PUT | `/api/sessions/:id/tracks/:role/segments/:n` | that role | Raw PCM for segment `n` (1-based, `application/octet-stream`); 204. Also sends `upload` to the room. |
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
| `state` | host | `{ state: { recording, paused, ended, startedAtServer, word, line, point, markers, scriptVersion, mode, hostName, adlib, cut } }`. The host is the authority; markers are in seconds on the host's recording clock. |
| `script` | host, producer | `{ version, text }`: the whole script (import format) after an edit |
| `command` | producer, guest | `{ action }`: `start`, `pause`, `resume`, `stop`, `retake`, `adlib`, `cut`, `next`, `prev`, `goto {word}`, `section {index}`, `point {index}`, `cough {down}` (guest) |
| `guest` | guest | `{ name, level, clip, recording, uploaded, pending, done, mic, word?, take? }` about twice a second |
| `hello` | anyone | `{ role, name }` on connecting |

## Timing

The host's and guest's tracks are recorded on different devices. Each records
`startedAtServer` (the server clock when its recorder started, from the clock
offset). At export the guest track is shifted by `guestStart − hostStart`:
padded with silence if it started late, trimmed if early. Markers are on the
host's recording clock, so the same cuts apply to both tracks.
