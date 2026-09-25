/*
 * Drives the mixer lanes (Mixer View 1b): levels in, history bars, meters,
 * status and talk time out. The host's level comes from this page's mic; the
 * guest's from their page, about twice a second, over the session.
 */
import { BAD, OK, WARN, segmentMeter, toFraction } from './audio/meter';
import { LevelHistory, TalkTime, laneStatus, HISTORY_SECONDS } from './mixer';

const SEGMENTS = 30;
const dbText = (db: number) => (Number.isFinite(db) ? `${String(Math.round(Math.min(0, db)) || 0).replace('-', '−')} dB` : '— dB');
const zoneOf = (db: number) => (db > -6 ? BAD : db >= -18 ? WARN : OK);

interface Lane {
  el: HTMLElement;
  name: string;
  history: LevelHistory;
  bars: HTMLElement[];
  meter: (db: number) => void;
  /** Peak since the last draw, and the held reading */
  peak: number;
  held: number[];
}

export function mountMixer(root: HTMLElement, names: { host: string; guest: string }, recording: () => boolean) {
  const view = root.querySelector<HTMLElement>('[data-mixer]')!;
  view.hidden = false;
  const talk = new TalkTime();
  const lanes: Record<'host' | 'guest', Lane> = {} as never;
  for (const who of ['host', 'guest'] as const) {
    const el = view.querySelector<HTMLElement>(`[data-lane="${who}"]`)!;
    const history = el.querySelector<HTMLElement>('[data-lane-history]')!;
    const bars = Array.from({ length: HISTORY_SECONDS }, () => {
      const b = document.createElement('span');
      b.className = 'min-w-0 flex-1 rounded-[2px]';
      history.append(b);
      return b;
    });
    const meterRow = el.querySelector<HTMLElement>('[data-lane-meter]')!;
    const segs = Array.from({ length: SEGMENTS }, () => {
      const s = document.createElement('span');
      s.className = 'h-2.5 min-w-0 flex-1 rounded-[2px]';
      meterRow.append(s);
      return s;
    });
    lanes[who] = { el, name: names[who], history: new LevelHistory(), bars, meter: segmentMeter(segs), peak: -Infinity, held: [] };
    el.querySelector('[data-lane-name]')!.textContent = names[who];
  }
  talk.add(names.host, -Infinity, 0);
  talk.add(names.guest, -Infinity, 0);

  const t0 = performance.now();
  const level = (who: 'host' | 'guest', db: number) => {
    const lane = lanes[who];
    lane.peak = Math.max(lane.peak, db);
    lane.history.push(db, (performance.now() - t0) / 1000);
  };

  // Talk time: every quarter second, whoever is above the threshold, while recording.
  let guestDb = -Infinity;
  let guestAt = 0;
  let hostDb = -Infinity;
  setInterval(() => {
    if (!recording()) return;
    talk.add(names.host, hostDb, 0.25);
    talk.add(names.guest, Date.now() - guestAt < 2000 ? guestDb : -Infinity, 0.25);
  }, 250);

  const draw = () => {
    for (const who of ['host', 'guest'] as const) {
      const lane = lanes[who];
      if (who === 'guest' && Date.now() - guestAt > 2000) level('guest', -Infinity);
      lane.held.push(lane.peak);
      if (lane.held.length > 6) lane.held.shift();
      if (who === 'host') hostDb = lane.peak;
      lane.meter(lane.peak);
      lane.peak = -Infinity;
      const shown = Math.max(...lane.held);
      const status = laneStatus(shown);
      const db = lane.el.querySelector<HTMLElement>('[data-lane-db]')!;
      db.textContent = dbText(shown);
      db.style.color = status === 'HOT' ? BAD : status === 'IDLE' ? 'var(--color-muted)' : '';
      lane.el.querySelector('[data-lane-status]')!.textContent = status;
      lane.el.style.borderColor = status === 'IDLE' ? '' : `color-mix(in oklab, ${zoneOf(shown)} 45%, transparent)`;
      lane.history.bars.forEach((v, i) => {
        const b = lane.bars[i];
        const quiet = !Number.isFinite(v) || v < -40;
        b.style.height = quiet ? '6px' : `${Math.max(14, toFraction(v) * 100)}%`;
        b.style.background = quiet ? 'var(--color-raised)' : zoneOf(v);
      });
    }
    const shares = talk.shares();
    const h = shares[names.host] ?? 0;
    const g = shares[names.guest] ?? 0;
    root.querySelector('[data-talk-text]')!.textContent = h + g ? `TALK ${names.host} ${h}% · ${names.guest} ${g}%` : 'TALK —';
    root.querySelector<HTMLElement>('[data-talk-host]')!.style.width = `${h}%`;
    root.querySelector<HTMLElement>('[data-talk-guest]')!.style.width = `${g}%`;
  };
  setInterval(draw, 250);

  return {
    host: (db: number) => level('host', db),
    guest: (db: number) => {
      guestDb = db;
      guestAt = Date.now();
      level('guest', db);
    },
    setName(who: 'host' | 'guest', name: string) {
      if (lanes[who].name === name) return;
      const secs = talk.seconds[lanes[who].name] ?? 0;
      delete talk.seconds[lanes[who].name];
      talk.seconds[name] = secs;
      lanes[who].name = name;
      names[who] = name;
      lanes[who].el.querySelector('[data-lane-name]')!.textContent = name;
    },
    setMeta(who: 'host' | 'guest', text: string) {
      lanes[who].el.querySelector('[data-lane-meta]')!.textContent = text;
    },
  };
}
