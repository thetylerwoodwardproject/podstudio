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

The checks workflow runs unit/server tests, Astro and Svelte checks, the build
and all 14 browser tests. Browser logs and screenshots are retained for seven
days.

## Editor follow-through

The editor core is deliberately podcast-focused: synchronized waveforms,
linked edits, retake and pause review, imports, simple per-track FX, cumulative
playback, autosave and compact export. Near-term work is refinement found in
VPS testing: waveform performance, accessibility, clearer edit affordances and
recovery for unusual media or network failures. MIDI, instruments, automation
lanes, routing matrices and a large mixer are outside the product direction.

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
