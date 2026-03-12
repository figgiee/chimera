# Architecture: Chimera Web Frontend Integration

**Domain:** Web frontend for local AI assistant
**Researched:** 2026-03-12
**Confidence:** HIGH (based on codebase analysis + verified patterns from Open WebUI and SvelteKit docs)

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
4. **AbortController** -- cancellation on client disconnect
5. **Event system** -- `session.onEvent(event)` callback, SSE endpoint wraps this to `sendSSE(res, event.type, event)`
6. **CORS enabled** -- `Access-Control-Allow-Origin: *` on all responses
7. **No static file serving** -- 404 for anything not matching API routes

## Recommended Architecture (To-Be)

```
 User (browser)
       |
       v
 chimera-chat.js (port 3210)
   |
   +-- /api/chat           POST --> JSON response
   |-- /api/chat/stream    POST --> SSE events
   |-- /api/health         GET
   |-- /api/sessions/:id/* GET
   |
   +-- /*  (static files)  --> web/build/ directory
   |   |-- /               --> index.html (SPA fallback)
   |   |-- /_app/*          --> JS/CSS bundles
   |   |-- /favicon.png     --> static assets
       |
       v
 chimera-orchestrator.js (unchanged)
       |
       +--> LM Studio (port 1235)
       +--> RAG Stack (port 8080)
```

### What Changes

| Component | Change | Rationale |
|-----------|--------|-----------|
| chimera-chat.js | Add `/api/` prefix to all API routes | Namespace separation: API routes vs static files |
| chimera-chat.js | Add static file serving function | Serve SvelteKit build output from `web/build/` |
| chimera-chat.js | Add SPA fallback | Unmatched routes serve `index.html` for client-side routing |
| web/ directory | NEW -- SvelteKit project | Frontend codebase |
| web/build/ | NEW -- build output | Static files served by chat server |

### What Does NOT Change

- chimera-orchestrator.js -- zero modifications needed
- Session management, event system, concurrency locks -- all stay
- RAG stack, LM Studio, Docker Compose -- unchanged
- API contract (request/response shapes) -- unchanged, just prefixed

## Integration Design

### 1. Static File Serving (Production)

Add a `serveStatic()` function to chimera-chat.js. This is approximately 40 lines of code in raw Node.js.

```javascript
const fs = require('node:fs');
const path = require('node:path');

const STATIC_DIR = path.join(__dirname, 'web', 'build');
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(res, urlPath) {
  // Prevent path traversal
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(STATIC_DIR, safePath);

  // Must stay within STATIC_DIR
  if (!filePath.startsWith(STATIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  // Try exact file, then index.html for directories
  let target = filePath;
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    target = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(target)) {
    // SPA fallback: serve index.html for unmatched routes
    target = path.join(STATIC_DIR, 'index.html');
    if (!fs.existsSync(target)) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
  }

  const ext = path.extname(target);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(target).pipe(res);
}
```

**Why raw fs.createReadStream instead of a library:** The project constraint is zero dependencies for the chat server. This approach uses only Node.js builtins, stays consistent with the existing pattern, and is sufficient for a single-user local app.

**Confidence:** HIGH -- this is a well-understood pattern. MDN documents it. Open WebUI does the equivalent in Python (FastAPI mounting static directory).

### 2. API Route Prefixing

Prefix all API routes with `/api/` to avoid collision with static file paths.

```javascript
// Before (current)
if (req.method === 'POST' && url.pathname === '/chat') { ... }

// After
if (req.method === 'POST' && url.pathname === '/api/chat') { ... }
```

Route resolution order in `handleRequest`:
1. OPTIONS (CORS preflight) -- any path
2. `/api/*` routes -- exact match on API paths
3. Static files -- everything else falls through to `serveStatic()`

**Migration:** The only consumer of the API today is curl/test scripts. Updating the prefix is low-risk. Test files (test_e2e.js, test_mini_project.js, test_synapse.js) need URL updates.

### 3. SSE Consumption in the Frontend

The existing `/chat/stream` endpoint uses a POST-initiated SSE stream. This is NOT compatible with the browser `EventSource` API (which only supports GET). Two options:

**Option A: fetch + ReadableStream (RECOMMENDED)**

```javascript
// In the SvelteKit frontend
async function streamChat(message, sessionId) {
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        const eventType = line.slice(7);
        // next data: line has the payload
      }
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        // dispatch to state management
      }
    }
  }
}
```

