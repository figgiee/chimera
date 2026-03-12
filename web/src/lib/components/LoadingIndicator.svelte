<script lang="ts">
	import { chatStore } from '$lib/chat/ChatStore.svelte.js';
</script>

{#if chatStore.status === 'loading'}
	<div class="flex w-full justify-start">
		<div class="max-w-[80%] rounded-2xl rounded-bl-sm bg-muted px-4 py-3">
			<div class="flex items-center">
				<!-- Animated dots -->
				<span class="flex items-center gap-1">
					<span
						class="inline-block w-2 h-2 rounded-full bg-muted-foreground animate-pulse"
						style="animation-delay: 0ms"
					></span>
					<span
						class="inline-block w-2 h-2 rounded-full bg-muted-foreground animate-pulse"
						style="animation-delay: 150ms"
					></span>
					<span
						class="inline-block w-2 h-2 rounded-full bg-muted-foreground animate-pulse"
						style="animation-delay: 300ms"
					></span>
				</span>
				<!-- Activity text -->
				{#if chatStore.currentActivity}
					<span class="text-sm text-muted-foreground ml-3">{chatStore.currentActivity}</span>
				{/if}
			</div>
		</div>
	</div>
{/if}
