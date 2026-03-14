<script lang="ts">
	import { chatStore } from '$lib/chat/ChatStore.svelte.js';
	import ChatWindow from '$lib/components/ChatWindow.svelte';
	import InputBar from '$lib/components/InputBar.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import DarkModeToggle from '$lib/components/DarkModeToggle.svelte';
	import SessionSidebar from '$lib/components/SessionSidebar.svelte';
	import HealthBar from '$lib/components/HealthBar.svelte';

	// Fetch context window size once so InputBar token count has correct denominator
	$effect(() => { chatStore.initContextLength(); });
</script>

<div class="flex h-screen bg-background text-foreground">
	<!-- Session sidebar: always in DOM, collapse managed by component via CSS max-width -->
	<SessionSidebar />

	<!-- Main content area -->
	<div class="flex flex-col flex-1 min-w-0">
		<!-- Health status bar: full-width, above the header -->
		<HealthBar />

		<!-- Header bar -->
		<header class="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
			<div class="flex items-center gap-2 min-w-0">
				<h1 class="text-lg font-semibold shrink-0">Chimera</h1>
				{#if chatStore.currentProject}
					<span class="text-muted-foreground/40 text-lg shrink-0">/</span>
					<span class="text-sm font-medium text-primary truncate">{chatStore.currentProject.name}</span>
				{/if}
			</div>
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
