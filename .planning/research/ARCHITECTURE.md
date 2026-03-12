# Architecture: Chimera Web Frontend Integration

**Domain:** Web frontend for local AI assistant
**Researched:** 2026-03-12
**Confidence:** HIGH (codebase analysis + verified SvelteKit docs + Open WebUI cross-reference)

---

## Existing Architecture (As-Is)

```
 User (curl/script)
       |
       v
 chimera-chat.js (Node.js http.createServer, port 3210)
   |-- POST /chat          --> JSON {response, session_id, stats}
   |-- POST /chat/stream   --> SSE events (tool, synapse_*, task_*, done, error)
   |-- GET  /health
   |-- GET  /sessions/:id/stats
   |-- GET  /sessions/:id/logs
       |
       v
 chimera-orchestrator.js (ChimeraSession class)
   |-- Intent detection (regex-based)
   |-- LLM chat loop with tool calls (max 8 loops)
   |-- Synapse Q&A driving (auto-answers planning questions)
   |-- Synapse task execution (auto-executes generated tasks)
   |-- Loop detection (3 consecutive identical calls)
   |-- Event emitter pattern: onEvent({type, ...data})
       |
       +--> LM Studio (port 1235) -- OpenAI-compatible /v1/chat/completions
       +--> RAG Stack (port 8080) -- SearXNG, documents, conversations, Synapse
```

### Key Properties of Existing System

1. **No Express** -- raw `http.createServer` with manual URL parsing via `new URL()`
2. **Session store** -- `Map<session_id, {session, created, lastActive, logs}>`, max 20, 2hr TTL
3. **Concurrency locks** -- `activeLocks` Set prevents parallel requests per session
4. **AbortController** -- cancellation on client disconnect; wired to request close event
5. **Event system** -- `session.onEvent(event)` callback; SSE endpoint wraps it to `sendSSE(res, event.type, event)`
6. **CORS enabled** -- `Access-Control-Allow-Origin: *` on all responses
7. **No static file serving** -- 404 for anything not matching the six API routes

---

## Recommended Architecture (To-Be)

```
 User (browser on localhost)
       |
       v
 chimera-chat.js (port 3210)
   |
   +-- /api/chat           POST --> JSON response
   +-- /api/chat/stream    POST --> SSE events
   +-- /api/health         GET
   +-- /api/sessions/:id/* GET
   |
   +-- /*  (static file fallback)
       |-- /               --> web/build/index.html (SPA shell)
       |-- /_app/*         --> JS/CSS bundles (long-lived cache)
       |-- /favicon.png    --> static assets
       |-- (any unknown)   --> web/build/index.html (SPA fallback)
       |
       v
 web/build/          SvelteKit adapter-static output
 (served by chimera-chat.js, no separate process in production)
```

### What Changes in chimera-chat.js

| Change | Lines of Code | Rationale |
|--------|---------------|-----------|
| Add `/api/` prefix to all API routes | ~10 find-and-replace | Namespace separation: API routes vs static file paths |
| Add `serveStatic()` function | ~35 lines | Serve `web/build/` using only `node:fs` and `node:path` |
| Add SPA fallback at end of `handleRequest` | ~5 lines | Unmatched routes serve `index.html` for client-side routing |

### What Does NOT Change

- `chimera-orchestrator.js` -- zero modifications
- Session management, event system, concurrency locks, AbortController -- all stay
- RAG stack, LM Studio, Docker Compose -- unchanged
- API contract (request/response shapes) -- unchanged, just namespaced under `/api/`

---

## Integration Design

### 1. Static File Serving (Production)

Add a `serveStatic()` function to `chimera-chat.js`. This uses only `node:fs` and `node:path`, consistent with the zero-dependencies constraint.

```javascript
const fs = require('node:fs');
const path = require('node:path');

const STATIC_DIR = path.resolve(__dirname, 'web', 'build');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(res, urlPath) {
  // Prevent path traversal: resolve inside STATIC_DIR only
  const relative = path.normalize(decodeURIComponent(urlPath));
  const filePath = path.join(STATIC_DIR, relative);
  if (!filePath.startsWith(STATIC_DIR + path.sep) && filePath !== STATIC_DIR) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  // If directory, look for index.html inside it
  let target = filePath;
  try {
    if (fs.statSync(filePath).isDirectory()) {
      target = path.join(filePath, 'index.html');
    }
  } catch {
    // File doesn't exist -- fall through to SPA fallback below
  }

  if (!fs.existsSync(target)) {
    // SPA fallback: any unmatched route serves the app shell
    target = path.join(STATIC_DIR, 'index.html');
    if (!fs.existsSync(target)) {
      sendJson(res, 404, { error: 'Frontend not built. Run: cd web && npm run build' });
      return;
    }
  }

  const ext = path.extname(target);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  // Long cache for hashed assets, no cache for HTML (SPA shell)
  const cacheControl = ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable';

  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl });
  fs.createReadStream(target).pipe(res);
}
```