**Option B: EventSource (NOT recommended)**

Would require changing the backend to accept GET requests for streaming, moving the message payload to query params or a pre-registered session. This is a significant API change for marginal benefit.

**Recommendation:** Use fetch + ReadableStream. The POST-initiated SSE pattern is already working and matches what Open WebUI does. No backend changes needed.

**Confidence:** HIGH -- fetch + ReadableStream is the standard pattern for POST-based SSE. Open WebUI uses this same approach.

### 4. State Management (Svelte 5 Runes)

Svelte 5 replaces stores with runes (`$state`, `$derived`, `$effect`). Use a reactive class pattern for chat state.

```
web/src/lib/
  state/
    chat.svelte.ts     -- ChatState class with $state runes
    sessions.svelte.ts -- Session list management
    streaming.svelte.ts -- SSE stream handling
```

**ChatState design:**

```typescript
// Conceptual -- the reactive chat state
class ChatState {
  messages = $state<Message[]>([]);
  sessionId = $state<string | null>(null);
  isStreaming = $state(false);
  currentEvents = $state<StreamEvent[]>([]);  // live SSE events
  error = $state<string | null>(null);

  // Derived
  lastMessage = $derived(this.messages.at(-1));
  hasSynapseActivity = $derived(
    this.currentEvents.some(e => e.type.startsWith('synapse_'))
  );
}
```

**Why runes over stores:** Svelte 5 runes are the current standard. Stores still work but are considered legacy. Runes provide fine-grained reactivity and work naturally in classes and .svelte.ts files.

**Confidence:** MEDIUM-HIGH -- Svelte 5 runes are well-documented and the recommended approach, but streaming + runes integration is less documented. The pattern above is sound but may need iteration.

### 5. Handling Dual Nature: Quick vs Long Requests

The frontend must handle two fundamentally different interaction patterns:

| Pattern | Endpoint | Duration | UI Behavior |
|---------|----------|----------|-------------|
| Quick chat | POST /api/chat | 2-15 seconds | Show typing indicator, then response |
| Synapse workflow | POST /api/chat/stream | 30s-5min | Show real-time activity panel |

**Recommended approach:** Always use the streaming endpoint (`/api/chat/stream`).

Rationale:
- Simple responses arrive quickly via SSE too (just fewer events before `done`)
- No need for the frontend to decide which endpoint to call
- The `done` event always carries the final response + stats
- Activity panel shows events regardless -- simple chats just show fewer

**Event-to-UI mapping:**

| SSE Event | UI Component |
|-----------|--------------|
| `tool` | Activity panel: "Used [tool_name]" with expand for details |
| `synapse_question` | Activity panel: Show Q&A exchange |
| `synapse_answer` | Activity panel: Show answer below question |
| `task_start` | Activity panel: Task card with spinner |
| `task_done` | Activity panel: Task card with checkmark |
| `done` | Message bubble: Final response, hide typing indicator |
| `error` | Error toast or inline error message |

### 6. File Structure

```
chimera/
  chimera-chat.js          # Modified: add /api/ prefix + static serving
  chimera-orchestrator.js  # UNCHANGED
  web/                     # NEW: SvelteKit project
    package.json
    svelte.config.js       # adapter-static, fallback: 'index.html'
    vite.config.ts         # proxy /api/ to localhost:3210 in dev
    src/
      app.html
      routes/
        +layout.svelte     # Root layout: sidebar + main area
        +page.svelte       # Chat view (default route)
      lib/
        components/
          ChatMessage.svelte
          ChatInput.svelte
          ActivityPanel.svelte
          ActivityEvent.svelte
          Sidebar.svelte
        state/
          chat.svelte.ts
          streaming.svelte.ts
        api/
          client.ts        # fetch wrappers for /api/* endpoints
    static/
      favicon.png
    build/                 # OUTPUT: served by chimera-chat.js
```

**Why `web/` not root-level SvelteKit:**
- Keeps clear separation between backend (Node.js) and frontend (SvelteKit)
- Build output in `web/build/` is easy to reference from chimera-chat.js
- Matches the mental model: `chimera-chat.js` serves `web/build/`
- Open WebUI uses a similar separation (frontend src vs backend Python)

**Confidence:** HIGH -- this is a common monorepo-lite pattern.

