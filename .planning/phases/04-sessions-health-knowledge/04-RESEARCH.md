# Phase 4: Sessions, Health + Knowledge - Research

**Researched:** 2026-03-12
**Domain:** SvelteKit UI — session management, health polling, drag-and-drop file upload, memory indicator
**Confidence:** HIGH (codebase verified; API contracts confirmed from source)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Session sidebar
- Collapsible sidebar (toggle open/closed, chat area expands when closed)
- Each session row shows: auto-generated title + relative timestamp ("2h ago")
- Sessions grouped by time (Today, Yesterday, etc.)
- Delete: hover reveals trash icon, clicking turns row into inline "Delete?" confirmation (no modal)
- New chat button at top of sidebar

#### Health bar
- Top bar spanning full width above the chat area
- Shows colored dot indicators for LM Studio, RAG, and Search (green = healthy, red = unhealthy)
- Unhealthy state shows red dot + inline text (e.g., "LM Studio offline")
- Displays currently loaded model name
- "Local" privacy badge in the bar

#### Knowledge management
- Lives as a second tab in the session sidebar (toggle between Sessions and Knowledge)
- Drag-and-drop upload supported
- Document list in sidebar with per-item metadata

#### Memory recall indicator
- Small brain/memory icon next to the assistant name in the message header
- Only shown when relevant (not on every message)
- Tooltip on hover explains what was recalled

### Claude's Discretion

#### Sessions
- Session title generation approach (first message truncation vs AI summary)
- Sidebar collapse animation and toggle button placement
- Default sidebar state (open vs closed) on first load

#### Health
- Polling interval for health checks
- Privacy badge placement within the top bar
- Transition/animation when health status changes

#### Knowledge
- Drop zone behavior (full-window vs sidebar-only)
- Document list metadata per item (name + size + date vs name + type icon + date)
- Search approach (client-side filter vs backend search — depends on expected volume)
- Upload progress indicator style

#### Memory
- Tooltip content (generic vs memory source hint)
- Trigger mechanism (based on backend SSE event support)
- Icon choice and sizing

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

## Summary

This phase adds three UI surfaces to an existing SvelteKit (Svelte 5 runes) app: a collapsible session sidebar, a health status bar, and a knowledge management tab. The existing codebase is fully understood — `+page.svelte` already has an `<aside>` placeholder ready for the sidebar, the `ChatStore` already tracks `sessionId`, and the RAG server API is confirmed from source.

The critical backend gap identified in STATE.md is real: `chimera-chat.js` has no `GET /api/sessions` list endpoint. Sessions currently live only in memory as an in-process `Map`. Adding persistence (or at minimum a list endpoint) must happen in `chimera-chat.js` before the sidebar can display history. The RAG server already has `GET /api/documents`, `POST /api/documents/upload`, and `DELETE /api/documents/{id}` endpoints — the document UI can be built against that known contract directly.

For Claude's Discretion areas: recommend **first-message truncation** for session titles (no LLM round-trip, deterministic), **max-width CSS transition** for sidebar collapse (no Svelte transition needed, pure CSS, performant), **sidebar open by default**, **30-second polling** for health checks, and **sidebar-only drop zone** for file upload (simpler, avoids full-window overlay z-index complications). For the memory indicator, recommend the `Brain` icon from `lucide-svelte` (already installed) with a generic "Memory recalled" tooltip triggered by a custom SSE event or a field on the `done` event payload.

**Primary recommendation:** Build backend endpoints first (sessions list in chimera-chat.js), then the three UI components: `SessionSidebar.svelte`, `HealthBar.svelte`, and `KnowledgeSidebar.svelte`.

---

## Standard Stack

No new packages required. All needed libraries are already installed.

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| svelte | ^5.51.0 | Runes-based reactivity | Project standard |
| lucide-svelte | ^0.577.0 | Icons (Brain, Trash2, Plus, ChevronLeft, FileText, etc.) | Already installed, consistent icon set |
| bits-ui | ^2.16.3 | Tooltip.Root/Trigger/Content for memory indicator | Already installed, headless a11y primitives |
| tailwindcss | ^4.2.1 | All styling | Project standard |

