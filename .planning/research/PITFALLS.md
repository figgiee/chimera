# Domain Pitfalls: Chimera Web Frontend

**Domain:** Web frontend for a local AI assistant with SSE streaming, tool execution display, and markdown rendering
**Researched:** 2026-03-12
**Specific to:** Adding a frontend to an existing plain Node.js HTTP server (no Express) with SSE streaming

---

## Critical Pitfalls

Mistakes that cause rewrites, security vulnerabilities, or fundamental UX failures.

### Pitfall 1: EventSource Cannot POST -- Using the Wrong SSE Client

**What goes wrong:** The browser's native `EventSource` API only supports GET requests. Chimera's `/chat/stream` endpoint is POST (it sends `message`, `session_id`, `project_id` in the body). Developers reach for `EventSource`, discover it can't POST, then either: (a) hack message content into query params (length limits, URL encoding bugs, security exposure), or (b) switch to WebSockets mid-build (massive scope change).

**Why it happens:** Every SSE tutorial starts with `new EventSource(url)`. The POST limitation is rarely mentioned until you hit it.

**Consequences:** Entire streaming architecture must be reworked after initial implementation. Query-param hacks break with long messages and expose user input in server logs and browser history.

**Prevention:** Use `fetch()` with `response.body.getReader()` and a `TextDecoder` to parse SSE from a POST response. This is the pattern used by ChatGPT's frontend and Azure's `@microsoft/fetch-event-source` library. The existing Chimera `/chat/stream` endpoint already returns `text/event-stream` from POST -- just consume it with fetch, not EventSource.

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

**Detection:** If you see `new EventSource(` anywhere in the codebase, it is wrong for this project.

**Phase:** Must be solved in Phase 1 (basic chat). This is the foundation of all streaming UI.

**Confidence:** HIGH -- verified against Chimera's existing POST-based `/chat/stream` endpoint and MDN EventSource documentation.

---

### Pitfall 2: XSS Through AI-Generated Markdown

**What goes wrong:** The AI model generates markdown containing HTML, JavaScript, or crafted links. When rendered with a markdown-to-HTML library (marked, markdown-it, etc.), this becomes executable code in the browser. An attacker who controls prompt input (or poisons RAG documents) can inject `<script>` tags, `<img onerror=>` handlers, or `javascript:` URIs that execute in the user's browser session.

**Why it happens:** Developers treat AI output as "safe internal data" and render it with `innerHTML` or unsanitized markdown conversion. This is formally recognized as OWASP LLM05:2025 (Insecure Output Handling). Real-world XSS vulnerabilities were found in DeepSeek's chat interface and Lenovo's Lena AI chatbot through this exact vector. CVE-2026-22813 documented unsafe rendering of AI-generated markdown in OpenCode's web interface.

**Consequences:** Arbitrary JavaScript execution. In Chimera's case, this could invoke tool calls (file operations, shell commands) or exfiltrate RAG data. Even though Chimera is local-only, XSS is still dangerous if the user opens a malicious link that interacts with the local Chimera server.

**Prevention:**
1. Convert markdown to HTML with a parser (marked or markdown-it)
2. Sanitize the HTML output with DOMPurify AFTER conversion (not before)
3. Set a Content-Security-Policy header that blocks inline scripts
4. Never use `innerHTML` with raw model output -- always sanitize first
5. Strip `javascript:` URIs from links

**Detection:** Search codebase for `innerHTML`, `.html(`, or `dangerouslySetInnerHTML` without adjacent DOMPurify calls.

**Phase:** Must be solved in Phase 1 when markdown rendering is first introduced. Retrofitting sanitization is error-prone.

**Confidence:** HIGH -- multiple CVEs and real-world exploits documented in 2025-2026.

---

### Pitfall 3: SSE Memory Leak from Unclosed Connections

**What goes wrong:** The fetch-based SSE reader is not properly aborted when: (a) the user navigates away from the chat, (b) the component unmounts, (c) the user sends a new message before the previous one finishes, or (d) the browser tab is backgrounded. The ReadableStream stays open, the connection hangs, and memory accumulates. Over a multi-minute Synapse workflow session, this causes the browser tab to consume hundreds of MB.

**Why it happens:** Chimera sessions run 5-15 seconds per response, and Synapse workflows can emit dozens of events over several minutes. Unlike typical REST calls, the connection stays open. Developers forget cleanup because short requests "work fine" in testing.

