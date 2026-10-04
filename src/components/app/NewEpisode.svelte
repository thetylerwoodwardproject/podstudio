<script lang="ts">
  import * as Dialog from '@/components/shadcn/dialog';
  import * as Field from '@/components/shadcn/field';
  import { Input } from '@/components/shadcn/input';
  import { Button } from '@/components/shadcn/button';
  import Spinner from '@/components/shadcn/spinner/Spinner.svelte';
  import { api } from '@/lib/api';
  import { saveShow } from '@/lib/show';
  let open = $state(false), title = $state(''), error = $state(''), saving = $state(false);
  let path = $state<'record' | 'script'>('record');
  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;
    if (!title.trim()) { error = 'Enter a working title to continue.'; document.getElementById('episode-title')?.focus(); return; }
    saving = true; error = '';
    try {
      const { episode } = await api<{ episode: { id: string } }>('episodes', { body: { title: title.trim() } });
      if (path === 'record') saveShow(episode.id, { mode: 'adlib' });
      location.assign(`/episodes/${episode.id}/${path === 'record' ? 'studio' : 'script'}`);
    } catch (e) { error = (e as Error).message; saving = false; }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger data-new-episode class="inline-flex h-9 items-center rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-fg" onclick={() => { title = ''; error = ''; path = 'record'; }}>+ New episode</Dialog.Trigger>
  <Dialog.Content class="episode-dialog gap-0 overflow-hidden border border-border bg-sheet p-0 sm:max-w-[520px]" onInteractOutside={(e) => { if (saving) e.preventDefault(); }} onEscapeKeydown={(e) => { if (saving) e.preventDefault(); }} onOpenAutoFocus={(e) => { e.preventDefault(); document.getElementById('episode-title')?.focus(); }}>
    <Dialog.Header class="border-b border-divider px-6 py-6 pr-12">
      <Dialog.Title>New episode</Dialog.Title>
      <Dialog.Description>A working title is fine. Get recording or start with a script.</Dialog.Description>
    </Dialog.Header>
    <form onsubmit={create}>
      <div class="space-y-6 p-6">
        <Field.Group><Field.Field data-invalid={!!error}>
          <Field.Label for="episode-title">Episode title</Field.Label>
          <Input id="episode-title" bind:value={title} maxlength={300} disabled={saving} aria-invalid={!!error} aria-describedby="episode-title-help" placeholder="Inside the new studio" oninput={() => error = ''} />
          <Field.Description id="episode-title-help">You can rename it later. Episode numbers are assigned automatically.</Field.Description>
          {#if error}<Field.Error role="alert">{error}</Field.Error>{/if}
        </Field.Field></Field.Group>
        <fieldset disabled={saving} class="space-y-2">
          <legend class="mb-3 text-sm font-medium">How would you like to start?</legend>
          <label class="flex cursor-pointer gap-3 rounded-xl border border-border p-3 has-checked:border-primary has-checked:bg-primary/5"><input type="radio" name="episode-path" value="record" bind:group={path} /><span class="text-sm">Record now<span class="mt-1 block text-xs text-text-2">Check your microphone and record without a script.</span></span></label>
          <label class="flex cursor-pointer gap-3 rounded-xl border border-border p-3 has-checked:border-primary has-checked:bg-primary/5"><input type="radio" name="episode-path" value="script" bind:group={path} /><span class="text-sm">Add a script<span class="mt-1 block text-xs text-text-2">Write or import your script before recording.</span></span></label>
        </fieldset>
      </div>
      <Dialog.Footer class="m-0 flex-row border-t border-divider bg-surface px-6 py-4">
        <Button type="button" variant="outline" disabled={saving} onclick={() => open = false}>Cancel</Button>
        <Button type="submit" disabled={saving}>{#if saving}<Spinner />Creating…{:else}Create episode{/if}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
<style>
  @media (max-width: 600px) { :global(.episode-dialog) { top: auto; bottom: 0; left: 0; transform: none; translate: none; width: 100%; max-width: 100%; border-radius: 18px 18px 0 0; padding-bottom: env(safe-area-inset-bottom); } }
</style>
