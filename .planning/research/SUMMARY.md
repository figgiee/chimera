# Project Research Summary

**Project:** Chimera Web UI
**Domain:** Web frontend for local-first AI assistant with RAG, tool execution, and autonomous workflows
**Researched:** 2026-03-12
**Confidence:** HIGH

## Executive Summary

Chimera is a local-first AI assistant with an existing Node.js HTTP server, SSE streaming backend, and a multi-stage orchestration layer (standard chat, tool execution, and autonomous Synapse workflows). The project needs a web frontend that makes this backend accessible without curl. Research across four dimensions — stack, features, architecture, and pitfalls — converges on a clear, well-validated approach: a SvelteKit + Svelte 5 static build served by the existing `chimera-chat.js` server. This is the same architecture used by Open WebUI (50k+ GitHub stars), validating it at scale. The frontend connects via `fetch + ReadableStream` (not native `EventSource`) to consume the POST-based SSE stream, and all API routes are prefixed to `/api/` to avoid collision with static file paths.

The recommended stack is lean and purpose-appropriate: SvelteKit generates a static `build/` directory that `chimera-chat.js` serves with ~40 lines of raw Node.js, no new runtime dependencies required. Svelte 5 runes handle streaming state with minimal boilerplate. Tailwind v4 with shadcn-svelte provides accessible, customizable UI components without a bloated dependency tree. The two-markdown-mode strategy (streaming-markdown during generation, marked + highlight.js after) solves the O(n²) re-render problem that plagues naive implementations.

The primary risks are all well-documented and have clear mitigations available from day one. XSS via AI-generated markdown (OWASP LLM05), SSE memory leaks from unclosed ReadableStreams, and silent UI deadlocks when SSE event sequences are incomplete are the three critical pitfalls that must be designed against from the first line of streaming code. None of these require architectural changes to the existing backend — they are purely frontend concerns with standard solutions.

---

## Key Findings

### Recommended Stack

See [`STACK.md`](.planning/research/STACK.md) for full details.

SvelteKit + Svelte 5 is the correct choice for this project. The framework compiles away to zero runtime overhead, Svelte 5 runes handle streaming state without `useState/useEffect` gymnastics, and `adapter-static` produces a drop-in `build/` directory the existing Node.js server can serve. Open WebUI, the dominant open-source AI chat UI, validates this exact architecture at scale.

**Core technologies:**

- **SvelteKit ^2.53 + Svelte ^5.53**: App framework + UI — zero-runtime compiled output, runes for streaming state, adapter-static for static build output
- **Tailwind CSS ^4.2**: Utility CSS — zero-config, first-party Vite plugin, matches shadcn-svelte expectations
- **shadcn-svelte ^1.1 + bits-ui ^2.16**: UI components — copy-paste ownership model, accessible headless primitives, no version lock-in
- **marked ^17.0 + streaming-markdown + highlight.js ^11.9**: Markdown rendering — two-mode strategy: streaming-markdown during generation (incremental, no re-parse), marked + highlight.js after `done` event (full quality)
- **DOMPurify ^3.x**: XSS sanitization — required on all rendered markdown before DOM insertion; non-negotiable
- **Native fetch + ReadableStream**: SSE consumption — Chimera uses POST-initiated SSE, which native `EventSource` cannot handle; fetch + ReadableStream is 30 lines with no dependencies
- **@lucide/svelte**: Icons — tree-shakeable, natively used by shadcn-svelte

**Critical version notes:** Tailwind v4 (not v3) is required for shadcn-svelte compatibility. The `fallback: 'index.html'` setting in `svelte.config.js` is required for SPA routing — without it, refreshing on `/settings` returns 404.

### Expected Features

See [`FEATURES.md`](.planning/research/FEATURES.md) for full details, including competitive analysis and anti-feature rationale.

