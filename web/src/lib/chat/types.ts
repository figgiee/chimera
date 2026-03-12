/**
 * Core type definitions for the Chimera chat data layer.
 * These types mirror the /api/chat/stream SSE event contract.
 */

/** A single chat message in the conversation history. */
export interface Message {
  /** Unique identifier for this message. */
  id: string;
  /** Who sent the message. 'error' is used for inline error messages with retry. */
  role: 'user' | 'assistant' | 'error';
  /** The message text content. */
  content: string;
  /** Unix timestamp (Date.now()) when the message was created. */
  timestamp: number;
  /** True while the streaming animation is in progress for this message. */
  isStreaming: boolean;
}

/** Current state of the chat interaction. */
export type ChatStatus =
  /** No active request — ready to send. */
  | 'idle'
  /** Request sent, waiting for first meaningful SSE event or done. */
  | 'loading'
  /** Done event received, streaming animation in progress. */
  | 'streaming'
  /** Request failed — lastError is populated. */
  | 'error';

/**
 * Discriminated union of all SSE events emitted by /api/chat/stream.
 * Each key maps to the typed payload for that event name.
 */
export type SSEEventMap = {
  /** Echo of the user's message text. */
  user_message: { text: string };
  /** Chimera determined which mode to use for this query. */
  intent: { mode: string };
  /** A tool was called during processing. */
  tool: {
    tool: string;
    args?: unknown;
    result?: unknown;
    error?: string;
    hadError?: boolean;
  };
  /** Processing complete — carries the full AI response. */
  done: {
    response: string;
    session_id: string;
    stats?: Record<string, unknown>;
  };
  /** Server-side error — request will not complete. */
  error: { error: string };
  /** The reasoning loop iterated again. */
  loop: { reason: string; signature?: string };
};

/** Options passed to the chat send flow. */
export interface SendMessageOptions {
  /** The user's message text. */
  message: string;
  /** Optional session ID to continue an existing conversation. */
  sessionId?: string;
}
