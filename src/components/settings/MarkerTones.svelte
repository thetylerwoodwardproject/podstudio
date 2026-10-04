<!--
  Settings → Recording, marker tones (design: step flow 1f): add tones, their
  pitch and how far they drop under your voice, with the rest under More. The
  five clean reference previews use the same generated tones as export.
-->
<script lang="ts">
  import Switch from '@/components/ui/Switch.svelte';
  import { Checkbox } from '@/components/shadcn/checkbox';
  import Segmented from '@/components/ui/Segmented.svelte';
  import { PreviewPlayer } from '@/lib/audio/preview-player';
  import { hzLabel, markerTonePreview, toneFreq, type ToneKind, type TonePitch, type ToneSettings } from '@/lib/audio/tones';

  interface Props {
    initial: ToneSettings;
    onchange: (t: ToneSettings) => void;
  }
  let { initial, onchange }: Props = $props();
  // svelte-ignore state_referenced_locally
  const t = $state(structuredClone(initial));
  $effect(() => onchange($state.snapshot(t) as ToneSettings));

  const KINDS: [ToneKind, string][] = [
    ['retake', 'Retake'],
    ['cut', 'Cough'],
    ['adlib', 'Ad-lib'],
    ['pause', 'Pause'],
    ['gap', 'Mic stopped'],
  ];
  const SLIDERS = [
    { k: 'level', label: 'Tone level', min: -30, max: -6, step: 1, unit: 'dBFS' },
    { k: 'attackMs', label: 'Attack', min: 1, max: 100, step: 1, unit: 'ms' },
    { k: 'releaseMs', label: 'Release', min: 20, max: 1000, step: 10, unit: 'ms' },
  ] as const;
  const minus = (s: string) => s.replace(/-/g, '−');

  // Clean reference tones: one at a time, without synthetic speech or ducking.
  const RATE = 48000;
  const player = new PreviewPlayer();
  let playing = $state<ToneKind | null>(null);
  $effect(() => () => player.close());
  player.onended = () => (playing = null);
  async function preview(kind: ToneKind) {
    if (playing === kind && player.playing) {
      player.reset();
      playing = null;
      return;
    }
    const s = $state.snapshot(t) as ToneSettings;
    player.set({ options: [markerTonePreview(kind, s, RATE)], channels: 1, rate: RATE });
    playing = kind;
    await player.play();
  }
  const row = 'flex items-center gap-4 px-5 py-[18px]';
  const rule = 'mx-5 h-px bg-divider';
</script>

<div class="flex flex-col overflow-hidden rounded-[14px] bg-surface" data-tones>
  <div class={row}>
    <div class="min-w-0 flex-1">
      <div class="text-[14px]" id="tone-default-label">Marker tones</div>
      <div class="help mt-0.5">A short beep at each marker in the full recording, so you can find it by ear. The assembled edit never has them. Off by default.</div>
    </div>
    <Switch label="Add tones" bind:checked={t.inExports} />
  </div>
  <div class={rule}></div>
  <div class="flex flex-col gap-5 transition-opacity" class:opacity-40={!t.inExports} data-tone-options>
    <div class="flex flex-wrap items-center justify-between gap-3 px-5 pt-[18px]">
      <span class="text-[14px]">Pitch</span>
      <Segmented
        label="Pitch"
        value={t.pitch}
        options={[
          { value: 'low', label: 'Low' },
          { value: 'mid', label: '1 kHz' },
          { value: 'high', label: 'High' },
        ]}
        data-tone-pitch
        onchange={(v) => (t.pitch = v as TonePitch)}
      />
    </div>
    <div class={rule}></div>
    <div class="flex flex-col gap-2 px-5" data-tone-previews>
      <div class="text-[14px]">Preview each tone</div>
      <p class="help">Clean reference tones at the level used in the export. Ducking only applies when they are mixed under speech.</p>
      <div class="grid gap-2 sm:grid-cols-2">
        {#each KINDS as [k, name]}
          <button
            type="button"
            class="flex h-10 items-center gap-3 rounded-[10px] border border-border bg-page px-3 text-left text-[14px] hover:border-handle focus-visible:outline-2 focus-visible:outline-text"
            aria-label={`${playing === k ? 'Stop' : 'Preview'} ${name} tone, ${hzLabel(toneFreq(k, t.pitch))}`}
            data-tone-preview={k}
            onclick={() => preview(k)}
          >
            <span class="flex size-7 items-center justify-center rounded-full border border-white/20 bg-black text-white shadow-sm" aria-hidden="true">
              {#if playing === k}<svg class="size-3.5" viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="3" width="4" height="14" rx="1"/><rect x="12" y="3" width="4" height="14" rx="1"/></svg>{:else}<svg class="ml-0.5 size-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M5 2 18 10 5 18Z"/></svg>{/if}
            </span>
            <span class="min-w-0 flex-1">{name}</span>
            <span class="font-mono text-[12px] text-text-3">{hzLabel(toneFreq(k, t.pitch))}</span>
          </button>
        {/each}
      </div>
    </div>
    <div class={rule}></div>
    <label class="flex flex-col gap-3 px-5">
      <span class="flex items-baseline justify-between text-[14px]">Under your voice<span class="font-mono text-[13px]" data-tone-value="duck">{t.duck ? minus(`-${t.duck}`) : '0'} dB</span></span>
      <input type="range" min="0" max="24" step="1" class="w-full" data-tone-range="duck" bind:value={t.duck} />
      <span class="help">How far the tone drops when you’re talking over it.</span>
    </label>
    <details class="group border-t border-divider px-5 pt-3.5 pb-5" data-tone-more>
      <summary class="flex cursor-pointer list-none items-center gap-2 text-[14px] text-text-2 hover:text-text [&::-webkit-details-marker]:hidden">
        <span class="inline-block transition-transform group-open:rotate-90">›</span>More
      </summary>
      <div class="mt-4 flex flex-col gap-5">
        <div class="flex flex-col gap-3">
          <div class="text-[14px]">Markers that beep</div>
          <div class="flex flex-wrap gap-2" role="group" aria-label="Markers that beep">
            {#each KINDS as [k, name]}
              <div class="inline-flex h-[34px] items-center gap-2 rounded-[9px] border border-border px-3 text-[14px] transition-colors has-[[data-state=checked]]:border-handle has-[[data-state=checked]]:bg-control">
                <Checkbox id={`tone-${k}`} data-tone-kind={k} bind:checked={t.kinds[k]} />
                <label for={`tone-${k}`} class="cursor-pointer">{name}</label>
                <span class="font-mono text-[12px] text-text-3">{hzLabel(toneFreq(k, t.pitch))}</span>
              </div>
            {/each}
          </div>
        </div>
        <div class="grid gap-x-8 gap-y-5 sm:grid-cols-3">
          {#each SLIDERS as s}
            <label class="flex flex-col gap-3">
              <span class="flex justify-between text-[14px]">{s.label}<span class="font-mono text-[13px]" data-tone-value={s.k}>{minus(String(t[s.k]))} {s.unit}</span></span>
              <input type="range" min={s.min} max={s.max} step={s.step} class="w-full" data-tone-range={s.k} bind:value={t[s.k]} />
            </label>
          {/each}
        </div>
        <p class="help">Attack sets how fast a tone drops when you start talking; release, how fast it comes back.</p>
      </div>
    </details>
  </div>
</div>
