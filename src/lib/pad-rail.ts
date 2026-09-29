/*
 * Hotkey pads on the recording screen. On a laptop, the rail on the right
 * (Hotkey Pads 1a). On a phone or tablet, a swipeable strip above the control
 * bar that pulls up into the full grid (2a–2b). Both draw the same pads, fire
 * them on tap or click, and show what's playing. Keys are handled by the page,
 * which knows when pads are armed.
 */
import { isMobile } from './mobile';
import { PadEngine, type Playing } from './audio/pad-engine';
import { loadPadSettings, padColor, padInk, padLength, padTag, padsFor, savePadSettings, type Pad } from './pads';
import { detentBetween, faderPos, faderTop, slideLevel } from './pad-fader';

const minSec = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const dbText = (db: number) => `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(Math.round(db))} dB`;

/** The rail needs a laptop or desktop with a mouse; phones and touch tablets get the strip. */
export const padsAvailable = () => matchMedia('(min-width: 1024px)').matches && !matchMedia('(pointer: coarse)').matches;

export interface PadRail {
  engine: PadEngine;
  pads: (Pad & { override: boolean })[];
  /** 'rail' on a laptop, 'strip' on a phone or tablet */
  layout: 'rail' | 'strip';
  /** Fire a pad from its key; false when nothing is on it */
  press(key: number): boolean;
  release(key: number): void;
  stopAll(): void;
  fadeAll(): void;
  padFor(key: number): Pad | undefined;
}

type PadInfo = Pad & { override: boolean };

/**
 * One pad button. `tap` fires on click (so a swipe along the strip doesn't fire
 * anything); otherwise it fires on press. Hold pads always play from press to release.
 */
function padButton(key: number, p: PadInfo | undefined, engine: PadEngine, armed: () => boolean, o: { size: string; tap: boolean; onEmpty: () => void; onFire?: (p: PadInfo) => void }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.padKey = String(key);
  b.className = `relative flex min-w-0 flex-col justify-between overflow-hidden rounded-xl p-2.5 text-left transition-shadow select-none ${o.size}`;
  b.style.setProperty('-webkit-touch-callout', 'none');
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  if (!p) {
    b.className += ' border border-dashed border-edge-strong text-subtle hover:border-fg';
    b.innerHTML = `<span class="font-mono text-[18px] leading-none font-medium">${key}</span><span class="text-[12px] leading-tight">Empty · click to assign</span>`;
    b.addEventListener('click', o.onEmpty);
    return b;
  }
  b.style.background = padColor(p.color);
  b.style.color = padInk(p.color);
  b.innerHTML = `
    <span class="flex items-start justify-between gap-1">
      <span class="font-mono text-[18px] leading-none font-medium">${key}</span>
      <span class="font-mono text-[9px] tracking-[0.06em] opacity-70" data-tag></span>
    </span>
    <span class="min-w-0">
      <span class="line-clamp-2 text-[13px] leading-tight font-semibold" data-name></span>
      <span class="mt-0.5 block font-mono text-[10px] opacity-75" data-dur></span>
    </span>
    <span class="absolute bottom-0 left-0 h-[3px] bg-black/45" style="width:0" data-progress></span>
    ${p.override ? '<span class="absolute top-1.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-black/60" title="This episode only"></span>' : ''}`;
  b.querySelector('[data-tag]')!.textContent = padTag(p);
  b.querySelector('[data-name]')!.textContent = p.name;
  b.querySelector('[data-dur]')!.textContent = minSec(padLength(p));
  b.title = `${key} · ${p.name}`;
  const fire = () => {
    if (!armed()) return;
    engine.press(key);
    o.onFire?.(p);
  };
  if (o.tap && p.mode !== 'hold') b.addEventListener('click', fire);
  else {
    b.addEventListener('pointerdown', (e) => {
      if (!o.tap) b.setPointerCapture(e.pointerId);
      fire();
    });
    // A swipe that starts on a hold pad cancels the pointer, which stops it too.
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => engine.release(key));
  }
  return b;
}

