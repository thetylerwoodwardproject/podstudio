<script lang="ts">
  import { Popover as Primitive } from 'bits-ui';
  let { open = $bindable(false), ...restProps }: Primitive.RootProps = $props();
</script>

<Primitive.Root bind:open {...restProps} />
