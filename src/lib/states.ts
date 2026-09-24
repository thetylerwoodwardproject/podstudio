/*
 * Mock-state switching for screens that have several states (prompter
 * banners, HTTPS health, host vs guest). Real state will come from the
 * server; for now it comes from ?<key>=<state> or the dev preview switcher.
 *
 * Markup: a root with data-states="a,b,c" data-state="a" [data-state-key],
 * children with data-when="a b" are shown only in those states.
 */

export function applyState(root: HTMLElement, state: string) {
  root.dataset.state = state;
  for (const el of root.querySelectorAll<HTMLElement>('[data-when]')) {
    el.hidden = !el.dataset.when!.split(' ').includes(state);
  }
  root.dispatchEvent(new CustomEvent('statechange', { detail: state }));
}

export function initStates() {
  for (const root of document.querySelectorAll<HTMLElement>('[data-states]')) {
    const key = root.dataset.stateKey ?? 'state';
    const allowed = root.dataset.states!.split(',');
    const fromUrl = new URL(location.href).searchParams.get(key);
    applyState(root, fromUrl && allowed.includes(fromUrl) ? fromUrl : root.dataset.state!);
  }

  for (const btn of document.querySelectorAll<HTMLElement>('[data-set-state]')) {
    const root = document.getElementById(btn.dataset.target!);
    if (!root) continue;
    const sync = () => btn.setAttribute('aria-pressed', String(root.dataset.state === btn.dataset.setState));
    sync();
    root.addEventListener('statechange', sync);
    btn.addEventListener('click', () => {
      const url = new URL(location.href);
      url.searchParams.set(root.dataset.stateKey ?? 'state', btn.dataset.setState!);
      history.replaceState(null, '', url);
      applyState(root, btn.dataset.setState!);
    });
  }
}
