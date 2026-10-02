<script lang="ts">
  // Adapted from More Shadcn Svelte's MIT-licensed Status Dot by kevwpl.
  let { variant = 'muted', size = 'sm', pulse = false, color: customColor, class: className = '' }: {
    variant?: 'success' | 'warning' | 'error' | 'info' | 'recording' | 'muted';
    size?: 'sm' | 'md' | number; pulse?: boolean; color?: string; class?: string;
  } = $props();
  const color = $derived(variant === 'success' ? 'bg-ok' : variant === 'warning' ? 'bg-warn' : variant === 'error' || variant === 'recording' ? 'bg-rec' : variant === 'info' ? 'bg-info' : 'bg-text-3');
  const measure = $derived(typeof size === 'number' ? `${size}px` : size === 'md' ? '12px' : '8px');
</script>
<span aria-hidden="true" class="relative inline-flex flex-none items-center justify-center {className}" style={`width:${measure};height:${measure}`}>
  {#if pulse}<span class="absolute inset-0 animate-ping rounded-full opacity-50 motion-reduce:animate-none {color}"></span>{/if}
  <span class="relative size-full rounded-full" class:bg-ok={!customColor && variant === 'success'} class:bg-warn={!customColor && variant === 'warning'} class:bg-rec={!customColor && (variant === 'error' || variant === 'recording')} class:bg-info={!customColor && variant === 'info'} class:bg-text-3={!customColor && variant === 'muted'} style:background={customColor}></span>
</span>
