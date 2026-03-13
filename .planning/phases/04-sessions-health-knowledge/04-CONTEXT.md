# Phase 4: Sessions, Health + Knowledge - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can manage multiple conversations from a sidebar, see system health at a glance in a top bar, and upload and browse documents in the knowledge base via a sidebar tab. Session persistence, document CRUD, and health polling complete the product for v1.0.

</domain>

<decisions>
## Implementation Decisions

### Session sidebar
- Collapsible sidebar (toggle open/closed, chat area expands when closed)
- Each session row shows: auto-generated title + relative timestamp ("2h ago")
- Sessions grouped by time (Today, Yesterday, etc.)
- Delete: hover reveals trash icon, clicking turns row into inline "Delete?" confirmation (no modal)
- New chat button at top of sidebar

### Claude's Discretion (Sessions)
- Session title generation approach (first message truncation vs AI summary)
- Sidebar collapse animation and toggle button placement
- Default sidebar state (open vs closed) on first load

### Health bar
- Top bar spanning full width above the chat area
- Shows colored dot indicators for LM Studio, RAG, and Search (green = healthy, red = unhealthy)
- Unhealthy state shows red dot + inline text (e.g., "LM Studio offline")
- Displays currently loaded model name
- "Local" privacy badge in the bar

### Claude's Discretion (Health)
- Polling interval for health checks
- Privacy badge placement within the top bar
- Transition/animation when health status changes

### Knowledge management
- Lives as a second tab in the session sidebar (toggle between Sessions and Knowledge)
- Drag-and-drop upload supported
- Document list in sidebar with per-item metadata

### Claude's Discretion (Knowledge)
- Drop zone behavior (full-window vs sidebar-only)
- Document list metadata per item (name + size + date vs name + type icon + date)
- Search approach (client-side filter vs backend search — depends on expected volume)
- Upload progress indicator style

### Memory recall indicator
- Small brain/memory icon next to the assistant name in the message header
- Only shown when relevant (not on every message)
- Tooltip on hover explains what was recalled

### Claude's Discretion (Memory)
- Tooltip content (generic vs memory source hint)
- Trigger mechanism (based on backend SSE event support)
- Icon choice and sizing

</decisions>

<specifics>
## Specific Ideas

- Sidebar tab pattern (Sessions | Knowledge) keeps everything accessible without leaving chat
- Delete confirmation is inline, not modal — similar to Slack's message delete UX
- Health bar is informational, not blocking — red indicators inform but don't prevent chatting
- Memory icon should be subtle enough to not distract but noticeable enough to build trust in the system's memory capabilities

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-sessions-health-knowledge*
*Context gathered: 2026-03-13*
