<script lang="ts">
  import { SAVE_STATUS_EVENT, type SaveStatus, type SaveStatusDetail } from '@/lib/save-status';

  let status = $state<SaveStatus>('saved');
  const copy = $derived(
    status === 'saving' ? 'Saving…' : status === 'waiting' ? 'Waiting for connection' : status === 'error' ? 'Couldn’t save' : 'Saved automatically',
  );
  const color = $derived(status === 'saved' ? 'bg-ok' : status === 'waiting' ? 'bg-warn' : status === 'error' ? 'bg-rec' : 'bg-text-2');

  $effect(() => {
    const update = (event: Event) => (status = (event as CustomEvent<SaveStatusDetail>).detail.status);
    window.addEventListener(SAVE_STATUS_EVENT, update);
    return () => window.removeEventListener(SAVE_STATUS_EVENT, update);
  });
</script>

<div
  class="fixed right-4 z-30 flex h-9 items-center gap-2 rounded-full border border-border bg-sheet/95 px-3 font-mono text-[12px] text-text-2 shadow-lg backdrop-blur-sm sm:right-6"
  style="bottom:max(16px,env(safe-area-inset-bottom))"
  role="status"
  aria-live="polite"
  data-save-status={status}
>
  <span class="size-2 rounded-full {color}" class:animate-pulse={status === 'saving'} aria-hidden="true"></span>
  <span>{copy}</span>
</div>
