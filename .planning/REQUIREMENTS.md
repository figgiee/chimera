# Requirements: Chimera Web UI (v1.0)

**Milestone:** v1.0 Web UI
**Created:** 2026-03-12
**Source:** Research (FEATURES.md, STACK.md, ARCHITECTURE.md, PITFALLS.md) + user scoping

---

## v1.0 Requirements

### Core Chat Loop

- [ ] **CHAT-01**: User can type a message and send it (auto-growing textarea, Enter to send, Shift+Enter for newline)
- [ ] **CHAT-02**: User sees assistant response tokens streaming in real-time via SSE
- [ ] **CHAT-03**: User sees markdown rendered correctly (headings, bold, italic, lists, tables, links, inline code)
- [ ] **CHAT-04**: User sees code blocks with syntax highlighting and per-block copy button
- [ ] **CHAT-05**: User can copy an entire assistant message with one click
- [ ] **CHAT-06**: User can stop/cancel a generation in progress (closes SSE connection)
- [ ] **CHAT-07**: User sees a thinking/loading indicator between sending and first token
- [ ] **CHAT-08**: User sees inline error messages with retry button when requests fail (timeout, 429, server error)
- [ ] **CHAT-09**: User sees the UI in dark mode by default, can toggle to light mode, preference persists in localStorage
- [ ] **CHAT-10**: User can use the UI comfortably on desktop and tablet breakpoints (collapsible sidebar on tablet)

### Tool Call Display

- [ ] **TOOL-01**: User sees inline collapsible blocks for each tool call showing tool name, status icon (spinner/checkmark/x), and duration
- [ ] **TOOL-02**: User can expand a tool call block to see the tool's arguments and truncated result
- [ ] **TOOL-03**: User can click "Show more" on long tool results to see the full output

### Synapse Workflow Visualization

- [ ] **SYN-01**: User sees a workflow progress panel when Synapse activates, showing current phase (Q&A / Planning / Executing)
- [ ] **SYN-02**: User sees Q&A pairs rendered as structured cards (question + answer) during the clarification phase
- [ ] **SYN-03**: User sees a task checklist with live status (pending/running/done/failed) during execution
- [ ] **SYN-04**: User can cancel a running workflow via a stop button

### Session Management

- [ ] **SESS-01**: User sees a sidebar listing their conversations with timestamps and last-message preview
- [ ] **SESS-02**: User can create a new chat session
- [ ] **SESS-03**: User can switch between existing sessions
- [ ] **SESS-04**: User can delete a conversation

### System Health & Identity

- [ ] **HLTH-01**: User sees a status bar showing LM Studio, RAG, and Search health (green/red indicators)
- [ ] **HLTH-02**: User sees a "Local" privacy badge indicating no data leaves the machine
- [ ] **HLTH-03**: User sees which model is currently loaded in LM Studio

### Knowledge Management

- [ ] **KNOW-01**: User can upload documents to the knowledge base via drag-and-drop
- [ ] **KNOW-02**: User can browse, search, and delete documents in the knowledge base
- [ ] **KNOW-03**: User sees a subtle indicator when the assistant recalls from conversation memory

---

## Future Requirements (Deferred)

- [ ] **DEV-01**: Keyboard shortcuts (Ctrl+N, Escape, Ctrl+Shift+C, help overlay)
- [ ] **DEV-02**: Slash commands with autocomplete (/web, /file, /remember, /workflow)
- [ ] **FMT-01**: LaTeX/KaTeX rendering for math expressions
- [ ] **SYN-05**: Workflow escalation with reason field for mid-workflow redirects
- [ ] **SESS-05**: Conversation rename
- [ ] **SESS-06**: Message editing and regeneration
- [ ] **EXPORT-01**: Export conversations to markdown file

## Out of Scope

| Feature | Reason |
|---------|--------|
| Artifacts / Canvas | Enormous engineering effort, duplicates editor |
| Voice input/output | Not relevant for local developer tool |
| Image generation | Requires separate GPU/model infrastructure |
| Multi-model switching | LM Studio handles this; showing loaded model is sufficient |
| User authentication | Single-user local tool, auth adds no security value |
| Plugin marketplace | Core must be solid first, v3+ concern |
| Chat sharing / public links | Chimera is private by design |
| Mobile-first responsive | Requires desktop hardware (local GPU) |
| Mermaid diagram rendering | Rare use case, defer to v2 |
| File tree browser | AI navigates files through tool calls |

---

## Traceability

| Requirement | Phase |
|-------------|-------|
| CHAT-01..10 | TBD |
| TOOL-01..03 | TBD |
| SYN-01..04 | TBD |
| SESS-01..04 | TBD |
| HLTH-01..03 | TBD |
| KNOW-01..03 | TBD |

---

*27 requirements across 6 categories*
