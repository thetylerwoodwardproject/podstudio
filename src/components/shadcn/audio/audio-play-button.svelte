<script lang="ts">
	import { cn } from '@/lib/shadcn-utils';
	import { Button } from '@/components/shadcn/button';
	import { Play, Pause } from '@lucide/svelte';
	import { getAudioPlayerContext } from './ctx';

	let { class: className }: { class?: string } = $props();
	const ctx = getAudioPlayerContext();
</script>

<Button
	variant="ghost"
	size="icon"
	class={cn('h-12 w-12 rounded-full border border-white/20 bg-black text-white shadow-sm hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary', className)}
	onclick={ctx.togglePlay}
>
	{#if ctx.isPlaying.value}
		<Pause class="h-5 w-5 fill-current" />
	{:else}
		<Play class="h-5 w-5 fill-current ml-0.5" />
	{/if}
</Button>