**Must have (table stakes) — Phase 1-2:**
- Message input with auto-growing textarea, Enter to send, Shift+Enter for newline
- Streaming response display via SSE — real-time token appearance is a user expectation
- Markdown rendering with code syntax highlighting and copy-to-clipboard on every code block
- Dark mode as default (82% of AI app users prefer dark mode); follow system preference via `prefers-color-scheme`
- Stop/cancel generation button — AbortController support already exists in the backend
- Inline tool call display in collapsible blocks — transparency is expected; ChatGPT and Claude both show this
- Error handling with inline messages and retry option
- Session list in sidebar (new chat, switch, delete)
- Loading/thinking indicators — especially important for the 5-15 second model inference gap

**Should have (differentiators) — Phase 3:**
- Synapse workflow progress visualization — no competitor has this; it is Chimera's killer UI surface
- Interactive Q&A cards for workflow planning questions
- Task list with live checkmark status updates
- Document upload via drag-and-drop (RAG intake)
- Knowledge base browser (list, search, delete indexed documents)
- System health indicator (LLM / RAG / Search status from `/health`)
- Keyboard shortcuts (Ctrl+N, Escape, Ctrl+/)

**Defer to post-MVP:**
- Slash commands (autocomplete UI adds complexity)
- Message editing and regeneration
- LaTeX / KaTeX rendering
- Model info display (tok/s, context usage)
- Conversation memory indicators
- Export conversations to markdown

**Anti-features — explicitly excluded:**
- Artifacts / side-panel code execution (massive scope, wrong use case)
- Voice input/output (not relevant for developer-focused local tool)
- Image generation (wrong tool category)
- Multi-model switching (LM Studio handles this)
- User authentication (local-first single-user by design)
- Mobile-first responsive layout (GPU required, desktop-only is appropriate)

### Architecture Approach

See [`ARCHITECTURE.md`](.planning/research/ARCHITECTURE.md) for full details, including data flow diagrams, component code, and Open WebUI comparison table.

The integration requires minimal changes to the existing backend: add `/api/` prefix to all routes, add a `serveStatic()` function (~40 lines, no new dependencies), and add SPA fallback to serve `index.html` for unmatched routes. The frontend lives in a `web/` subdirectory, builds to `web/build/`, and is served by `chimera-chat.js`. `chimera-orchestrator.js` is entirely unchanged. Two-terminal development (node + `npm run dev`) with Vite proxy for `/api/` is the standard pattern, validated by Open WebUI.

**Major components:**

