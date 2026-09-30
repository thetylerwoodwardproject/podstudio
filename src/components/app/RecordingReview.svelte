<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { ReviewDownload } from '@/lib/recording-review';
  import { formatDuration } from '@/lib/audio/takes';
  import { Button } from '@/components/shadcn/button';
  let { duration, preview, downloads, sync, initialStatus, missingGuest = false, recoveryHref }: { duration: number; preview: (from: number, seconds: number) => Promise<string>; downloads: ReviewDownload[]; sync: () => Promise<string>; initialStatus: string; missingGuest?: boolean; recoveryHref: string } = $props();
  let audio: HTMLAudioElement;
  let position = $state(0), playing = $state(false), loading = $state(false), busy = $state(''), message = $state(''), error = $state('');
  let server = $state(initialStatus), syncing = $state(false);
  let start = 0, url = '', generation = 0;
  const clock = (n: number) => formatDuration(n);
  async function load(from: number, play: boolean) {
    const task = ++generation; audio.pause(); loading = true; error = '';
    try {
      const next = await preview(from, Math.min(30, duration - from));
      if (task !== generation) { URL.revokeObjectURL(next); return; }
      if (url) URL.revokeObjectURL(url); url = next; start = from; position = from; audio.src = url; audio.load();
      if (play) await audio.play();
    } catch (e) { if (task === generation) error = (e as Error).message; }
    finally { if (task === generation) loading = false; }
  }
  async function toggle() {
    if (playing) { audio.pause(); return; }
    if (audio.src && position < duration) await audio.play(); else await load(position >= duration ? 0 : position, true);
  }
  async function synchronize() {
    syncing = true; server = 'Sending recording…';
    try { server = await sync(); } catch { server = 'Waiting for connection'; }
    finally { syncing = false; }
  }
  async function raw(file: ReviewDownload) {
    busy = file.id; message = 'Preparing download…'; error = '';
    try { await file.run((s) => message = s); message = 'Download ready'; }
    catch (e) { error = (e as Error).message; message = ''; }
    finally { busy = ''; }
  }
  onMount(() => { void synchronize(); });
  const online = () => void synchronize();
  $effect(() => { window.addEventListener('online', online); return () => window.removeEventListener('online', online); });
  onDestroy(() => { ++generation; audio?.pause(); if (url) URL.revokeObjectURL(url); });
</script>
<audio data-review-audio bind:this={audio} onplay={() => playing = true} onpause={() => playing = false} ontimeupdate={() => { if (!loading && audio.readyState >= 1) position = Math.min(duration, start + audio.currentTime); }} onended={() => { if (start + audio.duration < duration - .05) void load(start + audio.duration, true); }} hidden></audio>
<div class="flex flex-col gap-5" data-recording-review>
  <div class="rounded-[14px] bg-surface p-5">
    <div class="mb-4 flex items-center gap-4">
      <Button variant="default" size="icon" class="size-12 flex-none rounded-full" aria-label={playing ? 'Pause recording' : 'Play recording'} disabled={loading || !duration} onclick={toggle}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">{#if playing}<rect x="4" y="3" width="4" height="14" rx="1"/><rect x="12" y="3" width="4" height="14" rx="1"/>{:else}<path d="M5 2 18 10 5 18Z"/>{/if}</svg>
      </Button>
      <span class="font-mono text-[13px]" data-review-time>{clock(position)} / {clock(duration)}</span>
      {#if loading}<span role="status" class="text-[13px] text-text-2">Preparing playback…</span>{/if}
    </div>
    <input class="w-full" type="range" min="0" max={duration} step=".1" value={position} aria-label="Recording position" onchange={(e) => load(Math.min(Number(e.currentTarget.value), Math.max(0, duration - .1)), playing)} />
  </div>
  <div class="flex items-center justify-between gap-3 rounded-[14px] bg-surface p-5">
    <div><span class="section-label">Server copy</span><p class="mt-1 text-[13px] text-text-2" role="status" data-review-server>{server}</p></div>
    <button class="h-11 rounded-[10px] border border-border px-4 text-[13px] disabled:opacity-40" disabled={syncing} onclick={synchronize}>Retry synchronization</button>
  </div>
  {#if missingGuest}<p role="status" class="help">Guest audio is still missing. <a class="underline" href={recoveryHref}>Add guest file</a> or retry synchronization.</p>{/if}
  <div class="rounded-[14px] bg-surface p-5">
    <h2 class="section-label mb-3">Raw recordings</h2>
    <div class="flex flex-col gap-3">{#each downloads as file}<div class="flex items-center justify-between gap-3"><span class="text-[14px]">{file.name}</span><button data-raw-download={file.id} class="h-11 rounded-[10px] border border-border px-4 text-[13px] disabled:opacity-40" disabled={!!busy} onclick={() => raw(file)}>Download WAV</button></div>{/each}</div>
    <p role="status" class="help mt-3" aria-live="polite">{message}</p>
  </div>
  {#if error}<p role="alert" class="help text-rec">{error} Try again when connected.</p>{/if}
</div>
