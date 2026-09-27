<!--
  Segmented control (framework), for Svelte panels: the same as
  Segmented.astro, native radios in a page-fill track. With no `name`,
  buttons instead (aria-pressed), for choices that aren't form fields.
-->
<script lang="ts">
  interface Option {
    value: string;
    label: string;
    shortLabel?: string;
  }
  interface Props {
    name?: string;
    label: string;
    options: Option[];
    value: string | null;
    /** On a laptop, 30 px tall and 13 px (the step player's bar) */
    small?: boolean;
    onchange?: (value: string) => void;
    class?: string;
    [data: `data-${string}`]: string | boolean | undefined;
  }
  let { name, label, options, value = $bindable(), small = false, onchange, class: cls = '', ...rest }: Props = $props();
  const item = $derived(
    `flex items-center justify-center rounded-[7px] px-3 text-center whitespace-nowrap text-text-2 transition-colors hover:text-text h-8 text-[14px] ${small ? 'sm:h-[30px] sm:text-[13px]' : ''}`,
  );
  const pick = (v: string) => {
    value = v;
    onchange?.(v);
  };
</script>

<div
  role={name ? 'radiogroup' : 'group'}
  aria-label={label}
  class={`grid auto-cols-[minmax(0,1fr)] grid-flow-col gap-[3px] rounded-[10px] border border-border bg-page p-[3px] ${cls}`}
  {...rest}
>
  {#each options as o (o.value)}
    {#if name}
      <label class={`${item} has-checked:bg-text has-checked:font-medium has-checked:text-page has-focus-visible:outline-2 has-focus-visible:outline-text`}>
        <input type="radio" class="sr-only" {name} value={o.value} checked={o.value === value} onchange={() => pick(o.value)} />
        {#if o.shortLabel}<span class="sm:hidden">{o.shortLabel}</span><span class="hidden sm:inline">{o.label}</span>{:else}{o.label}{/if}
      </label>
    {:else}
      <button type="button" class={`${item} aria-pressed:bg-text aria-pressed:font-medium aria-pressed:text-page`} aria-pressed={o.value === value} data-value={o.value} onclick={() => pick(o.value)}>{#if o.shortLabel}<span class="sm:hidden">{o.shortLabel}</span><span class="hidden sm:inline">{o.label}</span>{:else}{o.label}{/if}</button>
    {/if}
  {/each}
</div>
