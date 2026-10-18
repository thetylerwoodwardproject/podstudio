# Stage 05: Noise reduction, voice FX, loudness & MP3

**Goal:** Make it sound finished.

Noise reduction, voice processing and normalized export are required for Release 1, not optional polish.

At the end of this stage the app must still deploy and everything from earlier stages must keep working.

## Screens (ids from the mockup)
- 08 Editor: FX inspector + Loudness tab
- 12 Export (Audio tab only)

## Build
- [ ] Per-track FX chain: noise reduction, compressor with gain-reduction meter, HPF 20–300 Hz and LPF 4–20 kHz (12 dB/oct, on/off + log freq knob), 3-band EQ (gain knob top, smaller log freq knob below; low shelf 60–400 Hz, mid bell 300 Hz–6 kHz, high shelf 4–16 kHz). Values never wrap.
- [ ] Implement PREBUILD's actual noise-reduction algorithm, preview/bypass and identical approved export processing; persist algorithm/version, FX order, latency and simplified-control mappings
- [ ] EQ curve that includes the filters; Reset to flat; A/B; Save as show preset
- [ ] LUFS meter (BS.1770 AudioWorklet): integrated / short-term / momentary; target −16 stereo / −19 mono
- [ ] Worker: approved shared project/DSP rendering then ffmpeg WAV/MP3 delivery; AAC arrives with video, not as a hosted audio enclosure
- [ ] Show-default/per-episode MP3 presets: 64 kbps mono speech, 96 stereo speech, 128 stereo speech+music (default), 192 stereo music-heavy; feed delivery 44.1 kHz CBR
- [ ] Separate delivery normalization, post-encode true-peak verification and quiet/silent/short-material diagnostics from editor-preview parity

## Out of scope
Anything listed in a later stage. Leave stub routes, not half-built features.

## Done when
- [ ] Deterministic pre-delivery render nulls below −60 dBFS RMS after defined alignment; any non-deterministic processing passes PREBUILD's approved repeatable signal/quality test
- [ ] Noise reduction audibly reduces the reference noise with acceptable speech quality in preview and export; no cosmetic-only processing controls
- [ ] Encoded MP3 is within ±0.5 LU of −16 LUFS stereo / −19 mono and meets PREBUILD's finalized true-peak ceiling (proposed ≤ −1 dBTP), with supported-program-material diagnostics
- [ ] Screens match the mockup at 1440×900 (and 390×844 for phone screens)
- [ ] lint, typecheck, unit and e2e tests pass in CI
- [ ] CHANGELOG.md has an entry for this stage

## Demo for review
Add EQ and HPF to a voice, export MP3, check LUFS.

## Then
Update `STATUS.md`, write a short summary of what changed and anything that was skipped, and **stop**. Don't start the next stage until Tyler says go.
