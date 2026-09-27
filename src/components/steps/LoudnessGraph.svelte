<!--
  Short-term loudness over time (framework graph): the plot area, a grid
  every 6 LU, the target in text with a ±1 LU band, the history in text-2,
  and where the preview is, dashed. Export step 04 and after an export.
-->
<script lang="ts">
  interface Props {
    /** Short-term loudness, evenly spaced over `seconds` */
    history: number[];
    seconds: number;
    target: number | null;
    /** Where playback is, in seconds */
    now?: number | null;
  }
  let { history, seconds, target, now = null }: Props = $props();
  let W = $state(0);
  let H = $state(0);
  const L = 34, B = 22, T = 8, R = 8, lo = -42, hi = -6;
  const w = $derived(Math.max(0, W - L - R));
  const h = $derived(Math.max(0, H - T - B));
  const y = (d: number) => T + ((hi - Math.max(lo, Math.min(hi, d))) / (hi - lo)) * h;
  const x = (i: number) => L + (i / Math.max(1, history.length - 1)) * w;
  const minus = (s: string) => s.replace(/-/g, '−');
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const first = $derived(history.findIndex((v) => Number.isFinite(v)));
  const path = $derived(
    history
      .map((v, i) => (Number.isFinite(v) ? `${i === first ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}` : ''))
      .filter(Boolean)
      .join(' '),
  );
  const levels = Array.from({ length: 7 }, (_, k) => hi - k * 6);
</script>

<div class="h-[180px] min-w-0" bind:clientWidth={W} bind:clientHeight={H} data-loud-plot>
  {#if w > 0 && h > 0}
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Short-term loudness over time">
      <defs><clipPath id="loud-clip"><rect x={L} y={T} width={w} height={h} /></clipPath></defs>
      <rect x={L} y={T} width={w} height={h} fill="var(--color-plot)" />
      {#each levels as d}<line x1={L} x2={L + w} y1={y(d)} y2={y(d)} stroke="var(--color-border)" />{/each}
      {#each [1, 2, 3, 4, 5] as k}<line x1={L + (k / 6) * w} x2={L + (k / 6) * w} y1={T} y2={T + h} stroke="var(--color-divider)" />{/each}
      {#each levels.slice(1, -1) as d}
        <text x={L - 6} y={y(d) + 3.5} text-anchor="end" fill="var(--color-text-3)" font-family="var(--font-mono)" font-size="10">{minus(String(d))}</text>
      {/each}
      <text x={L} y={T + h + 15} fill="var(--color-text-3)" font-family="var(--font-mono)" font-size="10">0:00</text>
      {#if seconds}<text x={L + w} y={T + h + 15} text-anchor="end" fill="var(--color-text-3)" font-family="var(--font-mono)" font-size="10">{clock(seconds)}</text>{/if}
      <g clip-path="url(#loud-clip)">
        {#if target != null}
          <rect x={L} y={y(target + 1)} width={w} height={y(target - 1) - y(target + 1)} fill="var(--color-ok)" opacity="0.12" />
          <line x1={L} x2={L + w} y1={y(target)} y2={y(target)} stroke="var(--color-text)" stroke-width="2" />
        {/if}
        {#if first >= 0 && history.length > 1}
          <path d={`${path} L${x(history.length - 1)} ${y(lo)} L${x(first)} ${y(lo)} Z`} fill="var(--color-text)" opacity="0.05" />
          <path d={path} fill="none" stroke="var(--color-text-2)" stroke-width="2" stroke-linejoin="round" data-loud-history />
        {/if}
        {#if now != null && seconds}
          <line x1={L + (now / seconds) * w} x2={L + (now / seconds) * w} y1={T} y2={T + h} stroke="var(--color-text-3)" stroke-dasharray="2 3" />
        {/if}
      </g>
    </svg>
  {/if}
</div>
