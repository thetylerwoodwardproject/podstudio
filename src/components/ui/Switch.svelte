<!--
  Toggle (framework), for Svelte panels: the same as Switch.astro. 40 × 24
  with an 18 px knob; on is the text track with a page-colored knob.
-->
<script lang="ts">
  interface Props {
    name?: string;
    label: string;
    checked: boolean;
    disabled?: boolean;
    onchange?: (on: boolean) => void;
  }
  let { name, label, checked = $bindable(), disabled = false, onchange }: Props = $props();
</script>

<label
  class="relative inline-flex h-6 w-10 flex-none items-center rounded-full bg-track-off transition-colors has-checked:bg-text has-disabled:opacity-40 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-text"
>
  <input type="checkbox" role="switch" class="peer sr-only" {name} {disabled} aria-label={label} bind:checked onchange={() => onchange?.(checked)} />
  <span class="absolute top-[3px] left-[3px] size-[18px] rounded-full bg-text-2 transition-all peer-checked:left-[19px] peer-checked:bg-page"></span>
</label>
