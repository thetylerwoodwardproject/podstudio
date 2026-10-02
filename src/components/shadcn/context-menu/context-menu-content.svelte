<script lang="ts">
  import { ContextMenu as Primitive } from 'bits-ui';
  import { cn } from '@/lib/shadcn-utils.js';
  let { ref = $bindable(null), class: className, sideOffset = 4, ...restProps }: Primitive.ContentProps = $props();
</script>

<Primitive.Portal>
  <Primitive.Content bind:ref data-slot="context-menu-content" {sideOffset}
    class={cn('z-50 min-w-44 rounded-lg border border-border bg-sheet p-1 text-text shadow-xl outline-none', className)} {...restProps} />
</Primitive.Portal>
