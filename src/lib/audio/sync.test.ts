import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bextChunk, fitClock, guestRanges, guestTime, SILENT, startTime, syncGuest, timeAt, type SyncPoint } from './sync.ts';

const RATE = 48000;

/** Deterministic pseudo-random numbers. */
const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/**
 * A simulated device: records for `seconds` of shared-clock time from `start`,
 * its audio clock off by `ppm`, audio arriving in 250 ms chunks up to `jitter`
 * ms late (with a few long stalls that catch up), and `gaps` (shared-clock
 * [from, to] ms) where no audio arrived at all. Logs the least-late chunk of
 * each 5 s segment, as TakeWriter does.
 */
function device({ start, seconds, ppm = 0, jitter = 30, gaps = [] as [number, number][], seed = 1 }) {
  const rand = rng(seed);
  const fps = RATE * (1 + ppm / 1e6); // frames per shared-clock second
  const points: SyncPoint[] = [];
  let frames = 0;
  let best: SyncPoint | null = null;
  let segFrames = 0;
  let exact = 0;
  for (let t = start; t < start + seconds * 1000; t += 250) {
    exact += (fps * 250) / 1000; // the device's frames, carried exactly
    if (gaps.some(([a, b]) => t >= a && t < b)) {
      exact = frames; // nothing captured
      continue;
    }
    const n = Math.round(exact) - frames;
    frames += n;
    segFrames += n;
    const late = rand() * jitter + (rand() < 0.01 ? 400 : 0); // the odd stall
    const p: SyncPoint = [frames, t + 250 + late];
    if (!best || p[1] - p[0] / fps * 1000 < best[1] - best[0] / fps * 1000) best = p;
    if (segFrames >= RATE * 5) {
      points.push(best!);
      best = null;
      segFrames = 0;
    }
  }
  return { points, frames, fps };
}

test('a steady clock fits to its real rate and start', () => {
  const d = device({ start: 1_000_000, seconds: 600, ppm: 40 });
  const fit = fitClock(d.points, RATE, d.frames);
  assert.equal(fit.length, 1);
  assert.ok(Math.abs(startTime(fit) - 1_000_000) < 15, `start off by ${startTime(fit) - 1_000_000} ms`);
  const ppm = (1000 / RATE / fit[0].k - 1) * 1e6;
  assert.ok(Math.abs(ppm - 40) < 5, `ppm ${ppm}`);
});

test('stalls that catch up are not gaps; missing audio is', () => {
  const d = device({ start: 0, seconds: 900, gaps: [[300_000, 302_000]], seed: 3 });
  const fit = fitClock(d.points, RATE, d.frames);
  assert.equal(fit.length, 2, 'one gap, one split');
  const lostMs = fit[1].t0 - timeAt(fit.slice(0, 1), fit[0].f1);
  assert.ok(Math.abs(lostMs - 2000) < 60, `gap measured as ${lostMs} ms`);
});

test('a drifting guest is mapped onto the host within 20 ms, for the whole recording', () => {
  const host = device({ start: 50_000, seconds: 2400, ppm: 0, seed: 5 });
  const guest = device({ start: 51_300, seconds: 2400, ppm: 60, seed: 9 }); // 60 ppm fast: 144 ms over 40 min
  const map = syncGuest(fitClock(host.points, RATE, host.frames), fitClock(guest.points, RATE, guest.frames), RATE);
  assert.ok(Math.abs(map.ppm - 60) < 6, `ppm ${map.ppm}`);
  assert.ok(map.driftMs > 120 && map.driftMs < 170, `drift ${map.driftMs}`);
  // A moment on the host's timeline (s) and where the guest really was then.
  for (const s of [5, 600, 1800, 2390]) {
    const truth = ((50_000 + s * 1000 - 51_300) / 1000) * guest.fps / RATE; // guest audio seconds
    const got = guestTime(map, s, RATE, RATE);
    if (s < 1.3) continue;
    assert.ok(got != null && Math.abs(got - truth) < 0.02, `at ${s}s: ${got} vs ${truth}`);
  }
});

test('guest ranges come out exactly as long as the host range, with silence where the guest has no audio', () => {
  const host = device({ start: 0, seconds: 600, seed: 2 });
  const guest = device({ start: 3000, seconds: 590, ppm: -80, gaps: [[200_000, 203_000]], seed: 4 });
  const map = syncGuest(fitClock(host.points, RATE, host.frames), fitClock(guest.points, RATE, guest.frames), RATE);
  const ranges = guestRanges(map, [[0, 300], [400, 500]], RATE, RATE);
  const frames = ranges.reduce((n, [a, b]) => n + Math.round(b * RATE) - Math.round(a * RATE), 0);
  assert.equal(frames, 400 * RATE, 'same length as the host ranges');
  const silent = ranges.filter(([a]) => a >= SILENT).reduce((n, [a, b]) => n + (b - a), 0);
  // 3 s before the guest joined, plus the 3 s gap.
  assert.ok(Math.abs(silent - 6) < 0.1, `silence ${silent}s`);
  assert.ok(Math.abs(map.gaps - 3) < 0.1, `gaps ${map.gaps}`);
});

test("guest audio from while the host's mic was stopped is left out", () => {
  const host = device({ start: 0, seconds: 600, gaps: [[100_000, 104_000]], seed: 6 });
  const guest = device({ start: 0, seconds: 600, seed: 7 });
  const map = syncGuest(fitClock(host.points, RATE, host.frames), fitClock(guest.points, RATE, guest.frames), RATE);
  assert.ok(Math.abs(map.dropped - 4) < 0.1, `dropped ${map.dropped}`);
  // After the host's gap, host 200 s (audio) is shared-clock 204 s: the guest is there too.
  const got = guestTime(map, 200, RATE, RATE)!;
  assert.ok(Math.abs(got - 204) < 0.02, `guest at ${got}`);
});

test('bext timecode: samples since local midnight', () => {
  const start = new Date(2026, 8, 26, 14, 30, 5, 500).getTime();
  const c = bextChunk({ description: 'Tyler', originator: 'Podstudio', reference: 'x', start, sampleRate: 48000 });
  const v = new DataView(c.buffer);
  assert.equal(String.fromCharCode(...c.slice(0, 4)), 'bext');
  assert.equal(v.getUint32(4, true), 602);
  assert.equal(c.length, 610);
  assert.equal(v.getUint32(8 + 338, true), (14 * 3600 + 30 * 60 + 5.5) * 48000);
  assert.equal(String.fromCharCode(...c.slice(8 + 320, 8 + 338)), '2026-09-2614:30:05');
});

test('a short recording has too few points to claim drift', () => {
  const host = device({ start: 0, seconds: 16, seed: 11 });
  const guest = device({ start: 400, seconds: 16, ppm: 0, jitter: 60, seed: 12 });
  const map = syncGuest(fitClock(host.points, RATE, host.frames), fitClock(guest.points, RATE, guest.frames), RATE);
  assert.equal(map.ppm, 0);
  assert.equal(map.driftMs, 0);
  assert.ok(Math.abs(map.offset + 0.4) < 0.03, `start offset ${map.offset}`);
});

test('no drift is corrected when there is none', () => {
  const host = device({ start: 0, seconds: 1800, seed: 13 });
  const guest = device({ start: 0, seconds: 1800, jitter: 60, seed: 14 });
  const map = syncGuest(fitClock(host.points, RATE, host.frames), fitClock(guest.points, RATE, guest.frames), RATE);
  assert.ok(map.driftMs < 15, `drift ${map.driftMs} ms`);
});
