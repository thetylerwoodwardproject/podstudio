<script lang="ts">
  import { toFraction } from '@/lib/audio/meter';

  let { left = -Infinity, right = -Infinity, leftHeld = -Infinity, rightHeld = -Infinity }: {
    left?: number; right?: number; leftHeld?: number; rightHeld?: number;
  } = $props();

  const format = (db: number) => Number.isFinite(db) ? `${db > 0 ? '+' : ''}${Math.round(db)}` : '−∞';
</script>

<div data-master-meter class="flex w-[clamp(170px,19vw,260px)] flex-none flex-col gap-0.5" role="group" aria-label="Master output levels" title="Master output sample peaks · dBFS">
  <span class="font-mono text-[9px] leading-none text-text-3">MASTER · dBFS</span>
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
</div>
