<script lang="ts">
  import type { EditorFx, ShapePreset } from '@/lib/editor-project';
  import { toneFromFx } from '@/lib/editor-project';
  import { BANDS, EQ_PRESETS, COMP_PRESETS, eqResponse, compCurve, flatTone } from '@/lib/audio/tone';
  import { Slider } from '@/components/shadcn/slider';
  import { Checkbox } from '@/components/shadcn/checkbox';
  import FxKnob from './FxKnob.svelte';
  let { fx = $bindable(), voice }: { fx: EditorFx; voice: boolean } = $props();
  let advanced = $state(false);
  let confirmReset = $state(false);
  let generatedTone = false;
  let initialTone = '';
  const legacyActive = $derived(!fx.macro && (fx.low !== 0 || fx.mid !== 0 || fx.high !== 0 || fx.compression !== 'Off'));
  function openAdvanced() {
    generatedTone = !fx.tone;
    if (generatedTone) { fx.tone = toneFromFx(fx); initialTone = JSON.stringify(fx.tone); }
    advanced = true;
  }
  function openSimple() {
    if (generatedTone && JSON.stringify(fx.tone) === initialTone) delete fx.tone;
    generatedTone = false;
    advanced = false;
  }
  const macro = () => fx.macro ?? { shape: 0, shapePreset: 'Clear' as ShapePreset, boost: 0 };
  function setShape(shape: number) { fx.macro = { ...macro(), shape }; }
  function setBoost(boost: number) { fx.macro = { ...macro(), boost }; }
  function setPreset(shapePreset: ShapePreset) { fx.macro = { ...macro(), shapePreset }; }
  function resetSimple() {
    delete fx.tone; fx.low = fx.mid = fx.high = 0; fx.compression = 'Off';
    fx.macro = { shape: 0, shapePreset: 'Clear', boost: 0 }; confirmReset = false;
  }
  const tone = $derived(toneFromFx(fx));
  const eqPath = $derived(Array.from({ length: 161 }, (_, i) => `${i ? 'L' : 'M'}${i * 3},${70 - (tone.eq.on ? eqResponse(20 * 1000 ** (i / 160), tone.eq.gains) : 0) * 2.5}`).join(' '));
  const compPath = $derived(Array.from({ length: 121 }, (_, i) => { const db = -60 + i / 2; return `${i ? 'L' : 'M'}${i * 4},${140 - ((tone.comp.on ? compCurve(db, tone.comp) + tone.comp.makeup : db) + 60) / 60 * 140}`; }).join(' '));
