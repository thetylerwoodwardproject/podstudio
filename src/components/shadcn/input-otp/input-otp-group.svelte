<script lang="ts">
	import { cn, type WithElementRef } from "@/lib/shadcn-utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="input-otp-group"
	class={cn("flex items-center rounded-lg has-aria-invalid:border-rec has-aria-invalid:ring-3 has-aria-invalid:ring-rec/20", className)}
	{...restProps}
>
	{@render children?.()}
</div>
