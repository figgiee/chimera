---
phase: 03-tool-synapse-visualization
verified: 2026-03-13T03:30:25Z
status: gaps_found
score: 4/5 must-haves verified
gaps:
  - truth: "User sees clarification questions rendered as Q&A cards and a live task checklist with per-task status (pending/running/done/failed)"
    status: partial
    reason: "TaskItem.status type only includes pending or running or done. The failed variant is absent from the type definition. TaskChecklist.svelte has no corresponding render branch — a failed task falls through to the CheckCircle2 done icon."
    artifacts:
      - path: "web/src/lib/chat/types.ts"
        issue: "TaskItem.status union is pending|running|done only — failed variant missing"
      - path: "web/src/lib/components/TaskChecklist.svelte"
        issue: "Icon block handles pending/running/else(done) — no explicit failed branch with error icon"
    missing:
      - "Add failed to TaskItem.status union type in types.ts"
      - "Add else-if task.status === failed branch in TaskChecklist.svelte with XCircle text-destructive icon"
---

# Phase 3: Tool + Synapse Visualization Verification Report

**Phase Goal:** Users can see every tool call Chimera makes (name, status, duration, arguments, result) and watch Synapse workflows unfold in real-time as a structured progress panel with Q&A cards, task checklist, and cancel control
**Verified:** 2026-03-13T03:30:25Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User sees an inline collapsible block for each tool call showing tool name, status icon (spinner/check/x), and elapsed time | VERIFIED | ToolCallBlock.svelte lines 59-89: button row renders Loader2/Check/X icon, tool name span, displayDuration ms, ChevronRight; wired into MessageBubble via each over message.toolCalls |
| 2 | User can expand a tool call block to read its arguments and a truncated result, and click Show more to see full output | VERIFIED | ToolCallBlock.svelte lines 92-127: expanded block renders args pre, result pre with 300-char TRUNCATE_LIMIT, Show more/Show less toggle |
| 3 | User sees a workflow progress panel appear when Synapse activates, showing current phase | VERIFIED | ChatStore handles synapse_start by inserting role:synapse message; ChatWindow dispatches to SynapsePanel; SynapsePanel renders three-phase indicator with phaseOrder visual hierarchy |
| 4 | User sees Q&A cards and a live task checklist with per-task status (pending/running/done/failed) | PARTIAL | QACard and TaskChecklist render pending/running/done correctly. The failed status variant is absent from TaskItem.status type and TaskChecklist has no dedicated failed icon branch |
| 5 | User can cancel a running Synapse workflow via a stop button and the UI returns to idle | VERIFIED | InputBar shows Square stop button when isBusy; handleStop calls chatStore.stop(); stop() aborts AbortController, clears activeSynapseMessageId, sets status=idle |

**Score:** 4/5 truths verified (Truth 4 partial — failed task status missing)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| web/src/lib/chat/types.ts | ToolCall, SynapseState, QACard, TaskItem types; Message role:synapse | VERIFIED | 179 lines; all types present; TaskItem.status union missing failed variant |
| web/src/lib/chat/ChatStore.svelte.ts | SSE handlers for all tool/synapse/task events; pendingToolCalls buffer | VERIFIED | 392 lines; all 11 event types handled; find_tool filtered at ingestion; full synapse lifecycle wired |
| web/src/lib/components/ToolCallBlock.svelte | Collapsible display with status icons, live timer, args, result, show-more | VERIFIED | 128 lines; substantive, no stubs; imported and used in MessageBubble |
| web/src/lib/components/MessageBubble.svelte | Renders ToolCallBlock list above markdown for assistant messages | VERIFIED | 211 lines; imports ToolCallBlock; conditional each block at lines 158-163 |
| web/src/lib/components/QACard.svelte | Q&A pair card with question icon, answer, waiting spinner | VERIFIED | 25 lines; renders card props; Loader2 spinner when card.answer is falsy |
| web/src/lib/components/TaskChecklist.svelte | Task list with pending/running/done/failed status icons and progress count | PARTIAL | 45 lines; pending/running/done handled; failed status absent from type and component |
| web/src/lib/components/SynapsePanel.svelte | Inline workflow panel composing QACard + TaskChecklist with phase indicator | VERIFIED | 79 lines; imports and uses both sub-components; phaseOrder map drives visual hierarchy |
| web/src/lib/components/ChatWindow.svelte | Dispatches role:synapse messages to SynapsePanel | VERIFIED | 50 lines; role=synapse guard at line 40 dispatches correctly |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| ChatStore SSE tool event | pendingToolCalls buffer | push to array | WIRED | Lines 120-140 ChatStore.svelte.ts; find_tool filtered; ToolCall constructed and pushed |
| pendingToolCalls buffer | assistant Message.toolCalls | done event handler | WIRED | Lines 244-260; toolCalls spread from buffer, attached to new assistant message on done |
| Message.toolCalls | ToolCallBlock render | MessageBubble each | WIRED | MessageBubble lines 158-163; conditional on message.toolCalls?.length |
| ChatStore SSE synapse_start | role:synapse Message | push to messages | WIRED | Lines 147-165; Message with synapseState inserted, activeSynapseMessageId set |
| ChatStore SSE synapse/task events | SynapseState mutations | updateSynapseMessage | WIRED | Lines 168-228; all 5 synapse/task events handled with spread-based immutable updates |
| role:synapse message | SynapsePanel component | ChatWindow role dispatch | WIRED | ChatWindow lines 40-43 |
| InputBar stop button | chatStore.stop() | handleStop | WIRED | InputBar lines 49-51; stop() aborts SSE, clears buffers, sets idle |