</script>
<div class="flex flex-col gap-5" data-fx-controls>
  <div class="grid grid-cols-2 rounded-[10px] border border-border p-1" aria-label="FX detail">
    <button class="h-9 rounded-[7px] text-[13px]" class:bg-text={!advanced} class:text-page={!advanced} onclick={openSimple}>Simple</button>
    <button class="h-9 rounded-[7px] text-[13px]" class:bg-text={advanced} class:text-page={advanced} onclick={openAdvanced}>Advanced</button>
  </div>
  {#if voice && advanced}<label class="text-[13px]">Noise reduction <span class="float-right font-mono text-text-2">{fx.noise}%</span><Slider type="single" aria-label="Noise reduction" class="mt-3" min={0} max={100} step={1} bind:value={fx.noise} /></label>{/if}
  {#if advanced && fx.tone}
    <section class="flex flex-col gap-4 rounded-[14px] bg-surface p-4">
      <div class="flex justify-between"><div class="flex items-center gap-2"><Checkbox id="fx-equalizer" bind:checked={fx.tone.eq.on} /><label for="fx-equalizer" class="text-[14px]">Equalizer</label></div><button class="text-[12px] text-text-2" onclick={() => fx.tone!.eq = flatTone().eq}>Reset EQ</button></div>
      <label class="text-[13px]">EQ preset<select class="ml-3 h-9 min-w-36 rounded-[10px] border border-border bg-page pl-3 pr-9" value={fx.tone.eq.preset ?? 'Custom'} onchange={(e) => { const name = e.currentTarget.value; if (EQ_PRESETS[name]) fx.tone!.eq = { on: true, gains: [...EQ_PRESETS[name]], preset: name }; }}><option value="Custom" disabled>Custom</option>{#each Object.keys(EQ_PRESETS) as preset}<option>{preset}</option>{/each}</select></label>
      <svg viewBox="0 0 480 140" role="img" aria-label="Equalizer frequency response from 20 Hz to 20 kHz" class="w-full rounded-[10px] bg-nav"><path d="M0 10H480 M0 40H480 M0 70H480 M0 100H480 M0 130H480" stroke="var(--color-border)" fill="none"/><path d={eqPath} stroke="var(--color-text)" stroke-width="2" fill="none" /></svg>
      <div class="flex justify-between font-mono text-[10px] text-text-3"><span>20 Hz</span><span>0 dB · ±12</span><span>20 kHz</span></div>
      <div class="grid grid-cols-10 gap-1 overflow-x-auto pb-1" data-eq-bands>
        {#each BANDS as frequency, i}
          <div class="flex min-w-0 flex-col items-center gap-2 text-center">
            <span class="font-mono text-[10px] tabular-nums text-text-2">{fx.tone.eq.gains[i] > 0 ? '+' : ''}{fx.tone.eq.gains[i]}</span>
            <Slider type="single" orientation="vertical" aria-label={`EQ ${frequency} Hz`} min={-12} max={12} step={1}
              value={fx.tone.eq.gains[i]} onValueChange={(value: number) => { fx.tone!.eq.gains[i] = value; fx.tone!.eq.preset = null; fx.tone!.eq.on = true; }}
              class="h-36 min-h-36" />
            <span class="whitespace-nowrap font-mono text-[9px] text-text-3">{frequency >= 1000 ? `${frequency / 1000}k` : frequency}</span>
          </div>
        {/each}
      </div>
    </section>
    <section class="flex flex-col gap-4 rounded-[14px] bg-surface p-4">
      <div class="flex justify-between"><div class="flex items-center gap-2"><Checkbox id="fx-compressor" bind:checked={fx.tone.comp.on} /><label for="fx-compressor" class="text-[14px]">Compressor</label></div><button class="text-[12px] text-text-2" onclick={() => fx.tone!.comp = flatTone().comp}>Reset compressor</button></div>
      <label class="text-[13px]">Compressor preset<select class="ml-3 h-9 min-w-36 rounded-[10px] border border-border bg-page pl-3 pr-9" value={fx.tone.comp.preset ?? 'Custom'} onchange={(e) => { const name = e.currentTarget.value; if (COMP_PRESETS[name]) fx.tone!.comp = { on: true, ...COMP_PRESETS[name], attackMs: 10, releaseMs: 150, preset: name }; }}><option value="Custom" disabled>Custom</option>{#each Object.keys(COMP_PRESETS) as preset}<option>{preset}</option>{/each}</select></label>
      <svg viewBox="0 0 480 140" role="img" aria-label="Compressor input to output curve" class="w-full rounded-[10px] bg-nav"><path d="M0 140L480 0" stroke="var(--color-border)"/><path d={compPath} stroke="var(--color-text)" stroke-width="2" fill="none"/></svg>
      <div class="flex justify-between font-mono text-[10px] text-text-3"><span>Input −60 dB</span><span>0 dB</span></div>
      <div class="grid grid-cols-2 gap-4">{#each [{ key: 'threshold', name: 'Threshold', min: -40, max: 0, step: 1, unit: 'dB' }, { key: 'ratio', name: 'Ratio', min: 1, max: 10, step: .1, unit: ':1' }, { key: 'knee', name: 'Knee', min: 0, max: 18, step: 1, unit: 'dB' }, { key: 'makeup', name: 'Makeup gain', min: 0, max: 12, step: .5, unit: 'dB' }, { key: 'attackMs', name: 'Attack', min: .1, max: 100, step: .1, unit: 'ms' }, { key: 'releaseMs', name: 'Release', min: 10, max: 2000, step: 10, unit: 'ms' }] as control}<label class="text-[12px]">{control.name} <span class="text-text-3">{control.unit}</span><input class="mt-2 h-10 w-full rounded-[10px] border border-border bg-page px-3 font-mono" type="number" min={control.min} max={control.max} step={control.step} bind:value={fx.tone.comp[control.key as 'threshold' | 'ratio' | 'knee' | 'makeup' | 'attackMs' | 'releaseMs']} oninput={() => { fx.tone!.comp.preset = null; fx.tone!.comp.on = true; }} /></label>{/each}</div>
    </section>
  {:else if fx.tone || legacyActive}
    <p class="help">Advanced EQ and compression are active. Their settings are preserved while this view is collapsed.</p>
    <button class="h-9 rounded-[10px] border border-border text-[13px]" onclick={() => confirmReset = true}>Replace with Simple controls…</button>
    {#if confirmReset}<div class="rounded-[12px] bg-surface p-4 text-[13px]">Replace the current EQ and compression with neutral Clean, Shape, and Boost settings?<div class="mt-3 flex gap-3"><button onclick={() => confirmReset = false}>Keep current sound</button><button class="text-rec" onclick={resetSimple}>Replace settings</button></div></div>{/if}
  {:else}
    <div class="grid gap-3 rounded-[14px] bg-surface p-4" class:grid-cols-3={voice} class:grid-cols-2={!voice}>
      {#if voice}<FxKnob label="Clean" description="Reduce background noise" bind:value={fx.noise} />{/if}
      <FxKnob label="Shape" description="Set the voice or track tone" value={macro().shape} onvaluechange={setShape} />
      <FxKnob label="Boost" description="Add steady presence" value={macro().boost} onvaluechange={setBoost} />
    </div>
    <label class="flex items-center justify-between gap-3 text-[13px]">Shape preset
      <select aria-label="Shape preset" class="h-10 min-w-[160px] rounded-[10px] border border-border bg-page px-3" value={macro().shapePreset} onchange={(event) => setPreset(event.currentTarget.value as ShapePreset)}>
        {#each ['Warm', 'Clear', 'De-mud', 'Radio'] as preset}<option>{preset}</option>{/each}
      </select>
    </label>
  {/if}
  {#if voice}<div class="flex items-center justify-between rounded-[10px] bg-surface p-3 text-[13px]"><label for="fx-leveling">Automatic speech leveling</label><Checkbox id="fx-leveling" bind:checked={fx.level} /></div>{/if}
</div>
