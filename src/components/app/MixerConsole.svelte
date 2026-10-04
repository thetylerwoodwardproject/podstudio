<script lang="ts">
  import type { EditorTrack } from '@/lib/editor-project';
  import { defaultEditorTrackColor, editorTrackColor } from '@/lib/editor-track-colors';
  import { toFraction } from '@/lib/audio/meter';
  import StatusDot from '@/components/ui/StatusDot.svelte';

  type TrackLevel = { left?: number; right?: number; held?: number };
  type MasterLevel = { left?: number; right?: number; leftHeld?: number; rightHeld?: number };
  type Props = {
    open?: boolean;
    tracks: EditorTrack[];
    levels?: Record<string, TrackLevel>;
    master?: MasterLevel;
    solo?: string[];
    onmute?: (id: string) => void;
    onsolo?: (id: string) => void;
    onlevel?: (id: string, gainDb: number) => void;
    oncommitlevel?: (id: string) => void;
    onfx?: (track: EditorTrack) => void;
    onclose?: () => void;
    masterGain?: number;
    onmasterlevel?: (gainDb: number) => void;
    oncommitmasterlevel?: () => void;
    playing?: boolean;
    loading?: boolean;
    playhead?: number;
    duration?: number;
    playbackStatus?: string;
    looping?: boolean;
    onplay?: () => void | Promise<void>;
    onpause?: () => void;
    onstop?: () => void;
    onseek?: (at: number) => void;
    onloop?: () => void;
  };

  let { open = $bindable(), tracks, levels = {}, master = {}, solo = [], onmute, onsolo, onlevel, oncommitlevel, onfx, onclose, masterGain = 0, onmasterlevel, oncommitmasterlevel,
    playing = false, loading = false, playhead = 0, duration = 0, playbackStatus = '', looping = false, onplay, onpause, onstop, onseek, onloop }: Props = $props();
  let dialog: HTMLDialogElement;
  let faderDrafts = $state<Record<string, number>>({});
  let masterFaderDraft = $state<number | undefined>(undefined);
  const segments = Array.from({ length: 24 }, (_, index) => index);
  const masterSegments = Array.from({ length: 32 }, (_, index) => index);

  $effect(() => {
    if (open && !dialog.open) {
      dialog.showModal();
      document.documentElement.style.overflow = 'hidden';
    } else if (!open && dialog.open) dialog.close();
  });

  const db = (value: number | undefined) => Number.isFinite(value) ? `${value! > 0 ? '+' : ''}${value!.toFixed(1)}` : '−∞';
  const time = (value: number) => {
    const safe = Math.max(0, Number.isFinite(value) ? value : 0);
    const minutes = Math.floor(safe / 60);
    const seconds = Math.floor(safe % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };
  const meterColor = (value: number | undefined, index: number, count = segments.length) => {
    const lit = Number.isFinite(value) ? Math.ceil(toFraction(value!) * count) : 0;
    if (index >= lit) return 'var(--color-meter-off)';
    const position = (index + 1) / count;
    if (position > toFraction(-3)) return 'var(--color-rec)';
    if (position > toFraction(-12)) return 'var(--color-warn)';
    return 'var(--color-ok)';
  };
  const channelLevels = (track: EditorTrack) => {
    const level = levels[track.id] ?? {};
    return track.channels === 2 ? [{ label: 'L', value: level.left }, { label: 'R', value: level.right }] : [{ label: 'M', value: level.left }];
  };
  const stripColor = (track: EditorTrack, index: number) => track.color ? editorTrackColor(track.color) : editorTrackColor(defaultEditorTrackColor(index));
  const faderValue = (track: EditorTrack) => faderDrafts[track.id] ?? track.gainDb;
  const masterFaderValue = () => masterFaderDraft ?? masterGain;
  const faderPercent = (value: number) => Math.max(0, Math.min(100, ((value + 24) / 36) * 100));
  function stageFader(id: string, value: number) {
    faderDrafts = { ...faderDrafts, [id]: value };
    onlevel?.(id, value);
  }
  function commitFader(id: string) {
    oncommitlevel?.(id);
    const next = { ...faderDrafts };
    delete next[id];
    faderDrafts = next;
  }
  function stageMasterFader(value: number) {
    masterFaderDraft = value;
    onmasterlevel?.(value);
  }
  function commitMasterFader() {
    if (masterFaderDraft === undefined) return;
    oncommitmasterlevel?.();
    masterFaderDraft = undefined;
  }
  function close() { dialog?.close(); }
</script>

<dialog bind:this={dialog} data-mixer-console aria-labelledby="mixer-console-title" aria-modal="true"
  class="m-auto w-[min(1240px,calc(100vw-32px))] overflow-hidden rounded-[18px] border border-border bg-page p-0 text-text shadow-2xl backdrop:bg-black/75 max-sm:mx-0 max-sm:mb-0 max-sm:w-full max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0"
  onclose={() => { document.documentElement.style.overflow = ''; open = false; onclose?.(); }}
  onclick={(event) => event.target === dialog && close()}>
  <div class="flex max-h-[calc(100dvh-32px)] flex-col max-sm:max-h-[92dvh]">
    <header class="flex flex-none items-center justify-between gap-4 border-b border-divider bg-nav px-5 py-4">
      <div>
        <div class="flex items-center gap-2"><span class="font-mono text-[10px] tracking-[0.18em] text-text-3">PODSTUDIO / EDITOR</span><StatusDot variant="success" size="sm" /></div>
        <h2 id="mixer-console-title" class="mt-1 text-[20px] font-semibold tracking-tight">Mixer</h2>
        <p class="mt-0.5 text-[12px] text-text-2">Channel strips for the current edit. Changes follow the timeline mix.</p>
      </div>
      <button type="button" class="flex size-9 items-center justify-center rounded-[9px] border border-border text-[20px] text-text-2 hover:bg-control hover:text-text" aria-label="Close mixer" title="Close mixer" onclick={close}>×</button>
    </header>

    <div class="min-h-0 flex-1 overflow-x-auto overflow-y-hidden bg-page px-4 py-3">
      <div class="min-w-[720px]">
        <div class="flex items-stretch gap-2">
          {#each tracks as track, index}
            {@const color = stripColor(track, index)}
            {@const level = levels[track.id] ?? {}}
            <section class="flex w-[156px] flex-none flex-col overflow-hidden rounded-[12px] border border-border bg-surface" data-mixer-channel={track.id}>
              <div class="border-b border-divider px-3 pb-2 pt-3">
                <div class="flex items-center justify-between gap-2"><span class="font-mono text-[10px] text-text-3">CH {String(index + 1).padStart(2, '0')}</span><StatusDot color={color} size="sm" /><button class="text-[11px] text-text-3 hover:text-text" aria-label={`${track.name} soft select`} title="Soft select" onclick={() => onfx?.(track)}>SOFT SELECT</button></div>
                <h3 class="mt-2 truncate text-[14px] font-semibold" title={track.name}>{track.name}</h3>
                <span class="font-mono text-[10px] text-text-3">{track.role === 'host' ? 'HOST MIC' : track.role === 'guest' ? 'GUEST MIC' : track.kind.toUpperCase()}</span>
              </div>

              <div class="border-b border-divider px-3 py-3">
                <div class="mb-2 flex items-center justify-between"><span class="font-mono text-[10px] text-text-3">LEVEL</span><span class="font-mono text-[12px] tabular-nums" style={`color:${color}`}>{db(level.held)} dB</span></div>
                <div class="flex h-36 items-end justify-center gap-2">
                  <div class="flex h-full items-stretch gap-1" aria-label={`${track.name} live meter`} role="meter" aria-valuemin="-60" aria-valuemax="12" aria-valuenow={Number.isFinite(level.held) ? level.held : -60} aria-valuetext={`${db(level.held)} dBFS`}>
                    {#each channelLevels(track) as channel}<div class="flex w-2 flex-col-reverse gap-px">{#each segments as segment}<span class="min-h-[3px] flex-1 rounded-[1px] transition-colors duration-75" style={`background:${meterColor(channel.value, segment)}`}></span>{/each}</div>{/each}
                  </div>
                  <div class="relative h-36 w-10" style={`--fader-color:${color}`}>
                    <div class="pointer-events-none absolute left-1/2 top-2 bottom-2 w-1.5 -translate-x-1/2 rounded-full bg-page shadow-inner"></div>
                    <div class="pointer-events-none absolute left-1/2 bottom-2 w-1.5 -translate-x-1/2 rounded-full opacity-80" style={`height:${faderPercent(faderValue(track))}%;background:var(--fader-color)`}></div>
                    <div class="pointer-events-none absolute left-1/2 size-7 -translate-x-1/2 translate-y-1/2 rounded-[5px] border border-white/40 bg-gradient-to-b from-white/95 via-white/65 to-white/30 shadow-[0_2px_8px_rgba(0,0,0,.5)]" style={`bottom:${faderPercent(faderValue(track))}%`}></div>
                    <input class="absolute inset-0 h-full w-full cursor-pointer opacity-0" style="writing-mode:vertical-lr;direction:rtl" aria-label={`${track.name} fader`} type="range" min="-24" max="12" step="1" value={faderValue(track)} oninput={(event) => stageFader(track.id, Number(event.currentTarget.value))} onchange={() => commitFader(track.id)} onblur={() => commitFader(track.id)} />
                  </div>
                </div>
                <div class="mt-2 flex justify-between font-mono text-[9px] text-text-3"><span>+12</span><span>0</span><span>−12</span><span>−24</span></div>
              </div>

              <div class="mt-auto grid grid-cols-2 gap-1 border-b border-divider px-3 py-2">
                <button type="button" class="h-8 rounded-[6px] border border-border font-mono text-[10px]" class:bg-rec={track.muted} class:text-white={track.muted} aria-label={`${track.muted ? 'Unmute' : 'Mute'} ${track.name}`} onclick={() => onmute?.(track.id)}>MUTE</button>
                <button type="button" class="h-8 rounded-[6px] border border-border font-mono text-[10px]" class:bg-warn={solo.includes(track.id)} class:text-page={solo.includes(track.id)} aria-label={`${solo.includes(track.id) ? 'Unsolo' : 'Solo'} ${track.name}`} onclick={() => onsolo?.(track.id)}>SOLO</button>
              </div>
              <div class="px-3 py-2"><button type="button" class="h-8 w-full rounded-[6px] border border-border font-mono text-[10px] text-text-2 hover:bg-control hover:text-text" onclick={() => onfx?.(track)}>FX</button></div>
            </section>
          {/each}
          <section class="sticky right-0 z-10 order-last ml-auto flex w-[156px] flex-none flex-col overflow-hidden rounded-[12px] border border-primary/50 bg-surface shadow-[-10px_0_18px_rgba(0,0,0,.22)]" data-mixer-master>
            <div class="border-b border-divider px-3 pb-2 pt-3">
              <div class="flex items-center justify-between gap-2"><span class="font-mono text-[10px] tracking-[0.12em] text-text-3">MASTER</span><StatusDot variant="success" size="sm" /></div>
              <h3 class="mt-2 text-[14px] font-semibold">Output</h3>
              <span class="font-mono text-[10px] text-text-3">STEREO BUS</span>
            </div>
            <div class="border-b border-divider px-3 py-3">
              <div class="mb-2 flex items-center justify-between"><span class="font-mono text-[10px] text-text-3">MASTER LEVEL</span><span class="font-mono text-[12px] tabular-nums text-primary">{db(masterFaderValue())} dB</span></div>
              <div class="flex h-36 items-end justify-center gap-3">
                <div class="flex h-full items-stretch gap-1" aria-label="Master output live meter" role="meter" aria-valuemin="-60" aria-valuemax="12" aria-valuenow={Number.isFinite(master.rightHeld) ? master.rightHeld : -60} aria-valuetext={`${db(master.rightHeld)} dBFS`}>
                  {#each [{ value: master.left }, { value: master.right }] as channel}<div class="flex w-2 flex-col-reverse gap-px">{#each masterSegments as segment}<span class="min-h-[3px] flex-1 rounded-[1px] transition-colors duration-75" style={`background:${meterColor(channel.value, segment, masterSegments.length)}`}></span>{/each}</div>{/each}
                </div>
                <div class="relative h-36 w-10" style="--fader-color:var(--color-primary)">
                  <div class="pointer-events-none absolute left-1/2 top-2 bottom-2 w-1.5 -translate-x-1/2 rounded-full bg-page shadow-inner"></div>
                  <div class="pointer-events-none absolute left-1/2 bottom-2 w-1.5 -translate-x-1/2 rounded-full bg-primary opacity-80" style={`height:${faderPercent(masterFaderValue())}%;`}></div>
                  <div class="pointer-events-none absolute left-1/2 size-7 -translate-x-1/2 translate-y-1/2 rounded-[5px] border border-white/40 bg-gradient-to-b from-white/95 via-white/65 to-white/30 shadow-[0_2px_8px_rgba(0,0,0,.5)]" style={`bottom:${faderPercent(masterFaderValue())}%`}></div>
                  <input class="absolute inset-0 h-full w-full cursor-pointer opacity-0" style="writing-mode:vertical-lr;direction:rtl" aria-label="Master output fader" type="range" min="-24" max="0" step="1" value={masterFaderValue()} oninput={(event) => stageMasterFader(Number(event.currentTarget.value))} onchange={commitMasterFader} onblur={commitMasterFader} />
                </div>
              </div>
              <div class="mt-2 flex justify-between font-mono text-[9px] text-text-3"><span>0</span><span>−12</span><span>−24</span></div>
            </div>
            <div class="mt-auto px-3 py-2"><span class="block text-center font-mono text-[10px] text-text-3">PRE-MASTER OUTPUT</span></div>
          </section>
          {#if !tracks.length}<div class="flex min-h-56 flex-1 items-center justify-center rounded-[12px] border border-dashed border-border text-[13px] text-text-2">No active tracks</div>{/if}
        </div>
      </div>
    </div>

    <footer class="flex flex-none items-center gap-2 border-t border-divider bg-nav px-4 py-2.5 text-[11px] text-text-3">
      <button type="button" class="flex size-8 flex-none items-center justify-center rounded-full border border-white/20 bg-black text-white shadow-sm hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50" aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'} onclick={() => playing ? onpause?.() : void onplay?.()}>
        {#if playing}
          <svg viewBox="0 0 20 20" class="size-4" aria-hidden="true"><path d="M6 4.5v11M14 4.5v11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
        {:else}
          <svg viewBox="0 0 20 20" class="size-4" aria-hidden="true"><path d="m7 4 8 6-8 6V4Z" fill="currentColor" /></svg>
        {/if}
      </button>
      <button type="button" class="flex size-8 flex-none items-center justify-center rounded-[7px] border border-border text-text-2 hover:bg-control hover:text-text" aria-label="Stop" title="Stop" onclick={() => onstop?.()}>
        <svg viewBox="0 0 20 20" class="size-3.5" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="1" fill="currentColor" /></svg>
      </button>
      <button type="button" class="flex size-8 flex-none items-center justify-center rounded-[7px] border border-border text-text-2 hover:bg-control hover:text-text" class:border-primary={looping} class:bg-control={looping} class:text-primary={looping} aria-label={looping ? 'Disable loop' : 'Enable loop'} aria-pressed={looping} title={looping ? 'Disable loop' : 'Loop'} onclick={() => onloop?.()}>
        <svg viewBox="0 0 20 20" class="size-3.5" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h9a3 3 0 0 1 3 3v1"/><path d="m13 4 3 2-3 2"/><path d="M16 14H7a3 3 0 0 1-3-3v-1"/><path d="m7 16-3-2 3-2"/></svg>
      </button>
      <span class="w-10 flex-none font-mono text-[10px] tabular-nums text-text-2">{time(playhead)}</span>
      <input class="min-w-0 flex-1 accent-primary" aria-label="Mixer playback position" type="range" min="0" max={Math.max(0.01, duration)} step="0.01" value={Math.min(playhead, duration)} oninput={(event) => onseek?.(Number(event.currentTarget.value))} />
      <span class="w-10 flex-none font-mono text-[10px] tabular-nums text-text-2">{time(duration)}</span>
      {#if loading || playbackStatus}<span class="hidden max-w-28 truncate text-[10px] text-text-2 sm:inline" role="status">{playbackStatus || 'Preparing audio…'}</span>{/if}
      <span class="hidden text-[10px] text-text-3 lg:inline">Faders affect the finished mix.</span>
      <button type="button" class="h-8 flex-none rounded-[7px] border border-border px-3 font-mono text-[10px] text-text-2 hover:bg-control hover:text-text" onclick={close}>Return to editor</button>
    </footer>
  </div>
</dialog>
