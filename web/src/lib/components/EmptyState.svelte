<script lang="ts">
	import { chatStore } from '$lib/chat/ChatStore.svelte.js';

	const suggestions = [
		'Explain quantum computing simply',
		'Write a Python hello world script',
		'What can you help me with?'
	];

	function sendSuggestion(text: string) {
		chatStore.sendMessage(text);
	}
</script>

<div class="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
	<h2 class="text-2xl font-semibold text-foreground">How can I help you today?</h2>

	<div class="flex flex-wrap justify-center gap-2">
		{#each suggestions as suggestion}
			<button
				onclick={() => sendSuggestion(suggestion)}
				class="cursor-pointer rounded-full border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
			>
				{suggestion}
			</button>
		{/each}
	</div>
</div>
