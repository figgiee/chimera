# Feature Research: Chimera Web UI

**Domain:** AI chat frontend for local-first assistant with RAG, tool use, and autonomous workflows
**Researched:** 2026-03-12
**Confidence:** HIGH (cross-referenced competitor docs, Open WebUI source, ChatGPT/Claude UX patterns, Chimera backend source)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or broken.

#### Core Chat Loop

| Feature | Why Expected | Complexity | Backend Dependency | Notes |
|---------|-------------|------------|-------------------|-------|
| Message input with send button | Fundamental. Every chat UI has this | LOW | POST /chat/stream | Auto-growing textarea; Enter to send, Shift+Enter for newline; disabled while generating |
| Streaming response display | Users expect tokens to appear in real-time, not wait for full response. Perceived as 40-60% faster even when latency is identical | MEDIUM | SSE /chat/stream (already emits all events) | Handle SSE event protocol: `event: <type>\ndata: <json>\n\n`. Render incrementally. Handle incomplete markdown blocks mid-stream |
| Markdown rendering | AI responses are markdown-heavy. Raw markdown asterisks and hashes are unreadable | MEDIUM | None (client-side) | Recommend Streamdown (built specifically for AI streaming) or react-markdown + remark-gfm. Must handle partial/unterminated blocks gracefully during streaming |
| Code blocks with syntax highlighting | Developer audience. Unhighlighted code is painful and unprofessional | MEDIUM | None (client-side) | Shiki (same engine as VS Code, best quality) over Prism/highlight.js. Support 20+ languages. Every code block needs a copy-to-clipboard button |
| Copy message / copy code | Users constantly copy AI output to their editor, terminal, or docs | LOW | None | One-click copy for full message text; per-code-block copy buttons. Show checkmark confirmation for 2 seconds |
| Stop / cancel generation | Users abort frequently (wrong prompt, too long, got what they needed). 82% of surveyed chat UIs have this | LOW | AbortController already wired in backend — `req.on('close', () => abort.abort())` | Replace send button with stop button during generation. Client just closes the SSE connection |
| Loading and thinking indicators | Users need to know the system is working, not frozen. Local models can be slow to first token | LOW | SSE `intent` event fires before first tool; `synapse_start` before workflows | Pulsing indicator between send and first token. "Thinking..." is sufficient. Do NOT show a timer or percentage |
| Error handling and inline messages | Tool failures, timeouts (5-min hard limit in backend), LLM errors happen regularly with local models | LOW | SSE `error` event type; 429 from busy session | Inline error bubble in the message flow. Retry button. Never show raw error objects |
| Dark mode as default | Developer/enthusiast audience skews heavily dark mode. Open WebUI, AnythingLLM both default dark. Looks right for a local tool | MEDIUM | None (client-side) | Dark mode is the default. Light mode as toggle. Respect `prefers-color-scheme` on first visit. Store preference in localStorage |
| Responsive layout | Must work on desktop; tablet is nice-to-have | MEDIUM | None | Desktop: fixed sidebar + chat main. Tablet: collapsible sidebar via hamburger. Phone: not a priority (local GPU tool) |
| Conversation sidebar with history | Users expect to see past conversations and switch between them. ChatGPT, Claude, Khoj, Open WebUI all have this | MEDIUM | Session management exists in backend; needs GET /sessions list endpoint | Sidebar with conversation list, timestamps, preview of last message. New chat button. Delete conversation |

#### Tool Call Display

The backend emits `tool` events via SSE for every tool call. These include: `tool` (name), `args`, `result`, and `hadError` fields.

| Feature | Why Expected | Complexity | Backend Dependency | Notes |
|---------|-------------|------------|-------------------|-------|
| Inline tool call blocks | ChatGPT, Claude, Open WebUI (three verbosity levels), AnythingLLM all show tool usage. Users trained to expect transparency | MEDIUM | `tool` SSE event: `{ type: "tool", tool: "search_web", args: {...}, result: {...}, hadError: false }` | Collapsible blocks inline in the message stream. Show tool name + status icon (spinner / checkmark / x). NOT a separate panel — inline like Claude Code |
| Tool result preview (expandable) | Users want to see what the tool returned. Builds trust, helps debug | MEDIUM | `result` field in tool events | Collapsed by default showing tool name + duration. Click to expand shows truncated result. "Show more" for long results |
| Tool call timing | Shows how long each tool took. Helps identify slow tools (web search vs file read) | LOW | Compute client-side from SSE event timestamps | Subtle badge: "1.2s". No backend changes needed |

