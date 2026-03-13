# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-12)

**Core value:** User says what they want in plain language, framework handles the rest
**Current focus:** Phase 4 complete — all phases done, v1.0 feature complete

## Current Position

Phase: 4 of 4 (Sessions, Health + Knowledge)
Plan: 3 of 3 in current phase
Status: Phase complete — all phases complete
Last activity: 2026-03-13 — Completed 04-03 (knowledge sidebar + memory recall indicator)

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 10
- Average duration: ~3.5 min/plan
- Total execution time: ~35 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-static-shell | 2 | ~8 min | ~4 min |
| 02-core-chat-loop | 3 | ~11 min | ~3.7 min |
| 03-tool-synapse-visualization | 3 | ~7 min | ~2.3 min |
| 04-sessions-health-knowledge | 3/3 | ~8 min | ~2.7 min |

**Recent Trend:**
- Last 5 plans: 03-03, 04-01, 04-02, 04-03
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
- [04-02-A]: resetSession() is single method for new chat (no arg) and switch session (with ID) — loadSession() delegates to it
- [04-02-B]: resetSession() aborts in-flight fetch before clearing state — prevents stale SSE events landing in wrong session
- [04-02-C]: RAG and Search share same errors[] parse but render as separate dots — matches user's three-indicator locked decision
- [04-02-D]: Collapsed sidebar toggle is a fixed-position button outside aside element — stays clickable at max-width 0
- [04-02-E]: Sidebar open by default per RESEARCH.md discretion recommendation
- [04-03-A]: dragCount counter (not boolean) for drag-and-drop state — prevents flicker from child element drag events
- [04-03-B]: Upload first file only when multiple dropped (v1 simplicity) — re-upload same file enabled by resetting input.value
- [04-03-C]: hasMemoryRecall derived from toolCalls (no backend change) — detects recall_conversation with !hadError
- [04-03-D]: Assistant name header row added above bubble to host Brain icon — natural placement, no floating/overlay needed
- [04-03-E]: Client-side document search filter — personal knowledge base is small, avoids per-keystroke API calls

### Pending Todos

None.

### Blockers/Concerns

None — all phases complete.

## Session Continuity

Last session: 2026-03-13T05:54:09Z
Stopped at: Completed 04-03-PLAN.md — knowledge sidebar + memory recall indicator
Resume file: None
