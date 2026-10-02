<script lang="ts">
	import { PinInput as InputOTPPrimitive } from "bits-ui";
	import { cn } from "@/lib/shadcn-utils.js";

	let {
		ref = $bindable(null),
		cell,
		class: className,
		...restProps
	}: InputOTPPrimitive.CellProps = $props();
</script>

<InputOTPPrimitive.Cell
	{cell}
	bind:ref
	data-slot="input-otp-slot"
	class={cn(
		"relative flex size-11 items-center justify-center border-y border-r border-border bg-page font-mono text-[20px] text-text outline-none transition-all first:rounded-l-lg first:border-l last:rounded-r-lg data-[active=true]:z-10 data-[active=true]:border-handle data-[active=true]:ring-3 data-[active=true]:ring-ring/50 aria-invalid:border-rec",
		className
	)}
	{...restProps}
>
	{cell.char}
	{#if cell.hasFakeCaret}
		<div
			class="pointer-events-none absolute inset-0 flex items-center justify-center"
		>
			<div class="animate-caret-blink h-4 w-px bg-text duration-1000"></div>
		</div>
	{/if}
</InputOTPPrimitive.Cell>
