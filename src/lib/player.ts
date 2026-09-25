/*
 * Noise suppression on a Listen player: a switch that flips the player between
 * the original and the cleaned recording at the same moment. The whole session
 * is cleaned once and kept (the same copy Export uses). Until that's done, a
 * short cleaned stretch from where you're listening plays, so the switch
 * answers in a few seconds.
 */
import { denoiseTake, previewTake, variantName } from './audio/denoise';
import { hasVariant, takeWav, type TakeMeta } from './audio/takes';
import { loadSettings } from './settings';

const PREVIEW_SECONDS = 12;

export function noiseToggle(audio: HTMLAudioElement, toggle: HTMLInputElement, status: HTMLElement, meta: TakeMeta, original: () => Promise<string>) {
  const amount = loadSettings().recording.noiseSuppression || 50;
  let full: string | null = null;
  let cleaning: Promise<void> | null = null;
  let progress = 0;
  // What the player has loaded: where it starts in the session, and how long it is.
  let current = { offset: 0, length: Infinity };
  // The short cleaned stretch ran out before the whole session was ready.
  let waiting = false;

  const position = () => audio.currentTime + current.offset;
  const swap = async (url: string, offset = 0, length = Infinity, play = !audio.paused) => {
    const pos = position();
    current = { offset, length };
    audio.src = url;
    audio.addEventListener('loadedmetadata', () => (audio.currentTime = Math.max(0, Math.min(pos - offset, length))), { once: true });
    if (play) await audio.play().catch(() => {});
  };
  const showProgress = () => {
    if (toggle.checked && !full) status.textContent = `${waiting ? 'Cleaning the rest' : 'Cleaned from here · the rest'} ${Math.round(progress * 100)}%`;
  };

  const cleanWhole = () =>
    (cleaning ??= (async () => {
      const variant = await denoiseTake(meta, amount, (p) => {
        progress = p;
        showProgress();
      });
      full = URL.createObjectURL(await takeWav(meta, variant!));
      if (toggle.checked) {
        await swap(full, 0, Infinity, !audio.paused || waiting);
        waiting = false;
        status.textContent = `Cleaned · ${amount}%`;
      }
    })().catch((err) => {
      cleaning = null;
      status.textContent = `Couldn’t clean: ${(err as Error).message}`;
    }));

  audio.addEventListener('ended', () => {
    if (toggle.checked && !full && current.offset + current.length < (meta.samples / meta.sampleRate) - 0.5) {
      waiting = true;
      showProgress();
    }
  });

  toggle.addEventListener('change', async () => {
    toggle.disabled = true;
    try {
      if (!toggle.checked) {
        waiting = false;
        await swap(await original());
        status.textContent = '';
        return;
      }
      if (!full && (await hasVariant(meta, variantName(amount)))) full = URL.createObjectURL(await takeWav(meta, variantName(amount)));
      if (full) {
        await swap(full);
        status.textContent = `Cleaned · ${amount}%`;
        return;
      }
      status.textContent = 'Cleaning from here…';
      const from = Math.floor(position());
      const preview = URL.createObjectURL((await previewTake(meta, amount, PREVIEW_SECONDS, from)).after);
      if (toggle.checked && !full) {
        await swap(preview, from, PREVIEW_SECONDS);
        showProgress();
      }
      cleanWhole();
    } catch (err) {
      status.textContent = `Couldn’t clean: ${(err as Error).message}`;
      toggle.checked = false;
    } finally {
      toggle.disabled = false;
    }
  });
}

/** The switch's markup, shared by the Listen players. */
export const noiseToggleHtml = (id: string) => `
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
    <label class="flex items-center gap-2 text-fg-soft" for="${id}">
      <span class="relative inline-flex h-5 w-[34px] flex-none items-center rounded-full bg-edge has-checked:bg-ok has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-fg">
        <input id="${id}" type="checkbox" role="switch" class="peer sr-only" data-ns-toggle />
        <span class="absolute top-0.5 left-0.5 size-4 rounded-full bg-subtle transition-all peer-checked:left-4 peer-checked:bg-white"></span>
      </span>
      Noise suppression
    </label>
    <span class="text-muted" data-ns-status></span>
  </div>`;
