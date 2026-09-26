/*
 * Keeping tracks from different devices in sync, like cameras with timecode.
 *
 * While recording, every track logs sync points: how many sample frames it had
 * captured, and the time on the session's shared clock (the server's, measured
 * by lib/room.ts) when they arrived (TakeWriter). From those points:
 *
 *   fitClock()     how fast this device's audio clock really ran, and where
 *                  audio went missing (a gap: time passed but no frames came);
 *   syncGuest()    maps a guest's audio onto the host's timeline. Drift is
 *                  corrected by slipping single frames (dropping or repeating
 *                  one) at evenly spaced points; a guest gap becomes silence;
 *                  guest audio from while the host's mic was stopped is left
 *                  out, as the host's track has no time for it. Nothing is
 *                  filtered or resampled, and the raw recordings are untouched;
 *   bext()         a Broadcast WAV timecode for any start time, so editors
 *                  that sync by timecode line the files up on their own.
 *
 * Accuracy is about the arrival jitter of audio chunks in the browser, which
 * the fit mostly removes: typically within 10 to 20 ms.
 */

/** [frames captured so far, shared-clock time in ms when they arrived] */
export type SyncPoint = [frame: number, ms: number];

export interface SyncLog {
  /** 'server': the session's shared clock (with a guest); 'local': this device's clock (solo) */
  clock: 'server' | 'local';
  points: SyncPoint[];
}

/** One stretch of a track with no missing audio: time = t0 + (frame − f0) × k */
export interface ClockPiece {
  f0: number;
  f1: number;
  t0: number;
  /** ms per frame on the shared clock (1000 / rate for a perfect clock) */
  k: number;
}

/** A jump in arrival time bigger than this, that lasts, is missing audio rather than jitter. */
export const GAP_MS = 120;

const lsSlope = (groups: SyncPoint[][]) => {
  // One slope for every piece (a device's clock runs at one speed), each with its own offset.
  let num = 0;
  let den = 0;
  for (const g of groups) {
    const fm = g.reduce((s, p) => s + p[0], 0) / g.length;
    const tm = g.reduce((s, p) => s + p[1], 0) / g.length;
    for (const [f, t] of g) {
      num += (f - fm) * (t - tm);
      den += (f - fm) ** 2;
    }
  }
  return den > 0 ? num / den : NaN;
};

/** Whether slope `k` differs from `nominal` by more than 3 standard errors, with enough points to say. */
function significant(groups: SyncPoint[][], k: number, nominal: number) {
  const n = groups.reduce((s, g) => s + g.length, 0);
  if (n < 6) return false;
  let rss = 0;
  let sxx = 0;
  for (const g of groups) {
    const fm = g.reduce((s, p) => s + p[0], 0) / g.length;
    const tm = g.reduce((s, p) => s + p[1], 0) / g.length;
    for (const [f, t] of g) {
      rss += (t - tm - k * (f - fm)) ** 2;
      sxx += (f - fm) ** 2;
    }
  }
  const se = Math.sqrt(rss / Math.max(1, n - 1 - groups.length)) / Math.sqrt(sxx);
  return Math.abs(k - nominal) > 3 * se;
}

/** The low end of the residuals: chunks only ever arrive late, never early. */
const floor = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * 0.2)];
};

/**
 * The track's clock: pieces of steady audio separated by gaps. `frames` is the
 * track's length; `start` (ms) is used when there are too few points to fit.
 */
