<!--
  Dialog (framework): centred, 640 max, on a phone a bottom sheet (88 % high
  at most). A fixed header and footer, the body scrolls. Built on <dialog>
  with showModal(): the page behind can't be used or reached with Tab, Esc
  closes it, and focus goes back to what opened it. The page behind doesn't
  scroll while it's open; clicking outside closes it.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    /** The id of the title element */
    labelledby: string;
    onclose?: () => void;
    header: Snippet;
    children: Snippet;
    footer?: Snippet;
    [data: `data-${string}`]: string | boolean | undefined;
  }
  let { open = $bindable(), labelledby, onclose, header, children, footer, ...rest }: Props = $props();
  let dialog: HTMLDialogElement;

  $effect(() => {
    if (open && !dialog.open) {
      dialog.showModal();
      document.documentElement.style.overflow = 'hidden';
    } else if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby={labelledby}
  aria-modal="true"
  class="m-auto w-[min(640px,calc(100vw-40px))] overflow-hidden rounded-[16px] border border-border bg-sheet p-0 text-text backdrop:bg-black/60 max-sm:mx-0 max-sm:mt-auto max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0"
  onclose={() => {
    document.documentElement.style.overflow = '';
    open = false;
    onclose?.();
  }}
  onclick={(e) => e.target === dialog && dialog.close()}
  {...rest}
>
  <div class="flex max-h-[calc(100dvh-64px)] flex-col max-sm:max-h-[88dvh]">
    <div class="flex flex-none items-start justify-between gap-4 border-b border-divider px-5 pt-5 pb-4">
      <div class="min-w-0">{@render header()}</div>
      <button type="button" class="-mt-1 -mr-1 flex size-9 flex-none items-center justify-center rounded-[10px] text-[20px] text-text-2 hover:text-text" aria-label="Close" onclick={() => dialog.close()}>×</button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{@render children()}</div>
    {#if footer}<div class="flex-none border-t border-divider bg-surface px-5 py-4">{@render footer()}</div>{/if}
  </div>
</dialog>
