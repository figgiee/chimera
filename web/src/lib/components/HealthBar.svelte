<script lang="ts">
	import { Shield } from 'lucide-svelte';
	import { fetchHealth } from '$lib/chat/api.js';
	import type { HealthStatus } from '$lib/chat/types.js';

	// ---------------------------------------------------------------------------
	// State
	// ---------------------------------------------------------------------------

	let health = $state<HealthStatus | null>(null);

	// Model name comes from /api/health.modelName — server-side fetch avoids
	// cross-origin requests from the browser to LM Studio's port.
	const modelName = $derived(health?.modelName ?? 'Loading...');

	// ---------------------------------------------------------------------------
	// Per-service health derivation
	// ---------------------------------------------------------------------------

	/**
	 * Parse the flat errors[] array from /api/health?deep=true into per-service status.
	 *
	 * User decision: THREE separate indicators — LM Studio, RAG, Search.
	 * RAG and Search share the same backend signal (RAG stack errors) but render as separate dots.
	 */
	const lmHealthy = $derived(
		health === null ? null : !health.errors?.some((e) => /Ollama/i.test(e))
	);
	const ragHealthy = $derived(
		health === null ? null : !health.errors?.some((e) => /RAG/i.test(e))
	);
	// Search shares the RAG signal — same underlying health, separate visual indicator
	const searchHealthy = $derived(ragHealthy);

	// ---------------------------------------------------------------------------
	// Polling
	// ---------------------------------------------------------------------------

	async function refresh(): Promise<void> {
		health = await fetchHealth();
	}

	$effect(() => {
		refresh();
		const interval = setInterval(refresh, 30_000);
		return () => clearInterval(interval);
	});
</script>

<div class="flex items-center gap-4 border-b border-border px-4 py-1.5 text-xs shrink-0 bg-background">
	<!-- Service indicators -->
	<div class="flex items-center gap-3">
		<!-- Ollama -->
		<span class="flex items-center gap-1.5">
			<span
				class="w-2 h-2 rounded-full transition-colors duration-300 {lmHealthy === false
					? 'bg-red-500'
					: 'bg-green-500'}"
			></span>
			<span class="text-muted-foreground">
				Ollama
				{#if lmHealthy === false}
					<span class="text-red-500">offline</span>
				{/if}
			</span>
		</span>

		<!-- RAG -->
		<span class="flex items-center gap-1.5">
			<span
				class="w-2 h-2 rounded-full transition-colors duration-300 {ragHealthy === false
					? 'bg-red-500'
					: 'bg-green-500'}"
			></span>
			<span class="text-muted-foreground">
				RAG
				{#if ragHealthy === false}
					<span class="text-red-500">offline</span>
				{/if}
			</span>
		</span>

		<!-- Search (shares RAG health signal per user decision) -->
		<span class="flex items-center gap-1.5">
			<span
				class="w-2 h-2 rounded-full transition-colors duration-300 {searchHealthy === false
					? 'bg-red-500'
					: 'bg-green-500'}"
			></span>
			<span class="text-muted-foreground">
				Search
				{#if searchHealthy === false}
					<span class="text-red-500">offline</span>
				{/if}
			</span>
		</span>
	</div>

	<!-- Separator -->
	<span class="text-border">|</span>

	<!-- Model name -->
	<span class="text-muted-foreground">{modelName}</span>

	<!-- Spacer -->
	<span class="flex-1"></span>

	<!-- Local privacy badge (right side) -->
	<span
		class="flex items-center gap-1 bg-green-500/10 text-green-500 rounded-full px-2 py-0.5 text-xs"
	>
		<Shield size={10} />
		<span>Local</span>
	</span>
</div>
