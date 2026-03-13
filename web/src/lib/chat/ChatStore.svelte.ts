import { fetchSessionLogs, logsToMessages } from './api.js';
import { streamChat } from './SSEClient.js';
import type { ChatStatus, Message, SynapseState, ToolCall } from './types.js';

/**
 * Reactive ChatStore using Svelte 5 runes pattern.
 *
 * Manages the full lifecycle of a Chimera chat session:
 * - Tracks messages, status, activity indicator, and errors.
 * - Drives the idle → loading → streaming → idle state machine.
 * - Buffers tool calls during a request and attaches them to the assistant message on done.
 * - Manages Synapse workflow state as a dedicated role:'synapse' message.
 * - Exposes sendMessage, stop, retry, markDone for UI components.
 *
 * Arrow function methods are used throughout to avoid `this` rebinding
 * issues when methods are destructured or passed as callbacks (Svelte 5 Pitfall 7).
 */
export class ChatStore {
	// -----------------------------------------------------------------------
	// Reactive state ($state runes)
	// -----------------------------------------------------------------------

	/** All messages in the current conversation (user + assistant + error + synapse). */
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

	/**
	 * Tool calls accumulated during the current request.
	 * Attached to the assistant message when the done event fires, then cleared.
	 */
	pendingToolCalls: ToolCall[] = [];

	/**
	 * ID of the active synapse message in this.messages.
	 * Used to update the correct message for in-place synapse state mutations.
	 * Null when no synapse workflow is in progress.
	 */
	activeSynapseMessageId: string | null = null;

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	/**
	 * Apply an updater function to the active synapse message's SynapseState.
	 * Rebuilds the messages array with spread to trigger Svelte 5 reactivity.
	 * No-op if activeSynapseMessageId is null or the message is not found.
	 */
	private updateSynapseMessage = (updater: (state: SynapseState) => SynapseState): void => {
		if (!this.activeSynapseMessageId) return;
		const id = this.activeSynapseMessageId;
		this.messages = this.messages.map((m) => {
			if (m.id !== id || !m.synapseState) return m;
			return { ...m, synapseState: updater(m.synapseState) };
		});
	};

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

				case 'tool': {
					// Filter out find_tool events — these are internal routing events, not
					// real tool calls. Only call_tool events have meaningful args/results to show.
					if (d.tool === 'find_tool') break;

					const toolCall: ToolCall = {
						id: crypto.randomUUID(),
						tool: typeof d.tool === 'string' ? d.tool : String(d.tool),
						args: d.args,
						result: d.result,
						error: typeof d.error === 'string' ? d.error : undefined,
						hadError: Boolean(d.hadError),
						status: d.result !== undefined || d.hadError ? 'done' : 'running',
						startedAt: Date.now(),
						// Single-event tools don't expose a start time, so durationMs stays undefined
						// for 'running' calls and is 0 for instantly-resolved calls.
						durationMs: d.result !== undefined || d.hadError ? 0 : undefined
					};
					this.pendingToolCalls = [...this.pendingToolCalls, toolCall];
					this.currentActivity = `Using: ${d.tool}`;
					break;
				}

				case 'loop':
					this.currentActivity = 'Thinking...';
					break;

				case 'synapse_start': {
					const newMsg: Message = {
						id: crypto.randomUUID(),
						role: 'synapse',
						content: '',
						timestamp: Date.now(),
						isStreaming: false,
						synapseState: {
							sessionId: typeof d.session_id === 'string' ? d.session_id : '',
							mode: typeof d.mode === 'string' ? d.mode : '',
							phase: 'qa',
							qaCards: [],
							tasks: []
						}
					};
					this.messages = [...this.messages, newMsg];
					this.activeSynapseMessageId = newMsg.id;
					this.currentActivity = 'Synapse: starting...';
					break;
				}

				case 'synapse_question': {
					const areaId = typeof d.area_id === 'string' ? d.area_id : '';
					const question = typeof d.text === 'string' ? d.text : '';
					this.updateSynapseMessage((state) => ({
						...state,
						qaCards: [...state.qaCards, { areaId, question }]
					}));
					this.currentActivity = 'Synapse: asking questions...';
					break;
				}

