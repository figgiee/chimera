---
phase: 03-tool-synapse-visualization
plan: 02
subsystem: ui
tags: [svelte, svelte5, tool-calls, collapsible, lucide-svelte, tailwind]

# Dependency graph
requires:
  - phase: 03-01
    provides: ToolCall type in types.ts, toolCalls attached to Message
provides:
  - Collapsible ToolCallBlock.svelte component covering TOOL-01, TOOL-02, TOOL-03
  - MessageBubble renders tool call blocks above assistant markdown text
affects: [03-03-synapse-visualization, phase-4]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "untrack() used for reading prop values at $state init to silence state_referenced_locally warning"
    - "Lucide icons used for status indicators (Loader2/Check/X/ChevronRight)"
    - "$effect + setInterval for live elapsed timer; cleanup via return function"

key-files:
  created:
    - web/src/lib/components/ToolCallBlock.svelte
  modified:
    - web/src/lib/components/MessageBubble.svelte

key-decisions:
  - "03-02-A: untrack() used for hadError prop at $state init — avoids state_referenced_locally Svelte 5 warning"
  - "03-02-B: Tool call blocks placed inside the assistant bubble wrapper above prose div — one bubble, tools then text"

patterns-established:
  - "ToolCallBlock: collapsed by default (except errors); expand on click; show-more for long results"
  - "Elapsed timer: $effect + setInterval with return cleanup, only when status=running"

# Metrics
duration: 2min
completed: 2026-03-13
---

# Phase 3 Plan 02: Tool Call Block Component Summary

**Svelte 5 collapsible ToolCallBlock with spinner/check/x status icons, live elapsed timer, truncated result with Show more/less, auto-expand on error, wired into MessageBubble above assistant text**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-13T03:25:19Z
- **Completed:** 2026-03-13T03:27:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created ToolCallBlock.svelte: collapsed row shows status icon + tool name + duration; expands to show args, result, and error
- Running tools show live elapsed counter via $effect + setInterval with proper cleanup
- Result truncation at 300 chars with Show more/Show less toggle
- Error tool calls auto-expand and use destructive border/text styling
- MessageBubble updated with import and conditional {#each} rendering tool calls above markdown

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ToolCallBlock.svelte** - `32ccef9` (feat)
2. **Task 2: Wire ToolCallBlock into MessageBubble** - `41083e5` (feat)

## Files Created/Modified
- `web/src/lib/components/ToolCallBlock.svelte` - Collapsible tool call display with all three statuses, timing, args, result, show-more
- `web/src/lib/components/MessageBubble.svelte` - Added ToolCallBlock import and conditional render block above markdownContainer

## Decisions Made
- **03-02-A**: Used `untrack(() => toolCall.hadError)` for the `$state` initial value. Svelte 5 emits `state_referenced_locally` when a prop is referenced directly in `$state()` initializer. `untrack` reads the prop value at mount without subscribing to reactive tracking.
- **03-02-B**: Tool call blocks placed inside the existing assistant bubble div above the prose div — keeps tools and response in one visual bubble rather than separate containers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed state_referenced_locally Svelte 5 warning for expanded state init**
- **Found during:** Task 1 (ToolCallBlock.svelte creation)
- **Issue:** Initializing `$state(toolCall.hadError)` triggered Svelte 5 compiler warning about prop reference captured at init without reactive tracking
- **Fix:** Wrapped in `untrack(() => toolCall.hadError)` — reads the value at mount, no reactive tracking needed since expanded is intentionally one-shot initialized
- **Files modified:** web/src/lib/components/ToolCallBlock.svelte
- **Verification:** svelte-check 0 errors 0 warnings
- **Committed in:** 32ccef9 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — Svelte 5 warning fix)
**Impact on plan:** Minor fix required for clean compilation. No scope creep.

## Issues Encountered
- Svelte 5 `state_referenced_locally` warning for prop reference at `$state()` init. First attempted extracting to a local variable (same warning). Resolved with `untrack()` from Svelte.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ToolCallBlock and MessageBubble integration complete — tool calls render in the chat UI
- Plan 03-03 (Synapse visualization) can now build the SynapseBlock component using the same pattern
- No blockers

## Self-Check: PASSED

---
*Phase: 03-tool-synapse-visualization*
*Completed: 2026-03-13*