### New Packages Required
**None.** The drag-and-drop file upload is implemented with native HTML5 `dragover`/`drop` events — no library needed for a sidebar-scoped drop zone.

**Installation:**
```bash
# No new packages needed
```

---

## Architecture Patterns

### Recommended Project Structure

```
web/src/
├── lib/
│   ├── chat/
│   │   ├── ChatStore.svelte.ts        # Add: sessions[], activeSessionId, new/switch/delete
│   │   ├── types.ts                   # Add: SessionSummary, DocumentItem, HealthStatus
│   │   ├── SSEClient.ts               # No change
│   │   └── markdown.ts               # No change
│   └── components/
│       ├── SessionSidebar.svelte      # NEW: collapsible sidebar with Sessions + Knowledge tabs
│       ├── HealthBar.svelte           # NEW: full-width health status top bar
│       ├── MessageBubble.svelte       # MODIFY: add memoryRecalled prop for brain icon
│       ├── ChatWindow.svelte          # No change
│       └── [existing components]     # No change
└── routes/
    └── +page.svelte                   # MODIFY: wire in SessionSidebar + HealthBar
```

### Pattern 1: Svelte 5 Polling with $effect Cleanup

**What:** Use `$effect` returning a teardown function for health polling interval.
**When to use:** Any periodic fetch that must stop when the component unmounts.

```typescript
// Source: https://svelte.dev/docs/svelte/$effect
$effect(() => {
  checkHealth(); // initial check on mount
  const interval = setInterval(checkHealth, 30_000);
  return () => clearInterval(interval);
});
```

### Pattern 2: CSS max-width Collapse for Sidebar

**What:** Animate sidebar collapse using `max-width` transition on the `<aside>`. Does not require Svelte's `slide` transition. The chat flex container naturally expands via `flex-1`.
**When to use:** Width-based sidebar collapse where content stays in DOM (preserves scroll position).

```svelte
<!-- Source: CSS-Tricks "Using CSS Transitions on Auto Dimensions" pattern -->
<aside
  class="transition-[max-width] duration-200 ease-in-out overflow-hidden border-r border-border flex flex-col"
  style="max-width: {sidebarOpen ? '256px' : '0px'};"
>
  <!-- sidebar content -->
</aside>
```

Toggle button should be placed at the top of the sidebar (within the always-visible header zone) or as a floating button at the edge when collapsed.

### Pattern 3: Drag-and-Drop with Native HTML5 API

**What:** Handle `dragover` + `drop` events directly in Svelte. No library needed for sidebar-scoped drop zone.
**When to use:** Single-zone file upload where accessibility requirements are met via a hidden `<input type="file">` fallback.

```svelte
<!-- Source: MDN HTML Drag and Drop API -->
<script lang="ts">
  let isDragging = $state(false);

  function handleDragOver(e: DragEvent) {
    e.preventDefault(); // required to enable drop
    isDragging = true;
  }

  function handleDragLeave() {
    isDragging = false;
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    const files = Array.from(e.dataTransfer?.files ?? []);
    for (const file of files) {
      await uploadFile(file);
    }
  }
</script>

<div
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
  class={isDragging ? 'ring-2 ring-ring' : ''}
>
  <!-- drop zone content -->
</div>
```

### Pattern 4: Brain Icon Tooltip (bits-ui)

**What:** Use `bits-ui` `Tooltip` with `Brain` from `lucide-svelte` for the memory indicator.
**When to use:** Non-blocking tooltip on hover; shown conditionally per-message.

```svelte
<!-- Source: https://bits-ui.com/docs/components/tooltip -->
<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import { Brain } from 'lucide-svelte';
</script>

{#if message.memoryRecalled}
  <Tooltip.Provider>
    <Tooltip.Root delayDuration={300}>
      <Tooltip.Trigger class="text-muted-foreground hover:text-foreground">
        <Brain size={12} />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="rounded bg-popover px-2 py-1 text-xs text-popover-foreground shadow">
          Memory recalled from past conversations
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
{/if}
```

### Pattern 5: Relative Timestamp (No Library)