#### Content Formatting

| Feature | Why Expected | Complexity | Backend Dependency | Notes |
|---------|-------------|------------|-------------------|-------|
| Tables | AI frequently outputs markdown tables. Must render as real HTML tables, not raw pipe syntax | LOW | None | Part of markdown renderer (GFM tables). Horizontal scroll for wide tables |
| Links (clickable) | Markdown links must open in new tab | LOW | None | `target="_blank"` with `rel="noopener noreferrer"` |
| Ordered and unordered lists | Basic markdown. Must render during streaming | LOW | None | Part of any markdown renderer |
| Bold, italic, inline code | Fundamental formatting. Missing these looks amateurish | LOW | None | Part of any markdown renderer |

---

### Differentiators (Competitive Advantage)

Features that leverage Chimera's unique backend capabilities. No competitor has these combinations.

#### Synapse Workflow Visualization (PRIMARY DIFFERENTIATOR)

The backend emits a full event sequence for Synapse workflows: `synapse_start` -> `synapse_question` / `synapse_answer` (repeated) -> `task_start` / `task_done` (repeated) -> `tasks_complete`. No competitor surfaces this kind of autonomous planning+execution flow.

| Feature | Value Proposition | Complexity | Backend Dependency | Notes |
|---------|-------------------|------------|-------------------|-------|
| Workflow progress panel | Makes Chimera's killer feature visible. When Synapse kicks in, show: current phase (Q&A / Planning / Executing), what's happening right now, what's been done | HIGH | `synapse_start`, `synapse_question`, `synapse_answer`, `task_start`, `task_done`, `tasks_complete` events | Inline expandable block that grows as events arrive. Shows phase badge, progress bar, and live step list. This is what makes Chimera different from a dumb chatbot |
| Interactive Q&A cards | Synapse asks clarifying questions before executing. Surface these as structured UI, not buried chat text | MEDIUM | `synapse_question` event; answers go back through the chat input | Render Q&A pairs as distinct cards with question text + answer displayed inline. Makes the workflow feel intentional, not opaque |
| Task list with live status | During execution phase, each task shows as pending/running/done/failed with checkmarks | MEDIUM | `task_start`, `task_done` events | Checklist display within the workflow block. Animated checkmark on completion. Expandable per-task to show what tool calls it made |
| Workflow cancel / escalate | Let users stop or redirect long-running workflows | MEDIUM | AbortController handles cancel; `synapse_escalate` endpoint exists | "Stop workflow" button visible during execution. Escalation with reason field for mid-workflow redirects |

#### Local-First Identity

| Feature | Value Proposition | Complexity | Backend Dependency | Notes |
|---------|-------------------|------------|-------------------|-------|
| System health status bar | Show that all components run locally. Builds trust, helps troubleshooting. Unique context for a local-first app | LOW | GET /health (exists), GET /health?deep=true checks LM Studio + RAG | Footer or header status strip: LM (green/red), RAG (green/red), Search (green/red). Click component for details. Poll every 30s |
| No-cloud / privacy indicator | Clear visual signal that no data leaves the machine. Differentiates from ChatGPT/Claude | LOW | None | Small badge or header text. "Local" or "Private" with an icon. Trust signal for the target audience |
| Model display | Show which LM Studio model is running | LOW | LM Studio API: GET http://localhost:1235/v1/models | Static display in header or settings. "Qwen 3.5-9B" |

#### Knowledge Management

| Feature | Value Proposition | Complexity | Backend Dependency | Notes |
|---------|-------------------|------------|-------------------|-------|
| Document upload via drag-and-drop | Make RAG accessible without API calls. Drop a PDF, it gets indexed and becomes searchable | MEDIUM | POST /api/documents/upload exists in RAG server | Drag-and-drop zone in sidebar or dedicated panel. Progress indicator. Confirm when indexed |
| Knowledge base browser | View, search, and manage what the AI knows about | MEDIUM | GET /api/documents endpoint exists | List with search box, delete button, document preview. Count badge in sidebar nav |
| Recall indicator | Show when the AI is drawing on past conversation memory | LOW | `tool` event fires when `recall_conversation` or `search_conversation_memory` tool is called | Subtle "recalling memory" label when those specific tools fire. Not a major feature, just a trust signal |

