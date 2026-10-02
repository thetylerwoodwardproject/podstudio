<script lang="ts">
  import { onMount } from 'svelte';
  import { REGEXP_ONLY_DIGITS, REGEXP_ONLY_DIGITS_AND_CHARS } from 'bits-ui';
  import * as InputOTP from '@/components/shadcn/input-otp';

  interface Props {
    name: string;
    length?: number;
    value?: string;
    alphanumeric?: boolean;
    split?: boolean;
    size?: 'md' | 'lg';
    label: string;
    queryCode?: boolean;
  }
  let { name, length = 6, value: initialValue = '', alphanumeric = false, split = false, size = 'md', label, queryCode = false }: Props = $props();
  // svelte-ignore state_referenced_locally
  let value = $state(initialValue);
  onMount(() => {
    if (queryCode) {
      const given = (new URL(location.href).searchParams.get('code') ?? '').replace(/\D/g, '').slice(0, length);
      if (given.length === length) value = given;
    }
  });
</script>

<div data-otp role="group" aria-label={label}>
  <InputOTP.Root {name} maxlength={length} bind:value
    pattern={alphanumeric ? REGEXP_ONLY_DIGITS_AND_CHARS : REGEXP_ONLY_DIGITS}
    inputmode={alphanumeric ? 'text' : 'numeric'} aria-label={label} autocomplete={alphanumeric ? 'off' : 'one-time-code'}>
    {#snippet children({ cells })}
      <InputOTP.Group class="gap-1.5">
        {#each cells.slice(0, split ? length / 2 : length) as cell (cell)}
          <InputOTP.Slot {cell} class={size === 'lg' ? 'h-14 w-11 text-[22px]' : 'h-[52px] w-11 text-[20px]'} />
        {/each}
      </InputOTP.Group>
      {#if split}
        <InputOTP.Separator class="mx-1 text-text-3" />
        <InputOTP.Group class="gap-1.5">
          {#each cells.slice(length / 2) as cell (cell)}
            <InputOTP.Slot {cell} class={size === 'lg' ? 'h-14 w-11 text-[22px]' : 'h-[52px] w-11 text-[20px]'} />
          {/each}
        </InputOTP.Group>
      {/if}
    {/snippet}
  </InputOTP.Root>
</div>
