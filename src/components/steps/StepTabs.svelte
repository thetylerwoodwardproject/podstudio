<!--
  Step tabs (framework, step flow): one column per step, a mono number over
  the label. The current step is text with a 2 px underline; steps already
  done have a green number; steps reached can be clicked; the rest are
  locked until Next gets there.
-->
<script lang="ts">
  interface Props {
    steps: { id: string; label: string }[];
    current: number;
    /** The furthest step unlocked */
    reached: number;
    ongo: (i: number) => void;
  }
  let { steps, current, reached, ongo }: Props = $props();
</script>

<nav class="flex-none border-b border-divider" aria-label="Steps">
  <div class="mx-auto grid max-w-[760px] gap-1 px-3 sm:px-5" style:grid-template-columns={`repeat(${steps.length}, minmax(0, 1fr))`}>
    {#each steps as s, i (s.id)}
      {@const locked = i > reached}
      <button
        type="button"
        class="flex min-w-0 flex-col items-center gap-[3px] border-b-2 pt-3 pb-2.5 sm:items-start"
        class:border-text={i === current}
        class:border-transparent={i !== current}
        disabled={locked}
        aria-current={i === current ? 'step' : undefined}
        data-step-tab={s.id}
        onclick={() => ongo(i)}
      >
        <span class="font-mono text-[11px] font-medium tracking-[0.06em] {i === current ? 'text-text' : i < reached ? 'text-ok' : locked ? 'text-handle' : 'text-text-3'}">{String(i + 1).padStart(2, '0')}</span>
        <span class="max-w-full truncate text-[13px] sm:text-[14px] {i === current ? 'text-text' : locked ? 'text-handle' : 'text-text-2'}">{s.label}</span>
      </button>
    {/each}
  </div>
</nav>
