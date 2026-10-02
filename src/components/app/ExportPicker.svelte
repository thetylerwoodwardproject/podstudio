<!--
  Export → Choose files (design: docs/design/export-files/): every file the
  chain makes, in four groups, each with what it is and its size. Quick picks,
  All / None per group, and "Use this selection every time", which saves the
  kinds of file ticked (lib/export-files.ts) to your settings. Closing without
  downloading keeps the ticks for this visit but saves nothing.
-->
<script lang="ts">
  import Sheet from '@/components/ui/Sheet.svelte';
  import { Checkbox } from '@/components/shadcn/checkbox';
  import { GROUPS, QUICK, formatSize, picked, type ExportFile } from '@/lib/export-files';

  interface Props {
    open: boolean;
    files: ExportFile[];
    /** Ticks made this visit, by file name */
    picks: Record<string, boolean>;
    saved: string[] | null;
    notes: string[];
    ondownload: (names: string[], remember: boolean) => void;
    onforget: () => void;
  }
  let { open = $bindable(), files, picks = $bindable(), saved, notes, ondownload, onforget }: Props = $props();
  // svelte-ignore state_referenced_locally
  let remember = $state(!!saved);
  $effect(() => {
    if (open) remember = !!saved;
  });

  const on = (f: ExportFile) => picked(f, picks, saved);
  const chosen = $derived(files.filter(on));
  const size = $derived(formatSize(chosen.reduce((n, f) => n + f.bytes, 0)));
  const groups = $derived(GROUPS.map((g) => ({ ...g, files: files.filter((f) => f.group === g.id) })).filter((g) => g.files.length));
  const setOnly = (pick: (f: ExportFile) => boolean) => (picks = Object.fromEntries(files.map((f) => [f.name, pick(f)])));
  const quick = $derived([...(saved ? [{ id: 'saved', label: 'Saved', pick: (f: ExportFile) => saved!.includes(f.kind) }] : []), ...QUICK]);
  const matches = (pick: (f: ExportFile) => boolean) => files.every((f) => pick(f) === on(f));
  const toggle = (f: ExportFile) => (picks = { ...picks, [f.name]: !on(f) });
  const key = (e: KeyboardEvent, f: ExportFile) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), toggle(f));
</script>

<Sheet bind:open labelledby="picker-title" data-picker>
  {#snippet header()}
    <h2 id="picker-title" class="text-[18px] font-medium">Choose files</h2>
    <p class="mt-1 font-mono text-[12px] text-text-2" data-picker-summary>{chosen.length} of {files.length} · {size}</p>
  {/snippet}

  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-2">
      {#each quick as q (q.id)}
        {@const active = matches(q.pick)}
        <button
          type="button"
          class="h-8 rounded-full border px-3.5 text-[13px] {active ? 'border-text bg-text font-medium text-page' : 'border-border text-text-2 hover:text-text'}"
          aria-pressed={active}
          data-quick={q.id}
          onclick={() => setOnly(q.pick)}>{q.label}</button
        >
      {/each}
      {#if saved}
        <button type="button" class="ml-auto text-[13px] text-text-2 underline-offset-2 hover:text-text hover:underline" data-forget onclick={() => ((remember = false), onforget())}>Forget saved</button>
      {/if}
    </div>

    {#each groups as g (g.id)}
      {@const n = g.files.filter(on).length}
      {@const full = n === g.files.length}
      <section class="flex flex-col rounded-[14px] bg-surface" data-file-group={g.id}>
        <div class="flex items-baseline gap-3 px-5 pt-4 pb-2">
          <h3 class="min-w-0 flex-1 text-[14px] text-text-2">{g.name}</h3>
          <span class="font-mono text-[12px] text-text-3">{n}/{g.files.length}</span>
          <button
            type="button"
            class="text-[13px] text-text-2 hover:text-text"
            aria-label={`${full ? 'Select none' : 'Select all'} in ${g.name}`}
            data-group-toggle={g.id}
            onclick={() => (picks = { ...picks, ...Object.fromEntries(g.files.map((f) => [f.name, !full])) })}>{full ? 'None' : 'All'}</button
          >
        </div>
        {#each g.files as f, i (f.name)}
          {@const checked = on(f)}
          <div
            role="group"
            tabindex="-1"
            class="mx-2 flex cursor-pointer items-start gap-3 rounded-[10px] px-3 py-3 transition-opacity hover:bg-control focus-visible:outline-2 focus-visible:outline-text"
            class:border-t={i > 0}
            class:border-divider={i > 0}
            style:opacity={checked ? 1 : 0.45}
            data-file={f.name}
            onclick={(e) => { if (!(e.target as HTMLElement).closest('[data-slot=checkbox]')) toggle(f); }}
            onkeydown={(e) => { if (e.target === e.currentTarget) key(e, f); }}
          >
            <Checkbox checked={checked} aria-label={f.name} onCheckedChange={() => toggle(f)} class="mt-[1px]" />
            <span class="min-w-0 flex-1">
              <span class="block font-mono text-[13px] break-all">{f.name}</span>
              <span class="mt-0.5 block text-[13px] leading-normal text-text-2">{f.desc}</span>
            </span>
            <span class="flex-none pt-[1px] font-mono text-[12px] text-text-3">{formatSize(f.bytes)}</span>
          </div>
        {/each}
        <div class="h-2"></div>
      </section>
    {/each}

    {#if notes.length}<p class="text-[13px] leading-normal text-text-3" data-picker-notes>{notes.join(' ')}</p>{/if}
  </div>

  {#snippet footer()}
    <div class="flex flex-wrap items-center gap-3">
      <div class="mr-auto flex items-center gap-2.5 text-[14px]"><Checkbox id="remember-export-files" bind:checked={remember} data-remember /><label for="remember-export-files" data-remember-label class="cursor-pointer">Use this selection every time</label></div>
      <div class="flex gap-2 max-sm:w-full">
        <button type="button" class="h-9 rounded-[10px] px-3.5 text-[14px] text-text-2 hover:text-text max-sm:h-11 max-sm:flex-1 max-sm:bg-control" onclick={() => (open = false)}>Cancel</button>
        <button
          type="button"
          class="h-9 rounded-[10px] px-4 text-[14px] font-medium whitespace-nowrap max-sm:h-11 max-sm:flex-[2] {chosen.length ? 'bg-text text-page' : 'bg-border text-text-3'}"
          disabled={!chosen.length}
          data-download
          onclick={() => ondownload(chosen.map((f) => f.name), remember)}>{chosen.length ? `Download ${chosen.length} file${chosen.length === 1 ? '' : 's'}` : 'Pick a file'}</button
        >
      </div>
    </div>
  {/snippet}
</Sheet>
