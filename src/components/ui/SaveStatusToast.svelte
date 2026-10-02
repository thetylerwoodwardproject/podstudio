<script lang="ts">
  import { toast, Toaster } from 'svelte-sonner';
  import SaveToastContent from './SaveToastContent.svelte';
  let { status, message }: {
    status: 'saving' | 'saved' | 'waiting' | 'error' | 'conflict'; message: string;
  } = $props();
  $effect(() => {
    toast.custom(SaveToastContent, { id: 'save-status', componentProps: { status, message }, duration: Infinity, unstyled: true, dismissible: false });
  });
</script>
<Toaster position="top-right" offset={{ top: '112px', right: '16px' }} />