---

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| TOOL-01 (inline collapsible tool call block with name, status, time) | SATISFIED | ToolCallBlock.svelte fully implements all three status states |
| TOOL-02 (expandable args and truncated result with Show more) | SATISFIED | ToolCallBlock expand section with 300-char limit and show-more toggle |
| TOOL-03 (tool blocks rendered in chat message flow) | SATISFIED | MessageBubble conditionally renders ToolCallBlock per tool call above markdown |
| SYN-01 (Synapse workflow panel with phase indicator) | SATISFIED | SynapsePanel renders three-phase indicator driven by phaseOrder map |
| SYN-02 (Q&A cards with question and answer) | SATISFIED | QACard renders with waiting spinner; ChatStore wires synapse_question/answer SSE events |
| SYN-03 (live task checklist with per-task status including failed) | PARTIAL | pending/running/done render correctly; failed status variant absent from type and component |
| SYN-04 (cancel Synapse workflow via stop button) | SATISFIED | InputBar stop button calls chatStore.stop() which aborts SSE stream and returns to idle |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | No stubs, TODOs, placeholder returns, or empty handlers found |

---

### Human Verification Required

#### 1. Tool Call Live Timer

**Test:** Trigger a slow tool call (e.g., web search). Observe the elapsed time counter in the collapsed ToolCallBlock header while the tool is running.
**Expected:** Counter increments each second while running; freezes and shows final durationMs value on completion.
**Why human:** setInterval tick cadence and reactive state behavior requires runtime observation.

#### 2. Synapse Q&A Spinner Transition

**Test:** Trigger a Synapse workflow. Observe a Q&A card immediately after the question appears, before the answer arrives.
**Expected:** Loader2 spinner visible while answer is null; spinner disappears and answer text renders when synapse_answer SSE event arrives.
**Why human:** Reactive SSE event timing requires a live server and real streaming events.

#### 3. SynapsePanel Phase Indicator Visual Hierarchy

**Test:** Watch the phase indicator (Q&A / Executing / Complete) progress through a full Synapse workflow.
**Expected:** Current phase is font-medium at full opacity; past phases are text-muted-foreground; future phases are text-muted-foreground/50 (very faint).
**Why human:** Visual contrast and Tailwind opacity rendering requires runtime observation.

---

### Gaps Summary

One gap partially blocks requirement SYN-03: the TaskItem.status type union in web/src/lib/chat/types.ts does not include a failed variant (only pending | running | done). TaskChecklist.svelte has no dedicated render branch for a failed task — the icon block uses an else fallthrough that renders CheckCircle2 (green done icon) for any non-pending, non-running status. If the Synapse server ever emits a task with status: failed, it would silently render as a green checkmark rather than an error indicator.

The fix requires two small changes: add failed to the TaskItem.status union in types.ts, and add an else-if branch in TaskChecklist.svelte rendering an XCircle icon with text-destructive styling.

All other truths and requirements are fully verified with real, substantive implementations. No stubs were found in any phase 3 file. All key data flows — SSE events to ChatStore to Message objects to UI components — are wired end-to-end.

---

_Verified: 2026-03-13T03:30:25Z_
_Verifier: Claude (gsd-verifier)_
