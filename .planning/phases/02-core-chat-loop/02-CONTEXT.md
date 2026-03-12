# Phase 2: Core Chat Loop - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Streaming chat experience: users send messages to Chimera and receive AI responses in real-time with full markdown rendering, code highlighting, stop/cancel, loading states, error handling, dark mode, and responsive layout. Tool call visualization, Synapse workflows, session management, and knowledge base are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Chat layout & density
- Bubble-style message layout — user messages right-aligned, AI messages left-aligned
- No avatars on either side — bubble alignment alone distinguishes sender
- Metadata and content width are Claude's discretion

### Input experience
- Enter sends message, Shift+Enter inserts newline
- Input area behavior, controls, and limit indicators are Claude's discretion

### Streaming & interruption
- Stop button replaces the send button during streaming (ChatGPT-style transform)
- Clicking stop keeps the partial response visible in chat as-is (no removal, no "incomplete" marker)
- Code blocks should render with syntax highlighting during streaming, not just after completion
- Whether users can queue messages during streaming is Claude's discretion (user curious if possible — evaluate during planning)

### Error & empty states
- Dark mode follows OS preference by default, with manual toggle to override (preference saved)
- Error display, empty/welcome state, and offline handling are Claude's discretion

### Claude's Discretion
- Message metadata (timestamps, model name, token stats) — pick what fits the design
- Content area max-width on large screens
- Loading indicator style during inference gap
- Auto-scroll behavior during streaming
- Streaming text rendering effect (cursor, smooth append, etc.)
- Input area growth behavior and extra controls
- Character/token limit indicator
- Error display pattern (inline vs toast)
- Empty state design (welcome message, suggestions, or blank)
- Offline/backend-down handling strategy
- Message queuing during streaming

</decisions>

<specifics>
## Specific Ideas

- Two-mode markdown rendering is already decided: streaming-markdown library during generation, marked + highlight.js + DOMPurify after done event (from PROJECT.md decisions)
- Code blocks need syntax highlighting even during streaming — not just post-completion
- fetch + ReadableStream for SSE (not native EventSource) — Chimera uses POST-based SSE
- Zinc oklch palette already established for dark theme in Phase 1

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-core-chat-loop*
*Context gathered: 2026-03-12*
