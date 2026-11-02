// Undo/redo over immutable project documents. Edits are pure, so a history is just a list of
// snapshots (structurally shared, so cheap). `commit` clears redo; a run of edits with the same
// `group` key within `mergeMs` (dragging a gain slider, nudging) collapses into one undo step.
import type { ProjectDoc } from "./document";

export interface History {
  past: { doc: ProjectDoc; group?: string; at: number }[];
  present: ProjectDoc;
  future: ProjectDoc[];
  presentGroup?: string;
  presentAt: number;
}

export const HISTORY_LIMIT = 200;

export const createHistory = (doc: ProjectDoc): History => ({ past: [], present: doc, future: [], presentAt: 0 });

export function commit(h: History, doc: ProjectDoc, opts: { group?: string; now?: number; mergeMs?: number } = {}): History {
  if (doc === h.present) return h;
  const now = opts.now ?? Date.now();
  const merge = opts.group !== undefined && opts.group === h.presentGroup && now - h.presentAt <= (opts.mergeMs ?? 800) && h.past.length > 0;
  const past = merge ? h.past : [...h.past, { doc: h.present, group: h.presentGroup, at: h.presentAt }].slice(-HISTORY_LIMIT);
  return { past, present: doc, future: [], presentGroup: opts.group, presentAt: now };
}

export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;

export function undo(h: History): History {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return { past: h.past.slice(0, -1), present: prev.doc, future: [h.present, ...h.future], presentGroup: prev.group, presentAt: 0 };
}

export function redo(h: History): History {
  const [next, ...rest] = h.future;
  if (!next) return h;
  return { past: [...h.past, { doc: h.present, group: h.presentGroup, at: h.presentAt }], present: next, future: rest, presentGroup: undefined, presentAt: 0 };
}
