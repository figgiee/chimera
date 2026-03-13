---
phase: 03-tool-synapse-visualization
plan: 01
subsystem: ui
tags: [svelte5, typescript, sse, tool-calls, synapse, runes, chat-store]

# Dependency graph
requires:
  - phase: 02-core-chat-loop
    provides: ChatStore class, Message interface, SSEEventMap, streamChat SSE client
provides:
  - ToolCall, ToolCallStatus types with id, tool, args, result, error, hadError, status, startedAt, durationMs
  - SynapseState, SynapsePhase, QACard, TaskItem types for Synapse workflow tracking
  - Message.role extended to include 'synapse'; Message.toolCalls and Message.synapseState optional fields
  - SSEEventMap extended with synapse_start, synapse_question, synapse_answer, task_start, task_done, tasks_complete
  - ChatStore.pendingToolCalls buffer — accumulates ToolCall objects, attached to assistant message on done
  - ChatStore.activeSynapseMessageId — tracks live synapse message for in-place reactive updates
  - ChatStore.updateSynapseMessage private helper — immutable spread-based state updater
  - ChatStore SSE handlers for all 11 event types including find_tool filtering
affects:
  - 03-02 (tool call UI components consume Message.toolCalls)
  - 03-03 (synapse UI components consume Message.synapseState and role:'synapse')

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-reactive instance fields for buffers (pendingToolCalls, activeSynapseMessageId) — avoids reactive overhead on transient state"
    - "Private arrow-function helper (updateSynapseMessage) encapsulates find-update-spread pattern for in-place message mutation"
    - "Spread-based immutable updates for all message array mutations — required for Svelte 5 rune reactivity"
    - "find_tool SSE event filtered at ingestion layer — UI never sees internal routing events"

key-files:
  created: []
  modified:
    - web/src/lib/chat/types.ts
    - web/src/lib/chat/ChatStore.svelte.ts

key-decisions:
  - "03-01-A: pendingToolCalls is a plain non-reactive field (not $state) — it's a write-only buffer during streaming, never read by UI directly"
  - "03-01-B: find_tool SSE events filtered by tool name equality — simpler and more reliable than inspecting args/result shape"
  - "03-01-C: Synapse message gets phase:'complete' on done event as a safety fallback if tasks_complete was never received"
  - "03-01-D: durationMs set to 0 for instantly-resolved tool calls (single-event model has no separate start event)"

patterns-established:
  - "updateSynapseMessage pattern: private helper accepts (SynapseState => SynapseState) updater, handles id lookup and spread rebuild"
  - "SSE filter-at-ingestion: implementation-detail events (find_tool) stripped before they reach any UI layer"

# Metrics
duration: 2min
completed: 2026-03-13
---

# Phase 3 Plan 01: Tool + Synapse Data Layer Summary

**Typed ToolCall and SynapseState reactive data layer wired into ChatStore — buffers tool events during streaming and produces a role:'synapse' message tracking Q&A cards and task execution through SSE events.**

## Performance

- **Duration:** ~2 min 16 sec
- **Started:** 2026-03-13T03:20:21Z
- **Completed:** 2026-03-13T03:22:37Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Defined six new exported types (ToolCall, ToolCallStatus, SynapseState, SynapsePhase, QACard, TaskItem) and extended Message with role:'synapse', optional toolCalls, and optional synapseState
- Extended SSEEventMap with six new event shapes (synapse_start, synapse_question, synapse_answer, task_start, task_done, tasks_complete)
- Wired ChatStore to handle all 11 SSE event types: buffers ToolCall objects in pendingToolCalls during the request, attaches them to the assistant message on done, manages a role:'synapse' message lifecycle through start/Q&A/task/complete phases using immutable spread updates

## Task Commits

1. **Task 1: Extend types.ts with tool call and Synapse types** - `c215c5f` (feat)
2. **Task 2: Wire ChatStore to handle tool and Synapse SSE events** - `bcbed94` (feat)

**Plan metadata:** _(committed with docs commit below)_

## Files Created/Modified

- `web/src/lib/chat/types.ts` - Added ToolCall, SynapseState, QACard, TaskItem types; extended Message with role:'synapse'/toolCalls/synapseState; extended SSEEventMap with 6 new event types
- `web/src/lib/chat/ChatStore.svelte.ts` - Added pendingToolCalls buffer, activeSynapseMessageId tracker, updateSynapseMessage helper, and SSE handlers for all tool/synapse/task events

## Decisions Made

- **03-01-A:** pendingToolCalls is a plain (non-reactive) instance field — it's a write-only buffer during streaming, never read by UI directly, so $state overhead is unnecessary
- **03-01-B:** find_tool SSE events filtered by `d.tool === 'find_tool'` equality — simpler and more reliable than inspecting args/result shape heuristics
- **03-01-C:** Synapse message phase is set to 'complete' on the done event as a safety fallback in case tasks_complete was never emitted by the server
- **03-01-D:** durationMs is set to 0 for immediately-resolved tool calls since the single-event SSE model has no separate start event to measure from

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Minor: IDE linter flagged unsorted imports on first write of ChatStore.svelte.ts. Fixed immediately before svelte-check (sorted alphabetically: SSEClient before types, ChatStatus before Message before SynapseState before ToolCall).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02 can now build ToolCallChip/ToolCallList components using Message.toolCalls — the data structure is fully typed and populated
- Plan 03 can now build the SynapsePanel component using role:'synapse' messages and Message.synapseState — Q&A cards and task list are structurally complete
- svelte-check passes zero errors; existing user/assistant/error flows are unaffected

---
*Phase: 03-tool-synapse-visualization*
*Completed: 2026-03-13*

## Self-Check: PASSED