Route resolution order inside `handleRequest`:
1. OPTIONS (CORS preflight) -- any path
2. Any path starting with `/api/` -- exact match on API patterns
3. Everything else -- `serveStatic(res, url.pathname)`

**Confidence:** HIGH -- pattern is well-understood. `node:fs.createReadStream().pipe(res)` is the canonical Node.js static file pattern. The path traversal guard (`startsWith(STATIC_DIR + sep)`) is critical.

### 2. SvelteKit adapter-static Configuration

```javascript
// web/svelte.config.js
import adapter from '@sveltejs/adapter-static';

export default {
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',   // SPA mode: unmatched routes get app shell
      precompress: false,        // not needed for single-user local tool
      strict: true               // fail build if routes aren't prerenderable
    }),
    paths: {
      base: ''                   // served from root, not a subdirectory
    }
  }
};
```

```javascript
// web/src/routes/+layout.js  (disables SSR -- this is a client-only SPA)
export const ssr = false;
export const prerender = false;
```

**The fallback nuance:** The official SvelteKit docs recommend `200.html` over `index.html` as the fallback filename to avoid confusion with prerendered homepage content. However, since we control the static file server and it explicitly does the SPA fallback redirect (not a 404 redirect), `index.html` works fine. If you use a hosting platform that uses HTTP 404 responses to trigger fallback, use `200.html` or `404.html` per platform convention. For Chimera's custom Node.js server, `index.html` is unambiguous.

**Why adapter-static, not adapter-node:** `adapter-node` produces its own Node.js server process -- we already have `chimera-chat.js`. Two server processes is the anti-pattern to avoid.

**Confidence:** HIGH -- verified against official SvelteKit docs.

### 3. API Prefix Migration

All six existing routes gain an `/api/` prefix:

```javascript
// Before
url.pathname === '/chat'             // POST
url.pathname === '/chat/stream'      // POST
url.pathname === '/health'           // GET
url.pathname.match(/^\/sessions\//)  // GET

// After
url.pathname === '/api/chat'
url.pathname === '/api/chat/stream'
url.pathname === '/api/health'
url.pathname.match(/^\/api\/sessions\//)
```

The only consumers today are test scripts (`test_e2e.js`, `test_mini_project.js`, `test_synapse.js`) and direct curl calls -- all need URL updates. The vanilla HTML stepping stone (if it exists) also needs updating before the SvelteKit migration.

**Risk:** LOW -- no external callers, single developer, test files are easy to update.

### 4. SSE Consumption: fetch + ReadableStream

The backend uses POST-initiated SSE. The browser `EventSource` API only supports GET. Use fetch + ReadableStream.

```javascript
// web/src/lib/api/client.js
export async function streamChat(message, sessionId, onEvent) {
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId }),
    signal: abortController.signal,   // wire up cancellation
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let pendingEventType = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete last line

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        pendingEventType = line.slice(7).trim();
      } else if (line.startsWith('data: ') && pendingEventType) {
        try {
          const data = JSON.parse(line.slice(6));
          onEvent(pendingEventType, data);
        } catch { /* malformed JSON -- skip */ }
        pendingEventType = '';
      }
      // empty lines are SSE event separators -- reset happens on next 'event:' line
    }
  }
}
```

**Why NOT native EventSource:** EventSource only supports GET. Changing the backend to GET would move the message body to query params, breaking the current clean POST contract. Fetch + ReadableStream is ~35 lines and zero dependencies.

**Why NOT `@microsoft/fetch-event-source`:** It is 12kB for functionality that is 35 lines of code. Adds a frontend dependency for no material benefit.

