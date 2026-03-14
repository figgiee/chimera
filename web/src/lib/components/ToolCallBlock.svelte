<script lang="ts">
	import { untrack } from 'svelte';
	import { Loader2, Check, X, ChevronRight } from 'lucide-svelte';
	import type { ToolCall } from '$lib/chat/types.js';

	let { toolCall }: { toolCall: ToolCall } = $props();

	// Expand by default when the tool call has an error.
	// untrack avoids the state_referenced_locally warning for prop access at init.
	let expanded = $state(untrack(() => toolCall.hadError));

	// Show/hide full result text.
	let showFullResult = $state(false);

	// Live elapsed counter for running tools.
	let elapsedMs = $state(0);

	// Start an interval to track elapsed time while the tool is running.
	$effect(() => {
		if (toolCall.status !== 'running') {
			return;
		}

		const startedAt = toolCall.startedAt;
		// Initialise immediately so first render is non-zero.
		elapsedMs = Date.now() - startedAt;

		const interval = setInterval(() => {
			elapsedMs = Date.now() - startedAt;
		}, 1000);

		return () => clearInterval(interval);
	});

	// Resolved display duration: prefer toolCall.durationMs when done/error.
	const rawDurationMs = $derived(
		toolCall.status === 'running' ? elapsedMs : (toolCall.durationMs ?? elapsedMs)
	);
	const displayDuration = $derived(
		rawDurationMs >= 1000
			? `${(rawDurationMs / 1000).toFixed(1)}s`
			: `${rawDurationMs}ms`
	);

	// Stringified result for truncation logic.
	const resultStr = $derived(
		toolCall.result !== undefined ? String(JSON.stringify(toolCall.result, null, 2)) : ''
	);

	const TRUNCATE_LIMIT = 300;
	const resultTruncated = $derived(resultStr.length > TRUNCATE_LIMIT);
	const resultDisplay = $derived(
		resultTruncated && !showFullResult ? resultStr.slice(0, TRUNCATE_LIMIT) + '...' : resultStr
	);

	// Border colour based on error state.
	const borderClass = $derived(toolCall.hadError ? 'border-destructive' : 'border-border');
</script>

<div class="rounded-lg bg-muted/50 px-3 py-2 border-l-2 {borderClass}">
	<!-- Header row — always visible, clicking toggles expanded -->
	<button
		type="button"
		class="flex w-full items-center gap-2 cursor-pointer text-left"
		onclick={() => (expanded = !expanded)}
		aria-expanded={expanded}
	>
		<!-- Status icon -->
		<span class="flex-shrink-0">
			{#if toolCall.status === 'running'}
				<Loader2 size={14} class="animate-spin text-muted-foreground" />
			{:else if toolCall.status === 'done'}
				<Check size={14} class="text-emerald-500" />
			{:else}
				<X size={14} class="text-destructive" />
			{/if}
		</span>

		<!-- Tool name -->
		<span class="flex-1 text-sm font-medium text-foreground truncate">{toolCall.tool}</span>

		<!-- Elapsed / duration -->
		<span class="text-xs text-muted-foreground flex-shrink-0">{displayDuration}</span>

		<!-- Chevron -->
		<span
			class="flex-shrink-0 transition-transform duration-150 text-muted-foreground"
			style="transform: rotate({expanded ? 90 : 0}deg)"
		>
			<ChevronRight size={14} />
		</span>
	</button>

	<!-- Expanded detail -->
	{#if expanded}
		<div class="mt-2 space-y-2">
			<!-- Arguments -->
			{#if toolCall.args !== undefined}
				<div>
					<p class="text-xs text-muted-foreground mb-1">Arguments</p>
					<pre class="text-xs bg-background rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(toolCall.args, null, 2)}</pre>
				</div>
			{/if}

			<!-- Result -->
			{#if toolCall.result !== undefined}
				<div>
					<p class="text-xs text-muted-foreground mb-1">Result</p>
					<pre class="text-xs bg-background rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">{resultDisplay}</pre>
					{#if resultTruncated}
						<button
							type="button"
							class="mt-1 text-xs text-muted-foreground hover:text-foreground underline cursor-pointer"
							onclick={() => (showFullResult = !showFullResult)}
						>
							{showFullResult ? 'Show less' : 'Show more'}
						</button>
					{/if}
				</div>
			{/if}

			<!-- Error message -->
			{#if toolCall.hadError && toolCall.error}
				<div>
					<p class="text-xs text-muted-foreground mb-1">Error</p>
					<p class="text-xs text-destructive">{toolCall.error}</p>
				</div>
			{/if}
		</div>
	{/if}
</div>
