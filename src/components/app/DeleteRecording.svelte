<script lang="ts">
  import * as AlertDialog from '@/components/shadcn/alert-dialog';
  import { Button } from '@/components/shadcn/button';
  import Spinner from '@/components/shadcn/spinner/Spinner.svelte';
  import { formatDuration, type TakeMeta } from '@/lib/audio/takes';
  import { deleteRecording } from '@/lib/recording-deletion';
  let { episodeId, tracks, serverBacked = true, open = $bindable(false), trigger = true, onDeleted }: { episodeId: string; tracks: TakeMeta[]; serverBacked?: boolean; open?: boolean; trigger?: boolean; onDeleted: () => void } = $props();
  let busy = $state(false), error = $state('');
  async function remove() {
    if (busy) return;
    busy = true; error = '';
    try { await deleteRecording(episodeId, tracks, !serverBacked); open = false; onDeleted(); }
    catch (e) { error = (e as Error).message; }
    finally { busy = false; }
  }
</script>
<AlertDialog.Root bind:open>
  {#if trigger}<AlertDialog.Trigger data-delete class="inline-flex h-9 items-center rounded-[10px] border border-rec/70 px-3.5 text-sm text-rec hover:border-rec">Delete</AlertDialog.Trigger>{/if}
  <AlertDialog.Content class="sm:max-w-[480px]" onEscapeKeydown={(e) => { if (busy) e.preventDefault(); }}>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete recording permanently?</AlertDialog.Title>
      <AlertDialog.Description>{tracks[0]?.name ?? 'Recording'} · {new Date(tracks[0]?.startedAt ?? 0).toLocaleString()} · {formatDuration((tracks[0]?.samples ?? 0) / (tracks[0]?.sampleRate ?? 48000))} · {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}</AlertDialog.Description>
    </AlertDialog.Header>
    <p class="text-sm text-text-2">{serverBacked ? 'This removes the recording here and on the server' : 'This removes the browser-only recording'}, its editor project, and derived audio. It cannot be undone. The episode, script, approved text, and independent media-library clips remain.</p>
    {#if error}<p role="alert" class="text-sm text-rec">{error} Deletion was not confirmed. Retry to finish synchronization and cleanup.</p>{/if}
    <AlertDialog.Footer class="bg-surface">
      <Button variant="outline" disabled={busy} onclick={() => open = false}>Cancel</Button>
      <Button variant="destructive" disabled={busy} data-delete-confirm onclick={remove}>{#if busy}<Spinner />Deleting…{:else}Delete permanently{/if}</Button>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