**Reconnection behavior:** For a single-user local tool, automatic reconnection adds more complexity than value. If the stream drops (LM Studio restart, etc.), show a "Connection lost -- retry" button. Do not auto-reconnect silently -- the user needs to know the state is reset. The 429 "Session is busy" response from the backend means a reconnect would create a new session anyway.

**Confidence:** HIGH -- this is the standard pattern for POST-based SSE. Verified against chimera-chat.js SSE format: `event: {type}\ndata: {JSON}\n\n`.

### 5. State Management: Svelte 5 Runes in .svelte.js Files

Svelte 5 replaces legacy stores with runes. The pattern for shared state is `.svelte.js` (or `.svelte.ts`) files that export reactive objects using `$state`.

**Chat state module (`web/src/lib/state/chat.svelte.js`):**

```javascript
// Reactive state lives in a .svelte.js file
// Components import this and get reactivity automatically

export const chatState = $state({
  messages: [],          // Message[]
  sessionId: null,       // string | null -- persisted to localStorage
  isStreaming: false,
  streamEvents: [],      // SSE events for current in-flight request
  error: null,           // string | null
});

// Derived values
export const lastMessage = $derived(chatState.messages.at(-1));
export const hasSynapseActivity = $derived(
  chatState.streamEvents.some(e => e.type?.startsWith('synapse_'))
);
export const taskEvents = $derived(
  chatState.streamEvents.filter(e => e.type === 'task_start' || e.type === 'task_done')
);
```

**Key Svelte 5 runes facts (verified against official docs):**
- `$state` on an array/object creates a deeply reactive proxy -- `chatState.messages.push(msg)` triggers reactivity without spread operators
- `$derived` recalculates only when dependencies change -- efficient for filtered event lists
- `.svelte.js` files can use runes outside components -- shared state across the component tree
- SSR safety: this app disables SSR (`ssr = false` in layout), so module-level `$state` is safe. If SSR were ever enabled, use `getContext/setContext` for per-request isolation.

**Why NOT Svelte stores (writable/readable):** Stores are Svelte 4 era. They still work but are considered legacy. Runes are the current standard and require less boilerplate (no `$` prefix subscriptions, no `subscribe()` calls).

**Why NOT external state library (Zustand, etc.):** Svelte 5 runes replace all state management needs for this scope. Adding an external library would be importing a solution to a problem Svelte already solved.

**Confidence:** HIGH for the pattern; MEDIUM for the exact API shape. Svelte 5 runes are well-documented. The `.svelte.js` shared state pattern is the recommended current approach.

### 6. Component Architecture

Open WebUI (the most-deployed SvelteKit AI chat app) provides the reference hierarchy:

```
+layout.svelte              -- App shell, sidebar
  Sidebar.svelte            -- Session list, new chat button
  +page.svelte              -- Chat view
    ChatMessages.svelte     -- Message list container
      ChatMessage.svelte    -- Individual message bubble (user or assistant)
        MarkdownContent.svelte -- Rendered markdown with code highlighting
        ActivityPanel.svelte   -- Expandable SSE event log (tool calls, Synapse)
          ActivityEvent.svelte -- Single event: tool / synapse_question / task_*
    ChatInput.svelte        -- Textarea, send button, stop button, status
```

