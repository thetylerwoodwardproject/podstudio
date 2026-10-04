<script lang="ts">
 import { Label as Primitive } from 'bits-ui';
 import { cn } from '@/lib/shadcn-utils';
 let { ref = $bindable(null), class: className, children, ...rest }: Primitive.RootProps = $props();
</script>
<Primitive.Root bind:ref data-slot="label" class={cn('flex items-center gap-2 text-sm font-medium leading-none peer-disabled:opacity-50', className)} {...rest}>{@render children?.()}</Primitive.Root>