**Consequences:** Browser tab becomes sluggish. On the server side, Chimera's `activeLocks` set never clears for zombie connections. The existing 5-minute timeout in `chimera-chat.js` helps server-side, but the client-side leak persists.

**Prevention:**
1. Use an `AbortController` for every fetch call
2. Call `controller.abort()` in cleanup (component unmount, new message sent, navigation)
3. Always call `reader.cancel()` in finally blocks
4. For vanilla JS: attach cleanup to `beforeunload` and to any "new message" handler
5. For SvelteKit: use `onDestroy` lifecycle hook

**Detection:** Open DevTools Memory tab, start a Synapse workflow, navigate away mid-stream, check if connections/memory are released.

**Phase:** Must be in Phase 1. Hard to retrofit because every streaming call site needs the abort pattern.

**Confidence:** HIGH -- standard browser behavior, verified with MDN ReadableStream documentation.

---

### Pitfall 4: MIME Type Errors When Serving Static Files from Plain Node.js HTTP Server

**What goes wrong:** Chimera uses `http.createServer()` with no framework. Adding static file serving (HTML, CSS, JS, images) requires manually mapping file extensions to MIME types. Missing or wrong MIME types cause: JS files treated as text (browser refuses to execute), CSS files ignored, SVGs not rendering. The browser console shows `Refused to execute script from '...' because its MIME type ('text/plain') is not executable`.

**Why it happens:** Express and other frameworks handle this automatically with `express.static()`. With raw `http.createServer()`, every Content-Type must be set manually. Developers forget `.mjs`, `.woff2`, `.svg`, `.json`, or `.map` extensions.

**Consequences:** The app loads but looks broken -- no styles, no interactivity, missing fonts. Debugging is confusing because the files are served (200 status) but not applied.

**Prevention:** Create a MIME type map at the start of the project:
```javascript
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
```
Default to `application/octet-stream` for unknown types. Test every asset type in the browser.

**Detection:** Open browser DevTools Network tab, check Content-Type headers on all loaded assets. Any `text/plain` on JS/CSS files is a bug.

**Phase:** Phase 1 -- the very first thing that must work when serving the frontend.

**Confidence:** HIGH -- inherent to the no-framework constraint documented in PROJECT.md.

---

### Pitfall 5: Silent Frontend Deadlock from Inconsistent SSE State

**What goes wrong:** The frontend state machine gets out of sync with the SSE event stream. For example: a `task_start` event arrives but the corresponding `task_done` never comes (server error, timeout, abort). The UI shows a spinner forever. Or: events arrive out of order during reconnection, leaving the message list in an inconsistent state. Open WebUI had exactly this bug -- a "logical deadlock" where the frontend entered an unrecoverable state from orphaned message objects, with no errors in console or backend logs.

**Why it happens:** Chimera's event types form an implicit state machine (`synapse_start` -> `synapse_question` -> `synapse_answer` -> `task_start` -> `task_done` -> `tasks_complete` -> `done`). The frontend must handle every transition, including error/abort cases that skip steps.

**Consequences:** UI appears frozen. User refreshes, loses context. No error messages because the bug is logical, not a crash.

**Prevention:**
1. Design an explicit state machine for the chat UI (idle -> streaming -> synapse_qa -> executing_tasks -> done/error)
2. Every state has a timeout that transitions to an error state
3. The `done` and `error` SSE events ALWAYS reset UI to idle state regardless of current state
4. Never depend on receiving every intermediate event -- the `done` event must be self-sufficient
5. Add a client-side watchdog: if no SSE event received for 30 seconds during an active session, show "Connection may be lost" with a retry option

**Detection:** Kill the Chimera server mid-response and observe the frontend. If it hangs without showing an error, this pitfall is present.

**Phase:** Phase 1 design, but becomes critical in Phase 2 when Synapse workflow display is added. Design the state machine early.

**Confidence:** HIGH -- verified by Open WebUI issue #15189 documenting this exact class of bug.

---

## Moderate Pitfalls

Mistakes that cause poor UX, performance problems, or technical debt.

### Pitfall 6: DOM Explosion from Long Conversations and Large Responses

**What goes wrong:** Every message is rendered as a full DOM node with syntax-highlighted code blocks. After 20-30 messages with code (typical Synapse workflow output), the DOM has thousands of nodes. Scrolling becomes janky, typing in the input lags, and syntax highlighting re-renders freeze the tab. ChatGPT itself suffers from this -- a Chrome extension ("ChatGPT Lag Fixer") exists specifically to virtualize off-screen messages.

