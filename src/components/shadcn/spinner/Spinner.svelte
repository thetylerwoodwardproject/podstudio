<script lang="ts">
  let { label = 'Loading' }: { label?: string } = $props();
</script>
<svg role="img" aria-label={label} class="size-4 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" opacity=".22" />
  <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
</svg>
