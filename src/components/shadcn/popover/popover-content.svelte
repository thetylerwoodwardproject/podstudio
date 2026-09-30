<script lang="ts">
  import { Popover as Primitive } from 'bits-ui';
  import { cn } from '@/lib/shadcn-utils';
  let { class: className, sideOffset = 8, ...restProps }: Primitive.ContentProps = $props();
</script>

<Primitive.Portal>
  <Primitive.Content data-slot="popover-content" {sideOffset} class={cn('z-50 w-72 rounded-xl border border-border bg-surface p-3 text-text shadow-xl outline-none', className)} {...restProps} />
</Primitive.Portal>
