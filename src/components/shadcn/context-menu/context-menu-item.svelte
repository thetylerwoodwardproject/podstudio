<script lang="ts">
  import { ContextMenu as Primitive } from 'bits-ui';
  import { cn } from '@/lib/shadcn-utils.js';
  let { ref = $bindable(null), class: className, ...restProps }: Primitive.ItemProps = $props();
</script>

<Primitive.Item bind:ref data-slot="context-menu-item"
  class={cn('relative flex cursor-default select-none items-center rounded-md px-2 py-1.5 text-[13px] outline-none focus:bg-control focus:text-text data-disabled:pointer-events-none data-disabled:opacity-40', className)} {...restProps} />