**Why it happens:** Rendering all messages seems natural and works fine for 5-10 messages. The 9B model's responses often include large code blocks (full file contents during build tasks), which generate massive DOM trees when syntax-highlighted.

**Consequences:** Tab becomes unusable after extended Synapse workflows (10+ task completions, each with code output).

**Prevention:**
1. For vanilla HTML Phase 1: Limit rendered messages to the last 50. Older messages stay in memory but are removed from DOM. Add "Load earlier messages" button.
2. For SvelteKit Phase 2: Use virtual scrolling (render only visible messages). Svelte's `{#each}` with keyed items helps but is not virtual by default.
3. Lazy-load syntax highlighting: only highlight code blocks that are visible. Use `IntersectionObserver`.
4. Truncate extremely long code blocks (>200 lines) with "Show full output" expander.

**Detection:** Send 10 consecutive "build something" requests to trigger Synapse workflows. Measure scroll FPS and input latency after.

**Phase:** Phase 1 should implement message capping. Phase 2 should implement virtual scrolling.

**Confidence:** HIGH -- documented in ChatGPT community forums and multiple chat UI performance studies.

---

### Pitfall 7: Auto-Scroll Fighting User Scroll

**What goes wrong:** The chat auto-scrolls to bottom on new SSE events (correct when user is at bottom). But if the user scrolls up to read earlier output, auto-scroll yanks them back down on every event. During Synapse workflows, events fire rapidly (tool calls, task progress), making it impossible to read earlier messages.

**Why it happens:** Naive implementation: `element.scrollTop = element.scrollHeight` on every event.

**Consequences:** Users cannot read streaming output while it is still arriving. Especially painful during 5-15 second model responses where the user wants to review the question while waiting.

**Prevention:**
1. Track whether the user is "at bottom" (within ~50px of scrollHeight)
2. Only auto-scroll if user was at bottom before the new event
3. Show a "Scroll to bottom" floating button when user has scrolled up and new messages arrive
4. Debounce scroll-to-bottom calls (requestAnimationFrame, not every event)

**Detection:** Start a Synapse workflow, immediately scroll up. If you get yanked back down, the pitfall is present.

**Phase:** Phase 1. This is a v1 quality-of-life issue that is trivial to implement correctly upfront but annoying to retrofit.

**Confidence:** HIGH -- universal chat UI pattern, well-documented.

---

### Pitfall 8: Mobile Keyboard Destroys Chat Layout

**What goes wrong:** On mobile, when the user taps the message input, the virtual keyboard appears and either: (a) pushes the entire page up, hiding the header, (b) covers the input field so the user can't see what they're typing, (c) breaks `100vh` layouts because `vh` doesn't account for the keyboard, or (d) on iOS specifically, doesn't resize the viewport at all, leaving content obscured.

**Why it happens:** Mobile browsers handle the virtual keyboard inconsistently. iOS Safari does not resize the visual viewport when the keyboard appears (unlike Android Chrome). CSS `100vh` means different things on different mobile browsers.

**Consequences:** Chat is unusable on mobile. Users can't see their input or the latest messages while typing.

**Prevention:**
1. Use `dvh` (dynamic viewport height) instead of `vh` for the chat container
2. Use `position: sticky` for the input area instead of `position: fixed` at bottom
3. On iOS, listen to `visualViewport.resize` event and adjust layout
4. Test on actual iOS Safari -- simulators don't reproduce keyboard issues accurately
5. Set `<meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content">` (newer Chrome/Edge support)

**Detection:** Open the chat on an iPhone in Safari. Tap the input. If you can't see both the latest message and your input text, this pitfall is present.

**Phase:** Phase 2 (SvelteKit). For vanilla HTML Phase 1, mobile support is lower priority, but using `dvh` from the start prevents layout rewrites.

**Confidence:** MEDIUM -- well-documented problem, but `dvh` browser support and `interactive-widget` are relatively new (verify current support).

---

### Pitfall 9: Dark Mode Flash (FOUC/FART)

