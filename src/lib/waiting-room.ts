/*
 * The host's side of the waiting room, like Zoom's: whoever joins with a code
 * waits until the host lets them in, so a leaked code can't bring in strangers
 * or bots. Each knock shows as a card with the name and role, Let in and Deny.
 */
import type { Knock, Room } from './room';

export function waitingRoom(room: Room) {
  const box = document.createElement('div');
  box.className = 'fixed top-16 right-4 z-50 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2';
  box.setAttribute('aria-live', 'polite');
  document.body.append(box);
  const cards = new Map<string, HTMLElement>();
  const baseTitle = document.title;
  const retitle = () => (document.title = cards.size ? `(${cards.size}) ${baseTitle}` : baseTitle);

  const show = (k: Knock) => {
    if (cards.has(k.id)) return;
    const card = document.createElement('div');
    card.className = 'rounded-2xl border border-edge bg-panel p-4 text-fg shadow-2xl';
    card.dataset.knock = k.id;
    card.setAttribute('role', 'alertdialog');
    const title = document.createElement('div');
    title.className = 'text-[15px]';
    title.textContent = `${k.name} wants to join as ${k.role === 'guest' ? 'your guest' : 'producer'}`;
    const body = document.createElement('p');
    body.className = 'mt-1 text-[13px] leading-normal text-muted';
    body.textContent =
      k.role === 'guest'
        ? 'They’ll record on their own device. Only let in someone you invited.'
        : 'They can run the session and edit the script, but never record. Only let in someone you invited.';
    const row = document.createElement('div');
    row.className = 'mt-3 flex justify-end gap-2';
    const deny = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'h-9 rounded-lg border border-edge px-3.5 text-[13px] hover:bg-raised',
      textContent: 'Deny',
    });
    const admit = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'h-9 rounded-lg bg-fg px-3.5 text-[13px] font-medium text-ink hover:bg-white disabled:opacity-50',
      textContent: 'Let in',
    });
    deny.dataset.deny = '';
    admit.dataset.admit = '';
    deny.addEventListener('click', () => {
      room.deny(k.id);
      remove(k.id);
    });
    admit.addEventListener('click', () => {
      admit.disabled = deny.disabled = true;
      admit.textContent = 'Letting in…';
      room.admit(k.id);
    });
    row.append(deny, admit);
    card.append(title, body, row);
    box.append(card);
    cards.set(k.id, card);
    retitle();
    navigator.vibrate?.([30, 60, 30]);
  };
  const remove = (id: string) => {
    cards.get(id)?.remove();
    cards.delete(id);
    retitle();
  };

  room.on('knock', (m) => show(m.member));
  room.on('knocks', (m) => {
    for (const id of cards.keys()) if (!m.members.some((k) => k.id === id)) remove(id);
    m.members.forEach(show);
  });
  room.on('knock-gone', (m) => remove(m.id));
  room.on('admit-error', (m) => {
    const card = cards.get(m.id);
    if (!card) return;
    card.querySelector('p')!.textContent = m.error;
    card.querySelectorAll('button').forEach((b) => (b.disabled = false));
    card.querySelector<HTMLButtonElement>('[data-admit]')!.textContent = 'Let in';
  });
}
