// Retake cleanup (screen 09): from a retake mark, propose the stretch to cut. A mark (K) says
// "the take I just spoke was wrong" — so the cut runs from where the flubbed phrase began,
// through the tone, to where the redo begins. A tone alone can't say where a sentence starts,
// so the boundaries come from pauses in the audio itself (silence detection); the user then
// audits and nudges every cut before anything is applied. Pure: the browser feeds it a window
// of samples around each mark. No transcript needed (sentence-aware refinement is Stage 07).
import { findRetakeTones, toneLength } from "~/lib/capture-contract";

export interface RetakeParams {
  /** A pause at least this long ends a phrase. */
  minPauseMs: number;
  /** Pause left either side of the cut at most (the cut starts/ends this far into a longer pause). */
  keepPauseMs: number;
  /** Don't search further back than this. */
  maxLookbackS: number;
  /** Don't search further ahead than this. */
  maxLookaheadS: number;
}
export const RETAKE_DEFAULTS: RetakeParams = { minPauseMs: 350, keepPauseMs: 150, maxLookbackS: 25, maxLookaheadS: 6 };

export interface CutProposal {
  /** Source samples [from, to). */
  from: number;
  to: number;
  toneStart: number;
  toneEnd: number;
  /** The 1 kHz tone was found in the audio near the mark (else the mark itself is used). */
  toneFound: boolean;
  /** Hit the search limit without finding a pause: the start (or end) is a guess. */
  startLimited: boolean;
  endLimited: boolean;
}

const FRAME_MS = 10;

/**
 * `win` holds source samples starting at source sample `winStart`; `mark` is the annotation's
 * source sample (where the tone starts on the capture clock).
 */
export function proposeCut(win: Float32Array, winStart: number, mark: number, rate: number, params: RetakeParams = RETAKE_DEFAULTS): CutProposal {
  const frame = Math.round((rate * FRAME_MS) / 1000);
  const toneLen = toneLength(rate);

  // 1. Where is the tone really? Look ±0.5 s around the mark.
  const lo = Math.max(0, mark - winStart - Math.round(rate * 0.5));
  const hi = Math.min(win.length, mark - winStart + Math.round(rate * 0.5) + toneLen);
  const hits = hi > lo ? findRetakeTones(win.subarray(lo, hi), rate) : [];
  let toneStart = mark;
  let toneFound = false;
  if (hits.length) {
    const found = hits.map((h) => winStart + lo + h).sort((a, b) => Math.abs(a - mark) - Math.abs(b - mark))[0]!;
    toneStart = found;
    toneFound = true;
  }
  const toneEnd = toneStart + toneLen;

  // 2. Loudness per 10 ms frame, the tone masked out.
  const n = Math.floor(win.length / frame);
  const db = new Float32Array(n);
  const fOf = (s: number) => Math.floor((s - winStart) / frame);
  const tf0 = fOf(toneStart) - 1;
  const tf1 = fOf(toneEnd) + 1;
  for (let f = 0; f < n; f++) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) sum += win[i]! * win[i]!;
    db[f] = 10 * Math.log10(sum / frame + 1e-12);
  }
  const quiet = [...db].filter((_, f) => f < tf0 || f > tf1).sort((a, b) => a - b);
  const floor = quiet.length ? quiet[Math.floor(quiet.length * 0.2)]! : -80;
  const thr = Math.max(-60, Math.min(-38, floor + 10));
  const speech = (f: number) => f >= 0 && f < n && !(f >= tf0 && f <= tf1) && db[f]! > thr;
  const minPause = Math.max(1, Math.round(params.minPauseMs / FRAME_MS));
  const keep = Math.round(params.keepPauseMs / FRAME_MS);

  // 3. Backward from the tone: skip the pause, then walk back through speech (bridging short gaps).
  const backLimit = Math.max(0, fOf(toneStart) - Math.round((params.maxLookbackS * 1000) / FRAME_MS));
  let f = tf0 - 1;
  while (f >= backLimit && !speech(f)) f--; // pause between the flub and the tone
  let startLimited = false;
  let speechStart = f; // first frame of the flubbed phrase (found below)
  if (f < backLimit) {
    // nothing but silence before the tone: cut just the tone
    speechStart = tf0 + 1;
  } else {
    let gap = 0;
    for (; f >= backLimit; f--) {
      if (speech(f)) {
        speechStart = f;
        gap = 0;
      } else if (++gap >= minPause) break;
    }
    if (f < backLimit) startLimited = true;
    else {
      // f sits at the end of a pause of at least minPause frames before `speechStart`
      let g = speechStart - 1;
      while (g > f && !speech(g)) g--;
      const gapLen = speechStart - 1 - g;
      speechStart -= Math.min(Math.floor(gapLen / 2), keep);
    }
  }
  const from = winStart + Math.max(0, speechStart) * frame;

  // 4. Forward from the tone to where the redo starts. If speech carries straight on after the
  // tone, the speaker pressed K mid-phrase: that remainder belongs to the flub, so walk through it
  // (bridging short gaps) to the pause that follows, then on to where the redo begins.
  const fwdLimit = Math.min(n - 1, tf1 + Math.round((params.maxLookaheadS * 1000) / FRAME_MS));
  let g = tf1 + 1;
  let tailEnd = tf1; // last frame of speech that belongs to the flub
  if (speech(g)) {
    let gap = 0;
    for (; g <= fwdLimit; g++) {
      if (speech(g)) {
        tailEnd = g;
        gap = 0;
      } else if (++gap >= minPause) break;
    }
    g = tailEnd + 1;
  }
  const searchFrom = g;
  while (g <= fwdLimit && !speech(g)) g++;
  let endLimited = false;
  let to: number;
  if (g > fwdLimit) {
    endLimited = g > n - 1 || searchFrom > fwdLimit;
    to = Math.max(toneEnd, winStart + (tailEnd + 1) * frame) + Math.min(Math.round(rate * 0.2), Math.max(0, winStart + n * frame - toneEnd));
  } else {
    const gapLen = g - searchFrom;
    to = winStart + (g - Math.min(Math.floor(gapLen / 2), keep)) * frame;
  }
  return { from: Math.min(from, toneStart), to: Math.max(to, toneEnd), toneStart, toneEnd, toneFound, startLimited, endLimited };
}
