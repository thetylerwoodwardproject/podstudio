/*
 * Which device this is, for the few places that behave differently on an iPhone
 * or iPad (every browser there is WebKit: no Chrome voice follow, no PCM
 * MediaRecorder, and the mic stops when the page leaves the screen).
 */
export const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isAndroid = () => /Android/.test(navigator.userAgent);

/** A phone or tablet: touch first, bottom sheet instead of popover. */
export const isTouch = () => matchMedia('(pointer: coarse)').matches;
