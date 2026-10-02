<script lang="ts">
  import { ContextMenu as Primitive } from 'bits-ui';
  let { ref = $bindable(null), ...restProps }: Primitive.TriggerProps = $props();
</script>

<Primitive.Trigger bind:ref data-slot="context-menu-trigger" {...restProps} />
