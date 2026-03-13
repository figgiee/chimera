<script lang="ts">
	import { MessageCircleQuestion, Reply, Loader2 } from 'lucide-svelte';
	import type { QACard } from '$lib/chat/types.js';

	let { card }: { card: QACard } = $props();
</script>

<div class="rounded-lg border border-border bg-muted/30 px-3 py-2">
	<!-- Question row -->
	<div class="flex items-start gap-2">
		<MessageCircleQuestion size={14} class="mt-0.5 shrink-0 text-muted-foreground" />
		<span class="text-sm font-medium">{card.question}</span>
		{#if !card.answer}
			<Loader2 size={12} class="ml-auto mt-0.5 shrink-0 animate-spin text-muted-foreground" />
		{/if}
	</div>

	<!-- Answer row (indented) -->
	{#if card.answer}
		<div class="mt-1.5 flex items-start gap-2 pl-4">
			<Reply size={12} class="mt-0.5 shrink-0 text-muted-foreground" />
			<span class="text-sm text-muted-foreground">{card.answer}</span>
		</div>
	{/if}
</div>
