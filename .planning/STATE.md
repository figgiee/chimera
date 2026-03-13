# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-12)

**Core value:** User says what they want in plain language, framework handles the rest
**Current focus:** Phase 4 — Sessions, Health + Knowledge

## Current Position

Phase: 4 of 4 (Sessions, Health + Knowledge)
Plan: 0 of 3 in current phase
Status: Ready to plan
Last activity: 2026-03-13 — Phase 3 Tool + Synapse Visualization verified and complete

Progress: [████████░░] 75%

## Performance Metrics

**Velocity:**
- Total plans completed: 8
- Average duration: ~4 min/plan
- Total execution time: ~30 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-static-shell | 2 | ~8 min | ~4 min |
| 02-core-chat-loop | 3 | ~11 min | ~3.7 min |
| 03-tool-synapse-visualization | 3 | ~7 min | ~2.3 min |

**Recent Trend:**
- Last 5 plans: 02-02, 02-03, 03-01, 03-02, 03-03
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

### Pending Todos

None.

### Blockers/Concerns

- [Phase 4]: GET /api/sessions list endpoint does not exist yet — must be added to chimera-chat.js before session sidebar can be built
- [Phase 4]: /api/documents endpoints (upload, list, delete) are in the RAG stack, not chimera-chat.js — confirm API contract before building knowledge UI

## Session Continuity

Last session: 2026-03-13
Stopped at: Phase 3 verified (4/5 must-haves + 1 gap fixed) — ready for Phase 4 planning
Resume file: None
