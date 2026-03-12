import type { Message, ChatStatus } from './types.js';
import { streamChat } from './SSEClient.js';

/**
 * Reactive ChatStore using Svelte 5 runes pattern.
 *
 * Manages the full lifecycle of a Chimera chat session:
 * - Tracks messages, status, activity indicator, and errors.
 * - Drives the idle → loading → streaming → idle state machine.
 * - Exposes sendMessage, stop, retry, markDone for UI components.
 *
 * Arrow function methods are used throughout to avoid `this` rebinding
 * issues when methods are destructured or passed as callbacks (Svelte 5 Pitfall 7).
 */
export class ChatStore {
	// -----------------------------------------------------------------------
	// Reactive state ($state runes)
	// -----------------------------------------------------------------------

	/** All messages in the current conversation (user + assistant + error). */
	messages = $state<Message[]>([]);

	/** Current chat lifecycle state. */
	status = $state<ChatStatus>('idle');

	/**
	 * Human-readable activity text shown while loading/processing.
	 * e.g., "Connecting...", "Mode: direct", "Using: read_file"
	 */
	currentActivity = $state<string>('');

	/** Error message shown when status === 'error'. */
	lastError = $state<string>('');

	/** Current session ID. Rotates on new conversations (not yet exposed in UI). */
	sessionId = $state<string>(crypto.randomUUID());

	// -----------------------------------------------------------------------
	// Non-reactive fields
	// -----------------------------------------------------------------------

	/** AbortController for the in-flight fetch. Null when idle. */
	abortController: AbortController | null = null;

	/** Cancel function returned by animateStreaming. Null when no animation is running. */
	cancelAnimation: (() => void) | null = null;

	// -----------------------------------------------------------------------
	// Public methods (arrow functions to avoid this-binding issues)
	// -----------------------------------------------------------------------

	/**
	 * Send a user message and stream the response.
	 *
	 * State machine: idle → loading → (done event) → streaming → (markDone) → idle
	 * No message queuing — returns early if not idle.
	 */
	sendMessage = async (text: string): Promise<void> => {
		if (this.status !== 'idle') return;

		this.status = 'loading';
		this.currentActivity = 'Connecting...';
		this.lastError = '';

		// Push user message immediately so the UI can display it.
		this.messages = [
			...this.messages,
			{
				id: crypto.randomUUID(),
				role: 'user',
				content: text,
				timestamp: Date.now(),
				isStreaming: false
			}
		];

		const controller = new AbortController();
		this.abortController = controller;

		const onEvent = (type: string, raw: unknown) => {
			const d = (raw ?? {}) as Record<string, unknown>;
			switch (type) {
				case 'intent':
					this.currentActivity = `Mode: ${d.mode}`;
					break;

				case 'tool':
					this.currentActivity = `Using: ${d.tool}`;
					break;

				case 'loop':
					this.currentActivity = 'Thinking...';
					break;

				case 'done': {
					this.status = 'streaming';
					// Store the session_id returned by the server if present.
					if (typeof d.session_id === 'string') {
						this.sessionId = d.session_id;
					}
					this.messages = [
						...this.messages,
						{
							id: crypto.randomUUID(),
							role: 'assistant',
							content: typeof d.response === 'string' ? d.response : '',
							timestamp: Date.now(),
							isStreaming: true
						}
					];
					break;
				}

				case 'error': {
					this.status = 'error';
					const errorText = typeof d.error === 'string' ? d.error : 'Unknown error';
					this.lastError = errorText;
					this.messages = [
						...this.messages,
						{
							id: crypto.randomUUID(),
							role: 'error',
							content: errorText,
							timestamp: Date.now(),
							isStreaming: false
						}
					];
					break;
				}
			}
		};

		try {
			await streamChat(text, this.sessionId, onEvent, controller.signal);
		} catch (e: unknown) {
			// AbortError = user hit Stop — do not show as an error.
			if (e instanceof Error && e.name === 'AbortError') return;

			const message = e instanceof Error ? e.message : 'Unknown error';
			this.status = 'error';
			this.lastError = message;
			this.messages = [
				...this.messages,
				{
					id: crypto.randomUUID(),
					role: 'error',
					content: message,
					timestamp: Date.now(),
					isStreaming: false
				}
			];
		} finally {
			// The fetch is complete — clear the controller reference.
			// Note: status may be 'loading' (no done event received), 'error',
			// or 'streaming' (done event received mid-stream before await resolved).
			// In all cases the controller is spent; clear it unconditionally.
			this.abortController = null;
		}
	};

	/**
	 * Cancel the current in-flight request or animation.
	 *
	 * - Aborts the fetch if one is running.
	 * - Stops the streaming animation if one is running.
	 * - Sets status to idle immediately.
	 */
	stop = (): void => {
		this.abortController?.abort();
		this.abortController = null;

		this.cancelAnimation?.();
		this.cancelAnimation = null;

		// If an assistant message was mid-animation, mark it as done.
		if (this.status === 'streaming') {
			const last = this.messages.at(-1);
			if (last?.isStreaming) {
				this.messages = this.messages.map((m) =>
					m.id === last.id ? { ...m, isStreaming: false } : m
				);
			}
		}

		this.status = 'idle';
		this.currentActivity = '';
	};

	/**
	 * Retry after an error.
	 *
	 * Removes trailing error messages, then re-sends the last user message.
	 */
	retry = async (): Promise<void> => {
		// Find the last user message.
		const lastUser = [...this.messages].reverse().find((m) => m.role === 'user');
		if (!lastUser) return;

		// Remove trailing error messages from the end of the array.
		let msgs = [...this.messages];
		while (msgs.length > 0 && msgs.at(-1)?.role === 'error') {
			msgs = msgs.slice(0, -1);
		}
		this.messages = msgs;

		this.status = 'idle';
		await this.sendMessage(lastUser.content);
	};

	/**
	 * Called by MessageBubble when the streaming animation completes naturally.
	 *
	 * Marks the message as no longer streaming and transitions to idle.
	 */
	markDone = (messageId: string): void => {
		this.messages = this.messages.map((m) =>
			m.id === messageId ? { ...m, isStreaming: false } : m
		);

		if (this.status === 'streaming') {
			this.status = 'idle';
			this.currentActivity = '';
		}
	};

	/**
	 * Register the cancel function returned by animateStreaming.
	 *
	 * MessageBubble calls this so ChatStore.stop() can cancel an in-progress animation.
	 */
	registerAnimationCancel = (cancel: () => void): void => {
		this.cancelAnimation = cancel;
	};
}

/** Singleton ChatStore instance shared across the application. */
export const chatStore = new ChatStore();