export async function mountPadRail(root: HTMLElement, episodeId: string, armed: () => boolean): Promise<PadRail | null> {
  if (isMobile()) return null;
  const pads = padsFor(episodeId);
  if (!pads.length) return null;
  const layout = padsAvailable() ? 'rail' : 'strip';
  const settings = loadPadSettings();
  const engine = new PadEngine(settings);
  const loaded = engine.load(pads);
  const byKey = new Map(pads.map((p) => [p.key, p]));
  const recording = () => /rec|paused/.test(root.dataset.state ?? '');
  const setLabel = pads.some((p) => p.override) ? 'PADS · SHOW SET + THIS EPISODE' : 'PADS · SHOW SET';
  const editor = (key?: number) => `/settings/pads?episode=${episodeId}${key ? `&key=${key}` : ''}`;
  // The editor opens in a new tab while recording, so nothing here stops.
  const openEditor = (key?: number) => (recording() ? window.open(editor(key), '_blank') : (location.href = editor(key)));
  const editLink = (a: HTMLAnchorElement) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openEditor();
    });

  /** Every drawn button per key: the rail's, or the strip's and the sheet's. */
  const buttons = new Map<number, HTMLButtonElement[]>();
  const add = (key: number, b: HTMLButtonElement) => buttons.set(key, [...(buttons.get(key) ?? []), b]);

  let update: (playing: Playing[]) => void = () => {};
  if (layout === 'rail') update = mountRail();
  else update = mountStrip();

  function mountRail() {
    const rail = root.querySelector<HTMLElement>('[data-pad-rail]')!;
    const $ = <T extends HTMLElement = HTMLElement>(s: string) => rail.querySelector<T>(s)!;
    rail.style.display = '';
    $('[data-pad-set]').textContent = setLabel;
    editLink($<HTMLAnchorElement>('[data-pad-edit]'));
    const grid = $('[data-pad-grid]');
    for (let key = 1; key <= 9; key++) {
      const b = padButton(key, byKey.get(key), engine, armed, { size: 'aspect-[1.05]', tap: false, onEmpty: () => openEditor(key) });
      add(key, b);
      grid.append(b);
    }
    $('[data-pad-stop]').addEventListener('click', () => engine.stopAll());
    $('[data-pad-fade]').addEventListener('click', () => engine.fadeAll(2));

    const volume = $<HTMLInputElement>('[data-pad-volume]');
    volume.value = String(settings.volumeDb);
    const showVolume = () => ($('[data-pad-volume-text]').textContent = dbText(settings.volumeDb));
    showVolume();
    volume.addEventListener('input', () => {
      engine.setVolume(Number(volume.value));
      savePadSettings({ volumeDb: settings.volumeDb });
      showVolume();
    });
    const duckBtn = $('[data-pad-duck]');
    const duckDb = () => {
      const amounts = pads.filter((p) => p.duck).map((p) => p.duckDb);
      return amounts.length ? Math.max(...amounts) : 12;
    };
    const showDuck = () => {
      duckBtn.textContent = settings.duck ? `On · −${duckDb()} dB` : 'Off';
      duckBtn.setAttribute('aria-checked', String(settings.duck));
    };
    showDuck();
    duckBtn.addEventListener('click', () => {
      settings.duck = !settings.duck;
      savePadSettings({ duck: settings.duck });
      showDuck();
    });

    const checkSpeakers = async () => ($('[data-pad-speakers]').hidden = !(await engine.onSpeakers()));
    checkSpeakers();
    navigator.mediaDevices?.addEventListener?.('devicechange', checkSpeakers);

    const now = $('[data-pad-now]');
    return (playing: Playing[]) => {
      // The card shows the most recent long pad (a loop, or anything over 10 s).
      const long = playing.filter((p) => p.pad.mode === 'loop' || p.len > 10).at(-1);
      now.hidden = !long;
      if (long) {
        const left = long.pad.mode === 'loop' ? long.len - (long.pos % long.len) : long.len - long.pos;
        $('[data-pad-now-dot]').style.background = padColor(long.pad.color);
        $('[data-pad-now-name]').textContent = `${long.key} · ${long.pad.name}`;
        $('[data-pad-now-meta]').textContent = `${padTag(long.pad)} · ${minSec(left)} left`;
        const bar = $('[data-pad-now-bar]');
        bar.style.background = padColor(long.pad.color);
        bar.style.width = `${Math.min(100, ((long.pad.mode === 'loop' ? long.pos % long.len : long.pos) / (long.len || 1)) * 100)}%`;
        $('[data-pad-now-hint]').textContent = long.stopping
          ? 'Fading out…'
          : long.pad.mode === 'loop'
            ? `Press ${long.key} again to fade out (${(long.pad.fadeOutMs / 1000).toFixed(long.pad.fadeOutMs % 1000 ? 1 : 0)} s)`
            : `Press ${long.key} again to restart`;
        const lvl = engine.level();
        $('[data-pad-now-db]').textContent = Number.isFinite(lvl) ? dbText(lvl) : '';
      }
      const l = engine.latest;
      $('[data-pad-latest]').textContent = l ? `Last: ${l.key} · ${l.name} · ${minSec((Date.now() - l.at) / 1000)} ago` : 'Keys 1–9 fire pads · 0 stops all';
    };
  }

  function mountStrip() {
    const strip = root.querySelector<HTMLElement>('[data-pad-strip]')!;
    const sheet = root.querySelector<HTMLElement>('[data-pad-sheet]')!;
    const scrim = root.querySelector<HTMLElement>('[data-pad-sheet-scrim]')!;
    const q = <T extends HTMLElement = HTMLElement>(el: HTMLElement, s: string) => el.querySelector<T>(s)!;
    strip.style.display = '';
    const row = q(strip, '[data-pad-strip-row]');
    const grid = q(sheet, '[data-pad-sheet-grid]');
    q(sheet, '[data-pad-sheet-set]').textContent = setLabel;
    editLink(q<HTMLAnchorElement>(sheet, '[data-pad-sheet-edit]'));

    // Four pads across, with the fifth peeking to show there's more.
    for (let key = 1; key <= 9; key++) {
      const p = byKey.get(key);
      const inStrip = padButton(key, p, engine, armed, { size: 'h-[68px] w-[calc((100%-24px)/4.35)] flex-none snap-start', tap: true, onEmpty: () => openEditor(key) });
      add(key, inStrip);
      row.append(inStrip);
      // In the sheet, firing a one-shot drops you back to the strip.
      const inSheet = padButton(key, p, engine, armed, {
        size: 'aspect-[1.2]',
        tap: true,
        onEmpty: () => openEditor(key),
        onFire: (pad) => pad.mode === 'oneshot' && close(),
      });
      add(key, inSheet);
      grid.append(inSheet);
    }

    const open = () => {
      sheet.hidden = false;
      scrim.hidden = false;
      sheet.style.transform = '';
      root.dataset.padsOpen = '';
    };
    const close = () => {
      sheet.hidden = true;
      scrim.hidden = true;
      delete root.dataset.padsOpen;
    };
    q(strip, '[data-pad-strip-handle]').addEventListener('click', open);
    q(sheet, '[data-pad-sheet-handle]').addEventListener('click', close);
    scrim.addEventListener('click', close);
    q(sheet, '[data-pad-sheet-stop]').addEventListener('click', () => engine.stopAll());
    q(sheet, '[data-pad-sheet-fade]').addEventListener('click', () => engine.fadeAll(2));

    // Drag the strip's handle up to open; drag the sheet down to close.
    const drag = (el: HTMLElement, onMove: (dy: number) => boolean) => {
      let startY: number | null = null;
      el.addEventListener('pointerdown', (e) => {
        startY = e.clientY;
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', (e) => {
        if (startY != null && onMove(e.clientY - startY)) startY = null;
      });
      for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, () => (startY = null));
    };
    drag(q(strip, '[data-pad-strip-handle]'), (dy) => (dy < -24 ? (open(), true) : false));
    for (const el of [q(sheet, '[data-pad-sheet-handle]'), q(sheet, '[data-pad-sheet-head]')])
      drag(el, (dy) => {
        if (dy > 60) return close(), (sheet.style.transform = ''), true;
        sheet.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
        return false;
      });

    const fader = mountFader(strip, row);
    const status = q(strip, '[data-pad-strip-status]');
    const edges = { left: q(strip, '[data-pad-edge="left"]'), right: q(strip, '[data-pad-edge="right"]') };
    return (playing: Playing[]) => {
      const long = playing.filter((p) => p.pad.mode === 'loop' || p.len > 10).at(-1);
      const left = long ? (long.pad.mode === 'loop' ? long.len - (long.pos % long.len) : long.len - long.pos) : 0;
      status.textContent = playing.length ? `${playing.map((p) => p.key).join(' ')} PLAYING${long ? ` · ${minSec(left)}` : ''}` : '';
      // A playing pad scrolled out of view shows as a dot at that edge.
      const box = row.getBoundingClientRect();
      const off = { left: '', right: '' };
      for (const p of playing) {
        const b = buttons.get(p.key)?.[0];
        if (!b) continue;
        const r = b.getBoundingClientRect();
        if (r.right < box.left + 8) off.left ||= padColor(p.pad.color);
        else if (r.left > box.right - 8) off.right ||= padColor(p.pad.color);
      }
      for (const side of ['left', 'right'] as const) {
        edges[side].hidden = !off[side];
        edges[side].style.background = off[side];
      }
      const lvl = engine.level();
      q(sheet, '[data-pad-sheet-db]').textContent = Number.isFinite(lvl) && lvl > -60 ? dbText(lvl) : '—';
      fader.update(playing);
    };
  }

  /**
   * Press and slide (2c). Hold a playing loop or one-shot in the strip for
   * 350 ms and it becomes a full-width fader: slide to ride its level (logged
   * for the Pads track by the engine), with a tick at 0 dB and at its saved
   * level. It goes back to the strip 2 s after you let go, or when the pad stops.
   */
  function mountFader(strip: HTMLElement, row: HTMLElement) {
    const q = <T extends HTMLElement = HTMLElement>(s: string) => strip.querySelector<T>(s)!;
    const box = q('[data-pad-fader]');
    const track = q('[data-pad-fader-track]');
    const LONG_PRESS = 350;
    const SLOP = 8;
    const LINGER = 2000;
    let key: number | null = null;
    let db = 0;
    /** The slide in progress: where the finger and the level started */
    let ride: { x0: number; db0: number } | null = null;
    let closing: ReturnType<typeof setTimeout> | undefined;
    let swallowClick = false;

    const pad = () => (key != null ? byKey.get(key) : undefined);
    const draw = () => {
      const p = pad();
      if (!p) return;
      const f = faderPos(db, p.gainDb) * 100;
      const fill = q('[data-pad-fader-fill]');
      fill.style.width = `${f}%`;
      fill.style.background = `color-mix(in oklab, ${padColor(p.color)} 35%, transparent)`;
      q('[data-pad-fader-knob]').style.left = `calc(${f}% - 1px)`;
      q('[data-pad-fader-saved]').style.left = `${faderPos(p.gainDb, p.gainDb) * 100}%`;
      q('[data-pad-fader-db]').textContent = dbText(db);
    };
    const open = (k: number, levelDb: number) => {
      const p = byKey.get(k)!;
      key = k;
      db = levelDb;
      clearTimeout(closing);
      q('[data-pad-fader-dot]').style.background = padColor(p.color);
      q('[data-pad-fader-name]').textContent = `${k} · ${p.name}`;
      q('[data-pad-fader-top]').textContent = dbText(faderTop(p.gainDb));
      row.parentElement!.hidden = true;
      box.hidden = false;
      strip.dataset.riding = String(k);
      draw();
    };
    const close = () => {
      clearTimeout(closing);
      key = null;
      ride = null;
      box.hidden = true;
      row.parentElement!.hidden = false;
      delete strip.dataset.riding;
    };
    const linger = () => {
      clearTimeout(closing);
      closing = setTimeout(close, LINGER);
    };
    const slide = (x: number) => {
      const p = pad();
      if (!ride || !p || key == null) return;
      const next = slideLevel(ride.db0, x - ride.x0, track.clientWidth || row.clientWidth, p.gainDb);
      if (next === db) return;
      if (detentBetween(db, next, p.gainDb) != null) {
        navigator.vibrate?.(8);
        engine.tick();
      }
      db = next;
      engine.setLevel(key, db);
      draw();
    };

    // Long press on a strip pad. Touch events, so that once riding the slide
    // can stop the strip from scrolling (and the browser from cancelling it).
    let pending: { k: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
    row.addEventListener(
      'touchstart',
      (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pad-key]');
        const k = Number(b?.dataset.padKey);
        const t = e.touches[0];
        const playing = engine.playing().find((p) => p.key === k && !p.stopping);
        if (!b || !playing || playing.pad.mode === 'hold' || e.touches.length > 1) return;
        pending = {
          k,
          x: t.clientX,
          y: t.clientY,
          timer: setTimeout(() => {
            const now = engine.playing().find((p) => p.key === k && !p.stopping);
            if (!now || !pending) return;
            swallowClick = true;
            open(k, now.levelDb);
            ride = { x0: pending.x, db0: now.levelDb };
            pending = null;
            navigator.vibrate?.(8);
          }, LONG_PRESS),
        };
      },
      { passive: true },
    );
    row.addEventListener(
      'touchmove',
      (e) => {
        const t = e.touches[0];
        if (pending && Math.hypot(t.clientX - pending.x, t.clientY - pending.y) > SLOP) {
          clearTimeout(pending.timer);
          pending = null;
        }
        if (ride) {
          if (e.cancelable) e.preventDefault();
          slide(t.clientX);
        }
      },
      { passive: false },
    );
    const lift = () => {
      if (pending) clearTimeout(pending.timer);
      pending = null;
      if (ride) {
        ride = null;
        linger();
        // Not every browser sends a click after a long press; don't let the flag eat the next tap.
        setTimeout(() => (swallowClick = false), 400);
      }
    };
    row.addEventListener('touchend', lift);
    row.addEventListener('touchcancel', lift);
    // Letting go of a long press isn't a tap: don't fire (or fade) the pad.
    row.addEventListener(
      'click',
      (e) => {
        if (!swallowClick) return;
        swallowClick = false;
        e.stopPropagation();
        e.preventDefault();
      },
      true,
    );

    // Touching the fader again (before it goes back) keeps riding.
    track.addEventListener('pointerdown', (e) => {
      if (key == null) return;
      clearTimeout(closing);
      track.setPointerCapture(e.pointerId);
      ride = { x0: e.clientX, db0: db };
    });
    track.addEventListener('pointermove', (e) => slide(e.clientX));
    for (const ev of ['pointerup', 'pointercancel'])
      track.addEventListener(ev, () => {
        if (!ride) return;
        ride = null;
        linger();
      });
    q('[data-pad-fader-fade]').addEventListener('click', () => {
      if (key != null) engine.stop(key, 2);
      close();
    });
    q('[data-pad-fader-stop]').addEventListener('click', () => {
      if (key != null) engine.stop(key);
      close();
    });

    return {
      update(playing: Playing[]) {
        if (key == null) return;
        const p = playing.find((v) => v.key === key && !v.stopping);
        if (!p) return close();
        const left = p.pad.mode === 'loop' ? p.len - (p.pos % p.len) : p.len - p.pos;
        q('[data-pad-fader-meta]').textContent = `${padTag(p.pad)} · ${minSec(left)} left`;
      },
    };
  }

  // Rings, progress bars and time left, on every drawn copy of a pad.
  setInterval(() => {
    const playing = engine.playing();
    const on = new Map(playing.map((p) => [p.key, p]));
    for (const [key, list] of buttons) {
      const p = on.get(key);
      const pad = byKey.get(key);
      for (const b of list) {
        b.style.boxShadow = p ? '0 0 0 2px var(--color-void), 0 0 0 4px #fff' : '';
        const bar = b.querySelector<HTMLElement>('[data-progress]');
        if (bar) bar.style.width = p && p.len ? `${Math.min(100, ((p.pos % p.len) / p.len) * 100)}%` : '0';
        const dur = b.querySelector('[data-dur]');
        if (dur && pad) dur.textContent = p ? `${minSec(p.len - (p.pos % (p.len || 1)))} left` : minSec(padLength(pad));
      }
    }
    update(playing);
  }, 200);

  await loaded;
  for (const [key, list] of buttons)
    if (byKey.has(key) && !engine.playable(key))
      for (const b of list) {
        b.style.opacity = '0.45';
        b.title += ' · sound missing from this browser';
      }

  return {
    engine,
    pads,
    layout,
    press: (key) => (byKey.has(key) ? (engine.press(key), true) : false),
    release: (key) => engine.release(key),
    stopAll: () => engine.stopAll(),
    fadeAll: () => engine.fadeAll(2),
    padFor: (key) => byKey.get(key),
  };
}
