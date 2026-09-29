<script lang="ts">
  import type { EditorFx } from '@/lib/editor-project';
  import { toneFromFx } from '@/lib/editor-project';
  import { BANDS, EQ_PRESETS, COMP_PRESETS, eqResponse, compCurve, flatTone } from '@/lib/audio/tone';
  let { fx = $bindable(), voice }: { fx: EditorFx; voice: boolean } = $props();
  let advanced = $state(false);
  let confirmReset = $state(false);
  function openAdvanced() { fx.tone ??= toneFromFx(fx); advanced = true; }
  const tone = $derived(toneFromFx(fx));
  const eqPath = $derived(Array.from({ length: 161 }, (_, i) => `${i ? 'L' : 'M'}${i * 3},${70 - (tone.eq.on ? eqResponse(20 * 1000 ** (i / 160), tone.eq.gains) : 0) * 2.5}`).join(' '));
  const compPath = $derived(Array.from({ length: 121 }, (_, i) => { const db = -60 + i / 2; return `${i ? 'L' : 'M'}${i * 4},${140 - ((tone.comp.on ? compCurve(db, tone.comp) + tone.comp.makeup : db) + 60) / 60 * 140}`; }).join(' '));
</script>
<div class="flex flex-col gap-5" data-fx-controls>
  <div class="grid grid-cols-2 rounded-[10px] border border-border p-1" aria-label="FX detail">
    <button class="h-9 rounded-[7px] text-[13px]" class:bg-text={!advanced} class:text-page={!advanced} onclick={() => advanced = false}>Simple</button>
    <button class="h-9 rounded-[7px] text-[13px]" class:bg-text={advanced} class:text-page={advanced} onclick={openAdvanced}>Advanced</button>
  </div>
  {#if voice}<label class="text-[13px]">Noise reduction <span class="float-right font-mono text-text-2">{fx.noise}%</span><input class="mt-3 w-full" type="range" min="0" max="100" bind:value={fx.noise} /></label>{/if}
  {#if advanced && fx.tone}
    <section class="flex flex-col gap-4 rounded-[14px] bg-surface p-4">
      <div class="flex justify-between"><label class="text-[14px]">Equalizer <input type="checkbox" bind:checked={fx.tone.eq.on} /></label><button class="text-[12px] text-text-2" onclick={() => fx.tone!.eq = flatTone().eq}>Reset EQ</button></div>
      <label class="text-[13px]">EQ preset<select class="ml-3 h-9 rounded-[10px] border border-border bg-page px-3" value={fx.tone.eq.preset ?? 'Custom'} onchange={(e) => { const name = e.currentTarget.value; if (EQ_PRESETS[name]) fx.tone!.eq = { on: true, gains: [...EQ_PRESETS[name]], preset: name }; }}><option value="Custom" disabled>Custom</option>{#each Object.keys(EQ_PRESETS) as preset}<option>{preset}</option>{/each}</select></label>
      <svg viewBox="0 0 480 140" role="img" aria-label="Equalizer frequency response from 20 Hz to 20 kHz" class="w-full rounded-[10px] bg-nav"><path d="M0 10H480 M0 40H480 M0 70H480 M0 100H480 M0 130H480" stroke="var(--color-border)" fill="none"/><path d={eqPath} stroke="var(--color-text)" stroke-width="2" fill="none" /></svg>
      <div class="flex justify-between font-mono text-[10px] text-text-3"><span>20 Hz</span><span>0 dB · ±24</span><span>20 kHz</span></div>
      <div class="grid grid-cols-2 gap-x-5 gap-y-3">{#each BANDS as frequency, i}<label class="text-[12px] font-mono">{frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`}<span class="float-right text-text-2">{fx.tone.eq.gains[i]} dB</span><input aria-label={`EQ ${frequency} Hz`} class="mt-2 w-full" type="range" min="-12" max="12" step="1" bind:value={fx.tone.eq.gains[i]} oninput={() => { fx.tone!.eq.preset = null; fx.tone!.eq.on = true; }} /></label>{/each}</div>
    </section>
    <section class="flex flex-col gap-4 rounded-[14px] bg-surface p-4">
      <div class="flex justify-between"><label class="text-[14px]">Compressor <input type="checkbox" bind:checked={fx.tone.comp.on} /></label><button class="text-[12px] text-text-2" onclick={() => fx.tone!.comp = flatTone().comp}>Reset compressor</button></div>
      <label class="text-[13px]">Compressor preset<select class="ml-3 h-9 rounded-[10px] border border-border bg-page px-3" value={fx.tone.comp.preset ?? 'Custom'} onchange={(e) => { const name = e.currentTarget.value; if (COMP_PRESETS[name]) fx.tone!.comp = { on: true, ...COMP_PRESETS[name], attackMs: 10, releaseMs: 150, preset: name }; }}><option value="Custom" disabled>Custom</option>{#each Object.keys(COMP_PRESETS) as preset}<option>{preset}</option>{/each}</select></label>
      <svg viewBox="0 0 480 140" role="img" aria-label="Compressor input to output curve" class="w-full rounded-[10px] bg-nav"><path d="M0 140L480 0" stroke="var(--color-border)"/><path d={compPath} stroke="var(--color-text)" stroke-width="2" fill="none"/></svg>
      <div class="flex justify-between font-mono text-[10px] text-text-3"><span>Input −60 dB</span><span>0 dB</span></div>
      <div class="grid grid-cols-2 gap-4">{#each [{ key: 'threshold', name: 'Threshold', min: -40, max: 0, step: 1, unit: 'dB' }, { key: 'ratio', name: 'Ratio', min: 1, max: 10, step: .1, unit: ':1' }, { key: 'knee', name: 'Knee', min: 0, max: 18, step: 1, unit: 'dB' }, { key: 'makeup', name: 'Makeup gain', min: 0, max: 12, step: .5, unit: 'dB' }, { key: 'attackMs', name: 'Attack', min: .1, max: 100, step: .1, unit: 'ms' }, { key: 'releaseMs', name: 'Release', min: 10, max: 2000, step: 10, unit: 'ms' }] as control}<label class="text-[12px]">{control.name} <span class="text-text-3">{control.unit}</span><input class="mt-2 h-10 w-full rounded-[10px] border border-border bg-page px-3 font-mono" type="number" min={control.min} max={control.max} step={control.step} bind:value={fx.tone.comp[control.key as 'threshold' | 'ratio' | 'knee' | 'makeup' | 'attackMs' | 'releaseMs']} oninput={() => { fx.tone!.comp.preset = null; fx.tone!.comp.on = true; }} /></label>{/each}</div>
    </section>
  {:else if fx.tone}
    <p class="help">Advanced EQ and compression are active. Their settings are preserved while this view is collapsed.</p>
    <button class="h-9 rounded-[10px] border border-border text-[13px]" onclick={() => confirmReset = true}>Reset to simple controls…</button>
    {#if confirmReset}<div class="rounded-[12px] bg-surface p-4 text-[13px]">Replace custom EQ and compression with flat EQ and no compression?<div class="mt-3 flex gap-3"><button onclick={() => confirmReset = false}>Keep advanced settings</button><button class="text-rec" onclick={() => { delete fx.tone; fx.low = fx.mid = fx.high = 0; fx.compression = 'Off'; confirmReset = false; }}>Reset</button></div></div>{/if}
  {:else}
    {#each ['low','mid','high'] as band}<label class="text-[13px] capitalize">{band}<span class="float-right font-mono text-text-2">{fx[band as 'low'|'mid'|'high']} dB</span><input class="mt-3 w-full" type="range" min="-12" max="12" step="1" bind:value={fx[band as 'low'|'mid'|'high']} /></label>{/each}
    <label class="flex flex-col gap-2 text-[13px]">Compression<select class="h-10 rounded-[10px] border border-border bg-page px-3" bind:value={fx.compression}>{#each ['Off','Light','Medium','Heavy'] as value}<option>{value}</option>{/each}</select></label>
  {/if}
  {#if voice}<label class="flex items-center justify-between rounded-[10px] bg-surface p-3 text-[13px]">Automatic speech leveling<input type="checkbox" bind:checked={fx.level} /></label>{/if}
</div>
