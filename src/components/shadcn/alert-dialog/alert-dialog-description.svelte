<script lang="ts">
	import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
	import { cn } from "@/lib/shadcn-utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: AlertDialogPrimitive.DescriptionProps = $props();
</script>

<AlertDialogPrimitive.Description
	bind:ref
	data-slot="alert-dialog-description"
	style="color: var(--color-text-2);"
	class={cn("text-text-2 *:[a]:hover:text-text text-sm text-balance md:text-pretty *:[a]:underline *:[a]:underline-offset-3", className)}
	{...restProps}
/>