### 7. Development Workflow

In development, run two processes:

**Terminal 1: Backend**
```bash
node chimera-chat.js
# Runs on port 3210
```

**Terminal 2: Frontend dev server**
```bash
cd web && npm run dev
# Runs on port 5173 (Vite default)
```

**Vite proxy configuration** (in `web/vite.config.ts`):
```typescript
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3210'
    }
  }
});
```

This means during development:
- Browser hits `http://localhost:5173` (Vite dev server, HMR)
- API calls to `/api/*` are proxied to `http://localhost:3210`
- No CORS issues because same origin from the browser's perspective

In production:
- `cd web && npm run build` generates `web/build/`
- `node chimera-chat.js` serves both API and static files on port 3210
- Single process, single port

**Confidence:** HIGH -- this is exactly how Open WebUI works (two terminals in dev, single process in production). Vite proxy is well-documented.

### 8. SvelteKit Configuration

```javascript
// web/svelte.config.js
import adapter from '@sveltejs/adapter-static';

export default {
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',  // SPA fallback for client-side routing
      precompress: false,       // not needed for local
      strict: true
    }),
    paths: {
      base: ''  // served from root
    }
  }
};
```

**Why adapter-static, not adapter-node:**
- adapter-node produces a Node.js server -- we already have one (chimera-chat.js)
- adapter-static produces pure HTML/CSS/JS files that our server can serve
- No duplicate server processes
- Simpler deployment: just copy files

