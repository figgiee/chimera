<script lang="ts">
	import { onMount } from 'svelte';
	import { Copy, Check, RotateCcw } from 'lucide-svelte';
	import ToolCallBlock from './ToolCallBlock.svelte';
	import type { Message } from '$lib/chat/types.js';
	import { chatStore } from '$lib/chat/ChatStore.svelte.js';
	import { animateStreaming, renderMarkdown, highlightCodeBlocks } from '$lib/chat/markdown.js';

	let { message }: { message: Message } = $props();

	// Container ref for the assistant markdown rendering area.
	let markdownContainer: HTMLElement | undefined = $state();

	// Whole-message copy state.
	let messageCopied = $state(false);

	// Track whether animation is running so we can swap to final render on stop.
	let animationRunning = $state(false);

	// -------------------------------------------------------------------------
	// Streaming + two-mode markdown
	// -------------------------------------------------------------------------

	onMount(() => {
		if (message.role === 'assistant' && message.isStreaming && markdownContainer) {
			animationRunning = true;

			const cancel = animateStreaming(markdownContainer, message.content, async () => {
				// Natural completion: highlight then swap to final marked render.
				animationRunning = false;
				if (markdownContainer) {
					highlightCodeBlocks(markdownContainer);
				}
				chatStore.markDone(message.id);
				if (markdownContainer) {
					markdownContainer.innerHTML = await renderMarkdown(message.content);
					injectCopyButtons();
				}
			});

			chatStore.registerAnimationCancel(cancel);
		}
	});

	// Reactive effect: if isStreaming transitions false while animation was running
	// (user hit Stop), swap to final render immediately.
	$effect(() => {
		if (!message.isStreaming && animationRunning && markdownContainer) {
			animationRunning = false;
			renderMarkdown(message.content).then((html) => {
				if (markdownContainer) {
					markdownContainer.innerHTML = html;
					injectCopyButtons();
				}
			});
		}
	});

	// Effect for non-streaming assistant messages (e.g., restored from history).
	$effect(() => {
		if (message.role === 'assistant' && !message.isStreaming && markdownContainer) {
			// Only run if container is empty (not yet populated by animation path).
			if (markdownContainer.innerHTML === '') {
				renderMarkdown(message.content).then((html) => {
					if (markdownContainer) {
						markdownContainer.innerHTML = html;
						injectCopyButtons();
					}
				});
			}
		}
	});

	// -------------------------------------------------------------------------
	// Code block copy buttons
	// -------------------------------------------------------------------------

	function injectCopyButtons() {
		if (!markdownContainer) return;

		const preBlocks = markdownContainer.querySelectorAll<HTMLElement>('pre');
		preBlocks.forEach((pre) => {
			// Avoid duplicating buttons.
			if (pre.querySelector('.code-copy-btn')) return;

			const code = pre.querySelector('code');
			if (!code) return;

			// Make pre relative so the button can be absolutely positioned.
			pre.style.position = 'relative';

			const btn = document.createElement('button');
			btn.className =
				'code-copy-btn absolute top-2 right-2 flex items-center gap-1 rounded px-2 py-1 text-xs bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors opacity-0 group-hover/pre:opacity-100 focus:opacity-100';
			btn.setAttribute('aria-label', 'Copy code');
			btn.textContent = 'Copy';

			btn.addEventListener('click', async () => {
				await navigator.clipboard.writeText(code.textContent ?? '');
				btn.textContent = 'Copied!';
				setTimeout(() => {
					btn.textContent = 'Copy';
				}, 1500);
			});

			pre.classList.add('group/pre');
			pre.appendChild(btn);
		});
	}

	// -------------------------------------------------------------------------
	// Whole-message copy
	// -------------------------------------------------------------------------

	async function copyMessage() {
		await navigator.clipboard.writeText(message.content);
		messageCopied = true;
		setTimeout(() => {
			messageCopied = false;
		}, 1500);
	}

	// -------------------------------------------------------------------------
	// Timestamp formatting
	// -------------------------------------------------------------------------

	const timestamp = $derived(
		new Date(message.timestamp).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit'
		})
	);
</script>

<!-- User message -->
{#if message.role === 'user'}
	<div class="group flex w-full justify-end">
		<div class="relative max-w-[80%]">
			<div
				class="rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-sm text-primary-foreground whitespace-pre-wrap"
			>
				{message.content}
			</div>
			<!-- Hover timestamp -->
			<div
				class="pointer-events-none absolute -bottom-5 right-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
			>
				{timestamp}
			</div>
		</div>
	</div>

<!-- Assistant message -->
{:else if message.role === 'assistant'}
	<div class="group flex w-full justify-start">
		<div class="relative max-w-[80%]">
			<div class="rounded-2xl rounded-bl-sm bg-muted px-4 py-3 text-sm text-foreground">
				{#if message.toolCalls?.length}
					<div class="space-y-1.5 mb-3">
						{#each message.toolCalls as toolCall (toolCall.id)}
							<ToolCallBlock {toolCall} />
						{/each}
					</div>
				{/if}
				<div
					bind:this={markdownContainer}
					class="prose prose-sm dark:prose-invert max-w-none"
				></div>
			</div>

			<!-- Whole-message copy button (hover) -->
			<button
				onclick={copyMessage}
				aria-label="Copy message"
				class="absolute -bottom-7 right-1 flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus:opacity-100"
			>
				{#if messageCopied}
					<Check size={12} />
					<span>Copied</span>
				{:else}
					<Copy size={12} />
					<span>Copy</span>
				{/if}
			</button>

			<!-- Hover timestamp -->
			<div
				class="pointer-events-none absolute -bottom-5 left-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
			>
				{timestamp}
			</div>
		</div>
	</div>

<!-- Error message -->
{:else if message.role === 'error'}
	<div class="flex w-full justify-start">
		<div
			class="max-w-[80%] rounded-2xl rounded-bl-sm bg-destructive/10 px-4 py-3 text-sm text-destructive"
		>
			<p class="mb-2">{message.content}</p>
			<button
				onclick={() => chatStore.retry()}
				class="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-destructive/20 transition-colors"
			>
				<RotateCcw size={12} />
				Retry
			</button>
		</div>
	</div>
{/if}