1. **chimera-chat.js (modified)**: HTTP server + API routing (`/api/*`) + static file serving (`web/build/`) + SPA fallback
2. **web/src/lib/api/client.ts**: HTTP client, SSE stream parser (`fetch + ReadableStream`), AbortController lifecycle
3. **web/src/lib/state/chat.svelte.ts + streaming.svelte.ts**: Reactive chat state using Svelte 5 runes (`$state`, `$derived`); explicit state machine (idle → streaming → synapse_qa → executing_tasks → done/error)
4. **web/src/lib/components/**: ChatInput, ChatMessage, ActivityPanel, ActivityEvent, Sidebar — each renders a slice of the reactive state
5. **web/src/routes/**: `+layout.svelte` (sidebar + main shell), `+page.svelte` (chat), `settings/+page.svelte`

Always use the streaming endpoint (`/api/chat/stream`) — even simple responses arrive quickly via SSE, and the frontend cannot predict whether Synapse will activate. Using the non-streaming `/api/chat` endpoint creates a dual-code-path problem with no benefit.

### Critical Pitfalls

See [`PITFALLS.md`](.planning/research/PITFALLS.md) for full details, prevention code, and phase-specific warnings.

1. **EventSource cannot POST** — Use `fetch + ReadableStream` from day one. `new EventSource(url)` only supports GET requests; Chimera's stream endpoint is POST. Retrofitting this is a full streaming rewrite.

2. **XSS via AI-generated markdown** — Always sanitize with DOMPurify after `marked()` converts to HTML, never before, and never use `innerHTML` with unsanitized AI output. Real CVEs (DeepSeek XSS, CVE-2026-22813) document this exact attack vector. In Chimera's case, XSS could invoke tool calls or exfiltrate RAG data.

3. **SSE memory leaks from unclosed connections** — Every `fetch` call that opens a stream needs an `AbortController`. Call `controller.abort()` in component cleanup (`onDestroy`), on new message sent, and on navigation. Synapse workflows run for minutes; zombie streams accumulate.

4. **Silent UI deadlock from orphaned SSE state** — Design an explicit state machine with timeout transitions from the start. The `done` and `error` events must always reset UI to idle regardless of current state. Add a 30-second client-side watchdog during active streaming.

5. **Broken code blocks during streaming** — During active SSE streaming, count backtick fences; if the count is odd, append a closing fence before parsing (display only). Run full `marked` + `highlight.js` only on the final complete response after the `done` event.

---

## Implications for Roadmap

Research strongly supports a 4-phase structure that maps cleanly to the dependency chain in FEATURES.md, the suggested build order in ARCHITECTURE.md, and the phase warnings in PITFALLS.md.

### Phase 1: Static Shell + Plumbing

**Rationale:** Establishes the integration pattern before any UI work. The API prefix migration and static file serving must work before a single component can be written. This phase is also where the 5 critical pitfalls must be pre-empted by design — AbortController pattern, DOMPurify, state machine, fetch-based SSE, MIME map.

**Delivers:** `chimera-chat.js` serving a working SvelteKit shell at `http://localhost:3210`. All API routes working at `/api/*`. Test files updated. Development workflow (two-terminal + Vite proxy) confirmed.

**Addresses:** MIME type handling (#4), API namespace separation, SPA routing, development workflow.

**Avoids:** Over-engineering (Pitfall #15 — vanilla HTML phase should be strictly scoped to 1 HTML + 1 CSS + 1 JS, max 500 LOC, no build step, no routing).

**Research flag:** Standard patterns — skip `/gsd:research-phase`. Node.js static serving and SvelteKit adapter-static are both well-documented.

### Phase 2: Core Chat Loop

**Rationale:** The core value of the product is sending messages and receiving streaming AI responses. All subsequent features depend on this working correctly. This is where the most critical pitfalls must be implemented: fetch-based SSE parser, AbortController lifecycle, DOMPurify sanitization, two-mode markdown rendering, state machine design.

**Delivers:** Type a message → see AI response stream in with markdown rendering, syntax-highlighted code blocks with copy buttons, stop/cancel button, loading/thinking indicator, error display, dark mode.

**Uses:** fetch + ReadableStream, Svelte 5 runes ($state ChatState class), marked + streaming-markdown + highlight.js + DOMPurify, shadcn-svelte Button/Input/ScrollArea.

**Implements:** api/client.ts, state/streaming.svelte.ts, state/chat.svelte.ts, ChatInput, ChatMessage components.

**Avoids:** EventSource pitfall (#1), XSS pitfall (#2), memory leak pitfall (#3), state machine deadlock (#5), broken streaming markdown (#10), 5-15s inference dead silence (#13).

**Research flag:** Streaming + runes integration is less documented than runes alone (ARCHITECTURE.md notes MEDIUM-HIGH confidence). May benefit from a quick `/gsd:research-phase` focused on Svelte 5 runes patterns for streaming state.

### Phase 3: Synapse Workflow Visualization

**Rationale:** This is Chimera's primary differentiator — no competitor has autonomous workflow visualization. It requires Phase 2's streaming infrastructure to work, then adds the ActivityPanel that interprets the richer SSE event types (synapse_*, task_*, tool). Interactive Q&A cards make the backend's planning phase visible and user-controllable.

**Delivers:** Full Synapse workflow display: real-time task checklist with tool call sub-items, interactive Q&A cards for planning questions, workflow cancellation via `synapse_escalate`. Session sidebar with new/switch/delete.

**Uses:** ActivityPanel.svelte, ActivityEvent.svelte components; `hasSynapseActivity` derived state; `synapse_question`, `synapse_answer`, `task_start`, `task_done`, `tasks_complete`, `tool` SSE events; shadcn-svelte Sheet (sidebar), Dialog.

**Implements:** The `currentEvents: $state<StreamEvent[]>` array from ChatState drives the entire ActivityPanel.

**Avoids:** State machine deadlock (#5) — this phase is where the explicit FSM becomes critical because Synapse events can arrive out of order or be skipped on error.

**Research flag:** Interactive Q&A card UX has no strong prior art in AI chat UIs. May benefit from `/gsd:research-phase` to find patterns from form-driven wizards or step-by-step onboarding flows.

### Phase 4: Knowledge + Polish

**Rationale:** Knowledge management (document upload, RAG browser) and developer experience polish (keyboard shortcuts, health indicators, session persistence) are valuable but do not block the core experience. Implemented last because they touch the most components and benefit from the stable foundation of Phases 1-3.

**Delivers:** Drag-and-drop document upload with progress indicator, knowledge base browser (list/search/delete), system health status bar, keyboard shortcuts (Ctrl+N, Escape, Ctrl+/), session persistence via `sessionStorage` (survive page refresh), responsive layout for tablet.

**Uses:** `POST /api/documents/upload`, `GET /api/documents`, `GET /api/health?deep=true`; shadcn-svelte Tooltip; `IntersectionObserver` for lazy syntax highlighting.

**Avoids:** DOM explosion from long conversations (#6) — implement message capping (last 50) or virtual scrolling; auto-scroll fighting user scroll (#7) — track scroll position, show "Scroll to bottom" button; losing messages on navigation (#11) — sessionStorage persistence.

**Research flag:** Document upload API endpoints (`/api/documents`) may need verification against the actual RAG stack implementation. Standard patterns otherwise — skip `/gsd:research-phase` unless endpoint structure is unclear.

### Phase Ordering Rationale

- Phases are ordered by strict dependency: static serving (1) → streaming core (2) → differentiator layer (3) → polish (4)
- Critical pitfalls are front-loaded: the 5 critical pitfalls (EventSource, XSS, memory leaks, state machine, streaming markdown) must be designed-in during Phases 1-2 because retrofitting them requires touching every call site
- The Synapse visualization (Phase 3) is deliberately not in Phase 2 despite being a differentiator — it requires proven SSE state management before adding a second UI layer interpreting the same event stream
- Knowledge management is Phase 4 not Phase 2 because RAG already works via the backend; the frontend for it is pure UI work with no architectural dependencies

### Research Flags

Phases needing deeper research during planning:
- **Phase 2:** Svelte 5 runes + streaming state integration — well-documented in isolation, less documented together. Specifically: reactive class pattern with `$state` in `.svelte.ts` files, `$effect` for SSE side effects.
- **Phase 3:** Interactive Q&A UX patterns — no strong AI chat precedent. Consider researching wizard/step UI patterns for the synapse_question interaction cards.
- **Phase 4:** RAG stack document API surface — confirm `/api/documents` endpoints exist and match expected request/response shapes before building the upload/browser UI.

Phases with standard patterns (skip `/gsd:research-phase`):
- **Phase 1:** Node.js static file serving + SvelteKit adapter-static + Vite proxy — fully documented, Open WebUI validates this exact pattern.
- **Phase 4 (keyboard shortcuts):** Standard DOM event handling, well-documented.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All library versions verified via npm. Open WebUI provides real-world validation of SvelteKit + adapter-static. SSE consumption pattern verified against Chimera source. |
| Features | HIGH | Cross-referenced against 6 production AI chat UIs. Backend capability verification via direct source code analysis. Competitive table is current as of 2026-03-12. |
| Architecture | HIGH | Based on direct analysis of `chimera-chat.js` (355 lines) and `chimera-orchestrator.js` (648 lines). Integration pattern validated by Open WebUI precedent. One caveat: Svelte 5 runes + streaming is MEDIUM-HIGH (newer pattern). |
| Pitfalls | HIGH | All 5 critical pitfalls backed by CVEs, open-source issue trackers, or MDN documentation. Phase warnings are grounded in Chimera's specific constraints (9B model latency, POST-based SSE, no-framework Node.js server). |

**Overall confidence:** HIGH

### Gaps to Address

- **`/api/documents` endpoint surface**: FEATURES.md and ARCHITECTURE.md reference document upload and browse endpoints (`POST /api/documents/upload`, `GET /api/documents`). These are not in `chimera-chat.js` — they are likely in the RAG stack. Confirm the actual API contract before building Phase 4 upload/browser UI.

- **Session listing endpoint**: FEATURES.md notes "needs new endpoint for listing/loading sessions." The current `/sessions/:id/stats` and `/sessions/:id/logs` endpoints exist but there is no `GET /sessions` list endpoint. A sessions list API will need to be added to `chimera-chat.js` for the sidebar conversation history feature.

- **Svelte 5 runes + streaming state patterns**: The architecture's reactive class pattern (`class ChatState { messages = $state([]) }` in `.svelte.ts` files) is the current recommendation but has less community documentation than the older store-based pattern. Validate during Phase 2 implementation and adjust if the pattern has edge cases with the SSE lifecycle.

- **`sessionStorage` vs backend persistence for messages**: Phase 4 defers persistent conversation history to post-MVP, using `sessionStorage` for tab-lifetime persistence. If users want history across browser sessions, a `/sessions/:id/messages` endpoint will need to be added. Flag this as a v2 feature during requirements definition.

---

## Sources

### Primary (HIGH confidence)

- Chimera source code: `chimera-chat.js`, `chimera-orchestrator.js`, `mcp-chimera-gateway/index.js`, `mcp-chimera-synapse/index.js` — direct analysis
- Open WebUI architecture: https://deepwiki.com/open-webui/open-webui/2-architecture
- Open WebUI dev setup: https://deepwiki.com/open-webui/open-webui/17.1-development-environment-setup
- SvelteKit adapter-static docs: https://svelte.dev/docs/kit/adapter-static
- npm verified versions: svelte@5.53.9, @sveltejs/kit@2.53.4, tailwindcss@4.2.1, shadcn-svelte@1.1.0, bits-ui@2.16.3, adapter-static@3.0.10, marked@17.0.4
- MDN EventSource documentation: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- Chrome AI rendering best practices: https://developer.chrome.com/docs/ai/render-llm-responses
- Open WebUI features docs: https://docs.openwebui.com/features/

### Secondary (MEDIUM confidence)

- streaming-markdown library: https://github.com/thetarnav/streaming-markdown
- Open WebUI issue #15189 (frontend deadlock): https://github.com/open-webui/open-webui/issues/15189
- Svelte 5 state management patterns: https://www.loopwerk.io/articles/2025/svelte-5-stores/
- AnythingLLM package.json: fetched via GitHub API (dependency tree analysis)
- Dark mode FOUC solutions: https://notanumber.in/blog/fixing-react-dark-mode-flickering

### Security (HIGH confidence — CVEs)

- CVE-2026-22813 (OpenCode XSS via markdown): https://www.pointguardai.com/ai-security-incidents/opencode-ai-ui-turns-chat-output-into-code-cve-2026-22813
- DeepSeek XSS via markdown: https://n45ht.or.id/blog/hacking-ai-with-markdown-how-we-triggered-xss-in-deepseeks-chat/
- OWASP LLM05:2025 Insecure Output Handling: https://instatunnel.my/blog/llm-insecure-output-handling-when-ai-generated-code-attacks-you

---

*Research completed: 2026-03-12*
*Ready for roadmap: yes*
