<script lang="ts">
	import { Slider as SliderPrimitive } from "bits-ui";
	import { cn } from "@/lib/shadcn-utils.js";

	let {
		ref = $bindable(null),
		value = $bindable(),
		orientation = "horizontal",
		"aria-label": ariaLabel,
		class: className,
		...restProps
	}: any = $props();
</script>

<!--
Discriminated Unions + Destructing (required for bindable) do not
get along, so we shut typescript up by casting `value` to `never`.
-->
<SliderPrimitive.Root
	bind:ref
	bind:value={value as never}
	data-slot="slider"
	{orientation}
	aria-label={ariaLabel}
	class={cn(
		"relative flex touch-none items-center select-none data-disabled:opacity-50",
		orientation === "vertical" ? "h-full min-h-36 w-4 flex-col" : "w-full",
		className
	)}
	{...restProps}
>
	{#snippet children({ thumbItems })}
		<span
			data-slot="slider-track"
			data-orientation={orientation}
			class={cn("relative grow overflow-hidden rounded-full bg-control", orientation === "vertical" ? "h-full w-1" : "h-1 w-full")}
		>
			<SliderPrimitive.Range
				data-slot="slider-range"
				class={cn("absolute select-none bg-primary", orientation === "vertical" ? "w-full" : "h-full")}
			/>
		</span>
		{#each thumbItems as thumb (thumb.index)}
			<SliderPrimitive.Thumb
				aria-label={ariaLabel}
				data-slot="slider-thumb"
				index={thumb.index}
				class="border-ring ring-ring/50 relative size-3 rounded-full border bg-white transition-[color,box-shadow] after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 block shrink-0 select-none disabled:pointer-events-none disabled:opacity-50"
			/>
		{/each}
	{/snippet}
</SliderPrimitive.Root>
