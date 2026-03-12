# Roadmap: Chimera Web UI (v1.0)

## Overview

Chimera has a fully working backend — SSE streaming, MCP tools, Synapse workflows, RAG pipeline — but no way to use it except curl. This milestone builds the SvelteKit web frontend that makes all of it accessible: a real-time chat UI that visualizes tool calls, Synapse workflow planning, and a knowledge base, all running locally. Four phases deliver in strict dependency order: static serving infrastructure, then the streaming chat core, then the Synapse differentiator layer, then sessions and knowledge management to complete the product.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Static Shell** - SvelteKit scaffolding + Node.js static serving + backend /api/ prefix migration
- [ ] **Phase 2: Core Chat Loop** - Streaming chat experience with markdown, code highlighting, stop/cancel, and error handling
- [ ] **Phase 3: Tool + Synapse Visualization** - Inline tool call display and real-time Synapse workflow progress panel
- [ ] **Phase 4: Sessions, Health + Knowledge** - Session sidebar, system health bar, and knowledge base management

## Phase Details

### Phase 1: Static Shell
**Goal**: The SvelteKit app shell is built and served by chimera-chat.js; all backend routes work at /api/*; two-terminal development workflow is confirmed working
**Depends on**: Nothing (first phase)
**Requirements**: None from REQUIREMENTS.md — this is infrastructure that enables all numbered requirements. The frontend milestone itself is captured in PROJECT.md Active requirements.
**Success Criteria** (what must be TRUE):
  1. Navigating to http://localhost:3210 serves the SvelteKit shell (not a curl JSON response)
  2. All backend endpoints respond correctly under the /api/ prefix (e.g., POST /api/chat/stream, GET /api/health)
  3. The Vite dev server proxies /api/ to Node.js without CORS errors
  4. Refreshing any SvelteKit route (e.g., /settings) returns the app, not a 404
  5. The existing test suite passes after the /api/ prefix migration
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — Migrate chimera-chat.js routes to /api/* prefix and add static file serving + SPA fallback
- [x] 01-02-PLAN.md — Scaffold SvelteKit project with Svelte 5, Tailwind v4, shadcn-svelte, adapter-static, and Vite proxy config

### Phase 2: Core Chat Loop
**Goal**: Users can send messages to Chimera and receive streaming AI responses with full markdown rendering, code highlighting, stop/cancel, loading states, error handling, dark mode, and responsive layout
**Depends on**: Phase 1
**Requirements**: CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06, CHAT-07, CHAT-08, CHAT-09, CHAT-10
**Success Criteria** (what must be TRUE):
  1. User types a message and sees AI response tokens appear in real-time as they stream in
  2. User sees markdown rendered correctly including code blocks with syntax highlighting and a copy button on each block
  3. User can stop a generation mid-stream and the UI returns to idle cleanly
  4. User sees a thinking/loading indicator during the 5-15 second model inference gap before the first token
  5. User sees an inline error message with a retry button when a request fails, and can switch between dark and light mode with the preference saved
**Plans**: 3 plans

Plans:
- [ ] 02-01-PLAN.md — Install dependencies, create types, SSE client, ChatStore state machine, and markdown rendering utilities
- [ ] 02-02-PLAN.md — Build MessageBubble, InputBar, ChatWindow, EmptyState components and wire into +page.svelte
- [ ] 02-03-PLAN.md — Add dark mode toggle, loading indicator, error display with retry, highlight.js themes, responsive layout, and human verification

### Phase 3: Tool + Synapse Visualization
**Goal**: Users can see every tool call Chimera makes (name, status, duration, arguments, result) and watch Synapse workflows unfold in real-time as a structured progress panel with Q&A cards, task checklist, and cancel control
**Depends on**: Phase 2
**Requirements**: TOOL-01, TOOL-02, TOOL-03, SYN-01, SYN-02, SYN-03, SYN-04
**Success Criteria** (what must be TRUE):
  1. User sees an inline collapsible block for each tool call showing tool name, status icon (spinner/check/x), and elapsed time
  2. User can expand a tool call block to read its arguments and a truncated result, and click "Show more" to see the full output
  3. User sees a workflow progress panel appear when Synapse activates, showing the current phase (Q&A / Planning / Executing)
  4. User sees clarification questions rendered as Q&A cards and a live task checklist with per-task status (pending/running/done/failed)
  5. User can cancel a running Synapse workflow via a stop button and the UI returns to idle
**Plans**: TBD

Plans:
- [ ] 03-01: Build ActivityPanel and ActivityEvent components — interpret tool, synapse_*, task_* SSE events; drive from ChatState.currentEvents
- [ ] 03-02: Build collapsible tool call blocks with arguments/result display and "Show more" expansion
- [ ] 03-03: Build Synapse Q&A cards, task checklist with live status, workflow cancel button wired to synapse_escalate

### Phase 4: Sessions, Health + Knowledge
**Goal**: Users can manage multiple conversations from a sidebar, see system health at a glance, and upload and browse documents in the knowledge base
**Depends on**: Phase 3
**Requirements**: SESS-01, SESS-02, SESS-03, SESS-04, HLTH-01, HLTH-02, HLTH-03, KNOW-01, KNOW-02, KNOW-03
**Success Criteria** (what must be TRUE):
  1. User sees a sidebar listing past conversations with timestamps and last-message previews, and can create, switch between, and delete sessions
  2. User sees a status bar showing green/red health indicators for LM Studio, RAG, and Search, plus the currently loaded model name and a "Local" privacy badge
  3. User can drag and drop documents onto the UI to upload them to the knowledge base
  4. User can browse, search, and delete documents in the knowledge base from within the UI
  5. User sees a subtle indicator in the chat when the assistant recalled something from conversation memory
**Plans**: TBD

Plans:
- [ ] 04-01: Build session sidebar — list sessions (requires new GET /api/sessions endpoint), new chat, switch, delete; sessionStorage persistence for tab-lifetime history
- [ ] 04-02: Build system health bar — poll GET /api/health, show LM Studio/RAG/Search indicators, model name, Local privacy badge; wire KNOW-03 memory recall indicator to SSE event
- [ ] 04-03: Build knowledge management UI — drag-and-drop upload to POST /api/documents/upload, document browser with search and delete against GET/DELETE /api/documents

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Static Shell | 2/2 | Complete | 2026-03-12 |
| 2. Core Chat Loop | 0/3 | Not started | - |
| 3. Tool + Synapse Visualization | 0/3 | Not started | - |
| 4. Sessions, Health + Knowledge | 0/3 | Not started | - |
