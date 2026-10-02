<script lang="ts">
  import { Checkbox as CheckboxPrimitive } from 'bits-ui';
  import CheckIcon from '@lucide/svelte/icons/check';
  import MinusIcon from '@lucide/svelte/icons/minus';
  import { cn, type WithoutChildrenOrChild } from '@/lib/shadcn-utils';

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    indeterminate = $bindable(false),
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<CheckboxPrimitive.RootProps> = $props();
</script>

<CheckboxPrimitive.Root
  bind:ref
  bind:checked
  bind:indeterminate
  data-slot="checkbox"
  class={cn(
    'relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-handle bg-page text-primary-fg shadow-xs outline-none transition-shadow',
    'data-[state=checked]:border-primary data-[state=checked]:bg-primary focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
    className,
  )}
  {...restProps}
>
  {#snippet children({ checked, indeterminate })}
    <span data-slot="checkbox-indicator" class="grid place-content-center [&>svg]:size-3.5">
      {#if checked}<CheckIcon />{:else if indeterminate}<MinusIcon />{/if}
    </span>
  {/snippet}
</CheckboxPrimitive.Root>
