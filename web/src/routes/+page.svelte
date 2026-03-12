<script lang="ts">
	import { chatStore } from '$lib/chat/ChatStore.svelte.js';
	import ChatWindow from '$lib/components/ChatWindow.svelte';
	import InputBar from '$lib/components/InputBar.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
</script>

<div class="flex h-screen flex-col bg-background text-foreground">
	<!-- Header bar (dark mode toggle added in Plan 03) -->
	<header class="flex items-center justify-between border-b border-border px-4 py-3">
		<h1 class="text-lg font-semibold">Chimera</h1>
		<!-- DarkModeToggle slot — added in Plan 03 -->
	</header>

	<!-- Chat area: empty state or message list -->
	{#if chatStore.messages.length === 0}
		<EmptyState />
	{:else}
		<ChatWindow />
	{/if}

	<!-- Input bar pinned at bottom -->
	<InputBar />
</div>
