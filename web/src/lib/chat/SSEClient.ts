import { EventSourceParserStream } from 'eventsource-parser/stream';

/**
 * Stream a chat message to /api/chat/stream via POST SSE.
 *
 * Uses fetch + ReadableStream (not EventSource) because the endpoint
 * requires POST with a JSON body — EventSource only supports GET.
 *
 * @param message   The user's message text.
 * @param sessionId Optional session ID to continue an existing conversation.
 * @param onEvent   Callback invoked for each parsed SSE event.
 * @param signal    AbortSignal for cancellation. AbortError is NOT caught — it propagates
 *                  so the caller can distinguish a user-initiated stop from a real error.
 */
export async function streamChat(
	message: string,
	sessionId: string | undefined,
	onEvent: (type: string, data: unknown) => void,
	signal: AbortSignal,
	projectId?: string | null
): Promise<void> {
	const response = await fetch('/api/chat/stream', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ message, session_id: sessionId, project_id: projectId ?? undefined }),
		signal
	});

	// 429 is returned as plain JSON before SSE headers are sent.
	if (response.status === 429) {
		throw new Error('Session is busy');
	}

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}

	if (!response.body) {
		throw new Error('Response has no body');
	}

	// Pipe: ReadableStream<Uint8Array> → TextDecoderStream → EventSourceParserStream
	const stream = response.body
		.pipeThrough(new TextDecoderStream())
		.pipeThrough(new EventSourceParserStream());

	// Use a reader directly because TypeScript's DOM lib does not declare
	// ReadableStream as AsyncIterable even with DOM.Iterable in tsconfig.
	const reader = stream.getReader();
	try {
		while (true) {
			if (signal.aborted) break;

			const { done, value: event } = await reader.read();
			if (done) break;

			try {
				onEvent(event.event ?? 'message', JSON.parse(event.data));
			} catch {
				// Skip malformed events (invalid JSON, missing data field, etc.)
			}
		}
	} finally {
		reader.releaseLock();
	}
}