**Why fallback: 'index.html':**
- Enables client-side routing (SvelteKit handles `/`, `/settings`, etc.)
- Our static file server falls back to index.html for unmatched routes
- This is the standard SPA pattern

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| chimera-chat.js | HTTP server, API routing, static file serving, session management | orchestrator, filesystem (static files) |
| chimera-orchestrator.js | AI orchestration, intent routing, tool execution | LM Studio, RAG Stack |
| web/src/lib/api/client.ts | HTTP client for API calls, SSE stream parsing | chimera-chat.js via fetch |
| web/src/lib/state/chat.svelte.ts | Reactive chat state (messages, events, streaming status) | client.ts, UI components |
| web/src/lib/state/streaming.svelte.ts | SSE stream lifecycle (connect, parse, dispatch, disconnect) | client.ts, chat.svelte.ts |
| web/src/lib/components/*.svelte | UI rendering | state classes via runes |

## Data Flow

### Simple Chat Message
```
User types message
  -> ChatInput.svelte captures submit
  -> streaming.svelte.ts calls fetch('/api/chat/stream', {POST})
  -> chimera-chat.js receives, creates/gets session
  -> orchestrator.processMessage() runs LLM loop
  -> Events emitted via onEvent callback -> sendSSE to response
  -> streaming.svelte.ts parses SSE, updates chat.svelte.ts state
  -> ChatMessage.svelte reactively renders new message
```

### Synapse Workflow
```
User types "build a calculator app"
  -> Same flow as above, but orchestrator detects intent
  -> Events stream: synapse_start, synapse_question, synapse_answer (x N),
     task_start, tool, task_done (x N), tasks_complete, done
  -> Each event updates chat.svelte.ts.currentEvents array
  -> ActivityPanel.svelte reactively shows workflow progress
  -> Final 'done' event adds completed message to messages array
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Separate Frontend Process in Production
**What:** Running `npm run preview` or a separate SvelteKit server alongside chimera-chat.js
**Why bad:** Two processes to manage, CORS complexity, defeats local-first simplicity
**Instead:** Build to static files, serve from chimera-chat.js. Single process.

### Anti-Pattern 2: Using EventSource for POST-based SSE
**What:** Trying to use the browser EventSource API with POST /chat/stream
**Why bad:** EventSource only supports GET requests. Would require backend API redesign.
**Instead:** Use fetch + ReadableStream to parse SSE manually. ~30 lines of code.

### Anti-Pattern 3: Polling Instead of SSE
**What:** Using setInterval to poll /api/chat for completion
**Why bad:** Misses intermediate events (tool usage, Synapse Q&A), adds latency, wastes resources
**Instead:** Stream everything via /api/chat/stream. Even simple responses benefit from real-time feedback.

### Anti-Pattern 4: Dual-Endpoint Frontend Logic
**What:** Frontend decides whether to call /api/chat or /api/chat/stream based on guessing complexity
**Why bad:** Frontend cannot predict if orchestrator will trigger Synapse. Creates two code paths.
**Instead:** Always use streaming endpoint. Simple responses arrive quickly with fewer events.

### Anti-Pattern 5: Storing Messages in Backend for UI
**What:** Adding a REST endpoint to retrieve message history from the server
**Why bad:** The current session Map stores logs (events), not rendered messages. Adding message persistence to chimera-chat.js increases scope.
**Instead:** Keep message history in frontend state (Svelte runes). It lives for the browser session. Persistent history is a later feature (requires database, out of scope for v1).

## Suggested Build Order

This ordering is driven by dependency analysis and incremental testability.

### Phase 1: Static Shell + Serving
**Build:**
1. Scaffold SvelteKit project in `web/` with adapter-static
2. Add static file serving to chimera-chat.js
3. Prefix API routes with `/api/`
4. Update test files for new API prefix
5. Basic layout: sidebar + chat area (hardcoded/mock data)

**Why first:** Establishes the integration pattern. Everything else builds on this. Can verify the build pipeline works end-to-end before adding complexity.

**Testable:** Navigate to `http://localhost:3210`, see the SvelteKit app. API endpoints still work at `/api/*`.

### Phase 2: Chat + Streaming
**Build:**
1. API client module (fetch wrappers)
2. SSE stream parser (fetch + ReadableStream)
3. Chat state management (Svelte 5 runes)
4. ChatInput, ChatMessage components
5. Connect: type message -> stream response -> render

**Why second:** Core value -- send messages and see responses. Builds on Phase 1's serving + API prefix.

**Testable:** Type a message, see AI response stream in. Simple questions work.

### Phase 3: Activity Panel + Synapse Visualization
**Build:**
1. ActivityPanel component (collapsible sidebar or drawer)
2. Event-type-specific rendering (tool cards, Q&A display, task progress)
3. Synapse workflow progress indicator
4. Error display

**Why third:** Differentiator feature. Requires streaming (Phase 2) to be working. Shows the unique value of Chimera's orchestrator transparency.

**Testable:** Ask "build a calculator" -- see Synapse Q&A, task cards, tool usage in real-time.

### Phase 4: Polish + Session Management
**Build:**
1. Session persistence in localStorage (reuse session_id across page reloads)
2. New chat / session switching in sidebar
3. Health check indicator (calls /api/health?deep=true)
4. Markdown rendering in messages
5. Code block syntax highlighting
6. Responsive layout

**Why last:** Polish and UX features. Core functionality must work first.

## Open WebUI Precedent

Open WebUI (50k+ GitHub stars) validates this architecture:

| Aspect | Open WebUI | Chimera |
|--------|-----------|---------|
| Frontend framework | SvelteKit | SvelteKit |
| Build approach | Static build via Vite | Static build via adapter-static |
| Backend | FastAPI (Python) | http.createServer (Node.js) |
| Static serving | FastAPI mounts build directory | Custom serveStatic function |
| Dev workflow | Two terminals (uvicorn + npm run dev) | Two terminals (node + npm run dev) |
| API proxy in dev | Vite proxy config | Vite proxy config |
| Production | Single process serves both | Single process serves both |
| State management | Svelte stores (Svelte 4 era) | Svelte 5 runes (current standard) |

The pattern is proven at scale. Chimera's simpler scope (single user, local only) means fewer edge cases.

## Sources

- Chimera codebase: chimera-chat.js (355 lines), chimera-orchestrator.js (648 lines) -- direct analysis
- [SvelteKit adapter-static docs](https://svelte.dev/docs/kit/adapter-static) -- verified via WebFetch
- [Open WebUI architecture](https://deepwiki.com/open-webui/open-webui/2-architecture) -- verified via WebFetch
- [Open WebUI dev setup](https://deepwiki.com/open-webui/open-webui/17.1-development-environment-setup) -- verified via WebFetch
- [Svelte 5 runes and state management](https://www.loopwerk.io/articles/2025/svelte-5-stores/) -- WebSearch
- [SvelteKit state management docs](https://svelte.dev/docs/kit/state-management) -- WebSearch reference
- [Node.js static file server (MDN)](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/Node_server_without_framework) -- WebSearch reference
- [Vite server proxy for SvelteKit](https://github.com/sveltejs/kit/discussions/2778) -- WebSearch reference
