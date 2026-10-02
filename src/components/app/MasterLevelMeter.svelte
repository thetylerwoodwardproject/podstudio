<script lang="ts">
  import { Button } from '@/components/shadcn/button';
  import { toFraction } from '@/lib/audio/meter';

  let { left = -Infinity, right = -Infinity, leftHeld = -Infinity, rightHeld = -Infinity,
    short = -Infinity, long = -Infinity, range = null }: {
    left?: number; right?: number; leftHeld?: number; rightHeld?: number;
    short?: number; long?: number; range?: number | null;
  } = $props();
  let mode = $state<'dbfs' | 'lufs'>('dbfs');
  const format = (db: number) => Number.isFinite(db) ? `${db > 0 ? '+' : ''}${Math.round(db)}` : '−∞';
  const precise = (value: number) => Number.isFinite(value) ? value.toFixed(1).replace('-', '−') : '—';
</script>

<div data-master-meter data-mode={mode} class="relative flex w-[clamp(190px,20vw,280px)] flex-none flex-col gap-0.5" role="group" aria-label="Master output levels"
  title={mode === 'dbfs' ? 'Master output sample peaks · dBFS. Click for LUFS.' : 'LUFS measured from audio played since the last seek or edit. Click for dBFS.'}>
  <span class="font-mono text-[10px] leading-3 text-text-3">MASTER · {mode === 'dbfs' ? 'dBFS' : 'LUFS'}</span>
  {#if mode === 'dbfs'}
    {#each [{ label: 'L', db: left, held: leftHeld }, { label: 'R', db: right, held: rightHeld }] as channel}
      <div class="flex h-3 items-center gap-1.5" role="meter" aria-label={`Master ${channel.label === 'L' ? 'left' : 'right'} level`}
        aria-valuemin="-60" aria-valuemax="12" aria-valuenow={Number.isFinite(channel.held) ? Math.max(-60, Math.min(12, Math.round(channel.held))) : -60}
        aria-valuetext={`${format(channel.held)} dBFS`}>
        <span class="w-2 font-mono text-[9px] text-text-3">{channel.label}</span>
        <div class="relative h-[7px] min-w-0 flex-1 overflow-hidden rounded-sm bg-track-off">
          <div class="absolute inset-0 rounded-sm" style={`background:linear-gradient(to right,var(--color-ok) 0 37.5%,var(--color-warn) 37.5% 75%,var(--color-rec) 75% 100%);clip-path:inset(0 ${100 - Math.max(0, Math.min(100, toFraction(channel.db) * 100))}% 0 0)`}></div>
          {#if channel.db > 0}<div class="absolute inset-y-0 right-0 w-1 bg-rec"></div>{/if}
        </div>
        <span class="w-8 text-right font-mono text-[9px] text-text-2">{format(channel.held)}</span>
      </div>
    {/each}
  {:else}
    <div class="flex justify-between gap-3 font-mono text-[11px] leading-3 tabular-nums"><span class="text-text-3">Short-term</span><span data-lufs-short>{precise(short)} LUFS</span></div>
    <div class="flex justify-between gap-3 font-mono text-[11px] leading-3 tabular-nums"><span class="text-text-3">Long-term</span><span data-lufs-long>{precise(long)} LUFS</span></div>
    <div class="flex justify-between gap-3 font-mono text-[11px] leading-3 tabular-nums"><span class="text-text-3">Range</span><span data-lufs-range>{range === null ? '—' : precise(range)} LU</span></div>
  {/if}
  <Button variant="ghost" size="sm" class="absolute inset-0 h-full w-full rounded-md bg-transparent p-0 hover:bg-control/20 focus-visible:ring-2" aria-label={mode === 'dbfs' ? 'Show master LUFS levels' : 'Show master dBFS levels'} aria-pressed={mode === 'lufs'} data-master-toggle onclick={() => mode = mode === 'dbfs' ? 'lufs' : 'dbfs'} />
</div>
