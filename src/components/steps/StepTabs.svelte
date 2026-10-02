<!-- Adapted from More Shadcn Svelte's MIT-licensed Stepper by kevwpl. -->
<script lang="ts">
  interface Props {
    steps: { id: string; label: string }[];
    current: number;
    complete?: boolean;
    /** The furthest step unlocked */
    reached: number;
    ongo: (i: number) => void;
  }
  let { steps, current, reached, complete = false, ongo }: Props = $props();
</script>

<nav class="flex-none border-b border-divider px-4 py-3" aria-label="Steps" data-stepper>
  <ol class="mx-auto flex max-w-[760px] items-start">
    {#each steps as s, i (s.id)}
      {@const locked = i > reached}
      <li class="flex min-w-0 flex-1 items-start last:flex-none" data-state={i === current ? 'active' : i < current || complete ? 'completed' : 'inactive'}>
        <button type="button" class="flex min-w-0 flex-col items-center gap-1.5 rounded-lg px-1.5 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          disabled={locked} aria-current={i === current ? 'step' : undefined} data-step-tab={s.id} onclick={() => ongo(i)}>
          <span class="grid size-7 place-items-center rounded-full border font-mono text-[11px] font-medium"
            class:border-primary={i === current} class:bg-primary={i === current} class:text-primary-fg={i === current}
            class:border-ok={i < current || complete} class:text-ok={i < current || complete}
            class:border-border={i > current && !complete} class:text-text-3={i > current && !complete}>{i < current || complete ? '✓' : String(i + 1)}</span>
          <span class="max-w-[90px] truncate text-[11px] sm:text-[13px]" class:text-text={i === current} class:text-text-2={i !== current}>{s.label}</span>
        </button>
        {#if i < steps.length - 1}<span aria-hidden="true" class:list={['mt-3.5 h-px min-w-2 flex-1', i < current || complete ? 'bg-ok' : 'bg-border']}></span>{/if}
      </li>
    {/each}
  </ol>
</nav>
