# Domain Pitfalls: Chimera Web Frontend

**Domain:** Web frontend for a local AI assistant with SSE streaming, tool execution display, and markdown rendering
**Researched:** 2026-03-12
**Specific to:** Adding a frontend to an existing plain Node.js HTTP server (no Express) with SSE streaming

---

## Critical Pitfalls

Mistakes that cause rewrites, security vulnerabilities, or fundamental UX failures.

### Pitfall 1: EventSource Cannot POST — Using the Wrong SSE Client

**What goes wrong:** The browser's native `EventSource` API only supports GET requests. Chimera's `/chat/stream` endpoint is POST (it sends `message`, `session_id`, `project_id` in the body). Developers reach for `EventSource`, discover it can't POST, then either: (a) hack message content into query params (length limits, URL encoding bugs, security exposure), or (b) switch to WebSockets mid-build (massive scope change).

**Why it happens:** Every SSE tutorial starts with `new EventSource(url)`. The POST limitation is rarely mentioned until you hit it.

**Consequences:** Entire streaming architecture must be reworked after initial implementation. Query-param hacks break with long messages and expose user input in server logs and browser history.

**How to avoid:** Use `fetch()` with `response.body.getReader()` and a `TextDecoder` to parse SSE from a POST response. This is the pattern used by ChatGPT's frontend and Azure's `@microsoft/fetch-event-source` library. The existing Chimera `/chat/stream` endpoint already returns `text/event-stream` from POST — just consume it with fetch, not EventSource.

**Code pattern:**
```javascript
const res = await fetch('/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message, session_id })
});
const reader = res.body.getReader();
const decoder = new TextDecoder();
// Parse SSE lines from chunks
```

**Warning signs:** If you see `new EventSource(` anywhere in the codebase, it is wrong for this project.

**Phase to address:** Phase 1 (basic chat). This is the foundation of all streaming UI.

**Confidence:** HIGH — verified against Chimera's existing POST-based `/chat/stream` endpoint and MDN EventSource documentation.

---

### Pitfall 2: XSS Through AI-Generated Markdown

**What goes wrong:** The AI model generates markdown containing HTML, JavaScript, or crafted links. When rendered with a markdown-to-HTML library (marked, markdown-it, etc.), this becomes executable code in the browser. An attacker who controls prompt input (or poisons RAG documents) can inject `<script>` tags, `<img onerror=>` handlers, or `javascript:` URIs that execute in the user's browser session.

**Why it happens:** Developers treat AI output as "safe internal data" and render it with `innerHTML` or unsanitized markdown conversion. This is formally recognized as OWASP LLM05:2025 (Insecure Output Handling). Real-world XSS vulnerabilities were found in DeepSeek's chat interface and Lenovo's Lena AI chatbot through this exact vector. CVE-2026-22813 documented unsafe rendering of AI-generated markdown in OpenCode's web interface. markdown-it 14.1.0 (CVE-2025-7969) has a confirmed XSS via custom highlight functions in fenced code blocks.

**Consequences:** Arbitrary JavaScript execution. In Chimera's case, this could invoke tool calls (file operations, shell commands) or exfiltrate RAG data. Even though Chimera is local-only, XSS is still dangerous if the user opens a malicious link that interacts with the local Chimera server.

**How to avoid:**
1. Convert markdown to HTML with a parser (marked or markdown-it)
2. Sanitize the HTML output with DOMPurify AFTER conversion (not before)
3. Set a Content-Security-Policy header that blocks inline scripts
4. Never use `innerHTML` with raw model output — always sanitize first
5. Strip `javascript:` URIs from links

**Warning signs:** Search codebase for `innerHTML`, `.html(`, or `dangerouslySetInnerHTML` without adjacent DOMPurify calls.

**Phase to address:** Phase 1 when markdown rendering is first introduced. Retrofitting sanitization is error-prone.

**Confidence:** HIGH — multiple CVEs and real-world exploits documented in 2025-2026.

---

### Pitfall 3: SSE Memory Leak from Unclosed Connections

**What goes wrong:** The fetch-based SSE reader is not properly aborted when: (a) the user navigates away from the chat, (b) the component unmounts, (c) the user sends a new message before the previous one finishes, or (d) the browser tab is backgrounded. The ReadableStream stays open, the connection hangs, and memory accumulates. Over a multi-minute Synapse workflow session, this causes the browser tab to consume hundreds of MB.

**Why it happens:** Chimera sessions run 5-15 seconds per response, and Synapse workflows can emit dozens of events over several minutes. Unlike typical REST calls, the connection stays open. Developers forget cleanup because short requests "work fine" in testing. Chrome has a known delayed closure behavior — a tab navigating away can keep the connection visibly "open" server-side for up to a minute.

**Consequences:** Browser tab becomes sluggish. On the server side, Chimera's `activeLocks` set never clears for zombie connections. The existing 5-minute timeout in `chimera-chat.js` helps server-side, but the client-side leak persists.

**How to avoid:**
1. Use an `AbortController` for every fetch call
2. Call `controller.abort()` in cleanup (component unmount, new message sent, navigation)
3. Always call `reader.cancel()` in finally blocks
4. For vanilla JS: attach cleanup to `beforeunload` and to any "new message" handler
5. For SvelteKit: use `onDestroy` lifecycle hook

