import { loadSettings, saveSettings, type Settings } from './settings';

type Choice = Settings['ui']['theme'];
const preference = matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(choice: Choice) {
  const resolved = choice === 'system' ? (preference.matches ? 'dark' : 'light') : choice;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#121225' : '#f7f8fc');
  document.querySelectorAll<HTMLSelectElement>('[data-ui-theme]').forEach((select) => { select.value = choice; });
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
