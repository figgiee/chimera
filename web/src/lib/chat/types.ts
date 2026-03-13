/**
 * Core type definitions for the Chimera chat data layer.
 * These types mirror the /api/chat/stream SSE event contract.
 */

// ---------------------------------------------------------------------------
// Tool call types
// ---------------------------------------------------------------------------

/** Lifecycle state of a single tool invocation. */
export type ToolCallStatus = 'running' | 'done' | 'error';

/** Represents a single tool call made during request processing. */
export interface ToolCall {
  /** Unique identifier for this tool call. */
  id: string;
  /** Name of the tool that was called. */
  tool: string;
  /** Arguments passed to the tool. */
  args?: unknown;
  /** Result returned by the tool. */
  result?: unknown;
  /** Error message if the tool call failed. */
  error?: string;
  /** True if the tool call encountered an error. */
  hadError: boolean;
  /** Current lifecycle state of this tool call. */
  status: ToolCallStatus;
  /** Unix timestamp (Date.now()) when the tool call started. */
  startedAt: number;
  /** Duration in milliseconds from start to completion. */
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Synapse workflow types
// ---------------------------------------------------------------------------

/** Current phase of a Synapse workflow execution. */
export type SynapsePhase = 'qa' | 'executing' | 'complete';

/** A question-and-answer card produced during Synapse Q&A phase. */
export interface QACard {
  /** Identifier for the area/category this question belongs to. */
  areaId: string;
  /** The question text posed by Synapse. */
  question: string;
  /** The answer provided, once available. */
  answer?: string;
}

/** A single task in a Synapse execution plan. */
export interface TaskItem {
  /** Unique identifier for this task. */
  id: string;
  /** Human-readable description of what the task does. */
  description: string;
  /** Current execution status. */
  status: 'pending' | 'running' | 'done' | 'failed';
  /** Brief preview of the task result, populated after completion. */
  responsePreview?: string;
}

/** Full state of an active or completed Synapse workflow. */
export interface SynapseState {
  /** Server-assigned session identifier for this Synapse run. */
  sessionId: string;
  /** Synapse mode (e.g., 'plan', 'research'). */
  mode: string;
  /** Current phase of the workflow. */
  phase: SynapsePhase;
  /** Q&A cards generated during the planning phase. */
  qaCards: QACard[];
  /** Tasks in the execution plan. */
  tasks: TaskItem[];
  /** Summary message produced when all tasks are complete. */
  tasksCompleteMessage?: string;
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

/** A single chat message in the conversation history. */
export interface Message {
  /** Unique identifier for this message. */
  id: string;
  /**
   * Who sent the message.
   * - 'user': Human turn
   * - 'assistant': AI response
   * - 'error': Inline error with retry affordance
   * - 'synapse': Synthetic message tracking a Synapse workflow
   */
  role: 'user' | 'assistant' | 'error' | 'synapse';
  /** The message text content. */
  content: string;
  /** Unix timestamp (Date.now()) when the message was created. */
  timestamp: number;
  /** True while the streaming animation is in progress for this message. */
  isStreaming: boolean;
  /** Tool calls made during this assistant turn, attached after done event. */
  toolCalls?: ToolCall[];
  /** Synapse workflow state, populated for role:'synapse' messages. */
  synapseState?: SynapseState;
}

// ---------------------------------------------------------------------------
// Chat status
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SSE event map
// ---------------------------------------------------------------------------

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
  /** A Synapse workflow session has started. */
  synapse_start: { session_id: string; mode: string; status: string };
  /** Synapse is asking a clarifying question for the given area. */
  synapse_question: { area_id: string; text: string };
  /** Synapse received an answer for a previously asked question. */
  synapse_answer: { area_id: string; answer: string };
  /** A Synapse task has started executing. */
  task_start: { id: string; description: string };
  /** A Synapse task has completed. */
  task_done: { id: string; response: string };
  /** A Synapse task has failed. */
  task_failed: { id: string; error: string };
  /** All Synapse tasks have completed. */
  tasks_complete: { count: number; message: string };
};

// ---------------------------------------------------------------------------
// Phase 4: Session, Health, Document, and Model types
// ---------------------------------------------------------------------------

/** Metadata for a session returned by GET /api/sessions. */
export interface SessionInfo {
  id: string;
  title: string;
  created: number;
  lastActive: number;
  messageCount: number;
  lastMessagePreview: string;
}

/** Response from GET /api/health?deep=true. */
export interface HealthStatus {
  status: 'ok' | 'degraded';
  sessions: number;
  uptime: number;
  errors?: string[];
}

/** A document in the knowledge base from GET /api/documents. */
export interface KnowledgeDocument {
  id: string;
  filename: string;
  source_type: string;
  created_at: string;
  content_preview: string;
}
