# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-12)

**Core value:** User says what they want in plain language, framework handles the rest
**Current focus:** Phase 4 — Sessions, Health + Knowledge

## Current Position

Phase: 4 of 4 (Sessions, Health + Knowledge)
Plan: 1 of 3 in current phase
Status: In progress
Last activity: 2026-03-13 — Completed 04-01 (sessions endpoints + typed API client)

Progress: [████████░░] 80%

## Performance Metrics

**Velocity:**
- Total plans completed: 9
- Average duration: ~3.7 min/plan
- Total execution time: ~33 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-static-shell | 2 | ~8 min | ~4 min |
| 02-core-chat-loop | 3 | ~11 min | ~3.7 min |
| 03-tool-synapse-visualization | 3 | ~7 min | ~2.3 min |
| 04-sessions-health-knowledge | 1/3 | ~3 min | ~3 min |

**Recent Trend:**
- Last 5 plans: 03-01, 03-02, 03-03, 04-01
- Trend: Fast — plans well-scoped, svelte-check catches issues early

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Pre-v1.0]: Use SvelteKit + adapter-static served by chimera-chat.js (Open WebUI validates this at scale)
- [Pre-v1.0]: Use fetch + ReadableStream for SSE — NOT native EventSource (Chimera uses POST-based SSE)
- [Pre-v1.0]: DOMPurify mandatory on all AI markdown output (CVE-2026-22813 documents exact attack vector)
- [Pre-v1.0]: Two-mode markdown: streaming-markdown during generation, marked + highlight.js after done event
- [01-02]: Tailwind v4 uses @tailwindcss/vite Vite plugin — no postcss.config.js, no tailwind.config file
- [01-02]: shadcn-svelte CLI (v1.1.1) requires interactive mode — create components.json + theme manually for CI/automation contexts
- [01-02]: Zinc oklch palette used for dark theme (bg-background maps to oklch(0.141 0.005 285.823) in dark mode)
- [02-01]: ReadableStreamDefaultReader used instead of for-await on ReadableStream (TypeScript DOM lib limitation)
- [02-01]: AbortError from stop() silently returns — does not produce error UI or error message
- [02-02-A]: $derived used for timestamp in MessageBubble (avoids state_referenced_locally warning)
- [02-02-B]: Code copy buttons injected imperatively via injectCopyButtons() after innerHTML swap
- [02-02-C]: ChatWindow auto-scroll effect tracks messages.length AND chatStore.status
- [02-03-A]: mode-watcher v1.x uses rune-based mode.current, not Svelte store $mode
- [02-03-B]: highlight.js dark theme via .dark scoped CSS overrides (not CSS layers)
- [03-01-A]: pendingToolCalls is a plain non-reactive field — write-only buffer during streaming, never read by UI
- [03-01-B]: find_tool SSE events filtered by tool name equality at ingestion — UI never sees internal routing events
- [03-01-C]: Synapse message phase set to 'complete' on done event as safety fallback if tasks_complete not received
- [03-01-D]: durationMs is 0 for single-event tool calls (no separate start event in SSE model)
- [03-02-A]: untrack() used for hadError prop at $state init — avoids state_referenced_locally Svelte 5 warning
- [03-02-B]: Tool call blocks placed inside the assistant bubble wrapper above prose div — one bubble, tools then text
- [03-03-A]: CheckCircle2 and MessageCircleQuestion are alias re-exports in lucide-svelte v0.577.0 (to circle-check.svelte and message-circle-question-mark.svelte) — named imports work as documented
- [03-03-B]: ChatWindow dispatches on message.role to select renderer — SynapsePanel for 'synapse', MessageBubble for all other roles
- [03-03-C]: SynapsePanel cancel (SYN-04) uses existing InputBar stop button — no new cancel UI needed inside panel
- [04-01-A]: GET /api/sessions uses exact pathname match checked before parameterized :id routes — avoids ambiguity
- [04-01-B]: DELETE /api/sessions/:id placed after /stats and /logs handlers — regex /api/sessions/([^/]+) would match all three
- [04-01-C]: fetchHealth returns degraded status object on network failure (never throws) — callers can always render UI
- [04-01-D]: fetchModel returns 'Unknown' on any LM Studio failure (never throws) — graceful degradation for model display
- [04-01-E]: RAG_BASE is a direct URL (not proxied) — document endpoints hit the RAG stack on port 8080 directly

### Pending Todos

None.

### Blockers/Concerns

- [Phase 4 - RESOLVED by 04-01]: GET /api/sessions endpoint now exists in chimera-chat.js
- [Phase 4]: /api/documents endpoints (upload, list, delete) are in the RAG stack, not chimera-chat.js — confirm API contract before building knowledge UI

## Session Continuity

Last session: 2026-03-13
Stopped at: Completed 04-01-PLAN.md — sessions endpoints + typed API client
Resume file: None
