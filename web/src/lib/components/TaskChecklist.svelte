<script lang="ts">
	import { Circle, Loader2, CheckCircle2 } from 'lucide-svelte';
	import type { TaskItem } from '$lib/chat/types.js';

	let { tasks }: { tasks: TaskItem[] } = $props();

	const doneCount = $derived(tasks.filter((t) => t.status === 'done').length);
</script>

<div>
	<!-- Progress count -->
	<p class="mb-2 text-xs text-muted-foreground">
		{doneCount} of {tasks.length} task{tasks.length === 1 ? '' : 's'} complete
	</p>

	<!-- Task list -->
	<div class="space-y-2">
		{#each tasks as task (task.id)}
			<div>
				<div class="flex items-start gap-2">
					<!-- Status icon -->
					{#if task.status === 'pending'}
						<Circle size={14} class="mt-0.5 shrink-0 text-muted-foreground" />
					{:else if task.status === 'running'}
						<Loader2 size={14} class="mt-0.5 shrink-0 animate-spin text-primary" />
					{:else}
						<CheckCircle2 size={14} class="mt-0.5 shrink-0 text-emerald-500" />
					{/if}

					<!-- Description -->
					<span class="text-sm {task.status === 'running' ? 'font-medium' : ''}">
						{task.description}
					</span>
				</div>

				<!-- Response preview (done tasks only) -->
				{#if task.status === 'done' && task.responsePreview}
					<p class="mt-0.5 max-w-full truncate pl-5 text-xs text-muted-foreground">
						{task.responsePreview}
					</p>
				{/if}
			</div>
		{/each}
	</div>
</div>
