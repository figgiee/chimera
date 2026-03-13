<script lang="ts">
	import { tick } from 'svelte';
	import { chatStore } from '$lib/chat/ChatStore.svelte.js';
	import MessageBubble from './MessageBubble.svelte';
	import LoadingIndicator from './LoadingIndicator.svelte';
	import SynapsePanel from './SynapsePanel.svelte';

	// Ref to the scrollable outer container.
	let scrollContainer: HTMLElement | undefined = $state();

	// -------------------------------------------------------------------------
	// Auto-scroll: only when user is near bottom (80px threshold)
	// -------------------------------------------------------------------------

	$effect(() => {
		// Depend on messages length and status so this re-runs on new messages
		// and during streaming updates.
		const _len = chatStore.messages.length;
		const _status = chatStore.status;

		if (!scrollContainer) return;

		const { scrollHeight, scrollTop, clientHeight } = scrollContainer;
		const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
		const nearBottom = distanceFromBottom < 80;

		if (nearBottom) {
			tick().then(() => {
				if (scrollContainer) {
					scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });
				}
			});
		}
	});
</script>

<div bind:this={scrollContainer} class="flex-1 overflow-y-auto">
	<div class="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
		{#each chatStore.messages as message (message.id)}
			{#if message.role === 'synapse' && message.synapseState}
				<div class="flex w-full justify-start">
					<SynapsePanel synapseState={message.synapseState} />
				</div>
			{:else}
				<MessageBubble {message} />
			{/if}
		{/each}
		<LoadingIndicator />
	</div>
</div>