export function fitClock(points: SyncPoint[], rate: number, frames: number, start = 0): ClockPiece[] {
  const nominal = 1000 / rate;
  const pts = [...points].filter(([f]) => f > 0).sort((a, b) => a[0] - b[0]);
  if (pts.length < 3) {
    const t0 = pts.length ? pts[0][1] - pts[0][0] * nominal : start;
    return [{ f0: 0, f1: frames, t0, k: nominal }];
  }
  let k = lsSlope([pts]);
  if (!(k > nominal * 0.99 && k < nominal * 1.01)) k = nominal;
  // Split where the arrival time steps up and stays up: that's missing audio.
  const res = pts.map(([f, t]) => t - f * k);
  const cuts: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const before = Math.min(...res.slice(Math.max(0, i - 2), i + 1));
    const after = Math.min(...res.slice(i + 1, i + 4));
    if (after - before > GAP_MS && res[i + 1] - res[i] > GAP_MS) cuts.push(i);
  }
  // Neighbouring detections of the same gap: keep the biggest single step.
  const merged: number[] = [];
  for (const c of cuts) {
    const last = merged[merged.length - 1];
    if (last != null && c - last <= 3) {
      if (res[c + 1] - res[c] > res[last + 1] - res[last]) merged[merged.length - 1] = c;
    } else merged.push(c);
  }
  const groups: SyncPoint[][] = [];
  let from = 0;
  for (const c of [...merged, pts.length - 1]) {
    groups.push(pts.slice(from, c + 1));
    from = c + 1;
  }
  // Only believe a measured drift that stands clear of the jitter: a short or noisy
  // recording would otherwise "correct" drift that isn't there.
  const fitted = groups.filter((g) => g.length >= 2);
  const pooled = lsSlope(fitted);
  k = pooled > nominal * 0.99 && pooled < nominal * 1.01 && significant(fitted, pooled, nominal) ? pooled : nominal;
  return groups.map((g, i) => ({
    // The gap sits between the last point before it and the first after it.
    f0: i === 0 ? 0 : groups[i - 1][groups[i - 1].length - 1][0],
    f1: i === groups.length - 1 ? frames : g[g.length - 1][0],
    t0: floor(g.map(([f, t]) => t - f * k)),
    k,
  })).map((p) => ({ ...p, t0: p.t0 + p.f0 * p.k }));
}

/** Shared-clock time (ms) of a frame. */
export function timeAt(pieces: ClockPiece[], f: number): number {
  const p = pieces.find((x) => f < x.f1) ?? pieces[pieces.length - 1];
  return p.t0 + (f - p.f0) * p.k;
}

/** Shared-clock time (ms) at the start of the track. */
export const startTime = (pieces: ClockPiece[]) => pieces[0].t0;

/** How the guest's audio maps onto the host's: host frames [h0, h1) come from guest frames starting at g0, ρ guest frames per host frame. */
interface Block {
  h0: number;
  h1: number;
  g0: number;
  rho: number;
}

export interface SyncMap {
  blocks: Block[];
  /** Guest audio clock vs the host's, parts per million (positive: the guest's ran fast) */
  ppm: number;
  /** How far apart the tracks would have drifted by the end, ms */
  driftMs: number;
  /** Stretches (s) the guest's recording is missing, filled with silence */
  gaps: number;
  /** Guest audio (s) from while the host's mic was stopped, left out */
  dropped: number;
  /** The host's start minus the guest's, s (positive: the guest started first) */
  offset: number;
}

/**
 * The guest's track on the host's timeline. Both fits come from fitClock() on
 * the same shared clock.
 */
export function syncGuest(host: ClockPiece[], guest: ClockPiece[], hostRate: number): SyncMap {
  const blocks: Block[] = [];
  const span = (p: ClockPiece) => [p.t0, p.t0 + (p.f1 - p.f0) * p.k] as const;
  for (const g of guest) {
    const [gT0, gT1] = span(g);
    for (const h of host) {
      const [hT0, hT1] = span(h);
      const a = Math.max(gT0, hT0);
      const b = Math.min(gT1, hT1);
      if (b <= a) continue;
      blocks.push({
        h0: Math.round(h.f0 + (a - hT0) / h.k),
        h1: Math.round(h.f0 + (b - hT0) / h.k),
        g0: g.f0 + (a - gT0) / g.k,
        rho: h.k / g.k,
      });
    }
  }
  // Guest audio from while the host's mic was stopped (between host pieces).
  let dropped = 0;
  for (let i = 1; i < host.length; i++) {
    const a0 = span(host[i - 1])[1];
    const b0 = span(host[i])[0];
    for (const g of guest) {
      const [gT0, gT1] = span(g);
      dropped += Math.max(0, Math.min(b0, gT1) - Math.max(a0, gT0)) / 1000;
    }
  }
  blocks.sort((x, y) => x.h0 - y.h0);
  const hostFrames = host[host.length - 1].f1;
  const rho = host[0].k / guest[0].k;
  // Host time the guest has no audio for, between its first and last blocks.
  let gaps = 0;
  for (let i = 1; i < blocks.length; i++) gaps += Math.max(0, blocks[i].h0 - blocks[i - 1].h1) / hostRate;
  return {
    blocks,
    ppm: (rho - 1) * 1e6,
    driftMs: Math.abs(rho - 1) * (hostFrames / hostRate) * 1000,
    gaps,
    dropped,
    offset: (startTime(host) - startTime(guest)) / 1000,
  };
}

