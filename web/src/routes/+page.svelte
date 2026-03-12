<script lang="ts">
	import { chatStore } from '$lib/chat/ChatStore.svelte.js';
	import ChatWindow from '$lib/components/ChatWindow.svelte';
	import InputBar from '$lib/components/InputBar.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import DarkModeToggle from '$lib/components/DarkModeToggle.svelte';
	import LoadingIndicator from '$lib/components/LoadingIndicator.svelte';
</script>

<div class="flex h-screen bg-background text-foreground">
	<!-- Sidebar placeholder: hidden on tablet, visible on desktop (lg+). Populated in Phase 4. -->
	<aside class="hidden lg:flex lg:w-64 border-r border-border flex-col"></aside>

	<!-- Main content area -->
	<div class="flex flex-col flex-1 min-w-0">
		<!-- Header bar -->
		<header class="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
			<h1 class="text-lg font-semibold">Chimera</h1>
			<DarkModeToggle />
		</header>

		<!-- Chat area: empty state or message list + loading indicator -->
		{#if chatStore.messages.length === 0 && chatStore.status !== 'loading'}
			<EmptyState />
		{:else}
			<ChatWindow />
		{/if}

		<!-- Input bar pinned at bottom -->
		<InputBar />
	</div>
</div>