**ActivityPanel design decision:** Place the activity display INLINE within the assistant message bubble (like Claude Code's tool display), not as a separate drawer or sidebar panel. Rationale:
- Events belong to their triggering message temporally
- Collapsing activity does not disturb the message flow
- Matches the Claude/ChatGPT pattern users already know

**ActivityEvent rendering per event type:**

| SSE Event | Display |
|-----------|---------|
| `intent` | Badge: "Synapse workflow" / "RAG search" / "Direct chat" |
| `synapse_start` | Header: "Planning..." |
| `synapse_question` | Q card: question text |
| `synapse_answer` | A card under Q: answer text |
| `task_start` | Task row: spinner + description |
| `task_done` | Task row: checkmark + description |
| `tasks_complete` | Summary: "N tasks completed" (collapses task list) |
| `tool` | Tool row: tool name, error indicator if `hadError` |
| `auto_save` | Subtle indicator: save icon |
| `loop` | Warning: loop detected (developer-visible) |

**Always-use-streaming rule:** The frontend always calls `/api/chat/stream`. Simple responses arrive quickly through the same event pipeline (`done` event with final response). The frontend does not decide which endpoint to use -- that complexity would require predicting whether the orchestrator will trigger Synapse.

### 7. Session Persistence via localStorage

The backend generates session IDs (`default-{timestamp}`) if none is provided. The frontend should generate and persist its own session ID.

```javascript
// web/src/lib/state/session.svelte.js

function initSessionId() {
  const stored = localStorage.getItem('chimera_session_id');
  if (stored) return stored;
  const id = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem('chimera_session_id', id);
  return id;
}

export const sessionState = $state({
  sessionId: typeof window !== 'undefined' ? initSessionId() : null,
});

export function newSession() {
  const id = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem('chimera_session_id', id);
  sessionState.sessionId = id;
}
```

**Why localStorage, not cookies:** No server-side session lookup is needed. The session ID is sent in the POST body. localStorage is simpler than cookie management.

**Session lifecycle on the backend:** Sessions survive for 2 hours of inactivity (TTL). Page reloads reuse the same session ID, continuing the conversation. "New Chat" generates a fresh ID, starting a new session.

**SSR safety note:** `localStorage` only exists in the browser. The `typeof window !== 'undefined'` guard is necessary even with `ssr = false` because SvelteKit can still evaluate module code during prerendering analysis. Initializing in `onMount` is the safest alternative.

### 8. Development Workflow

**Two-terminal development:**

```bash
# Terminal 1: Backend (runs on :3210)
node chimera-chat.js

# Terminal 2: Frontend dev server (runs on :5173)
cd web && npm run dev
```

**Vite proxy configuration (web/vite.config.js):**

```javascript
export default {
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3210',
        changeOrigin: false,
      }
    }
  }
};
```

During development, the browser hits `http://localhost:5173`. All `/api/*` requests are proxied to `:3210` transparently. HMR works for Svelte component changes. The CORS headers on chimera-chat.js are a belt-and-suspenders backup but are not needed with the proxy.

**Production build and serve:**

```bash
cd web && npm run build
# Outputs to web/build/

node chimera-chat.js
# Serves both /api/* and web/build/* on port 3210
```

**Confidence:** HIGH -- this is exactly the Open WebUI development pattern. Vite proxy is a first-class Vite feature.

### 9. Project Structure

```
chimera/
  chimera-chat.js           MODIFIED: /api/ prefix + static file serving (~50 new lines)
  chimera-orchestrator.js   UNCHANGED
  web/                      NEW: SvelteKit project
    package.json
    svelte.config.js        adapter-static with fallback: 'index.html'
    vite.config.js          proxy /api -> localhost:3210 for dev
    src/
      app.html              Root HTML template
      routes/
        +layout.js          export const ssr = false
        +layout.svelte      App shell: sidebar + main content slot
        +page.svelte        Chat view (default route)
        settings/
          +page.svelte      Settings page (future)
      lib/
        api/
          client.js         fetch wrappers; streamChat() SSE parser
        state/
          chat.svelte.js    chatState: messages, streamEvents, isStreaming
          session.svelte.js sessionState: sessionId, localStorage persistence
        components/
          ChatMessages.svelte   Message list; auto-scroll to bottom
          ChatMessage.svelte    Message bubble: user or assistant
          MarkdownContent.svelte  marked + highlight.js rendering
          ActivityPanel.svelte  Expandable SSE event list, inline in message
          ActivityEvent.svelte  Single event renderer by type
          ChatInput.svelte      Textarea, send, stop button
          Sidebar.svelte        Session list, new chat
          StatusBar.svelte      /api/health indicator (future)
          ui/               shadcn-svelte generated components
    static/
      favicon.png
    build/                  OUTPUT (gitignored) -- served by chimera-chat.js
```

**Why `web/` subdirectory, not root-level SvelteKit:**
- `chimera-chat.js` is the primary entry point; the frontend is a sub-project
- `web/build/` is unambiguous as the build output
- `web/package.json` keeps frontend dependencies separate from any future Node.js tooling
- Matches the Open WebUI pattern (Python backend at root, SvelteKit in `src/` for their case)

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `chimera-chat.js` | HTTP server, API routing, static file serving, session TTL management | `chimera-orchestrator.js`, filesystem (`web/build/`) |
| `chimera-orchestrator.js` | AI orchestration, intent routing, tool execution, Synapse | LM Studio (port 1235), RAG Stack (port 8080) |
| `web/src/lib/api/client.js` | HTTP fetch wrappers, SSE stream parser, AbortController lifecycle | `chimera-chat.js` via HTTP |
| `web/src/lib/state/chat.svelte.js` | Reactive chat state: messages array, current stream events, streaming flag | `client.js` (source of truth), UI components (consumers) |
| `web/src/lib/state/session.svelte.js` | Session ID generation and localStorage persistence | `chat.svelte.js`, `client.js` |
| `ChatMessages.svelte` | Render message list, manage auto-scroll, detect streaming state | `chat.svelte.js` |
| `ChatMessage.svelte` | Render single message bubble, trigger ActivityPanel for in-progress messages | `chat.svelte.js` |
| `ActivityPanel.svelte` | Show real-time SSE events (tool calls, Synapse workflow), collapsible | `chat.svelte.js` (stream events) |
| `ChatInput.svelte` | Capture user input, send/stop controls, disabled-while-streaming guard | `client.js`, `chat.svelte.js` |

---

## Data Flow

### Simple Chat Message

```
User types message, hits Enter
  -> ChatInput.svelte: calls streamChat(message, sessionId)
  -> client.js: POST /api/chat/stream
  -> chimera-chat.js: creates/gets session, sets up SSE response
  -> chimera-orchestrator.js: processMessage() -> LLM loop
  -> SSE events stream back: intent, tool (0-N times), done
  -> client.js: parses SSE line-by-line, calls onEvent(type, data)
  -> chat.svelte.js: appends to streamEvents[], marks isStreaming = true
  -> ActivityPanel.svelte: reactively renders tool events (if any)
  -> 'done' event arrives:
     -> chat.svelte.js: adds final message to messages[], clears streamEvents, isStreaming = false
     -> ChatMessages.svelte: renders new message bubble
     -> MarkdownContent.svelte: parses markdown, applies syntax highlighting
```

### Synapse Workflow

```
User types "build a calculator app"
  -> Same flow start
  -> orchestrator detects intent: 'synapse'
  -> Events stream: intent, synapse_start,
       synapse_question (x N), synapse_answer (x N),
       task_start (x N), tool (x M per task), task_done (x N),
       tasks_complete, done
  -> Each event appended to chat.svelte.js.streamEvents
  -> ActivityPanel.svelte shows live:
       - Intent badge
       - Q&A exchange cards
       - Task checklist with live spinner -> checkmark transitions
       - Tool usage rows within each task
  -> 'done' arrives: final message added, activity collapses
```

### Page Reload / Session Resume

```
User reloads page
  -> session.svelte.js: reads sessionId from localStorage
  -> No message history is restored (messages live in browser state only)
  -> Next message sent uses same sessionId
  -> Backend finds existing session in Map (if within 2hr TTL)
  -> Conversation context (LLM history) continues from server side
  -> Note: displayed messages are gone (UI messages not persisted in v1)
```

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single user, local | Current design is correct. No changes needed. |
| 5-10 messages in conversation | No performance concerns. DOM is trivial. |
| 100+ messages in a session | Monitor for scroll performance. Add virtual scroll if sluggish (`@humanspeak/svelte-virtual-list` supports dynamic heights). Open WebUI has this issue with large histories (documented in their GitHub discussions). |
| Multiple simultaneous users | Not in scope. Backend already limits to 20 sessions with 2hr TTL. |

**Virtual scroll note:** For v1 (single user, typical conversations), virtual scroll is premature. Add it if and when performance is actually observed to degrade. The backend TTL (2hr) and max session count (20) naturally bound conversation length.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Running a Separate SvelteKit Server in Production

**What people do:** Use `npm run preview` (SvelteKit's preview server) alongside chimera-chat.js, keeping two running processes.
**Why it's wrong:** Two processes to start/stop/monitor, CORS complexity, defeats local-first simplicity.
**Do this instead:** Build to static files with adapter-static; serve from chimera-chat.js. Single process, single port.

### Anti-Pattern 2: Using EventSource for POST-based SSE

**What people do:** Try to use the browser `EventSource` API with `POST /api/chat/stream`.
**Why it's wrong:** EventSource only supports GET requests. This would require redesigning the backend API to accept GET with query params, or implementing a "register then stream" two-step flow.
**Do this instead:** fetch + ReadableStream. ~35 lines. No library. Works today with zero backend changes.

### Anti-Pattern 3: Polling Instead of Streaming

**What people do:** Use `setInterval(() => fetch('/api/chat'), 1000)` to poll for completion.
**Why it's wrong:** Misses all intermediate events (tool usage, Synapse Q&A, task progress). Adds 1s+ latency. Wastes resources. Loses the primary Chimera differentiator (workflow transparency).
**Do this instead:** Stream everything via `/api/chat/stream`. Even simple responses benefit from instant feedback.

### Anti-Pattern 4: Dual Endpoint Logic in the Frontend

**What people do:** Inspect the message to predict if Synapse will be triggered, then call `/api/chat` for "simple" messages and `/api/chat/stream` for "complex" ones.
**Why it's wrong:** The frontend cannot predict orchestrator behavior. Creates two code paths to maintain. The 429 busy check only happens once if both endpoints share the same activeLocks.
**Do this instead:** Always use `/api/chat/stream`. Simple responses stream quickly with fewer events.

### Anti-Pattern 5: Storing Message History in the Backend for Display

**What people do:** Add a REST endpoint to retrieve the full conversation transcript for UI display, storing formatted messages in the session Map.
**Why it's wrong:** The session Map stores event logs (raw SSE events), not rendered messages. Adding message persistence to chimera-chat.js increases scope. The LLM context lives in the session internally and doesn't need to be re-exposed.
**Do this instead:** Keep rendered message history in frontend `$state`. It lives for the browser session. Persistent history across sessions is a separate feature requiring database work -- defer to post-MVP.

### Anti-Pattern 6: Module-Level $state with SSR Enabled

**What people do:** Use module-level `$state` in `.svelte.js` files while SSR is enabled.
**Why it's wrong:** Module-level state is shared across requests on the server. User A's messages could leak to User B (irrelevant for single-user local, but worth knowing).
**Do this instead:** This app disables SSR (`ssr = false` in `+layout.js`). Module-level `$state` is safe. If SSR is ever re-enabled, move shared state to `getContext/setContext` in the root layout.

### Anti-Pattern 7: Re-parsing Full Markdown on Every SSE Chunk

**What people do:** During streaming, call `marked(accumulatedText)` on every new SSE chunk and replace `innerHTML`.
**Why it's wrong:** O(n²) complexity as response grows. Re-parsing causes layout flicker. Syntax highlighting re-runs on every character.
**Do this instead:** During streaming, append raw text (or use `streaming-markdown` for incremental DOM updates). Run full `marked` + `highlight.js` once on the `done` event when the complete response is available.

---

## Open WebUI Precedent

Open WebUI (50k+ GitHub stars) validates this architecture at production scale:

| Aspect | Open WebUI | Chimera |
|--------|-----------|---------|
| Frontend framework | SvelteKit | SvelteKit |
| Build approach | Static build via Vite | Static build via adapter-static |
| Backend | FastAPI (Python) | http.createServer (Node.js) |
| Static serving | FastAPI mounts `build/` | Custom `serveStatic()` in chimera-chat.js |
| Dev workflow | Two terminals (uvicorn + npm run dev) | Two terminals (node + npm run dev) |
| API proxy in dev | Vite `server.proxy` config | Vite `server.proxy` config |
| Production | Single process serves both | Single process serves both |
| State management | Svelte 4 stores | Svelte 5 runes (current standard) |
| Component hierarchy | Chat > Messages > ResponseMessage | Chat > ChatMessages > ChatMessage |
| Tool call display | Inline in message | Inline ActivityPanel in message |

The pattern is proven at scale. Chimera's simpler scope (single user, local only, no auth) means fewer edge cases.

---

## Suggested Build Order

Dependencies flow strictly downward -- later phases require earlier ones.

### Phase 1: Static Shell + Serving Integration

**What to build:**
1. Scaffold `web/` SvelteKit project with adapter-static
2. Add `serveStatic()` to `chimera-chat.js`
3. Prefix all API routes with `/api/`
4. Update test scripts for new prefix
5. Configure Vite proxy in `web/vite.config.js`
6. Basic layout: sidebar placeholder + chat area (no functionality, no real data)

**Why first:** Establishes the full pipeline. Proves `npm run build` in `web/` + `node chimera-chat.js` serves the app at `:3210` before any chat logic is added.

**Testable:** Browse `http://localhost:3210` and see the SvelteKit app. API endpoints still work at `/api/*`.

**Likely needs phase research:** No -- this is a well-understood static-serving pattern.

### Phase 2: Chat + SSE Streaming

**What to build:**
1. `web/src/lib/api/client.js` -- `streamChat()` with SSE parser
2. `web/src/lib/state/chat.svelte.js` -- reactive message + event state
3. `web/src/lib/state/session.svelte.js` -- localStorage session ID
4. `ChatInput.svelte` -- textarea, send/stop
5. `ChatMessage.svelte` -- user and assistant bubbles
6. `ChatMessages.svelte` -- list container with auto-scroll
7. Wire: input -> stream -> state -> render

**Why second:** Core value -- send messages and receive streaming responses. All other phases build on this.

**Testable:** Ask a simple question, see the response stream in token by token. Stop button cancels.

**Likely needs phase research:** SSE parser edge cases (multi-line data, partial chunks). Svelte 5 runes pattern in practice.

### Phase 3: Activity Panel + Synapse Visualization

**What to build:**
1. `ActivityPanel.svelte` -- collapsible container, appears inline in assistant message during streaming
2. `ActivityEvent.svelte` -- per-event-type rendering (tool rows, Q&A cards, task checklist)
3. Connect `streamEvents` from `chat.svelte.js` to ActivityPanel
4. Synapse workflow progress: Q&A phase display, task checklist with live status
5. Error state rendering

**Why third:** Chimera's primary differentiator. Requires streaming (Phase 2) as the event source.

**Testable:** Ask "build a calculator app" -- watch Synapse Q&A, task cards, and tool calls appear in real-time.

**Likely needs phase research:** Animation and transition patterns for task completion. Collapse behavior when `tasks_complete` arrives.

### Phase 4: Polish + Markdown + Session Management

**What to build:**
1. `MarkdownContent.svelte` -- `marked` + `highlight.js` rendering (post-stream)
2. Code block copy buttons
3. Dark mode as default (Tailwind CSS `dark:` classes, `prefers-color-scheme` detection)
4. Sidebar session list with "New Chat" button
5. `StatusBar.svelte` -- `/api/health?deep=true` indicator
6. Keyboard shortcuts (Ctrl+N new chat, Escape cancel)
7. Responsive layout (sidebar collapses on narrow screens)

**Why last:** Polish features. Core functionality (stream, display, activity) must work first.

**Likely needs phase research:** Streaming markdown approach (`streaming-markdown` library integration vs incremental DOM approach).

---

## Sources

- Chimera codebase: `chimera-chat.js` (355 lines, direct analysis) -- HIGH confidence
- [SvelteKit Single-Page Apps docs](https://svelte.dev/docs/kit/single-page-apps) -- HIGH confidence (WebFetch verified)
- [SvelteKit adapter-static docs](https://svelte.dev/docs/kit/adapter-static) -- HIGH confidence (WebFetch verified)
- [SvelteKit state management docs](https://svelte.dev/docs/kit/state-management) -- HIGH confidence (WebFetch verified)
- [The missing guide to adapter-static](https://khromov.se/the-missing-guide-to-understanding-adapter-static-in-sveltekit/) -- HIGH confidence (WebFetch verified)
- [Open WebUI frontend structure](https://deepwiki.com/open-webui/open-webui/2.1-frontend-structure) -- MEDIUM confidence (WebFetch, secondary source)
- [Svelte 5 runes for real-time data](https://dev.to/polliog/real-world-svelte-5-handling-high-frequency-real-time-data-with-runes-3i2f) -- HIGH confidence (WebFetch verified, confirms $state array mutation pattern)
- [Svelte 5 shared state patterns](https://fubits.dev/notes/svelte-5-patterns-simple-shared-state-getcontext-tweened-stores-with-runes/) -- MEDIUM confidence (WebFetch, author blog)
- [Open WebUI large history performance issue](https://github.com/open-webui/open-webui/discussions/13787) -- MEDIUM confidence (GitHub discussion, real-world data point)
- [svelte-virtual-list for Svelte 5](https://github.com/humanspeak/svelte-virtual-list) -- MEDIUM confidence (WebSearch, npm package)
- [Vite server.proxy for SvelteKit](https://github.com/sveltejs/kit/discussions/2778) -- MEDIUM confidence (GitHub discussion)

---
*Architecture research for: Chimera Web UI — SvelteKit frontend integrating with existing Node.js chat server*
*Researched: 2026-03-12*
