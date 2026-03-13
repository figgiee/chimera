<script lang="ts">
	import { ArrowUp, Square } from 'lucide-svelte';
	import { chatStore } from '$lib/chat/ChatStore.svelte.js';

	// Local input state.
	let inputText = $state('');

	// Derived: is the chat busy (loading or streaming)?
	const isBusy = $derived(chatStore.status === 'loading' || chatStore.status === 'streaming');

	// -------------------------------------------------------------------------
	// Auto-resize textarea action
	// -------------------------------------------------------------------------

	function autoResize(node: HTMLTextAreaElement) {
		function resize() {
			node.style.height = 'auto';
			node.style.height = node.scrollHeight + 'px';
		}

		node.addEventListener('input', resize);
		return {
			destroy() {
				node.removeEventListener('input', resize);
			}
		};
	}

	// -------------------------------------------------------------------------
	// Send / Stop handlers
	// -------------------------------------------------------------------------

	function handleSend() {
		const text = inputText.trim();
		if (!text || chatStore.status !== 'idle') return;

		chatStore.sendMessage(text);
		inputText = '';

		// Reset textarea height after clearing.
		requestAnimationFrame(() => {
			const textarea = document.querySelector<HTMLTextAreaElement>('.chat-input-textarea');
			if (textarea) {
				textarea.style.height = 'auto';
			}
		});
	}

	function handleStop() {
		chatStore.stop();
	}

	// -------------------------------------------------------------------------
	// Keyboard handler: Enter sends, Shift+Enter newline
	// -------------------------------------------------------------------------

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault(); // Prevent newline BEFORE sending.
			handleSend();
		}
	}
</script>

<div class="border-t border-border bg-background px-4 py-4">
	<div class="mx-auto flex w-full max-w-3xl items-end gap-2">
		<!-- Auto-resize textarea -->
		<textarea
			use:autoResize
			bind:value={inputText}
			onkeydown={handleKeydown}
			placeholder="Message Chimera..."
			aria-label="Message input"
			rows={1}
			class="chat-input-textarea flex-1 resize-none overflow-y-auto rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
			style="min-height: 44px; max-height: 200px;"
		></textarea>

		<!-- Send / Stop button -->
		{#if isBusy}
			<!-- Stop button -->
			<button
				onclick={handleStop}
				aria-label="Stop generating"
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all hover:opacity-80"
			>
				<Square size={16} fill="currentColor" />
			</button>
		{:else}
			<!-- Send button -->
			<button
				onclick={handleSend}
				disabled={!inputText.trim()}
				aria-label="Send message"
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all disabled:opacity-40 hover:opacity-80"
			>
				<ArrowUp size={16} />
			</button>
		{/if}
	</div>
</div>
