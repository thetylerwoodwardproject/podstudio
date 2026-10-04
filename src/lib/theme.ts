import { loadSettings, saveSettings, type Settings } from './settings';

type Choice = Settings['ui']['theme'];
const preference = matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(choice: Choice) {
  const resolved = choice === 'system' ? (preference.matches ? 'dark' : 'light') : choice;
  const root = document.documentElement;
  // Theme tokens are applied synchronously, but interactive controls use short
  // color transitions. Suppress those transitions while the token set changes
  // so a late account-settings refresh never leaves the UI captured halfway
  // between the light and dark palettes.
  const changing = root.dataset.theme && root.dataset.theme !== resolved;
  if (changing) root.dataset.themeChanging = 'true';
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#121225' : '#f7f8fc');
  document.querySelectorAll<HTMLSelectElement>('[data-ui-theme]').forEach((select) => { select.value = choice; });
  if (changing) {
    requestAnimationFrame(() => requestAnimationFrame(() => { delete root.dataset.themeChanging; }));
  }
}

export function startThemeSync() {
  const refresh = () => applyTheme(loadSettings().ui.theme);
  refresh();
  preference.addEventListener('change', refresh);
  window.addEventListener('podstudio:settings', refresh);
  document.addEventListener('change', (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || !select.matches('[data-ui-theme]')) return;
    const choice = select.value as Choice;
    if (!['system', 'light', 'dark'].includes(choice)) return;
    saveSettings('ui', { theme: choice });
    applyTheme(choice);
  });
}