**What goes wrong:** Page loads in light mode, then flashes to dark mode after JavaScript runs. If the user has selected dark mode (stored in localStorage), the page renders white first, then switches. For a tool used in dimly-lit environments (a developer's local AI assistant), this white flash is physically jarring.

**Why it happens:** Theme preference is read from localStorage in JavaScript, which runs after the initial paint. CSS `prefers-color-scheme` handles OS preference but not user-overridden preference stored in localStorage.

**Consequences:** Annoying white flash on every page load. Users perceive the app as janky.

**Prevention:**
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
3. Never apply theme in `onMount`/`useEffect`/`DOMContentLoaded` -- that is too late

**Detection:** Set dark mode, hard-refresh the page. If you see a white flash before dark mode applies, this pitfall is present.

**Phase:** Phase 1. Trivial to implement correctly from the start, painful to fix later because it requires restructuring where the theme script loads.

**Confidence:** HIGH -- well-documented pattern with clear solution.

---

### Pitfall 10: Broken Code Blocks in Markdown During Streaming

**What goes wrong:** While the model is streaming, a code block is half-received: the opening ` ``` ` has arrived but the closing ` ``` ` has not. The markdown parser treats everything after the opening fence as code, breaking the entire message layout. Alternatively, the parser chokes on partial markdown and throws an error, stopping all rendering.

**Why it happens:** Markdown parsers expect complete documents. During SSE streaming, you receive character-by-character or chunk-by-chunk. The intermediate states are invalid markdown.

**Consequences:** Message area shows garbled formatting during streaming. Code blocks "eat" subsequent text. Layout jumps when the closing fence finally arrives.

**Prevention:**
1. Before parsing, count backtick fences. If odd, append a closing fence to the string before parsing (display only, don't modify the stored message)
2. Use a markdown parser that handles partial/streaming content gracefully. `marked` is more tolerant than `markdown-it` for partial input.
3. During active streaming, render with a simpler parser or plain text with just newline handling. Switch to full markdown rendering only after the `done` event.
4. Accumulate the full response text and re-parse on each chunk (don't try to parse incremental diffs)

**Detection:** Send a request that generates a code block. Watch the rendering while tokens stream in. If the layout breaks mid-stream, this pitfall is present.

**Phase:** Phase 1. Any streaming chat UI must handle this.

**Confidence:** HIGH -- inherent to streaming + markdown rendering, widely documented in AI chat UI development.

---

### Pitfall 11: Losing Message State on Component Re-render or Navigation

**What goes wrong:** User navigates away from chat (to settings, docs, etc.) and back. All messages are gone because they were held in component-local state. Or: user refreshes the page and loses the entire conversation. Since Chimera sessions are server-side (in-memory Map with 2-hour TTL), the conversation history exists on the server but the frontend has no way to restore it.

**Why it happens:** The server's `/sessions/:id/logs` endpoint returns event logs, not formatted message history. There is no endpoint to retrieve the conversation as a message list. Frontend state is ephemeral.

**Consequences:** Users lose context on refresh. During long Synapse workflows, an accidental refresh means starting over visually (even though the server session is intact).

**Prevention:**
1. Store messages in `sessionStorage` (survives refresh, cleared on tab close -- appropriate for a local app)
2. On page load, check sessionStorage for existing messages before making a new request
3. For Phase 2 (SvelteKit): Use a Svelte store outside of component scope, or SvelteKit's `$page.data` with server-side load
4. Consider adding a `/sessions/:id/messages` endpoint to the backend that returns the conversation in a renderable format

**Detection:** Start a conversation, refresh the page. If messages disappear, this pitfall is present.

**Phase:** Phase 1 (sessionStorage) and Phase 2 (proper store architecture). Backend endpoint addition may be needed.

**Confidence:** HIGH -- direct analysis of Chimera's existing session architecture.

---

## Minor Pitfalls

Mistakes that cause annoyance but are fixable without major refactoring.

### Pitfall 12: CORS Headers Missing on Error Responses

**What goes wrong:** Chimera's `sendJson()` function includes CORS headers, but if the server throws an unhandled error or Node.js itself sends a response (e.g., request too large, invalid URL), the CORS headers are missing. The browser blocks the response entirely, and the frontend sees a network error instead of the actual error message.

**Why it happens:** CORS headers are added per-route in `sendJson()` but not globally. Edge cases bypass the helper function.

**Consequences:** Frontend shows "Network Error" instead of useful error messages. Developers waste time debugging what looks like a connectivity issue.

**Prevention:** Add CORS headers in a middleware-like wrapper at the top of `handleRequest()`, before any routing logic. Ensure the `OPTIONS` preflight handler also returns CORS headers (currently it calls `sendJson(204, {})` which does include them, so this specific case is fine).

**Detection:** Send a malformed request from the frontend and check if the error response is readable or blocked by CORS.

**Phase:** Phase 1, quick fix to the existing server.

**Confidence:** HIGH -- verified by reading chimera-chat.js source code.

---

### Pitfall 13: No Loading Indicator for 5-15 Second Model Responses

**What goes wrong:** User sends a message and nothing visible happens for 5-15 seconds while the 9B model generates a response. User thinks the app is broken and clicks send again, which gets a 429 (session busy) because of the `activeLocks` set.

**Why it happens:** The SSE stream starts with model inference, which emits no events until the first token. The gap between "request sent" and "first SSE event" is perceptible.

**Consequences:** User frustration. Double-sends. Confusion about whether the app is working.

**Prevention:**
1. Show a "thinking" indicator immediately when the user clicks send (before any SSE events)
2. Disable the send button while a request is in flight
3. Show elapsed time ("Thinking... 8s") for transparency -- users of local models expect some latency and appreciate knowing it's working
4. If a 429 comes back, show "Still processing your previous message" instead of a generic error

**Detection:** Send a message and count the seconds of dead silence before any visual feedback.

**Phase:** Phase 1. This is the single most important UX detail for a local model frontend.

**Confidence:** HIGH -- specific to Chimera's 9B model latency documented in PROJECT.md.

---

### Pitfall 14: Copy Button on Code Blocks Fails Silently

**What goes wrong:** The `navigator.clipboard.writeText()` API requires a secure context (HTTPS or localhost). If Chimera is accessed via `http://127.0.0.1:3210` it works. But if accessed via `http://192.168.x.x:3210` (LAN access from another device), clipboard API is blocked and the copy button does nothing.

**Why it happens:** Clipboard API security restrictions are not obvious during local development.

**Consequences:** Copy button appears to work but silently fails on non-localhost access.

**Prevention:**
1. Use `navigator.clipboard.writeText()` with a fallback to the legacy `document.execCommand('copy')` with a temporary textarea
2. Show visual feedback ("Copied!" tooltip) only after the promise resolves
3. Catch and handle the clipboard error gracefully

**Detection:** Access Chimera from another device on the LAN. Try the copy button.

**Phase:** Phase 1 when code block rendering is implemented.

**Confidence:** HIGH -- standard browser security restriction.

---

### Pitfall 15: Over-Engineering the Vanilla HTML Phase

**What goes wrong:** The vanilla HTML "stepping stone" (documented in PROJECT.md as a deliberate constraint) grows into a complex SPA with custom routing, component systems, state management, and build steps. This defeats the purpose of the stepping stone and makes the SvelteKit migration harder because patterns are entrenched.

**Why it happens:** Developers naturally want to "do it right" and add abstractions. The stepping stone is supposed to be quick and disposable.

**Consequences:** Weeks spent building infrastructure that will be thrown away. The SvelteKit migration gets delayed because "the vanilla version works well enough."

**Prevention:**
1. Set a hard scope for vanilla HTML Phase 1:
   - Single `index.html` file (inline `<style>` and `<script>`, or one CSS + one JS file)
   - No build step, no npm, no bundler
   - No routing (single page only)
   - No component abstraction
   - Maximum 500 lines of JavaScript
2. Treat it as a prototype, not a product
3. Features NOT to build in vanilla HTML: settings page, conversation history browser, file upload, model selection, keyboard shortcuts beyond Ctrl+Enter

**Detection:** If the vanilla JS file exceeds 500 lines or requires more than 3 files, scope is creeping.

**Phase:** Phase 1 constraint. The whole point is to exit "curl-land" fast.

**Confidence:** HIGH -- directly from PROJECT.md key decisions: "Vanilla HTML as stepping stone -- gets out of curl-land immediately, no risk."

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|---|---|---|
| Phase 1: Basic Chat (vanilla HTML) | EventSource can't POST (#1) | Use fetch + ReadableStream from day one |
| Phase 1: Basic Chat | MIME types wrong (#4) | Build MIME map before first file is served |
| Phase 1: Basic Chat | No loading state during inference (#13) | Add thinking indicator before any streaming code |
| Phase 1: Basic Chat | Over-engineering vanilla phase (#15) | Hard cap: 1 HTML, 1 CSS, 1 JS, <500 LOC JS |
| Phase 1: Markdown rendering | XSS from model output (#2) | DOMPurify from first markdown render |
| Phase 1: Markdown rendering | Broken code blocks during streaming (#10) | Auto-close fences before parsing |
| Phase 1: Streaming | Memory leaks from unclosed streams (#3) | AbortController on every fetch |
| Phase 1: Streaming | Silent frontend deadlock (#5) | Design state machine with timeout transitions |
| Phase 2: SvelteKit migration | Losing messages on navigation (#11) | Svelte store outside component scope |
| Phase 2: Synapse workflow display | State machine deadlock (#5) | Explicit FSM with error/timeout transitions |
| Phase 2: Mobile support | Keyboard breaks layout (#8) | Use dvh, test on real iOS Safari |
| Phase 2: Dark mode | Flash of white on load (#9) | Inline script in head, not in component |
| Phase 2: Long conversations | DOM explosion (#6) | Virtual scrolling or message capping |
| Phase 2: UX polish | Auto-scroll fighting user (#7) | Track scroll position, conditional auto-scroll |

---

## Sources

**SSE and Streaming:**
- [SSE Practical Guide](https://tigerabrodi.blog/server-sent-events-a-practical-guide-for-the-real-world) - connection management patterns
- [SSE via POST with fetch](https://medium.com/@david.richards.tech/sse-server-sent-events-using-a-post-request-without-eventsource-1c0bd6f14425) - EventSource POST limitation and workaround
- [Azure fetch-event-source](https://github.com/Azure/fetch-event-source) - reference implementation for POST-based SSE
- [MDN EventSource](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) - official API documentation and limitations

**Security:**
- [DeepSeek XSS via Markdown](https://n45ht.or.id/blog/hacking-ai-with-markdown-how-we-triggered-xss-in-deepseeks-chat/) - real-world AI chatbot XSS
- [CVE-2026-22813 OpenCode XSS](https://www.pointguardai.com/ai-security-incidents/opencode-ai-ui-turns-chat-output-into-code-cve-2026-22813) - markdown rendering vulnerability
- [React Markdown Security Guide](https://strapi.io/blog/react-markdown-complete-guide-security-styling) - sanitization best practices
- [LLM Insecure Output Handling](https://instatunnel.my/blog/llm-insecure-output-handling-when-ai-generated-code-attacks-you) - OWASP LLM05

**Performance:**
- [ChatGPT Lag Fixer](https://github.com/bramvdg/chatgpt-lag-fixer) - evidence of DOM explosion in production chat UIs
- [ChatGPT typing lag discussion](https://community.openai.com/t/chatgpt-typing-lag-in-long-chats-needs-virtual-scroll-like-yesterday/1273495) - community reports of this exact problem
- [Swiftask scroll optimization](https://docs.swiftask.ai/changelog/june-15-2025-chat-scroll-optimization) - production fixes for chat scroll performance

**Mobile:**
- [VirtualKeyboard API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API) - modern keyboard handling
- [Fix mobile keyboard overlap](https://dev.to/franciscomoretti/fix-mobile-keyboard-overlap-with-visualviewport-3a4a) - VisualViewport approach
- [Safari mobile resizing bug](https://medium.com/@krutilin.sergey.ks/fixing-the-safari-mobile-resizing-bug-a-developers-guide-6568f933cde0) - iOS-specific issues

**Dark Mode:**
- [Fixing dark mode FOUC](https://notanumber.in/blog/fixing-react-dark-mode-flickering) - comprehensive FOUC solution
- [FOUDT explanation](https://webcloud.se/blog/2020-04-06-flash-of-unstyled-dark-theme/) - flash of unstyled dark theme

**Open WebUI / AnythingLLM:**
- [Open WebUI issue #15189](https://github.com/open-webui/open-webui/issues/15189) - frontend deadlock from inconsistent data
- [Open WebUI Troubleshooting](https://docs.openwebui.com/troubleshooting/) - common issues catalog
- [Open WebUI vs AnythingLLM comparison](https://wz-it.com/en/blog/open-webui-vs-anythingllm-comparison/) - ecosystem comparison

**Chimera Source (direct analysis):**
- `chimera-chat.js` -- SSE endpoint, CORS handling, session locks, timeout behavior
- `chimera-orchestrator.js` -- event types, Synapse state machine, tool execution flow
- `.planning/PROJECT.md` -- constraints (no Express, vanilla HTML stepping stone, 9B model latency)
