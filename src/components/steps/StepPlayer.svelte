<!--
  The step flow's bottom bar (framework): the preview player (play, what's
  playing, time and progress), the step's before-and-after choice, and
  Back / Next. One row on a laptop; three on a phone (player, choice,
  buttons). `extra` replaces the player where a step has nothing to play.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Segmented from '@/components/ui/Segmented.svelte';

  interface Props {
    /** The choices to compare, or none */
    options?: string[] | null;
    choice?: number;
    onchoose?: (i: number) => void;
    /** What's playing, e.g. "Edit → Noise 40 % → Tone" */
    chain?: string;
    time?: string;
    progress?: number;
    playing?: boolean;
    /** False while there's nothing to play yet */
    canPlay?: boolean;
    onplay?: () => void;
    onback?: (() => void) | null;
    next?: { label: string; onclick: () => void; disabled?: boolean; attrs?: Record<string, string> } | null;
    extra?: Snippet;
    /** In place of the player on a step with nothing to play: "4 sections" and "64 lines · ~8:15 read time" */
    summary?: { text: string; meta: string } | null;
  }
  let { options = null, choice = 0, onchoose, chain = '', time = '', progress = 0, playing = false, canPlay = true, onplay, onback = null, next = null, extra, summary = null }: Props = $props();
  const opts = $derived((options ?? []).map((label, i) => ({ value: String(i), label })));
</script>

<div class="flex-none border-t border-divider bg-surface" data-step-player>
  <div class="mx-auto flex max-w-[760px] flex-wrap items-center gap-x-3 gap-y-3.5 px-4 pt-3.5 pb-5 sm:flex-nowrap sm:gap-3.5 sm:px-5 sm:py-4">
    {#if extra}
      <div class="min-w-0 basis-full sm:flex-1 sm:basis-0">{@render extra()}</div>
    {:else if summary}
      <div class="flex min-w-0 basis-full items-baseline gap-2.5 sm:flex-1 sm:basis-0" data-summary-bar>
        <span class="text-[14px] whitespace-nowrap">{summary.text}</span>
        <span class="truncate font-mono text-[12px] text-text-3">{summary.meta}</span>
      </div>
    {:else}
      <button
        type="button"
        class="flex size-11 flex-none items-center justify-center gap-1 rounded-full border border-white/20 bg-black text-white shadow-sm hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40 sm:size-10"
        style:padding-left={playing ? '0' : '3px'}
        aria-label={playing ? 'Pause preview' : 'Play preview'}
        disabled={!canPlay}
        data-play
        onclick={() => onplay?.()}
      >
        {#if playing}
          <span class="h-3.5 w-1 rounded-[1px] bg-white"></span><span class="h-3.5 w-1 rounded-[1px] bg-white"></span>
        {:else}
          <span class="size-0 border-y-[7px] border-l-[12px] border-y-transparent border-l-white"></span>
        {/if}
      </button>
      <div class="flex min-w-0 flex-1 basis-[calc(100%-56px)] flex-col gap-2 sm:basis-0">
        <div class="flex items-baseline gap-2 sm:gap-3">
          <span class="min-w-0 flex-1 truncate text-[13px] text-text-2" title={chain} data-chain>{chain}</span>
          <span class="flex-none font-mono text-[12px] text-text-3" data-time>{time}</span>
        </div>
        <div class="relative h-[3px] rounded-full bg-border"><div class="absolute inset-y-0 left-0 rounded-full bg-text" style:width={`${Math.min(1, Math.max(0, progress)) * 100}%`}></div></div>
      </div>
      {#if opts.length}
        <Segmented label="Listen to" options={opts} value={String(choice)} small class="basis-full sm:flex-none sm:basis-auto sm:auto-cols-max" data-ab onchange={(v) => onchoose?.(Number(v))} />
      {/if}
    {/if}
    {#if onback || next}
      <div class="hidden h-7 w-px flex-none bg-border sm:block"></div>
      <div class="flex basis-full gap-2 sm:flex-none sm:basis-auto">
        {#if onback}
          <button type="button" class="h-12 rounded-[12px] bg-control px-5 text-[15px] sm:h-9 sm:rounded-[10px] sm:bg-transparent sm:px-3.5 sm:text-[14px] sm:text-text-2 sm:hover:text-text" data-back onclick={onback}>Back</button>
        {/if}
        {#if next}
          <button
            type="button"
            class="h-12 flex-1 rounded-[12px] bg-primary px-4 text-[15px] font-medium whitespace-nowrap text-primary-fg disabled:opacity-40 sm:h-9 sm:flex-none sm:rounded-[10px] sm:text-[14px]"
            data-next
            {...next.attrs}
            disabled={next.disabled}
            onclick={next.onclick}>{next.label}</button
          >
        {/if}
      </div>
    {/if}
  </div>
</div>