**Warning signs:** Open DevTools Memory tab, start a Synapse workflow, navigate away mid-stream, check if connections/memory are released.

**Phase to address:** Phase 1. Hard to retrofit because every streaming call site needs the abort pattern.

**Confidence:** HIGH — standard browser behavior, verified with MDN ReadableStream documentation. Chrome delayed closure documented in bugzilla.mozilla.org/show_bug.cgi?id=906896.

---

### Pitfall 4: MIME Type Errors When Serving Static Files from Plain Node.js HTTP Server

**What goes wrong:** Chimera uses `http.createServer()` with no framework. Adding static file serving (HTML, CSS, JS, images) requires manually mapping file extensions to MIME types. Missing or wrong MIME types cause: JS files treated as text (browser refuses to execute), CSS files ignored, SVGs not rendering. The browser console shows `Refused to execute script from '...' because its MIME type ('text/plain') is not executable`.

**Why it happens:** Express and other frameworks handle this automatically with `express.static()`. With raw `http.createServer()`, every Content-Type must be set manually. Developers forget `.mjs`, `.woff2`, `.svg`, `.json`, or `.map` extensions.

**Consequences:** The app loads but looks broken — no styles, no interactivity, missing fonts. Debugging is confusing because the files are served (200 status) but not applied.

**How to avoid:** Create a MIME type map at the start of the project:
```javascript
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
```
Default to `application/octet-stream` for unknown types. Test every asset type in the browser.

**Warning signs:** Open browser DevTools Network tab, check Content-Type headers on all loaded assets. Any `text/plain` on JS/CSS files is a bug.

**Phase to address:** Phase 1 — the very first thing that must work when serving the frontend.

**Confidence:** HIGH — inherent to the no-framework constraint documented in PROJECT.md.

---

### Pitfall 5: Silent Frontend Deadlock from Inconsistent SSE State

**What goes wrong:** The frontend state machine gets out of sync with the SSE event stream. For example: a `task_start` event arrives but the corresponding `task_done` never comes (server error, timeout, abort). The UI shows a spinner forever. Or: events arrive out of order during reconnection, leaving the message list in an inconsistent state. Open WebUI had exactly this bug — a "logical deadlock" where the frontend entered an unrecoverable state from orphaned message objects, with no errors in console or backend logs.

**Why it happens:** Chimera's event types form an implicit state machine (`synapse_start` → `synapse_question` → `synapse_answer` → `task_start` → `task_done` → `tasks_complete` → `done`). The frontend must handle every transition, including error/abort cases that skip steps.

**Consequences:** UI appears frozen. User refreshes, loses context. No error messages because the bug is logical, not a crash.

**How to avoid:**
1. Design an explicit state machine for the chat UI (idle → streaming → synapse_qa → executing_tasks → done/error)
2. Every state has a timeout that transitions to an error state
3. The `done` and `error` SSE events ALWAYS reset UI to idle state regardless of current state
4. Never depend on receiving every intermediate event — the `done` event must be self-sufficient
5. Add a client-side watchdog: if no SSE event received for 30 seconds during an active session, show "Connection may be lost" with a retry option

**Warning signs:** Kill the Chimera server mid-response and observe the frontend. If it hangs without showing an error, this pitfall is present.

**Phase to address:** Phase 1 design, but becomes critical in Phase 2 when Synapse workflow display is added. Design the state machine early.

**Confidence:** HIGH — verified by Open WebUI issue #15189 documenting this exact class of bug.

---

### Pitfall 6: Vite Dev Proxy Does Not Forward SSE Close Events

**What goes wrong:** During development, SvelteKit runs on port 5173 and the Chimera server runs on port 3210. Vite's `server.proxy` config routes `/chat/stream` to `http://127.0.0.1:3210`. This works for regular HTTP, but SSE has two known problems with Vite's proxy: (1) the http-proxy library buffers streaming responses, causing SSE events to appear in large batches instead of real-time, and (2) when the browser closes the connection, the SSE close event is NOT forwarded to the backend — the connection between Vite proxy and Chimera stays open.

**Why it happens:** Vite's dev proxy uses the `http-proxy` library, which has known buffering behavior with streaming responses (GitHub issue vitejs/vite#10851 and #13522). This creates a gap between dev experience and production behavior.

**Consequences:** SSE appears to work in dev, but events arrive in batches every few seconds instead of in real-time. The Chimera server's abort-on-disconnect mechanism (`req.on('close', () => abort.abort())`) never fires during development, so Chimera keeps processing even after the browser cancels. The bug is invisible until testing with the production setup.

**How to avoid:**
1. Add `changeOrigin: true` and explicitly set the proxy to pass through streaming responses
2. Test SSE behavior directly against port 3210 (bypassing Vite proxy) when debugging streaming issues
3. The `fallback: 'index.html'` + SPA mode means you can open the built static app directly from the Chimera server for streaming tests
4. For the proxy config, add headers to disable buffering:
```javascript
// vite.config.js
server: {
  proxy: {
    '/chat': {
      target: 'http://127.0.0.1:3210',
      changeOrigin: true,
      configure: (proxy) => {
        proxy.on('proxyRes', (proxyRes) => {
          // Ensure streaming headers pass through
          proxyRes.headers['cache-control'] = 'no-cache';
        });
      }
    }
  }
}
```