#### Developer Experience

| Feature | Value Proposition | Complexity | Backend Dependency | Notes |
|---------|-------------------|------------|-------------------|-------|
| Keyboard shortcuts | Power users and developers expect shortcuts. ChatGPT has Cmd+K, Ctrl+/, etc. | LOW | None | Ctrl+N (new chat), Escape (cancel/close), Ctrl+Shift+C (copy last code block), Ctrl+/ (shortcut help overlay). Display hints in UI |
| Slash commands | Type `/` to trigger intent shortcuts. Open WebUI and AnythingLLM both have this | MEDIUM | Intent routing already exists in orchestrator — `/web`, `/docs`, `/workflow` map naturally | Autocomplete dropdown on `/` keypress. At minimum: /web, /file, /remember, /workflow. Keeps power users fast |

---

### Anti-Features (Deliberately NOT Building)

Features that seem appealing but waste engineering time for v1.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Artifacts / side-panel code preview | Claude's Artifacts and ChatGPT Canvas are enormous engineering efforts (sandboxed iframes, execution environments, state management). Only valuable if code generation is the primary use case | Excellent code blocks with copy + syntax highlighting. Users copy to their editor |
| Voice input / output | Requires speech-to-text/text-to-speech infrastructure (Whisper, TTS engines). Not relevant for a developer-focused local tool. Open WebUI has ongoing issues with it | Skip entirely for v1 |
| Image generation | Requires additional model infrastructure (SDXL etc.), separate GPU VRAM. Chimera is a productivity tool, not a creative tool | Screenshot capture/analysis already exists as a tool. That is the relevant vision feature |
| Multi-model switching in UI | Open WebUI's key feature: pick any model mid-conversation. Chimera uses whatever LM Studio has loaded. Duplicating LM Studio's model management adds complexity for zero benefit | Show which model is loaded (read-only). Model switching happens in LM Studio |
| User authentication / multi-user | Chimera is local-first, single-user by design. Auth adds login screens and session tokens for zero security benefit on localhost | No auth. If someone has access to the machine, auth would not help anyway |
| Plugins / extension marketplace | Open WebUI has a community marketplace. Too early. Core must be solid first | Hard-code the tool set Chimera already has. Plugin architecture is a v3+ concern |
| Chat sharing / public links | Open WebUI and Khoj support publicly sharing conversations. Chimera is private by design | Export to markdown file if needed |
| Collaborative editing | ChatGPT Canvas supports co-editing. Wrong paradigm for a single-user local tool | Not needed |
| Prompt template library | Nice-to-have but not critical. Adds a management interface with low usage | Slash commands provide the lightweight version of this |
| Mobile-first responsive | Chimera requires desktop hardware (local GPU). Phone layout is pointless for v1 | Desktop + tablet breakpoints only |
| Mermaid diagram rendering | Some AI outputs include Mermaid. Adds rendering complexity for rare use cases | Show as code block with copy button. Defer to v2 |
| File tree / workspace browser | Some tools show a file tree. Chimera navigates files through AI tool calls | Not needed. The AI uses file operation tools. Users do not need a file browser in the chat |

---

## Feature Dependencies

```
[SSE Connection Management]
  |
  |-- [Message Stream + Markdown Rendering]  <-- must work first
  |       |
  |       |-- [Code Syntax Highlighting]
  |       |-- [Copy Buttons]
  |       |-- [LaTeX Rendering]           (defer to v1.x)
  |
  |-- [Tool Call Display]                 <-- parallel with message stream
  |       |
  |       |-- [Tool Timing Badges]
  |       |-- [Expandable Results]
  |
  |-- [Synapse Workflow Visualization]    <-- requires tool call display working
          |
          |-- [Interactive Q&A Cards]
          |-- [Task Progress List]
          |-- [Workflow Cancel Controls]

[Session Management / Sidebar]           <-- independent, builds on top of SSE
  |
  |-- [Conversation History List]
  |-- [New Chat Button]
  |-- [Delete Conversation]

[Knowledge Management]                   <-- independent
  |
  |-- [Document Upload]
  |-- [Knowledge Base Browser]

[Developer Experience]                   <-- independent polish layer
  |
  |-- [Keyboard Shortcuts]
  |-- [Slash Commands]
```

