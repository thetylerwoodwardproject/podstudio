export type SaveStatus = 'saving' | 'saved' | 'waiting' | 'error';

export interface SaveStatusDetail {
  status: SaveStatus;
}

export const SAVE_STATUS_EVENT = 'podstudio:save-status';

export function reportSaveStatus(status: SaveStatus) {
  window.dispatchEvent(new CustomEvent<SaveStatusDetail>(SAVE_STATUS_EVENT, { detail: { status } }));
}

/** Report one server write. Overlapping writes stay "Saving" until the last finishes. */
let pending = 0;
let worst: SaveStatus = 'saved';
export function beginSave() {
  pending += 1;
  reportSaveStatus('saving');
  let finished = false;
  return (status: Exclude<SaveStatus, 'saving'>) => {
    if (finished) return;
    finished = true;
    pending = Math.max(0, pending - 1);
    if (status === 'error' || (status === 'waiting' && worst !== 'error')) worst = status;
    if (!pending) {
      reportSaveStatus(worst === 'saved' ? status : worst);
      worst = 'saved';
    }
  };
}