**Warning signs:** In development, if SSE events appear to "bunch up" and arrive after a delay rather than immediately, the proxy is buffering. Test the same request with `curl -N http://127.0.0.1:3210/chat/stream` to verify the backend streams immediately.

**Phase to address:** Phase 2 (SvelteKit). Critical to identify during the initial SvelteKit setup, not after the whole UI is built.

**Confidence:** MEDIUM — known Vite issue (multiple GitHub issues opened 2022-2025), but workarounds exist and behavior may differ by Vite version.

---

## Moderate Pitfalls

Mistakes that cause poor UX, performance problems, or technical debt.

### Pitfall 7: DOM Explosion from Long Conversations and Large Responses

**What goes wrong:** Every message is rendered as a full DOM node with syntax-highlighted code blocks. After 20-30 messages with code (typical Synapse workflow output), the DOM has thousands of nodes. Scrolling becomes janky, typing in the input lags, and syntax highlighting re-renders freeze the tab. ChatGPT itself suffers from this — a Chrome extension ("ChatGPT Lag Fixer") exists specifically to virtualize off-screen messages.

**Why it happens:** Rendering all messages seems natural and works fine for 5-10 messages. The 9B model's responses often include large code blocks (full file contents during build tasks), which generate massive DOM trees when syntax-highlighted.

**Consequences:** Tab becomes unusable after extended Synapse workflows (10+ task completions, each with code output).

**How to avoid:**
1. For vanilla HTML Phase 1: Limit rendered messages to the last 50. Older messages stay in memory but are removed from DOM. Add "Load earlier messages" button.
2. For SvelteKit Phase 2: Use virtual scrolling (render only visible messages). Svelte's `{#each}` with keyed items helps but is not virtual by default.
3. Lazy-load syntax highlighting: only highlight code blocks that are visible. Use `IntersectionObserver`.
4. Truncate extremely long code blocks (>200 lines) with "Show full output" expander.

**Warning signs:** Send 10 consecutive "build something" requests to trigger Synapse workflows. Measure scroll FPS and input latency after.

**Phase to address:** Phase 1 should implement message capping. Phase 2 should implement virtual scrolling.

**Confidence:** HIGH — documented in ChatGPT community forums and multiple chat UI performance studies.

---

### Pitfall 8: Auto-Scroll Fighting User Scroll

**What goes wrong:** The chat auto-scrolls to bottom on new SSE events (correct when user is at bottom). But if the user scrolls up to read earlier output, auto-scroll yanks them back down on every event. During Synapse workflows, events fire rapidly (tool calls, task progress), making it impossible to read earlier messages.

**Why it happens:** Naive implementation: `element.scrollTop = element.scrollHeight` on every event.

**Consequences:** Users cannot read streaming output while it is still arriving. Especially painful during 5-15 second model responses where the user wants to review the question while waiting.

**How to avoid:**
1. Track whether the user is "at bottom" (within ~50px of scrollHeight)
2. Only auto-scroll if user was at bottom before the new event
3. Show a "Scroll to bottom" floating button when user has scrolled up and new messages arrive
4. Debounce scroll-to-bottom calls (requestAnimationFrame, not every event)

**Warning signs:** Start a Synapse workflow, immediately scroll up. If you get yanked back down, the pitfall is present.

**Phase to address:** Phase 1. This is a v1 quality-of-life issue that is trivial to implement correctly upfront but annoying to retrofit.

**Confidence:** HIGH — universal chat UI pattern, well-documented.

---

### Pitfall 9: Mobile Keyboard Destroys Chat Layout

**What goes wrong:** On mobile, when the user taps the message input, the virtual keyboard appears and either: (a) pushes the entire page up, hiding the header, (b) covers the input field so the user can't see what they're typing, (c) breaks `100vh` layouts because `vh` doesn't account for the keyboard, or (d) on iOS specifically, doesn't resize the viewport at all, leaving content obscured. `position: fixed` elements break entirely when the iOS keyboard is open — they behave like `position: static`.

**Why it happens:** Mobile browsers handle the virtual keyboard inconsistently. iOS Safari does not resize the visual viewport when the keyboard appears (unlike Android Chrome). CSS `100vh` means different things on different mobile browsers. The amount of offscreen displacement varies with page height and scroll position, so no fixed padding value works.

**Consequences:** Chat is unusable on mobile. Users can't see their input or the latest messages while typing.

**How to avoid:**
1. Use `dvh` (dynamic viewport height) instead of `vh` for the chat container: `height: 100dvh`
2. Use `position: sticky` for the input area instead of `position: fixed` at bottom
3. On iOS, listen to `visualViewport.resize` event and adjust layout
4. Test on actual iOS Safari — simulators don't reproduce keyboard issues accurately
5. Set `<meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content">` (newer Chrome/Edge support)
6. Include `bottom: env(safe-area-inset-bottom)` on bottom-pinned elements with a `bottom: 0` fallback before it

**Warning signs:** Open the chat on an iPhone in Safari. Tap the input. If you can't see both the latest message and your input text, this pitfall is present.

**Phase to address:** Phase 2 (SvelteKit). For vanilla HTML Phase 1, mobile support is lower priority, but using `dvh` from the start prevents layout rewrites.

