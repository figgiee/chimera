---
phase: 04
plan: 01
subsystem: api-layer
tags: [sessions, health, documents, api-client, typescript, fetch]

dependency-graph:
  requires: [03-tool-synapse-visualization]
  provides: [session-list-endpoint, delete-session-endpoint, typed-api-client]
  affects: [04-02-session-sidebar, 04-03-knowledge-ui]

tech-stack:
  added: []
  patterns: [typed-fetch-wrapper, degraded-health-fallback, never-throw-fetch]

key-files:
  created:
    - web/src/lib/chat/api.ts
  modified:
    - chimera-chat.js
    - web/src/lib/chat/types.ts

decisions:
  - "[04-01-A]: GET /api/sessions uses exact pathname match checked before parameterized :id routes — avoids ambiguity"
  - "[04-01-B]: DELETE /api/sessions/:id placed after /stats and /logs handlers — regex /api/sessions/([^/]+) would match all three"
  - "[04-01-C]: fetchHealth returns degraded status object on network failure (never throws) — callers can always render UI"
  - "[04-01-D]: fetchModel returns 'Unknown' on any LM Studio failure (never throws) — graceful degradation for model display"
  - "[04-01-E]: RAG_BASE is a direct URL (not proxied) — document endpoints hit the RAG stack on port 8080 directly"

metrics:
  duration: "~3 min"
  completed: "2026-03-13"
---

# Phase 4 Plan 01: Sessions + Typed API Client Summary

**One-liner:** Backend session list/delete endpoints + typed fetch wrappers for sessions, health, LM Studio models, and RAG documents.

## What Was Built

### Task 1: GET /api/sessions and DELETE /api/sessions/:id (chimera-chat.js)

Added two new route handlers to the in-memory session management layer:

- **GET /api/sessions** — Exact pathname match (`url.pathname === '/api/sessions'`). Iterates the `sessions` Map, extracts metadata (id, title from first user_message log truncated to 50 chars, created/lastActive timestamps, messageCount), sorts by lastActive descending, returns `{ sessions: [...] }`.

- **DELETE /api/sessions/:id** — Regex match placed after the /stats and /logs handlers. Deletes session from Map, returns `{ status: 'deleted', session_id: id }` or 404.

Route ordering was critical: exact `/api/sessions` checked first, then `/stats`, then `/logs`, then bare `:id` DELETE — preventing the bare-ID regex from swallowing the sub-resource routes.

### Task 2: Phase 4 Types and Typed API Client (types.ts, api.ts)

**types.ts additions:**
- `SessionInfo` — mirrors GET /api/sessions response shape
- `HealthStatus` — mirrors GET /api/health?deep=true response
- `KnowledgeDocument` — mirrors RAG stack GET /api/documents item shape

**api.ts (new file) — 7 typed fetch wrappers:**

| Function | Target | Failure behavior |
|---|---|---|
| `fetchSessions()` | `/api/sessions` (same origin) | throws |
| `deleteSession(id)` | `/api/sessions/:id` (same origin) | throws |
| `fetchHealth()` | `/api/health?deep=true` (same origin) | returns degraded object, never throws |
| `fetchModel()` | `LM_BASE/v1/models` (direct) | returns 'Unknown', never throws |
| `fetchDocuments()` | `RAG_BASE/api/documents` (direct) | throws |
| `deleteDocument(id)` | `RAG_BASE/api/documents/:id` (direct) | throws |
| `uploadDocument(file)` | `RAG_BASE/api/documents/upload` (direct) | throws |

Content-Type is not set for `uploadDocument` — browser sets multipart boundary automatically via FormData.

## Task Commits

| Task | Description | Commit |
|---|---|---|
| 1 | Add GET /api/sessions and DELETE /api/sessions/:id | 198589c |
| 2 | Add Phase 4 types and typed API client module | 8ddcadd |

## Verification Results

- `node -c chimera-chat.js` — syntax OK
- `cd web && npx svelte-check` — 0 errors, 0 warnings
- Route ordering visually confirmed: exact match → /stats → /logs → bare DELETE

## Deviations from Plan

None — plan executed exactly as written.

## Next Phase Readiness

Plans 02 and 03 can now import from `$lib/chat/api.ts` for all data fetching. The session list endpoint is live in chimera-chat.js. The blocked concern from STATE.md is resolved:
- [Phase 4 blocker resolved]: GET /api/sessions now exists in chimera-chat.js

## Self-Check: PASSED
