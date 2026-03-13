/**
 * Typed fetch wrappers for all Phase 4 API calls.
 *
 * Sessions and health endpoints are served by chimera-chat.js (same origin).
 * Document endpoints are served by the RAG stack at RAG_BASE.
 * LM Studio model info is fetched directly from LM_BASE.
 */

import type { SessionInfo, HealthStatus, KnowledgeDocument } from './types.js';

const RAG_BASE = 'http://localhost:8080';
const LM_BASE = 'http://127.0.0.1:1235';

// ---------------------------------------------------------------------------
// Sessions  (chimera-chat.js, same origin)
// ---------------------------------------------------------------------------

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

/**
 * Fetch the currently loaded model name from LM Studio.
 * Returns 'Unknown' on any failure — never throws.
 */
export async function fetchModel(): Promise<string> {
  try {
    const res = await fetch(`${LM_BASE}/v1/models`);
    if (!res.ok) return 'Unknown';
    const data = await res.json() as { data?: Array<{ id: string }> };
    return data.data?.[0]?.id ?? 'Unknown';
  } catch {
    return 'Unknown';
  }
}

// ---------------------------------------------------------------------------
// Documents  (RAG server at RAG_BASE — not proxied through chimera-chat.js)
// ---------------------------------------------------------------------------

/**
 * Fetch all documents in the knowledge base.
 * Throws if the request fails.
 */
export async function fetchDocuments(): Promise<KnowledgeDocument[]> {
  const res = await fetch(`${RAG_BASE}/api/documents`);
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
  const res = await fetch(`${RAG_BASE}/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
  const res = await fetch(`${RAG_BASE}/api/documents/upload`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}