**Confidence:** MEDIUM — well-documented problem, but `dvh` browser support and `interactive-widget` are relatively new (verify current support).

---

### Pitfall 10: Dark Mode Flash (FOUC/FART)

**What goes wrong:** Page loads in light mode, then flashes to dark mode after JavaScript runs. If the user has selected dark mode (stored in localStorage), the page renders white first, then switches. For a tool used in dimly-lit environments (a developer's local AI assistant), this white flash is physically jarring.

**Why it happens:** Theme preference is read from localStorage in JavaScript, which runs after the initial paint. CSS `prefers-color-scheme` handles OS preference but not user-overridden preference stored in localStorage.

**Consequences:** Annoying white flash on every page load. Users perceive the app as janky.

**How to avoid:**
1. Add an inline `<script>` in the `<head>` (before any CSS/body) that reads localStorage and sets a class on `<html>`:
```html
<script>
  if (localStorage.theme === 'dark' ||
      (!localStorage.theme && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
</script>
```
2. Set `background-color` on `html` in CSS to the dark background color when `.dark` class is present
3. Never apply theme in `onMount`/`useEffect`/`DOMContentLoaded` — that is too late

**Warning signs:** Set dark mode, hard-refresh the page. If you see a white flash before dark mode applies, this pitfall is present.

**Phase to address:** Phase 1. Trivial to implement correctly from the start, painful to fix later because it requires restructuring where the theme script loads.

**Confidence:** HIGH — well-documented pattern with clear solution.

---

### Pitfall 11: Broken Code Blocks in Markdown During Streaming

**What goes wrong:** While the model is streaming, a code block is half-received: the opening ` ``` ` has arrived but the closing ` ``` ` has not. The markdown parser treats everything after the opening fence as code, breaking the entire message layout. Alternatively, the parser chokes on partial markdown and throws an error, stopping all rendering.

**Why it happens:** Markdown parsers expect complete documents. During SSE streaming, you receive character-by-character or chunk-by-chunk. The intermediate states are invalid markdown.

**Consequences:** Message area shows garbled formatting during streaming. Code blocks "eat" subsequent text. Layout jumps when the closing fence finally arrives.

**How to avoid:**
1. Before parsing, count backtick fences. If odd, append a closing fence to the string before parsing (display only, don't modify the stored message)
2. Use a markdown parser that handles partial/streaming content gracefully. `marked` is more tolerant than `markdown-it` for partial input.
3. During active streaming, render with a simpler parser or plain text with just newline handling. Switch to full markdown rendering only after the `done` event.
4. Accumulate the full response text and re-parse on each chunk (don't try to parse incremental diffs)
5. Consider `streaming-markdown` (3kB, purpose-built for this) which handles unterminated blocks gracefully

**Warning signs:** Send a request that generates a code block. Watch the rendering while tokens stream in. If the layout breaks mid-stream, this pitfall is present.

**Phase to address:** Phase 1. Any streaming chat UI must handle this.

**Confidence:** HIGH — inherent to streaming + markdown rendering, widely documented in AI chat UI development.

---

### Pitfall 12: SvelteKit adapter-static Prerendering Misconception

**What goes wrong:** Developers set `prerender = true` expecting adapter-static to generate populated HTML files, but the generated HTML is a shell with no rendered content (just the Svelte hydration script). The static output appears correct but doesn't actually contain rendered markup.

**Why it happens:** A subtle requirement: `ssr = true` must be set alongside `prerender = true` for adapter-static to include actual HTML content in the output. Prerender controls whether an HTML file is created at build time. SSR controls whether that HTML file contains the component's rendered markup. Disabling SSR (which some developers do to avoid issues with browser-only APIs like `localStorage`) silently strips content from prerendered pages.

**For Chimera specifically:** The SPA mode (adapter-static with `fallback: 'index.html'`) is the correct choice — the chat app is entirely client-side, has no server-rendered data, and all routes serve the same shell. SSR is not needed and should be disabled globally. The pitfall is accidentally enabling prerendering for some routes while SSR is off and expecting populated HTML — these routes will produce empty shells.

**How to avoid:**
1. Use SPA mode consistently: disable SSR globally in `+layout.js` with `export const ssr = false`
2. Use `fallback: 'index.html'` in adapter-static config (not `pages/404.html`)
3. Don't mix prerendering and SPA mode on different routes — pick one strategy
4. Test the build output: open `build/index.html` in a text editor and verify it contains meaningful `<div>` content (or accepts it's a shell)

**Warning signs:** Running `npm run build` succeeds but `build/index.html` contains only `<div id="svelte"></div>` with no child content. This is correct for SPA mode — but wrong if you expected prerendered content.

**Phase to address:** Phase 2 initial setup. Set the adapter-static configuration correctly before building any components.

**Confidence:** HIGH — documented in SvelteKit docs (svelte.dev/docs/kit/single-page-apps) and confirmed by GitHub issue #14471.

---

### Pitfall 13: ARIA Live Regions Silenced by Conditional Rendering

**What goes wrong:** A streaming chat message is an ideal candidate for `aria-live="polite"` (screen reader reads new content when user is idle). Developers add the attribute correctly but screen readers never announce streaming messages. The `aria-live` region works when tested with static content but silently fails with streaming updates.

**Why it happens:** Screen readers detect DOM mutations, not reactive data changes. In Svelte (and other frameworks), using `{#if}` or `:empty` CSS to conditionally render the live region destroys and recreates DOM nodes on each update. When a node is replaced rather than mutated, screen readers miss the announcement. Additionally, the aria-live element must exist in the DOM when the page loads — it cannot be dynamically inserted. The problem is well-documented for 2025: framework DOM management (mount/unmount/patch) breaks the fundamental mechanism that aria-live relies on.

**Consequences:** Users relying on screen readers get no feedback during streaming. The app is effectively inaccessible for long-running Synapse tasks where feedback is critical.

**How to avoid:**
1. The `aria-live` container must always be in the DOM with no conditional rendering — use `{#if}` to control content inside it, not on the container itself
2. Use `role="log"` and `aria-live="polite"` on the message list container — this is the correct semantic role for chat
3. Update text content by mutating existing nodes, not replacing them
4. For the "Thinking..." indicator, use `aria-busy="true"` on the message container while streaming
5. Use `aria-atomic="false"` on the log so each new message is announced individually (not the entire history)
6. Test with NVDA (Windows) or VoiceOver (macOS/iOS) — don't test with browser DevTools "Accessibility" panel alone

**Warning signs:** Enable VoiceOver/NVDA, send a message, and check whether the response is announced. Silence = broken live region.

**Phase to address:** Phase 2 (SvelteKit). The framework's DOM management makes this easy to break. Address during component design, not as a retrofit.

**Confidence:** HIGH — the DOM mutation mechanism is well-established (MDN ARIA Live Regions). The 2025 framework-specific issue is documented in prodsens.live article "When Your Live Region Isn't Live."

---

### Pitfall 14: Losing Message State on Component Re-render or Navigation

**What goes wrong:** User navigates away from chat (to settings, docs, etc.) and back. All messages are gone because they were held in component-local state. Or: user refreshes the page and loses the entire conversation. Since Chimera sessions are server-side (in-memory Map with 2-hour TTL), the conversation history exists on the server but the frontend has no way to restore it.

**Why it happens:** The server's `/sessions/:id/logs` endpoint returns event logs, not formatted message history. There is no endpoint to retrieve the conversation as a message list. Frontend state is ephemeral.

**Consequences:** Users lose context on refresh. During long Synapse workflows, an accidental refresh means starting over visually (even though the server session is intact).

**How to avoid:**
1. Store messages in `sessionStorage` (survives refresh, cleared on tab close — appropriate for a local app)
2. On page load, check sessionStorage for existing messages before making a new request
3. For Phase 2 (SvelteKit): Use a Svelte store outside of component scope (`chat.svelte.js` with `$state`), or SvelteKit's `$page.data` with server-side load
4. **Critical Svelte 5 warning:** Do NOT use Svelte stores (`writable`, `readable`) from `svelte/store` as module-level singletons in `+layout.server.js` or `+page.server.js`. On the server-side SvelteKit render, module-level state is shared across all requests — it will bleed user data between tabs/sessions. Store state in the `load()` function's return value or in component-scoped context instead.
5. Consider adding a `/sessions/:id/messages` endpoint to the backend that returns the conversation in a renderable format

**Warning signs:** Start a conversation, refresh the page. If messages disappear, this pitfall is present. For the server-side bleed issue: open two browser tabs with different session IDs and verify their messages don't cross-contaminate.

**Phase to address:** Phase 1 (sessionStorage) and Phase 2 (proper store architecture). Backend endpoint addition may be needed.

**Confidence:** HIGH — direct analysis of Chimera's existing session architecture. Server-side state sharing is a documented SvelteKit pitfall (svelte.dev/docs/kit/state-management).

---

## Minor Pitfalls

Mistakes that cause annoyance but are fixable without major refactoring.

### Pitfall 15: CORS Headers Missing on Error Responses

**What goes wrong:** Chimera's `sendJson()` function includes CORS headers, but if the server throws an unhandled error or Node.js itself sends a response (e.g., request too large, invalid URL), the CORS headers are missing. The browser blocks the response entirely, and the frontend sees a network error instead of the actual error message.

**Why it happens:** CORS headers are added per-route in `sendJson()` but not globally. Edge cases bypass the helper function.

**Consequences:** Frontend shows "Network Error" instead of useful error messages. Developers waste time debugging what looks like a connectivity issue.

**How to avoid:** Add CORS headers in a middleware-like wrapper at the top of `handleRequest()`, before any routing logic. Ensure the `OPTIONS` preflight handler also returns CORS headers (currently it calls `sendJson(204, {})` which does include them, so this specific case is fine).

**Warning signs:** Send a malformed request from the frontend and check if the error response is readable or blocked by CORS.

**Phase to address:** Phase 1, quick fix to the existing server.

**Confidence:** HIGH — verified by reading chimera-chat.js source code.

---

### Pitfall 16: No Loading Indicator for 5-15 Second Model Responses

**What goes wrong:** User sends a message and nothing visible happens for 5-15 seconds while the 9B model generates a response. User thinks the app is broken and clicks send again, which gets a 429 (session busy) because of the `activeLocks` set.

**Why it happens:** The SSE stream starts with model inference, which emits no events until the first token. The gap between "request sent" and "first SSE event" is perceptible.

**Consequences:** User frustration. Double-sends. Confusion about whether the app is working.

**How to avoid:**
1. Show a "thinking" indicator immediately when the user clicks send (before any SSE events)
2. Disable the send button while a request is in flight
3. Show elapsed time ("Thinking... 8s") for transparency — users of local models expect some latency and appreciate knowing it's working
4. If a 429 comes back, show "Still processing your previous message" instead of a generic error

**Warning signs:** Send a message and count the seconds of dead silence before any visual feedback.

**Phase to address:** Phase 1. This is the single most important UX detail for a local model frontend.

**Confidence:** HIGH — specific to Chimera's 9B model latency documented in PROJECT.md.

---

### Pitfall 17: Copy Button on Code Blocks Fails Silently

**What goes wrong:** The `navigator.clipboard.writeText()` API requires a secure context (HTTPS or localhost). If Chimera is accessed via `http://127.0.0.1:3210` it works. But if accessed via `http://192.168.x.x:3210` (LAN access from another device), clipboard API is blocked and the copy button does nothing.

**Why it happens:** Clipboard API security restrictions are not obvious during local development.

**Consequences:** Copy button appears to work but silently fails on non-localhost access.

**How to avoid:**
1. Use `navigator.clipboard.writeText()` with a fallback to the legacy `document.execCommand('copy')` with a temporary textarea
2. Show visual feedback ("Copied!" tooltip) only after the promise resolves
3. Catch and handle the clipboard error gracefully

**Warning signs:** Access Chimera from another device on the LAN. Try the copy button.

**Phase to address:** Phase 1 when code block rendering is implemented.

**Confidence:** HIGH — standard browser security restriction.

---

### Pitfall 18: Over-Engineering the Vanilla HTML Phase

**What goes wrong:** The vanilla HTML "stepping stone" (documented in PROJECT.md as a deliberate constraint) grows into a complex SPA with custom routing, component systems, state management, and build steps. This defeats the purpose of the stepping stone and makes the SvelteKit migration harder because patterns are entrenched.

**Why it happens:** Developers naturally want to "do it right" and add abstractions. The stepping stone is supposed to be quick and disposable.

**Consequences:** Weeks spent building infrastructure that will be thrown away. The SvelteKit migration gets delayed because "the vanilla version works well enough."

**How to avoid:**
1. Set a hard scope for vanilla HTML Phase 1:
   - Single `index.html` file (inline `<style>` and `<script>`, or one CSS + one JS file)
   - No build step, no npm, no bundler
   - No routing (single page only)
   - No component abstraction
   - Maximum 500 lines of JavaScript
2. Treat it as a prototype, not a product
3. Features NOT to build in vanilla HTML: settings page, conversation history browser, file upload, model selection, keyboard shortcuts beyond Ctrl+Enter

**Warning signs:** If the vanilla JS file exceeds 500 lines or requires more than 3 files, scope is creeping.

**Phase to address:** Phase 1 constraint. The whole point is to exit "curl-land" fast.

**Confidence:** HIGH — directly from PROJECT.md key decisions: "Vanilla HTML as stepping stone — gets out of curl-land immediately, no risk."

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `innerHTML` for markdown without DOMPurify | 2 fewer lines of code | XSS vulnerability — entire local system exposed | Never |
| Component-local message state instead of store | Simpler component design | Lost on navigation, unrecoverable from session | Only in vanilla HTML phase (Phase 1) |
| `element.scrollTop = element.scrollHeight` on every event | Simple auto-scroll | Fights user scroll during 5-min workflows | Never — always check if user is at bottom first |
| No AbortController on SSE fetch | Simpler initial code | Memory leak + zombie server locks | Never |
| Using `new EventSource()` for GET-ified messages | Works initially | Long messages break, user input in URL/logs | Never |
| Rendering all messages without DOM cap | Simplest approach | Unusable after 30+ messages with code | Acceptable in Phase 1 with message cap at 50 |
| Skipping ARIA live regions | Saves 30 min | App inaccessible for screen reader users | Acceptable in Phase 1, must address in Phase 2 |

---

## Integration Gotchas

Common mistakes when connecting to the existing Chimera backend.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `/chat/stream` endpoint | Using native `EventSource` | `fetch()` + `response.body.getReader()` — POST only |
| Session IDs | Generating a new session_id on every request | Persist session_id in `sessionStorage`, reuse across page refreshes |
| SSE event parsing | Assuming one event per chunk | Buffer incomplete lines across chunks — chunks don't align with SSE boundaries |
| Vite dev proxy + SSE | Trusting that proxy correctly streams events | Test streaming directly against port 3210 to verify real-time behavior |
| 429 responses | Showing "Too Many Requests" error to user | Show "Processing previous message..." — the `activeLocks` set is per-session, not rate-limiting |
| Backend abort | Relying on browser tab close to trigger server abort | Server abort fires on `req.on('close')` — client must use AbortController to trigger this reliably |
| Session stats | Polling `/sessions/:id/stats` during operation | Stats are available in the `done` SSE event — no polling needed during streaming |
| Working directory | Hardcoded `C:/Users/sandv/Desktop/chimera` in `/chat` requests | Make working_dir configurable in UI settings; default to detected path |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Rendering all messages in DOM | Janky scroll, input lag | DOM cap at 50 messages, virtual scroll in Phase 2 | ~20 messages with code blocks |
| Re-parsing markdown on every SSE chunk | O(n²) render time, sluggish streaming | Accumulate text, parse once on `done`; use streaming-markdown during stream | ~500 token responses |
| Syntax highlighting all code blocks eagerly | Initial load freeze after long workflow | IntersectionObserver-based lazy highlighting | ~10 code blocks visible |
| No debounce on scroll position check | Scroll handler fires hundreds of times per second | Debounce or use `requestAnimationFrame` | Continuous SSE event stream |
| Storing full SSE event log in frontend state | Memory growth during Synapse workflows | Only store rendered messages, not raw events | ~100 events (typical Synapse workflow) |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Unsanitized markdown rendering | XSS → tool execution (file write, shell commands) | DOMPurify after every markdown parse, before DOM insertion |
| Trusting AI-generated link URLs | `javascript:` URI execution | Strip non-http(s) protocols from rendered links |
| No CSP header on chat server | XSS fallback if sanitization is incomplete | Add `Content-Security-Policy: default-src 'self'` to chimera-chat.js static file responses |
| Exposing session_id in URL | Session hijacking if URL is shared (low risk for local-only, but habit to avoid) | Store session_id in sessionStorage, never in URL params |
| Path traversal in static file serving | `GET /../../etc/passwd` returns sensitive files | Verify `filePath.startsWith(STATIC_DIR)` before serving — already in STACK.md example, must not be omitted |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No progress during Synapse workflows (5+ min) | User thinks app is frozen, refreshes, loses context | Show task list as it builds, mark tasks done in real-time, show elapsed time |
| Collapsing activity blocks too eagerly | User misses tool errors or interesting intermediate steps | Keep blocks expanded until user explicitly collapses, or until `tasks_complete` event |
| Generic "Error" message when Chimera is unreachable | User doesn't know if it's the app, LM Studio, or RAG that failed | Distinguish: "Chimera offline" vs "LM Studio unreachable" vs "stream error" |
| Single-line textarea for message input | Users can't compose multi-line prompts comfortably | Auto-expanding textarea (grows up to ~5 lines, scrolls after) |
| No way to stop a running Synapse workflow | User starts a wrong task, has to wait 5 min or refresh | "Stop" button that calls AbortController, sends abort signal to server |
| Showing raw JSON from `synapse_answer` events | Technical noise in Q&A display | Format Q&A blocks as conversation: "Q: [text]" / "A: [answer]" |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Streaming chat:** Often missing AbortController cleanup — verify by navigating away mid-stream and checking DevTools connections tab
- [ ] **Markdown rendering:** Often missing DOMPurify — verify with `<img onerror="alert(1)">` in a message
- [ ] **Code block copy button:** Often missing LAN fallback — verify from a different device on the same network
- [ ] **Auto-scroll:** Often missing "user scrolled up" detection — verify by scrolling up mid-stream
- [ ] **ARIA live region:** Often conditionally rendered (broken) — verify with VoiceOver/NVDA turned on
- [ ] **Dark mode:** Often applied in onMount (causes flash) — verify with hard refresh while in dark mode
- [ ] **Session persistence:** Often ephemeral — verify by refreshing mid-conversation
- [ ] **Vite proxy SSE:** Often buffers events — verify by running curl against port 3210 and comparing timing to browser

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| EventSource → fetch migration | MEDIUM | Replace EventSource calls with fetch+ReadableStream; SSE parsing logic stays similar |
| XSS discovered post-launch | LOW | Add DOMPurify post-render; audit all innerHTML usage; CSP header; patch is additive |
| Memory leaks from unclosed connections | LOW | Add AbortController to every streaming call site; add onDestroy cleanup; 1-2 day fix |
| MIME type errors | LOW | Add MIME map to server; test all asset types; 2 hour fix |
| State machine deadlock | HIGH | Requires redesigning the event handling architecture; 2-5 days depending on how embedded the bad pattern is |
| DOM explosion (no message cap) | MEDIUM | Add cap and virtual scroll; existing message history may need migration to new format |
| Vite proxy SSE buffering | LOW | Add proxy configuration headers; test in dev; 2 hour fix |
| adapter-static SSR misconfiguration | LOW | Correct svelte.config.js; rebuild; test with shell output check |
| ARIA live region broken | LOW | Remove conditional rendering from live region container; 2-4 hours |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| EventSource can't POST (#1) | Phase 1 | Check for `new EventSource(` in codebase — must be absent |
| XSS through markdown (#2) | Phase 1 (first markdown render) | Send `<img onerror="alert(1)">` as message; must not execute |
| SSE memory leaks (#3) | Phase 1 | Navigate away mid-stream; DevTools connections must close |
| MIME type errors (#4) | Phase 1 (static serving) | DevTools Network: every asset has correct Content-Type |
| Frontend state deadlock (#5) | Phase 1 (design) / Phase 2 (Synapse) | Kill server mid-response; UI must show error, not hang |
| Vite proxy SSE buffering (#6) | Phase 2 (SvelteKit setup) | Events must arrive in real-time in dev mode |
| DOM explosion (#7) | Phase 1 (cap) / Phase 2 (virtual) | 30 long responses must not cause scroll lag |
| Auto-scroll fighting user (#8) | Phase 1 | Scroll up mid-stream; must stay scrolled |
| Mobile keyboard layout (#9) | Phase 2 | Test on real iPhone Safari |
| Dark mode flash (#10) | Phase 1 | Hard-refresh with dark mode; must not flash |
| Broken streaming markdown (#11) | Phase 1 | Generate code block; layout must not break mid-stream |
| adapter-static prerendering (#12) | Phase 2 (initial setup) | Check `build/index.html` structure matches expectations |
| ARIA live regions (#13) | Phase 2 | VoiceOver announces new messages; aria-busy during thinking |
| Message state on navigation (#14) | Phase 1 (sessionStorage) / Phase 2 (store) | Refresh page; messages must persist |
| CORS missing on errors (#15) | Phase 1 | Malformed request returns readable error, not CORS block |
| No loading indicator (#16) | Phase 1 | Send message; thinking indicator appears within 100ms |
| Copy button LAN failure (#17) | Phase 1 | Test copy from LAN device; must not fail silently |
| Over-engineering vanilla phase (#18) | Phase 1 (scope gate) | Vanilla JS file must stay under 500 LOC |

---

## Sources

**SSE and Streaming:**
- [SSE via POST with fetch](https://medium.com/@david.richards.tech/sse-server-sent-events-using-a-post-request-without-eventsource-1c0bd6f14425) — EventSource POST limitation and workaround
- [Azure fetch-event-source](https://github.com/Azure/fetch-event-source) — reference implementation for POST-based SSE
- [MDN EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) — official API documentation and limitations
- [Chrome 6-connection limit bug](https://bugs.chromium.org/p/chromium/issues/detail?id=275955) — per-domain EventSource connection cap (not a problem with fetch-based SSE)
- [Vite SSE proxy issue #10851](https://github.com/vitejs/vite/discussions/10851) — SSE not working through Vite dev proxy
- [Vite SSE close event #13522](https://github.com/vitejs/vite/issues/13522) — close event not forwarded through proxy

**Security:**
- [DeepSeek XSS via Markdown](https://n45ht.or.id/blog/hacking-ai-with-markdown-how-we-triggered-xss-in-deepseeks-chat/) — real-world AI chatbot XSS
- [CVE-2026-22813 OpenCode XSS](https://www.pointguardai.com/ai-security-incidents/opencode-ai-ui-turns-chat-output-into-code-cve-2026-22813) — markdown rendering vulnerability
- [markdown-it CVE-2025-7969](https://fluidattacks.com/advisories/fito) — XSS in fenced code blocks with custom highlight
- [LLM Insecure Output Handling](https://instatunnel.my/blog/llm-insecure-output-handling-when-ai-generated-code-attacks-you) — OWASP LLM05

**Performance:**
- [ChatGPT Lag Fixer](https://github.com/bramvdg/chatgpt-lag-fixer) — evidence of DOM explosion in production chat UIs
- [Open WebUI virtual scroll discussion](https://github.com/open-webui/open-webui/discussions/13787) — performance with large message history
- [Streaming markdown rendering](https://vercel.com/changelog/introducing-streamdown) — Vercel's Streamdown for incremental markdown

**Mobile:**
- [Fix mobile keyboard overlap](https://dev.to/franciscomoretti/fix-mobile-keyboard-overlap-with-visualviewport-3a4a) — VisualViewport approach
- [Safari mobile keyboard behavior](https://blog.opendigerati.com/the-eccentric-ways-of-ios-safari-with-the-keyboard-b5aa3f34228d) — iOS-specific issues
- [dvh CSS unit for chat input](https://www.codestudy.net/blog/how-to-make-fixed-content-go-above-ios-keyboard/) — dynamic viewport height fix

**Accessibility:**
- [MDN ARIA Live Regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions) — standard reference
- [ARIA live broken in frameworks (2025)](https://prodsens.live/2025/11/04/when-your-live-region-isnt-live-fixing-aria-live-in-angular-react-and-vue/) — DOM mutation issue in modern frameworks

**SvelteKit:**
- [SvelteKit Single-page apps docs](https://svelte.dev/docs/kit/single-page-apps) — adapter-static SPA mode
- [SvelteKit state management docs](https://svelte.dev/docs/kit/state-management) — server-side store sharing pitfall
- [SvelteKit #14471: ssr required for prerender content](https://github.com/sveltejs/kit/issues/14471) — prerendering misconception
- [Svelte 5 global state guide](https://mainmatter.com/blog/2025/03/11/global-state-in-svelte-5/) — runes vs stores

**Open WebUI / AnythingLLM:**
- [Open WebUI issue #15189](https://github.com/open-webui/open-webui/issues/15189) — frontend deadlock from inconsistent data
- [Open WebUI Troubleshooting](https://docs.openwebui.com/troubleshooting/) — common issues catalog

**Chimera Source (direct analysis):**
- `chimera-chat.js` — SSE endpoint, CORS handling, session locks, timeout behavior
- `chimera-orchestrator.js` — event types, Synapse state machine, tool execution flow
- `.planning/PROJECT.md` — constraints (no Express, vanilla HTML stepping stone, 9B model latency)
