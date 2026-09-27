// Moving through the Export step flow in browser tests.
const ORDER = ['edit', 'noise', 'tone', 'loud', 'export'];
/** Go to a step: by its tab once reached, else Next until there. */
export async function toStep(page, id) {
  await page.waitForSelector('[data-step-tab]');
  for (let i = 0; i < 6; i++) {
    const cur = await page.getAttribute('[data-step-tab][aria-current=step]', 'data-step-tab');
    if (cur === id) return;
    if (!(await page.isDisabled(`[data-step-tab="${id}"]`))) return page.click(`[data-step-tab="${id}"]`);
    if (ORDER.indexOf(cur) > ORDER.indexOf(id)) throw new Error(`can't go back to ${id}`);
    await page.click('[data-next]');
  }
}

/** Wrapping up: wait for the guest's track (Line up opens), then Review and Continue to export. */
export async function throughWrap(page, until, before = async () => {}) {
  const ready = await until(async () => !(await page.isDisabled('[data-step-tab=lineup]')), 30000);
  await page.click('[data-step-tab=lineup]');
  await before();
  await page.click('[data-step-tab=review]');
  await page.click('[data-continue]');
  return ready;
}

/** Export: open the file picker and download what's ticked. */
export async function pickAndDownload(page) {
  await page.click('[data-export]');
  await page.waitForSelector('[data-picker] [data-download]:not([disabled])');
  await page.click('[data-picker] [data-download]');
}

/**
 * Change the signed-in person's settings for a test, on the server and in this browser
 * (settings sync from the server, so editing localStorage alone would be undone).
 * `change` gets the current settings object and returns the new one ({} for the defaults).
 */
export async function resetSettings(page, change = (s) => s, { clear = false } = {}) {
  // On a page with no scripts of its own, so nothing reloads or syncs under it
  const back = page.url();
  const origin = new URL(back).origin;
  await page.goto(`${origin}/api/health`);
  await page.evaluate(async ([src, clear]) => {
    if (clear) localStorage.clear();
    const change = (0, eval)(src);
    const cur = JSON.parse(localStorage.getItem('podstudio:settings') || '{}');
    const next = change(cur) ?? cur;
    const { deviceId: _d, ...recording } = next.recording ?? {};
    const res = await fetch('/api/me/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { ...next, recording } }) });
    const r = await res.json();
    localStorage.setItem('podstudio:settings', JSON.stringify(next));
    localStorage.setItem('podstudio:settings:at', String(r.updatedAt));
    localStorage.removeItem('podstudio:settings:dirty');
  }, [change.toString(), clear]);
  await page.goto(back);
}
