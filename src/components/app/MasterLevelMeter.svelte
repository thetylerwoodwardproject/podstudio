<script lang="ts">
  import { Button } from '@/components/shadcn/button';
  import { toFraction } from '@/lib/audio/meter';

  let { left = -Infinity, right = -Infinity, leftHeld = -Infinity, rightHeld = -Infinity,
    short = -Infinity, long = -Infinity, range = null }: {
    left?: number; right?: number; leftHeld?: number; rightHeld?: number;
    short?: number; long?: number; range?: number | null;
  } = $props();
  let mode = $state<'dbfs' | 'lufs'>('dbfs');
  const segments = Array.from({ length: 32 }, (_, index) => index);
  const format = (db: number) => Number.isFinite(db) ? `${db > 0 ? '+' : ''}${db.toFixed(1)}` : '−∞';
  const precise = (value: number) => Number.isFinite(value) ? value.toFixed(1).replace('-', '−') : '—';
  const segmentZone = (index: number) => {
    const position = (index + 1) / segments.length;
    // Pi-Tuner's digital scale keeps comfortable headroom green, warns in
    // the last 12 dB, and reserves red for the clipping edge.
    if (position > toFraction(-3)) return 'var(--color-rec)';
    if (position > toFraction(-12)) return 'var(--color-warn)';
    return 'var(--color-ok)';
  };
  const segmentColor = (db: number, held: number, index: number) => {
    const lit = Number.isFinite(db) ? Math.ceil(toFraction(db) * segments.length) : 0;
    const hold = Number.isFinite(held) ? Math.ceil(toFraction(held) * segments.length) - 1 : -1;
    if (index === hold && hold >= 0) return 'var(--color-text)';
    const zone = segmentZone(index);
    if (index >= lit) return `color-mix(in oklab, ${zone} 20%, var(--color-meter-off))`;
    return zone;
  };
</script>

<div data-master-meter data-mode={mode} class="relative flex w-[clamp(230px,24vw,320px)] flex-none flex-col gap-1" role="group" aria-label="Master output levels"
  title={mode === 'dbfs' ? 'Master output sample peaks · dBFS. Click for LUFS.' : 'LUFS measured from audio played since the last seek or edit. Click for dBFS.'}>
  <span class="font-mono text-[10px] leading-3 tracking-[0.08em] text-text-3">MASTER OUTPUT · {mode === 'dbfs' ? 'dBFS' : 'LUFS'}</span>
  {#if mode === 'dbfs'}
    {#each [{ label: 'L', db: left, held: leftHeld }, { label: 'R', db: right, held: rightHeld }] as channel}
      <div class="flex h-4 items-center gap-2" role="meter" aria-label={`Master ${channel.label === 'L' ? 'left' : 'right'} level`}
        aria-valuemin="-60" aria-valuemax="12" aria-valuenow={Number.isFinite(channel.held) ? Math.max(-60, Math.min(12, Math.round(channel.held))) : -60}
        aria-valuetext={`${format(channel.held)} dBFS`}>
        <span class="w-3 font-mono text-[10px] text-text-3">{channel.label}</span>
        <div class="flex min-w-0 flex-1 gap-0.5" aria-hidden="true">
          {#each segments as index}
            <span class="h-2 min-w-0 flex-1 rounded-[1px] transition-colors duration-75" style={`background:${segmentColor(channel.db, channel.held, index)}`}></span>
          {/each}
        </div>
        <div class="flex w-[82px] items-center justify-end gap-1 text-right font-mono text-[10px] tabular-nums text-text-2">
          {#if channel.held >= 0}<span class="rounded-full bg-rec px-1 py-px text-[8px] font-semibold leading-none text-white">OVR</span>{/if}
          <span>pk {format(channel.held)} dBFS</span>
        </div>
      </div>
    {/each}
    <div class="ml-5 flex justify-between pr-[90px] font-mono text-[8px] tabular-nums text-text-3">
      <span>−60</span><span>−40</span><span>−30</span><span>−20</span><span class="text-ok">−12</span><span class="text-warn">−6</span><span class="text-rec">−3</span><span class="text-rec">0</span>
    </div>
  {:else}
    <div class="rounded-md border border-border bg-control/40 px-2 py-1.5">
      <div class="flex justify-between gap-3 font-mono text-[12px] leading-4 tabular-nums"><span class="text-text-3">Short-term</span><span class="text-text" data-lufs-short>{precise(short)} <small class="text-[10px] text-text-3">LUFS</small></span></div>
      <div class="mt-0.5 flex justify-between gap-3 font-mono text-[12px] leading-4 tabular-nums"><span class="text-text-3">Long-term</span><span class="text-text" data-lufs-long>{precise(long)} <small class="text-[10px] text-text-3">LUFS</small></span></div>
      <div class="mt-0.5 flex justify-between gap-3 font-mono text-[12px] leading-4 tabular-nums"><span class="text-text-3">Range</span><span class="text-text" data-lufs-range>{range === null ? '—' : precise(range)} <small class="text-[10px] text-text-3">LU</small></span></div>
    </div>
  {/if}
  <Button variant="ghost" size="sm" class="absolute inset-0 h-full w-full rounded-md bg-transparent p-0 hover:bg-control/20 focus-visible:ring-2" aria-label={mode === 'dbfs' ? 'Show master LUFS levels' : 'Show master dBFS levels'} aria-pressed={mode === 'lufs'} data-master-toggle onclick={() => mode = mode === 'dbfs' ? 'lufs' : 'dbfs'} />
</div>