/** Frame ranges past any real audio read as silence in rangesWav(). */
export const SILENT = 1e8;

/**
 * Host-timeline ranges (seconds) as guest-audio ranges (seconds) for
 * rangesWav(). Every output frame has one input frame, so the result is
 * exactly as long as the host's; drift shows up as one-frame slips, spaced
 * evenly, and host time with no guest audio as silence.
 */
export function guestRanges(map: SyncMap, ranges: [number, number][], hostRate: number, guestRate: number): [number, number][] {
  const out: [number, number][] = [];
  const silence = (n: number) => {
    if (n > 0) out.push([SILENT, SILENT + n / guestRate]);
  };
  for (const [a, b] of ranges) {
    let x = Math.round(a * hostRate);
    const end = Math.round(b * hostRate);
    for (const blk of map.blocks) {
      if (x >= end) break;
      if (blk.h1 <= x) continue;
      if (blk.h0 > x) {
        const n = Math.min(blk.h0, end) - x;
        silence(n);
        x += n;
        if (x >= end) break;
      }
      const stop = Math.min(blk.h1, end);
      // A slip every `step` frames keeps the guest within half a frame of true.
      const dev = Math.abs(blk.rho - 1);
      const step = dev > 1e-9 ? Math.max(1, Math.floor(1 / dev)) : Infinity;
      while (x < stop) {
        const next = Math.min(stop, x + step);
        const g = Math.round(blk.g0 + (x - blk.h0) * blk.rho);
        out.push([g / guestRate, (g + next - x) / guestRate]);
        x = next;
      }
    }
    silence(end - x);
  }
  // Join touching ranges so the file is built from as few pieces as possible.
  const joined: [number, number][] = [];
  for (const r of out) {
    const last = joined[joined.length - 1];
    if (last && Math.abs(last[1] - r[0]) * guestRate < 0.5 && r[0] < SILENT) last[1] = r[1];
    else joined.push([r[0], r[1]]);
  }
  return joined;
}

/** A host-timeline moment (s) in the guest's audio (s), or null if the guest has no audio then. */
export function guestTime(map: SyncMap, s: number, hostRate: number, guestRate: number): number | null {
  const x = s * hostRate;
  const blk = map.blocks.find((b) => x >= b.h0 && x < b.h1);
  return blk ? (blk.g0 + (x - blk.h0) * blk.rho) / guestRate : null;
}

/** Broadcast WAV (EBU Tech 3285) timecode: where a file starts, as samples since local midnight. */
export interface Bext {
  description: string;
  originator: string;
  reference: string;
  /** Start of the file, ms since the epoch (shared clock) */
  start: number;
  sampleRate: number;
}

/** The bext chunk, 8-byte header included (610 bytes). */
export function bextChunk(b: Bext): Uint8Array {
  const out = new Uint8Array(8 + 602);
  const v = new DataView(out.buffer);
  const put = (off: number, len: number, s: string) => {
    for (let i = 0; i < Math.min(len, s.length); i++) out[off + i] = s.charCodeAt(i) & 0x7f;
  };
  put(0, 4, 'bext');
  v.setUint32(4, 602, true);
  const d = new Date(b.start);
  const p2 = (n: number) => String(n).padStart(2, '0');
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const samples = Math.round(((b.start - midnight) / 1000) * b.sampleRate);
  put(8, 256, b.description);
  put(8 + 256, 32, b.originator);
  put(8 + 288, 32, b.reference);
  put(8 + 320, 10, `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`);
  put(8 + 330, 8, `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`);
  v.setUint32(8 + 338, samples % 2 ** 32, true);
  v.setUint32(8 + 342, Math.floor(samples / 2 ** 32), true);
  v.setUint16(8 + 346, 1, true); // version 1: no loudness fields
  return out;
}

/** Timecode (HH:MM:SS:FF at 25 fps, like most audio tools show it) for a bext start. */
export function timecode(start: number): string {
  const d = new Date(start);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}:${p2(Math.floor(d.getMilliseconds() / 40))}`;
}
