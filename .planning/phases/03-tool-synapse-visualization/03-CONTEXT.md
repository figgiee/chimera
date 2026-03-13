# Phase 3: Tool + Synapse Visualization - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Render tool calls and Synapse workflow progress inline in the chat UI. Users see every tool call Chimera makes (name, status, duration, arguments, result) and watch Synapse workflows unfold in real-time with Q&A cards, task checklist, and cancel control. Creating new tool types, modifying backend SSE events, or adding new workflow modes are out of scope.

**SSE events to visualize:**
- `tool` — name, args, result, hadError
- `synapse_start` — session_id, mode, status
- `synapse_question` — area_id, text
- `synapse_answer` — area_id, answer
- `task_start` — id, description
- `task_done` — id, response
- `tasks_complete` — count, message
- `intent` — mode
- `loop` — reason, signature

</domain>

<decisions>
## Implementation Decisions

### Tool call blocks
- Collapsed by default — shows tool name, status icon, and elapsed time
- User clicks to expand and see arguments and truncated result
- "Show more" button inside expanded view to see full output
- Placement relative to message text: Claude's discretion (inline vs grouped)

### Synapse workflow panel
- Panel location (inline vs side panel): Claude's discretion — pick what works best with existing layout
- Phase transition visualization (stepper vs label): Claude's discretion
- Post-completion behavior (collapse vs persist): Claude's discretion
- Cancel button confirmation behavior: Claude's discretion

### Q&A cards
- Question presentation format: Claude's discretion (card-based vs main input bar)
- Answered state display: Claude's discretion (paired Q/A vs collapsed)
- Skip behavior: Claude's discretion
- Question count/progress: Claude's discretion — backend may not know total upfront

### Task checklist
- Detail level per task: Claude's discretion (name+status vs name+status+preview)
- Overall progress indicator: Claude's discretion (bar, count, or none)
- Failed task display: Claude's discretion
- Active/running task visual treatment: Claude's discretion (spinner, highlight, or both)

### Claude's Discretion
User delegated nearly all visual design decisions to Claude. Key areas of flexibility:
- Tool block placement and visual treatment (status icons, colors, borders)
- Error display strategy (auto-expand on error vs same as success)
- Synapse panel location and layout
- Phase transition visuals
- Q&A interaction pattern and state management
- Task checklist detail level and progress indicators
- All spacing, typography, and animation choices

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User trusts Claude to make good design decisions across all four areas based on research into existing patterns (e.g., how ChatGPT, Cursor, or similar tools visualize tool calls and multi-step workflows).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-tool-synapse-visualization*
*Context gathered: 2026-03-12*
