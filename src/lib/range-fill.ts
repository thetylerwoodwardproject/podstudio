/*
 * Sliders fill up to their value (the framework's slider): each range input
 * gets --pct, updated as it moves and when code sets its value.
 */
const set = (el: HTMLInputElement) => {
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  const pct = max > min ? ((Number(el.value) - min) / (max - min)) * 100 : 0;
  el.style.setProperty('--pct', `${pct}%`);
};
const all = () => document.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(set);

addEventListener('input', (e) => {
  const t = e.target as HTMLElement;
  if (t instanceof HTMLInputElement && t.type === 'range') set(t);
});
all();
// Values set from code (saved settings, the recording screen) don't fire input events.
setInterval(all, 400);