**What:** Format timestamps as "2h ago", "Yesterday", etc. using native `Intl.RelativeTimeFormat` — no date-fns needed.
**When to use:** Simple relative timestamps that don't need live-updating.

```typescript
// Source: MDN Intl.RelativeTimeFormat
function relativeTime(ts: number): string {
  const diff = ts - Date.now(); // negative = past
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60_000) return 'just now';
  if (abs < 3_600_000) return rtf.format(-Math.floor(abs / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(-Math.floor(abs / 3_600_000), 'hour');
  return rtf.format(-Math.floor(abs / 86_400_000), 'day');
}
```

### Anti-Patterns to Avoid

- **`onDestroy` for interval cleanup:** Use `$effect` return value instead — cleaner and Svelte 5 idiomatic.
- **Svelte `slide` transition on sidebar:** Does not animate width; it collapses height. Use CSS max-width transition.
- **Fetching `/api/documents` from frontend directly to RAG port:** The frontend proxies through `chimera-chat.js`. Add proxy routes there, or call the RAG URL directly (already on localhost, acceptable for v1).
- **`for-await` on ReadableStream:** Project decision [02-01] — use `ReadableStreamDefaultReader`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Icon for brain/memory | Custom SVG | `Brain` from `lucide-svelte` | Already installed, consistent |
| Tooltip component | Custom div with hover state | `bits-ui Tooltip` | a11y, portal rendering, already installed |
| File upload encoding | Manual FormData | Native `FormData` + `fetch` | RAG server already handles multipart |
| CSS sidebar animation | JS-driven width calculation | CSS `max-width` transition | GPU-accelerated, no JS frame loop |
| Relative timestamps | date-fns (extra dep) | Native `Intl.RelativeTimeFormat` | Built into all modern browsers, no bundle cost |

**Key insight:** All necessary primitives (icons, tooltip, form handling, animation) are either browser-native or already installed. Adding new packages would introduce unnecessary bloat.

---

## Common Pitfalls

### Pitfall 1: Sessions Endpoint Does Not Exist

**What goes wrong:** The session sidebar tries to `GET /api/sessions` but chimera-chat.js has no such route. The sidebar renders empty or errors permanently.
**Why it happens:** STATE.md blocker — sessions are in-memory only, no list endpoint exists.
**How to avoid:** Add `GET /api/sessions` to `chimera-chat.js` FIRST, returning metadata from the `sessions` Map. Decide on title generation at this point (first-message truncation recommended).
**Warning signs:** 404 on `/api/sessions` in browser devtools.

### Pitfall 2: LM Studio Model Name Field Confusion

**What goes wrong:** Polling `/v1/models` on port 1235 (not 1234) and expecting an `id` field but getting `key` (native API) vs `data[0].id` (OpenAI-compat API).
**Why it happens:** LM Studio has two APIs: native (`GET /api/v1/models` → `{ models: [{ key, display_name, loaded_instances }] }`) and OpenAI-compat (`GET /v1/models` → `{ data: [{ id, owned_by }] }`). Chimera uses the OpenAI-compat port (1235).
**How to avoid:** Fetch `GET /v1/models` and read `data[0].id` (OpenAI-compat format). Filter for models with at least one loaded instance if needed.
**Warning signs:** `undefined` model name displayed in health bar.

### Pitfall 3: RAG Health Response Structure

