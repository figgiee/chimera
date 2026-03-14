/**
 * Typed fetch wrappers for all Phase 4 API calls.
 *
 * Sessions, health, and document endpoints are served by chimera-chat.js (same origin).
 * Document requests are proxied through /api/rag/* to the RAG stack.
 * LM Studio model info is fetched directly from LM_BASE.
 */

import type { SessionInfo, HealthStatus, KnowledgeDocument, Message, ToolCall, SynapseState, Project } from './types.js';

// ---------------------------------------------------------------------------
// Sessions  (chimera-chat.js, same origin)
// ---------------------------------------------------------------------------

/**
 * Fetch raw SSE logs for a session from GET /api/sessions/:id/logs?limit=200.
 * Returns an empty array on any failure — never throws — so session switching
 * still works even if the logs endpoint is unavailable.
 */
export async function fetchSessionLogs(id: string): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/logs?limit=200`);
    if (!res.ok) return [];
    const data = await res.json() as { logs?: Record<string, unknown>[] };
    return data.logs ?? [];
  } catch {
    return [];
  }
}

/**
 * Transform raw SSE log records into a Message[] suitable for ChatStore.messages.
 *
 * Log records have shape { ts: number, type: string, ...eventPayload }.
 * This mirrors the ChatStore.onEvent state machine so that hydrated history
 * renders identically to live-streamed messages.
 */
export function logsToMessages(logs: Record<string, unknown>[]): Message[] {
  const messages: Message[] = [];
  let pendingToolCalls: ToolCall[] = [];
  let activeSynapseMsg: Message | null = null;

  function updateSynapse(updater: (state: SynapseState) => SynapseState): void {
    if (!activeSynapseMsg) return;
    const targetId = activeSynapseMsg.id;
    const idx = messages.findIndex((m) => m.id === targetId);
    const existing = messages[idx]?.synapseState;
    if (idx === -1 || !existing) return;
    messages[idx] = { ...messages[idx], synapseState: updater(existing) };
    activeSynapseMsg = messages[idx];
  }

  for (const log of logs) {
    const type = typeof log.type === 'string' ? log.type : '';
    const ts = typeof log.ts === 'number' ? log.ts : Date.now();

    switch (type) {
      case 'user_message': {
        const text = typeof log.text === 'string' ? log.text : '';
        messages.push({
          id: crypto.randomUUID(),
          role: 'user',
          content: text,
          timestamp: ts,
          isStreaming: false
        });
        break;
      }

      case 'tool': {
        // Filter out internal routing events — same rule as ChatStore.
        if (log.tool === 'find_tool') break;
        const toolCall: ToolCall = {
          id: crypto.randomUUID(),
          tool: typeof log.tool === 'string' ? log.tool : String(log.tool ?? ''),
          args: log.args,
          result: log.result,
          error: typeof log.error === 'string' ? log.error : undefined,
          hadError: Boolean(log.hadError),
          status: log.hadError ? 'error' : 'done',
          startedAt: ts,
          durationMs: 0
        };
        pendingToolCalls = [...pendingToolCalls, toolCall];
        break;
      }

      case 'done': {
        const response = typeof log.response === 'string' ? log.response : '';
        // If a synapse workflow was open, close it out.
        if (activeSynapseMsg) {
          updateSynapse((state) =>
            state.phase !== 'complete' ? { ...state, phase: 'complete' } : state
          );
          activeSynapseMsg = null;
        }
        const toolCalls = pendingToolCalls.length > 0 ? [...pendingToolCalls] : undefined;
        pendingToolCalls = [];
        messages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response,
          timestamp: ts,
          isStreaming: false,
          toolCalls
        });
        break;
      }

      case 'error': {
        const errorText = typeof log.error === 'string' ? log.error : 'Unknown error';
        messages.push({
          id: crypto.randomUUID(),
          role: 'error',
          content: errorText,
          timestamp: ts,
          isStreaming: false
        });
        break;
      }

      // Synapse state machine — mirrors ChatStore.onEvent exactly.
      case 'synapse_start': {
        const newMsg: Message = {
          id: crypto.randomUUID(),
          role: 'synapse',
          content: '',
          timestamp: ts,
          isStreaming: false,
          synapseState: {
            sessionId: typeof log.session_id === 'string' ? log.session_id : '',
            mode: typeof log.mode === 'string' ? log.mode : '',
            phase: 'qa',
            qaCards: [],
            tasks: []
          }
        };
        messages.push(newMsg);
        activeSynapseMsg = newMsg;
        break;
      }

      case 'synapse_question': {
        const areaId = typeof log.area_id === 'string' ? log.area_id : '';
        const question = typeof log.text === 'string' ? log.text : '';
        updateSynapse((state) => ({
          ...state,
          qaCards: [...state.qaCards, { areaId, question }]
        }));
        break;
      }

      case 'synapse_answer': {
        const areaId = typeof log.area_id === 'string' ? log.area_id : '';
        const answer = typeof log.answer === 'string' ? log.answer : '';
        updateSynapse((state) => ({
          ...state,
          qaCards: state.qaCards.map((card) =>
            card.areaId === areaId ? { ...card, answer } : card
          )
        }));
        break;
      }

      case 'task_start': {
        const taskId = typeof log.id === 'string' ? log.id : '';
        const description = typeof log.description === 'string' ? log.description : '';
        updateSynapse((state) => ({
          ...state,
          phase: state.phase === 'qa' ? 'executing' : state.phase,
          tasks: [
            ...state.tasks.map((t) => (t.status === 'running' ? { ...t, status: 'done' as const } : t)),
            { id: taskId, description, status: 'running' as const }
          ]
        }));
        break;
      }

      case 'task_done': {
        const taskId = typeof log.id === 'string' ? log.id : '';
        const responsePreview = typeof log.response === 'string' ? log.response : '';
        updateSynapse((state) => ({
          ...state,
          tasks: state.tasks.map((t) =>
            t.id === taskId ? { ...t, status: 'done' as const, responsePreview } : t
          )
        }));
        break;
      }

      case 'task_failed': {
        const taskId = typeof log.id === 'string' ? log.id : '';
        const errorMsg = typeof log.error === 'string' ? log.error : 'Task failed';
        updateSynapse((state) => ({
          ...state,
          tasks: state.tasks.map((t) =>
            t.id === taskId ? { ...t, status: 'failed' as const, responsePreview: errorMsg } : t
          )
        }));
        break;
      }

      case 'tasks_complete': {
        const message = typeof log.message === 'string' ? log.message : '';
        updateSynapse((state) => ({
          ...state,
          phase: 'complete',
          tasksCompleteMessage: message
        }));
        break;
      }

      // All other event types (intent, loop, etc.) are ephemeral — no UI message needed.
      default:
        break;
    }
  }

  return messages;
}

/**
 * Fetch all active sessions, sorted by lastActive descending.
 * Throws if the request fails.
 */
export async function fetchSessions(): Promise<SessionInfo[]> {
  const res = await fetch('/api/sessions');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { sessions: SessionInfo[] };
  return data.sessions;
}

/**
 * Delete a session by ID.
 * Throws if the session is not found or request fails.
 */
export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Health  (chimera-chat.js, same origin)
// ---------------------------------------------------------------------------

/**
 * Fetch server health status.
 * Returns a degraded status object on network failure — never throws.
 */
export async function fetchHealth(): Promise<HealthStatus> {
  try {
    const res = await fetch('/api/health?deep=true');
    const data = await res.json() as HealthStatus;
    return data;
  } catch {
    return { status: 'degraded', sessions: 0, uptime: 0, errors: ['Health endpoint unreachable'] };
  }
}

// ---------------------------------------------------------------------------
// Projects  (proxied through chimera-chat.js at /api/projects/*)
// ---------------------------------------------------------------------------

/**
 * Fetch all projects, sorted by last updated descending.
 * Throws if the request fails.
 */
export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch('/api/projects');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { projects: Project[] };
  return data.projects;
}

/**
 * Create a new project.
 * Throws if the request fails.
 */
export async function createProject(name: string, description?: string): Promise<Project> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: description ?? '' })
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<Project>;
}

/**
 * Delete a project by ID.
 * Throws if the project is not found or request fails.
 */
export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Documents  (proxied through chimera-chat.js at /api/rag/*)
// ---------------------------------------------------------------------------

/**
 * Fetch all documents in the knowledge base.
 * Throws if the request fails.
 */
export async function fetchDocuments(): Promise<KnowledgeDocument[]> {
  const res = await fetch('/api/rag/documents');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<KnowledgeDocument[]>;
}

/**
 * Delete a document from the knowledge base by ID.
 * Throws if the document is not found or request fails.
 */
export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`/api/rag/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

/**
 * Upload a document to the knowledge base.
 * Do NOT set Content-Type — the browser must set the multipart boundary automatically.
 * Throws if the upload fails.
 */
export async function uploadDocument(file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/rag/documents/upload', { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}
