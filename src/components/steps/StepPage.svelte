<!--
  A step flow page (framework): the tabs, a scrolling column (760 max) with
  the step's title and lede, and the player bar pinned at the bottom. Fills
  the app shell's work area.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import StepTabs from './StepTabs.svelte';

  interface Props {
    steps?: { id: string; label: string }[] | null;
    current?: number;
    reached?: number;
    ongo?: (i: number) => void;
    title: string;
    lede?: string;
    children: Snippet;
    player: Snippet;
  }
  let { steps = null, current = 0, reached = 0, ongo = () => {}, title, lede = '', children, player }: Props = $props();
  let scroller: HTMLElement;
  // A new step starts at the top.
  $effect(() => {
    void current;
    scroller?.scrollTo({ top: 0 });
  });
</script>

<div class="flex h-full min-h-0 flex-col" data-step-page>
  {#if steps}<StepTabs {steps} {current} {reached} {ongo} />{/if}
  <div class="min-h-0 flex-1 overflow-y-auto" bind:this={scroller}>
    <div class="mx-auto flex max-w-[760px] flex-col gap-7 px-5 pt-7 pb-10">
      <div class="flex flex-col gap-1.5">
        <h1 class="page-title" data-step-title>{title}</h1>
        {#if lede}<p class="text-[14px] leading-normal text-pretty text-text-2">{lede}</p>{/if}
      </div>
      {@render children()}
    </div>
  </div>
  {@render player()}
</div>