**What goes wrong:** The health bar reads `status` field from `/health` but needs per-service granularity (LM Studio, RAG, Search separately).
**Why it happens:** The RAG server `/health` endpoint returns `{ status, services: { database, embeddings, search, llm_studio } }`. The chimera-chat.js `/api/health?deep=true` returns `{ status, errors[] }` — errors is a flat array of strings, not per-service.
**How to avoid:** The health bar should call the RAG `/health` endpoint directly (it's on localhost) OR add a richer health endpoint to chimera-chat.js. Recommend adding `GET /api/health/detail` to chimera-chat.js that returns structured per-service status.
**Warning signs:** Cannot distinguish LM Studio offline vs RAG offline vs Search offline.

### Pitfall 4: Drag-and-Drop `dragenter`/`dragleave` Event Bubbling

**What goes wrong:** The `isDragging` flag flickers as the user drags over child elements inside the drop zone (each child fires `dragleave` then `dragenter` again).
**Why it happens:** `dragleave` fires on the parent when a child captures the drag, causing the visual highlight to flash.
**How to avoid:** Use a counter instead of boolean for drag state, or use `dragenter` on the parent with `pointer-events: none` on children during drag. Simplest: track drag count.
**Warning signs:** Drop zone ring flickers rapidly while dragging over sidebar content.

```typescript
let dragCount = $state(0);
const isDragging = $derived(dragCount > 0);

function handleDragEnter() { dragCount++; }
function handleDragLeave() { dragCount--; }
function handleDrop(e: DragEvent) {
  e.preventDefault();
  dragCount = 0;
  // handle files...
}
```

### Pitfall 5: File Upload Requires multipart/form-data

**What goes wrong:** Uploading file as JSON body is rejected by the RAG server.
**Why it happens:** RAG `POST /api/documents/upload` uses FastAPI's `UploadFile = File(...)` — it expects `multipart/form-data`, not JSON.
**How to avoid:** Always use `FormData` for file uploads. Do NOT set `Content-Type` header manually — browser sets it with the boundary automatically.

```typescript
const formData = new FormData();
formData.append('file', file, file.name);
await fetch('http://localhost:8080/api/documents/upload', {
  method: 'POST',
  body: formData
  // DO NOT set Content-Type header
});
```

### Pitfall 6: Memory Recall Trigger Has No Existing SSE Event

**What goes wrong:** The UI tries to listen for a `memory_recall` SSE event that the backend never emits.
**Why it happens:** The chimera-orchestrator does not currently emit a dedicated `memory_recall` event. The `recall_conversation` MCP tool is called silently.
**How to avoid:** Two options: (a) add a `memory_recall` event to chimera-orchestrator when `recall_conversation` tool is used, or (b) detect it from existing `tool` events where `event.tool === 'recall_conversation'`. Option (b) requires no backend change — prefer for v1.
**Warning signs:** Brain icon never appears.

### Pitfall 7: Sidebar Width and Flex Layout

**What goes wrong:** `flex-1` on the chat area does not expand when sidebar collapses if the `aside` uses `display: none` instead of `width: 0` / `max-width: 0`.
**Why it happens:** `display: none` removes the element from flow but flex siblings don't recalculate immediately without a transition trigger.
**How to avoid:** Keep the `<aside>` in the DOM at all times (never `{#if sidebarOpen}`). Use CSS `max-width: 0` with `overflow: hidden` for collapse. The flex container will naturally redistribute space.
**Warning signs:** Chat area doesn't expand after sidebar closes.

---

## Code Examples

### Confirmed API Contracts

#### chimera-chat.js `/api/health?deep=true` (EXISTING)
```typescript
// Returns:
{ status: 'ok' | 'degraded', sessions: number, uptime: number, errors?: string[] }
// errors examples: ['RAG stack unreachable', 'LM Studio unreachable']
```

#### RAG server `/health` (EXISTING)
```typescript
// GET http://localhost:8080/health
// Returns:
{
  status: 'ok' | 'degraded',
  timestamp: string,  // ISO 8601
  services: {
    database: 'ok' | 'error: ...',
    embeddings: 'ok' | 'error: ...',
    search: 'ok' | 'error: ...',
    llm_studio: 'ok' | 'error: ...'
  }
}
```

#### RAG server `/api/documents` (EXISTING)
```typescript
// GET http://localhost:8080/api/documents
// Returns:
{
  documents: Array<{
    id: string,
    filename: string,
    source_type: string,
    created_at: string,   // ISO 8601
    content_preview: string
  }>,
  total: number
}
```

#### RAG server `DELETE /api/documents/{id}` (EXISTING)
```typescript
// DELETE http://localhost:8080/api/documents/{document_id}
// Returns:
{ status: 'deleted', document_id: string }
```

#### LM Studio `/v1/models` (EXISTING, OpenAI-compat format on port 1235)
```typescript
// GET http://127.0.0.1:1235/v1/models
// Returns OpenAI-compat format:
{ data: Array<{ id: string, owned_by: string, ... }> }
// 'id' is the model identifier, e.g., "qwen3.5-9b-instruct"
// Only loaded models appear in data[] when using LM Studio with auto-load
```

#### Sessions list endpoint (MUST BE ADDED to chimera-chat.js)
```typescript
// Proposed: GET /api/sessions
// Returns:
{
  sessions: Array<{
    id: string,
    title: string,         // first message truncated to 50 chars
    created: number,       // Date.now() timestamp
    lastActive: number,    // Date.now() timestamp
    messageCount: number
  }>
}
// Sessions ordered by lastActive descending
```

### Session Title Generation (Recommendation: First Message Truncation)

```typescript
// In chimera-chat.js, when first user message arrives for a new session:
function generateTitle(firstMessage: string): string {
  const clean = firstMessage.trim().replace(/\n+/g, ' ');
  return clean.length > 50 ? clean.slice(0, 47) + '...' : clean;
}
```

Rationale: No async LLM round-trip, deterministic, immediate. AI summary adds latency and a failure mode.

### Health Bar Polling (Recommended: 30 seconds)

30 seconds balances freshness with request overhead. User can see status change within 30s of a service going down. Health checks are lightweight GETs.

```typescript
// In HealthBar.svelte
let health = $state<HealthStatus | null>(null);

async function checkHealth() {
  try {
    const [ragRes, lmRes] = await Promise.allSettled([
      fetch('http://localhost:8080/health').then(r => r.json()),
      fetch('http://127.0.0.1:1235/v1/models').then(r => r.json())
    ]);
    // parse into HealthStatus...
  } catch { /* keep previous state */ }
}

$effect(() => {
  checkHealth();
  const interval = setInterval(checkHealth, 30_000);
  return () => clearInterval(interval);
});
```

---

## Decisions for Claude's Discretion

| Area | Recommendation | Rationale |
|------|---------------|-----------|
| Session title generation | First-message truncation (50 chars) | No LLM latency, no failure mode, deterministic |
| Sidebar collapse animation | CSS `max-width` transition (200ms ease-in-out) | GPU-accelerated, no JS frame loop, keeps DOM in place |
| Default sidebar state | Open on first load | Users benefit from seeing session history immediately; can collapse to focus |
| Health polling interval | 30 seconds | Balances freshness vs request overhead |
| Privacy badge placement | Right side of health bar, after model name | Left = status indicators (functional), right = identity (informational) |
| Health status transition | CSS `transition-colors` on dot (300ms) | Subtle, non-distracting; red/green color alone communicates enough |
| Drop zone behavior | Sidebar-only | Avoids z-index overlay complexity; full-window drop adds UX confusion when also typing |
| Document metadata per item | name + type icon + date | Type icon at a glance is faster than reading extension; date is most relevant secondary info |
| Document search approach | Client-side filter | v1 knowledge base is small (personal use); backend search adds API call latency for incremental typing |
| Upload progress indicator | Indeterminate progress bar (opacity pulse) | Multipart upload to local server completes in <1s typically; determinate % requires `XMLHttpRequest` instead of `fetch` |
| Memory trigger mechanism | Detect from `tool` SSE event where `tool === 'recall_conversation'` | No backend change needed; existing event stream contains this information |
| Tooltip content | Generic "Memory recalled from past conversations" | Sufficient for v1; specific source hint would require additional SSE data |
| Memory icon | `Brain` from lucide-svelte, size 12 | Already installed; semantically correct; `BrainCog` is an alternative if more "AI" feel wanted |

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `onMount` + `onDestroy` for lifecycle | `$effect` with return cleanup function | Cleaner, co-located, Svelte 5 idiomatic |
| Svelte stores (`readable`, `writable`) | Rune-based class state (`$state` in .svelte.ts) | Project already uses this (ChatStore pattern) |
| `slide` transition directive for sidebars | CSS `max-width` + `overflow: hidden` | Width-correct; `slide` only handles height |
| External date library (date-fns, dayjs) | `Intl.RelativeTimeFormat` native | Zero bundle cost |

---

## Backend Changes Required

This phase requires two backend additions to `chimera-chat.js`:

### 1. `GET /api/sessions` — Session List Endpoint (REQUIRED before SESS-01)

Must expose the existing in-memory `sessions` Map as a REST endpoint. Sessions need a `title` field (add when first message received).

```javascript
// Add to sessions Map entry structure:
// { session, created, lastActive, logs, title, messageCount }

// Add route to chimera-chat.js handleRequest():
if (req.method === 'GET' && url.pathname === '/api/sessions') {
  const list = [...sessions.entries()]
    .map(([id, s]) => ({
      id,
      title: s.title || 'New conversation',
      created: s.created,
      lastActive: s.lastActive,
      messageCount: s.messageCount || 0
    }))
    .sort((a, b) => b.lastActive - a.lastActive);
  sendJson(res, 200, { sessions: list });
  return;
}
```

### 2. `DELETE /api/sessions/:id` — Session Delete Endpoint (REQUIRED before SESS-04)

```javascript
const deleteSessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
if (req.method === 'DELETE' && deleteSessionMatch) {
  sessions.delete(deleteSessionMatch[1]);
  sendJson(res, 200, { status: 'deleted', id: deleteSessionMatch[1] });
  return;
}
```

### 3. Proxy Routes for Documents (OPTIONAL but recommended for clean architecture)

The frontend could call the RAG server directly (`http://localhost:8080/api/documents`), which works since it's all local. For v1 this is acceptable — no proxy needed.

---

## Open Questions

1. **Session persistence across server restarts**
   - What we know: Sessions are in-memory only; server restart loses all history
   - What's unclear: Is this acceptable for v1 or must sessions persist to disk?
   - Recommendation: Accept in-memory for v1 (consistent with STATE.md scope). The sidebar will be empty after restart, which is honest behavior.

2. **Memory recall trigger accuracy**
   - What we know: `recall_conversation` tool call is detectable from SSE `tool` events
   - What's unclear: The tool is called on every message by some modes, not just when something meaningful is found
   - Recommendation: Show brain icon only when `recall_conversation` tool call has a non-empty result (check `event.result` content length > threshold)

3. **RAG server URL from frontend**
   - What we know: RAG server is at `http://localhost:8080` by default
   - What's unclear: Is this URL hardcoded or should it be configurable?
   - Recommendation: Hardcode `localhost:8080` in health bar for v1. The chimera-chat.js already hardcodes this for its own health check.

---

## Sources

### Primary (HIGH confidence)
- Codebase: `chimera-chat.js` — confirmed sessions Map structure, health endpoint, LM Studio URL (port 1235)
- Codebase: `rag-setup/app.py` — confirmed all RAG API endpoints and their exact response shapes
- Codebase: `web/src/lib/chat/ChatStore.svelte.ts` — confirmed existing state patterns to extend
- Codebase: `web/src/routes/+page.svelte` — confirmed sidebar placeholder already in place
- https://svelte.dev/docs/svelte/$effect — confirmed `$effect` cleanup return pattern
- https://bits-ui.com/docs/components/tooltip — confirmed `Tooltip.Provider/Root/Trigger/Content` API
- https://lucide.dev/icons/brain — confirmed `Brain` import name

### Secondary (MEDIUM confidence)
- https://lmstudio.ai/docs/developer/rest/list — confirmed LM Studio `/v1/models` response structure with `display_name`, `loaded_instances`; OpenAI-compat uses `data[0].id`
- WebSearch + MDN: `Intl.RelativeTimeFormat` is supported in all modern browsers

### Tertiary (LOW confidence)
- WebSearch: CSS `max-width` transition pattern for sidebar collapse — standard practice, no single authoritative source

---

## Metadata

**Confidence breakdown:**
- API contracts (sessions, documents, health): HIGH — read directly from source code
- LM Studio model name field: MEDIUM — confirmed from official docs, exact field depends on which API flavor (`data[0].id` for OpenAI-compat, `models[0].display_name` for native)
- Standard stack: HIGH — no new packages, all verified installed
- Architecture patterns: HIGH — extends existing ChatStore/component patterns directly
- Pitfalls: HIGH for identified issues (drag flicker, multipart upload, sessions endpoint missing); MEDIUM for LM Studio field name

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable tech stack; LM Studio API is stable)