				case 'synapse_answer': {
					const areaId = typeof d.area_id === 'string' ? d.area_id : '';
					const answer = typeof d.answer === 'string' ? d.answer : '';
					this.updateSynapseMessage((state) => ({
						...state,
						qaCards: state.qaCards.map((card) =>
							card.areaId === areaId ? { ...card, answer } : card
						)
					}));
					break;
				}

				case 'task_start': {
					const taskId = typeof d.id === 'string' ? d.id : '';
					const description = typeof d.description === 'string' ? d.description : '';
					this.updateSynapseMessage((state) => ({
						...state,
						phase: state.phase === 'qa' ? 'executing' : state.phase,
						// Mark any previously running tasks as done before adding the new one.
						tasks: [
							...state.tasks.map((t) => (t.status === 'running' ? { ...t, status: 'done' as const } : t)),
							{ id: taskId, description, status: 'running' as const }
						]
					}));
					this.currentActivity = 'Synapse: executing tasks...';
					break;
				}

				case 'task_done': {
					const taskId = typeof d.id === 'string' ? d.id : '';
					const responsePreview = typeof d.response === 'string' ? d.response : '';
					this.updateSynapseMessage((state) => ({
						...state,
						tasks: state.tasks.map((t) =>
							t.id === taskId ? { ...t, status: 'done' as const, responsePreview } : t
						)
					}));
					break;
				}

				case 'tasks_complete': {
					const message = typeof d.message === 'string' ? d.message : '';
					this.updateSynapseMessage((state) => ({
						...state,
						phase: 'complete',
						tasksCompleteMessage: message
					}));
					this.currentActivity = 'Synapse: complete';
					break;
				}

				case 'done': {
					this.status = 'streaming';
					// Store the session_id returned by the server if present.
					if (typeof d.session_id === 'string') {
						this.sessionId = d.session_id;
					}

					// If a synapse workflow is open but never received tasks_complete, mark it complete now.
					if (this.activeSynapseMessageId) {
						this.updateSynapseMessage((state) =>
							state.phase !== 'complete' ? { ...state, phase: 'complete' } : state
						);
					}

					// Attach buffered tool calls to the assistant message, then clear the buffer.
					const toolCalls =
						this.pendingToolCalls.length > 0 ? [...this.pendingToolCalls] : undefined;
					this.pendingToolCalls = [];
					this.activeSynapseMessageId = null;

					this.messages = [
						...this.messages,
						{
							id: crypto.randomUUID(),
							role: 'assistant',
							content: typeof d.response === 'string' ? d.response : '',
							timestamp: Date.now(),
							isStreaming: true,
							toolCalls
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
			// The fetch is complete — clear the controller reference and pending buffers.
			// Note: status may be 'loading' (no done event received), 'error',
			// or 'streaming' (done event received mid-stream before await resolved).
			this.abortController = null;
			this.pendingToolCalls = [];
			this.activeSynapseMessageId = null;
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

		// Clear pending buffers.
		this.pendingToolCalls = [];
		this.activeSynapseMessageId = null;

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

	/**
	 * Reset the chat to a fresh state, optionally switching to a given session.
	 *
	 * Clears messages, status, activity, and errors.
	 * If sessionId is provided, sets this.sessionId to it (switch session).
	 * Otherwise generates a new UUID (new chat).
	 *
	 * Used by SessionSidebar for both "New chat" and "Switch session" actions.
	 */
	resetSession = (sessionId?: string): void => {
		// Abort any in-flight request before resetting.
		this.abortController?.abort();
		this.abortController = null;
		this.cancelAnimation?.();
		this.cancelAnimation = null;

		this.messages = [];
		this.status = 'idle';
		this.currentActivity = '';
		this.lastError = '';
		this.pendingToolCalls = [];
		this.activeSynapseMessageId = null;
		this.sessionId = sessionId ?? crypto.randomUUID();
	};

	/**
	 * Switch the active session to an existing server-side session.
	 *
	 * Resets chat state, then fetches and hydrates prior message history
	 * from the /api/sessions/:id/logs endpoint. On failure, leaves the
	 * chat empty (same behaviour as before hydration was added).
	 */
	loadSession = async (sessionId: string): Promise<void> => {
		this.resetSession(sessionId);
		const logs = await fetchSessionLogs(sessionId);
		const messages = logsToMessages(logs);
		this.messages = messages;
	};
}

/** Singleton ChatStore instance shared across the application. */
export const chatStore = new ChatStore();