### Dependency Notes

- SSE connection management is the foundation. Nothing works without it.
- Message streaming and markdown rendering must come before everything else. It is the core experience.
- Tool call display and Synapse visualization are layered on top of the streaming foundation.
- Session sidebar is conceptually independent but practically depends on streaming working.
- Knowledge management and developer experience features are independent and can be done in any order after core chat.

---

## MVP Definition

### Launch With (v1) — Core Chat

- [ ] Chat input with streaming response via SSE — the core loop
- [ ] Markdown rendering with partial-block handling during stream
- [ ] Code blocks: syntax highlighting (Shiki) + copy button per block
- [ ] Copy full message button
- [ ] Stop/cancel generation button (closes SSE connection)
- [ ] Dark mode as default, light mode toggle, localStorage persistence
- [ ] Loading/thinking indicator before first token
- [ ] Error display inline with retry (handles `error` SSE event + 429)
- [ ] Inline tool call blocks (collapsible, shows tool name + status + duration)
- [ ] Basic session sidebar (new chat, list with timestamps, switch, delete)
- [ ] System health status indicator

### Add After Validation (v1.x) — Synapse + Knowledge

- [ ] Synapse workflow visualization (trigger: most users have hit a workflow)
- [ ] Interactive Q&A cards for synapse_question events
- [ ] Task progress list during workflow execution
- [ ] Document upload drag-and-drop
- [ ] Knowledge base browser
- [ ] Keyboard shortcuts
- [ ] Conversation rename

### Future Consideration (v2+) — Polish + Power

- [ ] Slash commands with autocomplete
- [ ] Message editing and regeneration
- [ ] LaTeX / KaTeX rendering
- [ ] Workflow cancellation / escalation UI
- [ ] Export conversations to markdown
- [ ] OLED dark mode (third theme option)
- [ ] Model info display (LM Studio API integration)
- [ ] Recall / memory indicators

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| SSE streaming + markdown render | HIGH | MEDIUM | P1 |
| Code highlighting + copy | HIGH | MEDIUM | P1 |
| Stop button | HIGH | LOW | P1 |
| Dark mode | HIGH | MEDIUM | P1 |
| Inline tool call display | HIGH | MEDIUM | P1 |
| Session sidebar | HIGH | MEDIUM | P1 |
| Loading indicator | MEDIUM | LOW | P1 |
| Error handling | MEDIUM | LOW | P1 |
| Health status bar | MEDIUM | LOW | P1 |
| Synapse workflow visualization | HIGH | HIGH | P2 |
| Document upload | MEDIUM | MEDIUM | P2 |
| Knowledge base browser | MEDIUM | MEDIUM | P2 |
| Keyboard shortcuts | MEDIUM | LOW | P2 |
| Interactive Q&A cards | MEDIUM | MEDIUM | P2 |
| Slash commands | LOW | MEDIUM | P3 |
| Message edit / regenerate | MEDIUM | MEDIUM | P3 |
| LaTeX rendering | LOW | MEDIUM | P3 |
| Conversation export | LOW | LOW | P3 |

**Priority key:**
- P1: Must have for v1 launch
- P2: Should have, add in v1.x after core validated
- P3: Nice to have, v2+ consideration

---

## Competitor Feature Analysis

