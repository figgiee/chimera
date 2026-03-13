<script lang="ts">
	import { Workflow, CheckCircle2, Square } from 'lucide-svelte';
	import type { SynapseState, SynapsePhase } from '$lib/chat/types.js';
	import { chatStore } from '$lib/chat/ChatStore.svelte.js';
	import QACard from './QACard.svelte';
	import TaskChecklist from './TaskChecklist.svelte';

	let { synapseState }: { synapseState: SynapseState } = $props();

	const isActive = $derived(synapseState.phase !== 'complete');

	const phases: { id: SynapsePhase; label: string }[] = [
		{ id: 'qa', label: 'Q&A' },
		{ id: 'executing', label: 'Executing' },
		{ id: 'complete', label: 'Complete' }
	];

	// Determine ordering: qa=0, executing=1, complete=2
	const phaseOrder: Record<SynapsePhase, number> = { qa: 0, executing: 1, complete: 2 };

	const currentOrder = $derived(phaseOrder[synapseState.phase]);
</script>

<div class="max-w-[80%] rounded-2xl rounded-bl-sm bg-muted px-4 py-3">
	<div class="space-y-4">
		<!-- Header row -->
		<div class="flex items-center gap-2">
			<Workflow size={16} class="shrink-0 text-primary" />
			<span class="text-sm font-semibold">Synapse Workflow</span>
			<span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
				{synapseState.mode}
			</span>
			{#if isActive}
				<button
					onclick={() => chatStore.stop()}
					aria-label="Cancel workflow"
					class="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
				>
					<Square size={12} fill="currentColor" />
					Cancel
				</button>
			{/if}
		</div>

		<!-- Phase indicator -->
		<div class="flex items-center gap-1.5 text-xs">
			{#each phases as phase, i (phase.id)}
				{@const order = phaseOrder[phase.id]}
				{@const isCurrent = phase.id === synapseState.phase}
				{@const isPast = order < currentOrder}

				<span
					class="{isCurrent
						? 'font-medium text-foreground'
						: isPast
							? 'text-muted-foreground'
							: 'text-muted-foreground/50'}"
				>
					{phase.label}
				</span>

				{#if i < phases.length - 1}
					<span class="text-muted-foreground/30">·</span>
				{/if}
			{/each}
		</div>

		<!-- Q&A section -->
		{#if synapseState.qaCards.length > 0}
			<div class="space-y-2">
				{#each synapseState.qaCards as card (card.areaId)}
					<QACard {card} />
				{/each}
			</div>
		{/if}

		<!-- Task section -->
		{#if synapseState.tasks.length > 0}
			<TaskChecklist tasks={synapseState.tasks} />
		{/if}

		<!-- Completion message -->
		{#if synapseState.tasksCompleteMessage}
			<div class="flex items-center gap-2">
				<CheckCircle2 size={14} class="shrink-0 text-emerald-500" />
				<span class="text-sm font-medium text-emerald-500">
					{synapseState.tasksCompleteMessage}
				</span>
			</div>
		{/if}
	</div>
</div>
