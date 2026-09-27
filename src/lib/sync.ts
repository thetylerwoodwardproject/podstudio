/*
 * Changes made in this browser, sent to the server. Each save is written to
 * localStorage first (pages read it from there) and marked unsent until the
 * server has it, so an edit made offline goes up on the next page load and
 * isn't overwritten by the server's older copy meanwhile (EpisodeData).
 *
 * Scripts carry a version: if someone else changed it since this browser
 * loaded it, the server's copy wins here and a `podstudio:script-conflict`
 * event says so.
 */
import { ApiError, api } from './api';
import { beginSave } from './save-status';

const dirty = (key: string) => `${key}:dirty`;
const mark = (key: string, on: boolean) => {
  try {
    if (on) localStorage.setItem(dirty(key), '1');
    else localStorage.removeItem(dirty(key));
  } catch {}
};
const get = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/** Try a save; keep it marked unsent if the server can't be reached. */
async function send(key: string, run: () => Promise<unknown>) {
  mark(key, true);
  const finish = beginSave();
  try {
    await run();
    mark(key, false);
    finish('saved');
  } catch (err) {
    // Not signed in (a guest's page): it stays in this browser only.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 409) {
      mark(key, false);
      finish('error');
    } else finish('waiting');
  }
}

const scriptKey = (id: string) => `podstudio:script:${id}`;

export function pushScript(episodeId: string) {
  const key = scriptKey(episodeId);
  return send(key, async () => {
    const text = get(key);
    const base = Number(get(`${key}:v`) ?? 0);
    if (text == null) {
      await api(`episodes/${encodeURIComponent(episodeId)}/script`, { method: 'DELETE' });
      localStorage.setItem(`${key}:v`, '0');
      return;
    }
    try {
      const r = await api<{ version: number }>(`episodes/${encodeURIComponent(episodeId)}/script`, { method: 'PUT', body: { text, base: base || undefined } });
      localStorage.setItem(`${key}:v`, String(r.version));
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 409) throw err;
      // Changed elsewhere since this browser loaded it: take that copy.
      const cur = await api<{ script: { text: string; version: number } | null }>(`episodes/${encodeURIComponent(episodeId)}`);
      if (cur.script) {
        localStorage.setItem(key, cur.script.text);
        localStorage.setItem(`${key}:v`, String(cur.script.version));
      }
      mark(key, false);
      dispatchEvent(new CustomEvent('podstudio:script-conflict', { detail: { episodeId } }));
    }
  });
}

export function pushShow(episodeId: string) {
  const key = `podstudio:show:${episodeId}`;
  return send(key, () => api(`episodes/${encodeURIComponent(episodeId)}/setup`, { method: 'PUT', body: JSON.parse(get(key) || '{}') }));
}

export function pushPads(episodeId: string | null) {
  const key = episodeId ? `podstudio:pads:ep:${episodeId}` : 'podstudio:pads:show';
  return send(key, () => api(episodeId ? `pads/episode/${encodeURIComponent(episodeId)}` : 'pads/show', { method: 'PUT', body: JSON.parse(get(key) || '[]') }));
}

/** Send whatever this browser changed for an episode but couldn't send yet. */
export function flushPending(episodeId: string) {
  if (get(dirty(scriptKey(episodeId)))) pushScript(episodeId);
  if (get(dirty(`podstudio:show:${episodeId}`))) pushShow(episodeId);
  if (get(dirty('podstudio:pads:show'))) pushPads(null);
  if (get(dirty(`podstudio:pads:ep:${episodeId}`))) pushPads(episodeId);
}

/** Refresh this browser's copy of an episode's data (for pages that aren't rendered with it). */
export async function pullEpisode(episodeId: string) {
  try {
    const d = await api<{ script: { text: string; version: number } | null; setup: unknown; pads: { show: unknown[]; episode: unknown[] } }>(`episodes/${encodeURIComponent(episodeId)}`);
    const put = (key: string, value: string | null) => {
      if (localStorage.getItem(dirty(key))) return;
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    };
    put(scriptKey(episodeId), d.script?.text ?? null);
    put(`podstudio:show:${episodeId}`, d.setup ? JSON.stringify(d.setup) : null);
    put('podstudio:pads:show', JSON.stringify(d.pads.show));
    put(`podstudio:pads:ep:${episodeId}`, JSON.stringify(d.pads.episode));
  } catch {}
}
