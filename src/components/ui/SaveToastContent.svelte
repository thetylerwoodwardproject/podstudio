<script lang="ts">
  import StatusDot from './StatusDot.svelte';
  import Spinner from '@/components/shadcn/spinner/Spinner.svelte';
  let { status, message }: { status: 'saving' | 'saved' | 'waiting' | 'error' | 'conflict'; message: string } = $props();
  const variant = $derived(status === 'saved' ? 'success' : status === 'waiting' || status === 'saving' ? 'warning' : 'error');
</script>
<div class="pointer-events-none flex min-w-[190px] items-center gap-2.5 rounded-xl border border-border bg-sheet px-3.5 py-2.5 text-[12px] text-text shadow-lg" role="status" aria-live="polite" data-save-toast={status}>
  {#if status === 'saving'}<Spinner label="Saving" />{:else}<StatusDot {variant} />{/if}
  <span>{message}</span>
</div>
