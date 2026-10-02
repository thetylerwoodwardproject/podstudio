<script lang="ts">
  import { toFraction } from '@/lib/audio/meter';

  let { name, channels, left = -Infinity, right = -Infinity, held = -Infinity }: {
    name: string; channels: 1 | 2; left?: number; right?: number; held?: number;
  } = $props();

  const shown = $derived(Number.isFinite(held) ? `${held > 0 ? '+' : ''}${Math.round(held)}` : '−∞');
</script>

<div data-track-meter data-peak-dbfs={Number.isFinite(held) ? held.toFixed(1) : '-Infinity'}
  class="absolute inset-y-1.5 right-0.5 flex w-[28px] flex-col items-center justify-center gap-1"
  title={`${name} processed sample peak: ${shown} dBFS`}>
  <div class="flex h-14 items-stretch gap-[2px]" role="meter" aria-label={`${name} processed peak level`}
    aria-valuemin="-60" aria-valuemax="12" aria-valuenow={Number.isFinite(held) ? Math.max(-60, Math.min(12, Math.round(held))) : -60}
    aria-valuetext={`${shown} dBFS`}>
    {#each channels === 2 ? [left, right] : [left] as db}
      <div class="relative w-[7px] overflow-hidden rounded-[2px] bg-track-off">
        <div class="absolute inset-0 rounded-[2px]" style={`background:linear-gradient(to top,var(--color-ok) 0 37.5%,var(--color-warn) 37.5% 75%,var(--color-rec) 75% 100%);clip-path:inset(${100 - Math.max(0, Math.min(100, toFraction(db) * 100))}% 0 0 0)`}></div>
        {#if db > 0}<div class="absolute inset-x-0 top-0 h-1 bg-rec"></div>{/if}
      </div>
    {/each}
  </div>
  <span class="whitespace-nowrap font-mono text-[10px] leading-none text-text-2">{shown}</span>
  <span class="font-mono text-[9px] leading-none text-text-3">dBFS</span>
</div>
