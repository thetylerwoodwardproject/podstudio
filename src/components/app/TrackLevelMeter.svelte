<script lang="ts">
  import { toFraction } from '@/lib/audio/meter';

  let { name, channels, left = -Infinity, right = -Infinity, held = -Infinity }: {
    name: string; channels: 1 | 2; left?: number; right?: number; held?: number;
  } = $props();

  const shown = $derived(Number.isFinite(held) ? `${held > 0 ? '+' : ''}${Math.round(held)}` : '−∞');
  const segments = Array.from({ length: 12 }, (_, index) => index);
  const segmentColor = (db: number, index: number) => {
    if (!Number.isFinite(db) || index >= Math.round(toFraction(db) * segments.length)) return 'var(--color-track-off)';
    const position = (index + 1) / segments.length;
    if (position > toFraction(-3)) return 'var(--color-rec)';
    return position > toFraction(-12) ? 'var(--color-warn)' : 'var(--color-ok)';
  };
</script>

<div data-track-meter data-peak-dbfs={Number.isFinite(held) ? held.toFixed(1) : '-Infinity'}
  class="absolute right-0.5 top-2 flex w-[28px] flex-col items-center gap-1"
  title={`${name} processed sample peak: ${shown} dBFS`}>
  <div class="flex h-12 items-stretch gap-1" role="meter" aria-label={`${name} processed peak level`}
    aria-valuemin="-60" aria-valuemax="12" aria-valuenow={Number.isFinite(held) ? Math.max(-60, Math.min(12, Math.round(held))) : -60}
    aria-valuetext={`${shown} dBFS`}>
    {#each channels === 2 ? [left, right] : [left] as db}
      <div class="flex w-2 flex-col-reverse gap-px overflow-hidden" aria-hidden="true">
        {#each segments as index}
          <span class="min-h-[3px] flex-1 transition-colors duration-75" style={`background:${segmentColor(db, index)}`}></span>
        {/each}
      </div>
    {/each}
  </div>
  <span class="whitespace-nowrap font-mono text-[9px] leading-none tabular-nums text-text-2">{shown}</span>
</div>
