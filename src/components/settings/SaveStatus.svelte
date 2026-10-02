<script lang="ts">
  import { SAVE_STATUS_EVENT, type SaveStatus, type SaveStatusDetail } from '@/lib/save-status';
  import SaveStatusToast from '@/components/ui/SaveStatusToast.svelte';

  let status = $state<SaveStatus>('saved');
  const copy = $derived(
    status === 'saving' ? 'Saving…' : status === 'waiting' ? 'Waiting for connection' : status === 'error' ? 'Couldn’t save' : 'Saved automatically',
  );

  $effect(() => {
    const update = (event: Event) => (status = (event as CustomEvent<SaveStatusDetail>).detail.status);
    window.addEventListener(SAVE_STATUS_EVENT, update);
    return () => window.removeEventListener(SAVE_STATUS_EVENT, update);
  });
</script>

<div data-save-status={status}><SaveStatusToast {status} message={copy} /></div>
