# Planned and in validation

Podstudio's recording, settings audio controls and first desktop editor are
implemented. The immediate focus is proving them with real recordings on the
lab VPS rather than expanding into a general-purpose DAW.

## Current stage: real-world VPS and editor validation

The first real VPS install is active. Validate:

- fresh installs and upgrades, especially schema 3 → schema 4;
- backup and restore of SQLite, takes, guest uploads and media;
- long editor sessions without whole-file decoding or unbounded memory growth;
- interrupted/offline autosave and revision-conflict recovery;
- guest finalization, missing-segment recovery and drift correction on real
  networks;
- coordinated host/guest pause and pad suspension on desktop, iOS and Android;
- finished WAV/MP3 loudness and raw-track contents with real material;
- server CPU, memory and disk use while browsers do the audio processing.

## UI facelift follow-through

The first theme and component foundation is in place: System, Light and Dark
choices sync through account settings; the semantic palette and local
shadcn-svelte components are available; UI-source credits and license notices
are included. Finish the coordinated screen redesign across setup, library,
recording, mobile review, editor, export and Settings. Adapt the community
audio-player controls to a shared Podstudio transport interface while
retaining bounded editor rendering and specialized capture/pad engines.
Review every route in both themes on desktop and phone, including focus,
loading, offline and error states. Verify the original imported MP3 plays
continuously across multiple render windows on the VPS before closing that
regression; the earlier 502 remains unproven.

The checks workflow runs unit/server tests, Astro and Svelte checks, the build
and all browser tests. Browser logs and screenshots are retained for seven
days.

## Editor follow-through

Direct editor access, server-session discovery, direct clip dragging and ruler/Shift range selection,
reversible trims, SVG transport icons, advanced EQ/compression, configurable
loudness analysis and import progress/retry are implemented. Validate the reported
VPS import 502 with real uploads and service/proxy logs. Check Chrome translation
behavior with the editor's English and no-translation metadata on the lab machine.


The editor core is deliberately podcast-focused: synchronized waveforms,
linked edits, retake and pause review, imports, simple per-track FX, cumulative
playback, autosave and compact export. Near-term work is refinement found in
VPS testing: waveform performance, accessibility, clearer edit affordances and
recovery for unusual media or network failures. MIDI, instruments, automation
lanes, routing matrices and a large mixer are outside the product direction.

The editor now prepares missing waveforms from bounded source reads, including
server-only and imported audio; compact menus give the timeline more room.
The current editor polish pass moves import progress to a lower-corner status
card, makes clip fields a popover, fixes destructive-dialog contrast, derives
consistent source-time waveforms, and shortens the first playback render. Test
the original MP3 across multiple windows on the VPS before closing the stall;
the earlier 502 remains open until reproduced or conclusively resolved there.
Tracks can be removed and restored without deleting source recordings. The
theme choice is in Settings → General, and the studio setup footer keeps Start
session at full height. Validate these changes with long, real recordings on
the VPS; the reported MP3 playback stall remains open until tested there.

## Calibration

A future guided calibration can measure room noise, speaking level and mic
placement, then suggest capture and processing settings. It must remain easy to
skip and must not block recording.

## Transcription and optional AI tools

Optional AI tools appear after export as coming soon. Planned work includes
transcription, speaker-aware text editing, titles, chapters, show notes and
soundbite suggestions. These features must be optional, clear about where data
is processed, and leave recording/editor/export useful without an AI service.

## Releases

Before a public release:

- establish versioned releases and changelogs;
- test forward migrations from every released schema;
- publish a documented rollback and restore exercise;
- finish real-device browser coverage and accessibility review;
- document practical browser-memory and recording-length limits from measured
  VPS and laptop tests.

Mobile recording review and pad removal are implemented; validate raw downloads, playback and synchronization on real iOS/Android devices. The 502 and reported endless import buffering still need updated-VPS reproduction.

Direct clip dragging and automatic equal-power crossfades are implemented in the editor-direct-drag branch, with source-preserving project metadata. A bounded imported-WAV reader and earlier playback prefetch address a demonstrated per-window decoding cost. Validate continuous playback with the original four-minute MP3 on the upgraded VPS; the previous 502 cannot yet be attributed to a specific proxy or server cause.
