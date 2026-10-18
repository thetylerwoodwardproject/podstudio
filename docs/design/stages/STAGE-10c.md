# Stage 10c: Clips, captions, audiograms & custom colours

**Goal:** Produce finished shorts from audio-only or camera episodes with safe, reusable styles.

## Screens
- 13 Clips
- 13b Short video style (including confirmed changes beyond the mockup)

## Build
- [ ] Manual clip selection/in-out and optional AI-picked 30–90-second candidates; suggestions never apply automatically
- [ ] Four layouts: speaker, top/bottom split, picture-in-picture and audiogram; disable camera layouts when camera sources are absent
- [ ] Six caption styles: Bold pop, Clean, Boxed, Karaoke, Word bubble and Minimal; real edited word timings, position/size/words controls and shared text layout
- [ ] Show-level versioned style plus per-clip overrides; save/apply actions, aspect-specific normalized positions and source project revision
- [ ] Highlight defaults to **Use brand accent**; amber/yellow/green/teal/pink presets and validated custom hex picker
- [ ] Independent glow source: Follow highlight (default), Use brand accent, preset or custom hex; persist source/value separately and snapshot resolved colours in export revisions
- [ ] Audiogram: art RMS-envelope motion Still/Subtle/Lively, independent pulsing glow, 0–100% intensity, below-art captions, drag/centre snapping, corner resize and Reset positions
- [ ] Hook title for first 3 seconds, logo, progress bar and optional 3-second end card; show real configured destination links rather than advertising unavailable platforms
- [ ] Versioned TikTok/Reels/Shorts occlusion config; safe-area-aware defaults/reset, per-platform export placement and visible feedback for manually out-of-zone content
- [ ] H.264/AAC 1080×1920 at 30 fps, total duration under 90 seconds including any end card; deterministic envelope/motion/text rendering from the shared specification

## Out of scope
Editable-project exports (10d), direct social-platform posting and mobile host recording.

## Done when
- [ ] Preview/export caption position is within 2% of frame dimensions, word timing within one frame, and text wrapping/styles match pinned reference frames
- [ ] Default/reset audiogram captions and logo/hook fit inside each configured platform's safe region; reproduce and fix the mockup's TikTok-bottom overlap
- [ ] Brand-linked styles follow a brand change while custom highlight/glow remain independent; old export revisions retain their resolved colours
- [ ] Camera and audio-only clips export with correct layouts, duration, A/V timing and approved final audio metrics
- [ ] Desktop screens match README overrides; lint/typecheck/unit/e2e and frame/media checks pass; CHANGELOG updated

## Demo and then
Export an audiogram and camera short for each platform; change the show accent and then choose separate custom highlight/glow colours. Update STATUS and **stop for review** before 10d.
