<script lang="ts">
  import { ContextMenu as Primitive } from 'bits-ui';
  import { cn } from '@/lib/shadcn-utils.js';
  let { ref = $bindable(null), class: className, ...restProps }: Primitive.SeparatorProps = $props();
</script>

<Primitive.Separator bind:ref data-slot="context-menu-separator" class={cn('-mx-1 my-1 h-px bg-divider', className)} {...restProps} />
