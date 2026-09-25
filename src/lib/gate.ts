/*
 * Which browsers can run Podstudio, decided before a page renders (Base.astro
 * inlines these two functions, so they must not use anything outside themselves).
 *
 * - Everything needs a secure context (https:// or localhost): the mic, the
 *   recording storage and audio processing don't exist without one.
 * - Computers and Android: Chromium only (voice follow, MediaRecorder PCM).
 * - iPhone and iPad: every browser is WebKit, and Safari's user agent has
 *   reported iOS 18.6 since iOS 26, so it's judged on features, not version.
 */

export interface GateEnv {
  secure: boolean;
  ua: string;
  platform: string;
  touchPoints: number;
  chromium: boolean;
  worklet: boolean;
  opfs: boolean;
  mic: boolean;
  locks: boolean;
}

export interface GateResult {
  /** null: allowed */
  reason: null | 'insecure' | 'browser' | 'ios-old';
  failed: string[];
}

export function readEnv(): GateEnv {
  const nav = navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } };
  const brands = nav.userAgentData && nav.userAgentData.brands;
  return {
    secure: !!window.isSecureContext,
    ua: nav.userAgent,
    platform: nav.platform,
    touchPoints: nav.maxTouchPoints || 0,
    chromium: brands ? brands.some((b) => b.brand === 'Chromium') : 'chrome' in window,
    worklet: 'AudioWorkletNode' in window,
    opfs: !!(nav.storage && nav.storage.getDirectory),
    mic: !!(nav.mediaDevices && nav.mediaDevices.getUserMedia),
    locks: !!nav.locks,
  };
}

export function gateReason(env: GateEnv): GateResult {
  const failed: string[] = [];
  if (!env.secure) failed.push('secure context (https)');
  if (!env.worklet) failed.push('AudioWorklet');
  if (!env.opfs) failed.push('private file storage (OPFS)');
  if (!env.mic) failed.push('microphone access');
  if (!env.locks) failed.push('Web Locks');
  if (!env.secure) return { reason: 'insecure', failed };
  const ios = /iPhone|iPad|iPod/.test(env.ua) || (env.platform === 'MacIntel' && env.touchPoints > 1);
  if (ios) return { reason: failed.length ? 'ios-old' : null, failed };
  if (!env.chromium) return { reason: 'browser', failed: ['Chrome, Edge or another Chromium browser', ...failed] };
  return { reason: failed.length ? 'browser' : null, failed };
}
