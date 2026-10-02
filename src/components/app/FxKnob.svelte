<script lang="ts">
  // Adapted from More Shadcn Svelte's MIT-licensed knob by kevwpl.
  // Podstudio adds pointer capture, keyboard control, and accessible value text.
  let { value = $bindable(0), label, description, disabled = false, onvaluechange }: {
    value: number; label: string; description: string; disabled?: boolean; onvaluechange?: (value: number) => void;
  } = $props();
  let startY = 0;
  let startValue = 0;
  let dragging = false;
  const progress = $derived(Math.max(0, Math.min(1, value / 100)));
  const dash = $derived(progress * 212);
  const rotation = $derived(-135 + progress * 270);

  function setValue(next: number) { value = Math.max(0, Math.min(100, Math.round(next))); onvaluechange?.(value); }
  function down(event: PointerEvent) {
    if (disabled) return;
    event.preventDefault();
    dragging = true;
    startY = event.clientY;
    startValue = value;
    event.currentTarget instanceof HTMLElement && event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    if (dragging) setValue(startValue + (startY - event.clientY) * 0.8);
  }
  function up() { dragging = false; }
  function keydown(event: KeyboardEvent) {
    if (disabled) return;
    const delta = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') setValue(value + delta);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') setValue(value - delta);
    else if (event.key === 'Home') setValue(0);
    else if (event.key === 'End') setValue(100);
    else return;
    event.preventDefault();
  }
</script>

<div class="flex flex-col items-center gap-2 text-center" data-fx-knob={label.toLowerCase()}>
  <span class="text-[13px] font-medium">{label}</span>
  <div role="slider" tabindex={disabled ? -1 : 0} aria-label={label} aria-valuemin="0" aria-valuemax="100"
    aria-valuenow={value} aria-valuetext={`${value} percent`} aria-disabled={disabled}
    class="relative grid size-[92px] touch-none place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    class:cursor-ns-resize={!disabled} class:opacity-40={disabled}
    onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onlostpointercapture={up} onkeydown={keydown}
    ondblclick={() => !disabled && setValue(0)}>
    <svg viewBox="0 0 100 100" class="absolute inset-0 size-full -rotate-45" aria-hidden="true">
      <circle cx="50" cy="50" r="40" fill="none" stroke="var(--color-track-off)" stroke-width="6" stroke-dasharray="212 252" stroke-linecap="round" />
      <circle cx="50" cy="50" r="40" fill="none" stroke="var(--color-primary)" stroke-width="6" stroke-dasharray={`${dash} 252`} stroke-linecap="round" />
    </svg>
    <div class="grid size-[59px] place-items-center rounded-full border border-border bg-surface shadow-sm">
      <div class="absolute size-[45px]" style={`transform:rotate(${rotation}deg)`}><div class="mx-auto h-[9px] w-[3px] rounded-full bg-primary"></div></div>
      <span class="font-mono text-[18px] tabular-nums">{value}</span>
    </div>
  </div>
  <span class="max-w-[155px] text-[11px] leading-4 text-text-2">{description}</span>
</div>