| Feature | ChatGPT | Claude.ai | Open WebUI | AnythingLLM | Khoj | Chimera Target |
|---------|---------|-----------|------------|-------------|------|----------------|
| Token streaming | Yes | Yes | Yes | Yes | Yes | Yes (SSE exists) |
| Tool call display | Minimal inline | Inline blocks + hide/show | 3 verbosity levels | Limited | No | Inline collapsible |
| Code highlighting | Yes | Yes | Yes | Yes | Basic | Yes (Shiki) |
| Dark mode | Yes | Yes | Yes + OLED | Yes | Yes | Yes (default) |
| Workflow visualization | No | No | No | No | No | YES (unique) |
| Artifacts/Canvas | Canvas | Artifacts | Community | No | No | No (anti-feature) |
| Voice I/O | Yes | No | No | Yes | Yes | No (anti-feature) |
| Local-first | No | No | Yes | Yes | Optional | Yes (core identity) |
| Document upload | No | Yes | Yes | Yes | Yes | Yes (RAG exists) |
| Auth/multi-user | Yes | Yes | Yes | Yes | Yes | No (single-user) |
| Slash commands | No | No | Yes | No | No | v1.x |
| Session sidebar | Yes | Yes + Projects | Yes + Folders | Yes + Workspaces | Yes | Yes (basic) |
| Health indicators | No | No | No | No | No | Yes (local tools need this) |

---

## Backend SSE Event Inventory

The backend (`chimera-chat.js`, `chimera-orchestrator.js`) emits these SSE events. All UI features must be designed around this event schema:

| SSE Event Type | Payload Fields | UI Action |
|---------------|----------------|-----------|
| `user_message` | `text` | Echo user message in chat (may already be shown optimistically) |
| `intent` | `mode` | Show intent badge: "Using web search", "Planning workflow", etc. |
| `synapse_start` | `session_id`, `mode`, `status` | Open Synapse workflow block in message stream |
| `synapse_question` | `area_id`, `text` | Add Q&A card to workflow block |
| `synapse_answer` | `area_id`, `answer` | Fill answer into corresponding Q&A card |
| `tool` | `tool`, `args`, `result`, `hadError`, `error` | Add/update tool call block inline |
| `loop` | `reason`, `signature` | Show loop detection warning (subtle) |
| `task_start` | `id`, `description` | Add task to task list with spinner |
| `task_done` | `id`, `response` | Mark task complete with checkmark |
| `tasks_complete` | `count`, `message` | Close workflow block, show summary |
| `auto_save` | `content` | Show subtle "Saved to memory" indicator |
| `auto_save_error` | `error` | Log silently (not user-facing) |
| `trim` | `dropped`, `kept` | Optional: show context window indicator update |
| `done` | `response`, `session_id`, `stats` | Render final assistant message, enable input |
| `error` | `error` | Show inline error with retry button |

---

## Sources

### Verified (HIGH confidence)
- [Open WebUI Features Documentation](https://docs.openwebui.com/features/) — official docs, fetched directly
- [Claude Artifacts Documentation](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) — official Anthropic help
- [OpenAI UI Guidelines for Apps SDK](https://developers.openai.com/apps-sdk/concepts/ui-guidelines/) — official OpenAI dev docs
- [Streamdown — AI Markdown Streaming](https://streamdown.ai/) — purpose-built streaming markdown renderer
- [Vercel AI SDK — Stream Protocols](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol) — current streaming patterns
- Chimera source: `chimera-chat.js` — SSE event types, session management, abort/timeout behavior
- Chimera source: `chimera-orchestrator.js` — full `this.emit()` inventory, intent routing, Synapse integration

### Cross-referenced (MEDIUM confidence)
- [Design Patterns for AI Interfaces — Smashing Magazine 2025](https://www.smashingmagazine.com/2025/07/design-patterns-ai-interfaces/)
- [Comparing Conversational AI Tool UIs 2025 — IntuitionLabs](https://intuitionlabs.ai/articles/conversational-ai-ui-comparison-2025)
- [AI UI Design Patterns — patterns.dev](https://www.patterns.dev/react/ai-ui-patterns/)
- [AG-UI Protocol for Agent-UI Streams — MarkTechPost 2025](https://www.marktechpost.com/2025/09/18/bringing-ai-agents-into-any-ui-the-ag-ui-protocol-for-real-time-structured-agent-frontend-streams/)
- [AnythingLLM Roadmap](https://docs.anythingllm.com/roadmap)
- [Open WebUI vs AnythingLLM Comparison — wz-it.com](https://wz-it.com/en/blog/open-webui-vs-anythingllm-comparison/)

---

*Feature research for: Chimera Web UI (local AI assistant frontend)*
*Researched: 2026-03-12*
