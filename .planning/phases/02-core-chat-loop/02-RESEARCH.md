# Phase 2: Core Chat Loop - Research

**Researched:** 2026-03-12
**Domain:** Svelte 5 chat UI — SSE streaming, markdown rendering, syntax highlighting, dark mode
**Confidence:** MEDIUM-HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Chat layout & density**
- Bubble-style message layout — user messages right-aligned, AI messages left-aligned
- No avatars on either side — bubble alignment alone distinguishes sender
- Metadata and content width are Claude's discretion

**Input experience**
- Enter sends message, Shift+Enter inserts newline
- Input area behavior, controls, and limit indicators are Claude's discretion

**Streaming & interruption**
- Stop button replaces the send button during streaming (ChatGPT-style transform)
- Clicking stop keeps the partial response visible in chat as-is (no removal, no "incomplete" marker)
- Code blocks should render with syntax highlighting during streaming, not just after completion
- Whether users can queue messages during streaming is Claude's discretion (user curious if possible — evaluate during planning)

**Error & empty states**
- Dark mode follows OS preference by default, with manual toggle to override (preference saved)
- Error display, empty/welcome state, and offline handling are Claude's discretion

**Specific decided libraries (from STATE.md)**
- Two-mode markdown: streaming-markdown during generation, marked + highlight.js + DOMPurify after done event
- fetch + ReadableStream for SSE — NOT native EventSource (Chimera uses POST-based SSE)
- DOMPurify mandatory on all AI markdown output

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

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

## Summary

Phase 2 builds a streaming chat interface over an existing SvelteKit + Tailwind v4 + shadcn-svelte shell. The backend (`/api/chat/stream`) is a POST-based SSE endpoint that emits named events (`user_message`, `intent`, `tool`, `synapse_question`, `done`, `error`). **Critical finding:** the Chimera orchestrator does NOT stream individual LLM tokens — it processes the full LLM response internally and emits a single `done` event with the complete response text. This fundamentally changes the streaming UX: the "streaming" feel must be simulated client-side via progressive text reveal after the `done` event, or omitted in favor of a strong loading state during inference.

The two-mode markdown approach is already decided: `streaming-markdown` (thetarnav, v0.2.0) handles progressive display during simulated streaming, and `marked` v17 + `marked-highlight` v2.2.3 + `highlight.js` v11.11.1 + `DOMPurify` v3.3.3 handles the final sanitized render. For dark mode, `mode-watcher` (svecosystem) is the standard shadcn-svelte ecosystem tool — it handles OS preference, localStorage persistence, and FOUC prevention with two lines of code.

The SSE parsing approach uses `eventsource-parser` v3.0.6 with its `EventSourceParserStream` TransformStream, piped after `TextDecoderStream`, for clean event-by-event consumption without manual line parsing.

**Primary recommendation:** Build a `ChatStore` class using Svelte 5's reactive class pattern (`$state` fields in `.svelte.ts`), consume SSE with `eventsource-parser`, simulate streaming via `streaming-markdown` with a typed character effect after `done`, and switch to `marked` + `marked-highlight` + `DOMPurify` for the final persisted render.

---

## Critical Architecture Finding: No Token Streaming

**This is the most important finding for planning.**

The Chimera orchestrator (`chimera-orchestrator.js`) calls LM Studio via a standard non-streaming `POST /v1/chat/completions` and accumulates the full response before returning. The `/api/chat/stream` SSE endpoint streams *orchestrator events* (tool calls, intent detection, Synapse Q&A), not LLM tokens.

The `done` event payload:
```json
{
  "response": "full markdown text here",
  "session_id": "abc123",
  "stats": { ... }
}
```

**UX implication:** The user will wait 5–30+ seconds with no partial text visible. The loading indicator during this gap is the primary UX challenge. Two options for the planner:
1. **Simulate streaming**: After `done`, use `streaming-markdown` to type-animate the response character-by-character (50–80 chars/tick feels natural). Stop button during simulation still works (cancel animation).
2. **Direct render**: Show loading skeleton, then snap to final rendered markdown on `done`. Simpler but less ChatGPT-feel.

The `streaming-markdown` library was decided specifically for streaming mode. Even without real token streaming, it still provides value for the character-by-character animation approach during simulation.

Other SSE events that arrive *before* `done` (useful for UI feedback):
- `user_message` — confirms message received
- `intent` — shows what mode Chimera is in (chat, synapse, task)
- `tool` — shows tool call activity (useful for loading state detail)
- `error` — error with `.error` string

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| streaming-markdown | 0.2.0 | Progressive DOM markdown rendering during simulated streaming | Decided in STATE.md; purpose-built for ChatGPT-style reveal |
| marked | 17.0.4 | Full markdown → HTML parse after done event | Decided in STATE.md; fast, well-maintained |
| marked-highlight | 2.2.3 | highlight.js integration for marked (replaces removed `highlight` option) | Required since marked v8 removed built-in highlight option |
| highlight.js | 11.11.1 | Syntax highlighting for code blocks | Decided in STATE.md; industry standard |
| DOMPurify | 3.3.3 | XSS sanitization of all AI HTML output | Mandatory per CVE-2026-22813 decision |
| eventsource-parser | 3.0.6 | Parse SSE event/data lines from ReadableStream | Cleaner than manual line-splitting; supports for-await-of |
| mode-watcher | latest | OS preference dark mode + localStorage + FOUC prevention | shadcn-svelte ecosystem standard; 2 lines of setup |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-svelte | 0.577.0 (installed) | Send, Stop, Copy, Sun/Moon icons | Already installed; use for all action icons |
| bits-ui | 2.16.3 (installed) | Accessible primitives (tooltip, etc.) | Already installed; use for any overlay/tooltip |
| tw-animate-css | installed | CSS transitions for loading pulse, stop button transform | Already installed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| eventsource-parser | Manual TextDecoder + line split | Manual splitting is fragile with multi-byte chars; eventsource-parser is spec-compliant |
| mode-watcher | Manual matchMedia + localStorage | mode-watcher handles FOUC, tab sync, and adapter-static compatibility automatically |
| streaming-markdown | marked for all rendering | streaming-markdown prevents DOM thrashing during animation; marked is better for final sanitized HTML |

### Installation
```bash
npm install streaming-markdown marked marked-highlight highlight.js dompurify eventsource-parser mode-watcher
```

---

## SSE API Contract

The backend endpoint is `POST /api/chat/stream` at `http://localhost:3210`.

**Request:**
```json
{
  "message": "user text",
  "session_id": "string (optional, auto-generated if omitted)",
  "project_id": "string (optional)",
  "working_dir": "string (optional)"
}
```

**Response:** `Content-Type: text/event-stream`

Events emitted (format: `event: TYPE\ndata: JSON\n\n`):

| Event type | Payload | UI use |
|------------|---------|--------|
| `user_message` | `{ text }` | Confirm sent |
| `intent` | `{ mode }` | Show mode badge during loading |
| `tool` | `{ tool, args?, result?, error?, hadError }` | Tool call activity in loading state |
| `synapse_start` | `{ session_id, mode, status }` | Synapse workflow indicator |
| `synapse_question` | `{ area_id, text }` | (Phase 3 concern) |
| `loop` | `{ reason, signature }` | Show "thinking..." indicator |
| `done` | `{ response, session_id, stats }` | Full response text; begin render |
| `error` | `{ error }` | Show inline error with retry |

**429 response:** Returns JSON `{ error: "Session is busy." }` before SSE headers — handle before calling `.body.getReader()`.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── chat/
│   │   ├── ChatStore.svelte.ts    # Reactive class with $state fields
│   │   ├── SSEClient.ts           # fetch + eventsource-parser, AbortController
│   │   ├── markdown.ts            # marked + marked-highlight + DOMPurify setup
│   │   └── types.ts               # Message, ChatState interfaces
│   ├── components/
│   │   ├── ChatWindow.svelte      # Message list + scroll container
│   │   ├── MessageBubble.svelte   # Individual message (user/assistant)
│   │   ├── InputBar.svelte        # Auto-resize textarea + send/stop button
│   │   ├── LoadingIndicator.svelte # Thinking state during SSE
│   │   ├── DarkModeToggle.svelte  # Sun/Moon toggle using mode-watcher
│   │   └── EmptyState.svelte      # Welcome state
│   └── index.ts
└── routes/
    └── +page.svelte               # Compose ChatWindow + InputBar
```

### Pattern 1: Reactive Chat Store (Svelte 5 Class Pattern)

Use `$state` in `.svelte.ts` class fields for reactive state the planner flagged as MEDIUM-HIGH confidence. This is the validated Svelte 5 approach for shared reactive state.

```typescript
// Source: https://svelte.dev/docs/svelte/$state (official docs)
// lib/chat/ChatStore.svelte.ts
export class ChatStore {
  messages = $state<Message[]>([]);
  status = $state<'idle' | 'loading' | 'streaming' | 'error'>('idle');
  currentActivity = $state<string>(''); // e.g. "Using tool: read_file"
  abortController: AbortController | null = null;

  addUserMessage(text: string) {
    this.messages.push({ role: 'user', content: text, id: crypto.randomUUID() });
  }

  addAssistantMessage(content: string) {
    this.messages.push({ role: 'assistant', content, id: crypto.randomUUID(), rendered: '' });
  }

  stop() {
    this.abortController?.abort();
    this.status = 'idle';
  }
}

export const chatStore = new ChatStore();
```

### Pattern 2: SSE Consumer with eventsource-parser

```typescript
// Source: https://github.com/rexxars/eventsource-parser (official readme)
// lib/chat/SSEClient.ts
import { EventSourceParserStream } from 'eventsource-parser/stream';

export async function streamChat(
  message: string,
  sessionId: string,
  onEvent: (type: string, data: unknown) => void,
  signal: AbortSignal
) {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId }),
    signal,
  });

  if (response.status === 429) {
    throw new Error('Session is busy');
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const stream = response.body!
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream());

  for await (const event of stream) {
    if (signal.aborted) break;
    try {
      onEvent(event.event ?? 'message', JSON.parse(event.data));
    } catch {
      // skip malformed events
    }
  }
}
```

### Pattern 3: Two-Mode Markdown Rendering

**During simulated streaming animation** (streaming-markdown):
```typescript
// Source: https://github.com/thetarnav/streaming-markdown (official readme)
import * as smd from 'streaming-markdown';

function animateResponse(container: HTMLElement, text: string, onDone: () => void) {
  const renderer = smd.default_renderer(container);
  const parser = smd.parser(renderer);

  let i = 0;
  const CHUNK_SIZE = 8; // characters per tick
  const TICK_MS = 16;   // ~60fps

  const interval = setInterval(() => {
    const chunk = text.slice(i, i + CHUNK_SIZE);
    if (chunk.length === 0) {
      smd.parser_end(parser);
      clearInterval(interval);
      onDone(); // trigger switch to marked render
      return;
    }
    smd.parser_write(parser, chunk);
    i += CHUNK_SIZE;
  }, TICK_MS);

  return () => clearInterval(interval); // cancel function
}
```

**Note on syntax highlighting during streaming-markdown:** The `streaming-markdown` library applies language classes to code block elements as it encounters the opening fence. It does NOT call a user-provided highlight function during streaming. For syntax highlighting during animation, the approach is: streaming-markdown renders the structural DOM (with language class on `<code>` elements), then `highlight.js` post-processes those elements via `hljs.highlightElement()`. This can be done on every DOM tick or at the end — post-processing at end is simpler and still satisfies the requirement since code blocks are visible throughout streaming.

**After done event** (final render with marked + DOMPurify):
```typescript
// Source: https://marked.js.org/using_advanced, https://github.com/markedjs/marked-highlight
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

const marked = new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    }
  })
);

export function renderMarkdown(text: string): string {
  const html = marked.parse(text) as string;
  return DOMPurify.sanitize(html);
}
```

### Pattern 4: Dark Mode with mode-watcher

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { ModeWatcher } from 'mode-watcher';
  let { children } = $props();
</script>

<ModeWatcher defaultMode="system" />
{@render children()}
```

```svelte
<!-- lib/components/DarkModeToggle.svelte -->
<script lang="ts">
  import { toggleMode, mode } from 'mode-watcher';
  import { Sun, Moon } from 'lucide-svelte';
</script>

<button onclick={toggleMode} aria-label="Toggle dark mode">
  {#if $mode === 'dark'}
    <Sun size={18} />
  {:else}
    <Moon size={18} />
  {/if}
</button>
```

### Pattern 5: Auto-Resize Textarea (Svelte Action)

```typescript
// Source: https://svelte.dev/docs/svelte/use (official docs)
import type { Action } from 'svelte/action';

export const autoResize: Action<HTMLTextAreaElement> = (node) => {
  $effect(() => {
    const resize = () => {
      node.style.height = 'auto';
      node.style.height = `${node.scrollHeight}px`;
    };
    node.addEventListener('input', resize);
    resize(); // initial sizing
    return () => node.removeEventListener('input', resize);
  });
};
```

```svelte
<textarea
  use:autoResize
  bind:value={inputText}
  onkeydown={(e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }}
  rows={1}
  class="min-h-[44px] max-h-[200px] overflow-y-auto resize-none"
/>
```

### Pattern 6: Stop/Send Button Transform

```svelte
<!-- ChatGPT-style: single button position, content swaps -->
<button
  onclick={isStreaming ? stopGeneration : sendMessage}
  disabled={!isStreaming && !inputText.trim()}
  class="transition-all"
>
  {#if isStreaming}
    <!-- Square stop icon -->
    <Square size={18} />
  {:else}
    <!-- Arrow send icon -->
    <ArrowUp size={18} />
  {/if}
</button>
```

### Pattern 7: Auto-Scroll During Streaming

```svelte
<!-- Source: https://svelte.dev/docs/svelte/$effect (official docs) -->
<script>
  let scrollContainer: HTMLDivElement;
  let messages = chatStore.messages;

  $effect.pre(() => {
    // Register dependency on messages length
    void messages.length;
    // Only auto-scroll if already near bottom (within 80px)
    const el = scrollContainer;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) {
      tick().then(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
    }
  });
</script>
```

### Anti-Patterns to Avoid

- **Using native EventSource for POST SSE:** EventSource only supports GET — use fetch + ReadableStream
- **Rendering marked HTML without DOMPurify:** Mandatory per CVE-2026-22813 decision — never skip sanitization
- **Calling marked.parse() during streaming animation:** marked parses complete documents; use streaming-markdown for in-progress text
- **Mutating DOM inside streaming-markdown renderer:** streaming-markdown manages the DOM; don't mix with Svelte's DOM manipulation on the same container
- **SSR-loading DOMPurify:** DOMPurify requires a DOM — always import behind `browser` check or use dynamic import in `onMount`
- **Appending text to textarea value for Enter-to-send:** Always `e.preventDefault()` before `sendMessage()` — otherwise newline is inserted before submit

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE event parsing | Manual string split on `\n\n` / `data:` prefix | eventsource-parser EventSourceParserStream | Handles partial chunks, multi-line data, UTF-8 boundaries |
| Dark mode + FOUC | Manual matchMedia + class toggle in onMount | mode-watcher | FOUC happens because onMount runs after paint; mode-watcher injects inline script |
| Markdown sanitization | Custom HTML filter | DOMPurify | AI output contains arbitrary HTML; filter lists always have gaps |
| highlight.js + marked integration | Custom renderer with hljs | marked-highlight | marked removed the `highlight` option in v8; marked-highlight is the official replacement |
| Textarea auto-height | CSS-only resize or JS rows calculation | Svelte action with scrollHeight | scrollHeight pattern handles all font/line-height/padding cases |

**Key insight:** The markdown pipeline has four separate responsibilities (parse, highlight, sanitize, render) — each requires a dedicated tool. Collapsing any two produces fragile code.

---

## Common Pitfalls

### Pitfall 1: DOMPurify in SSR Context
**What goes wrong:** `import DOMPurify from 'dompurify'` at module level throws on server because `window` is undefined.
**Why it happens:** SvelteKit renders pages server-side even with adapter-static for initial hydration.
**How to avoid:** Dynamic import inside `onMount` or guard with `import { browser } from '$app/environment'`. Since rendering only happens client-side (AI response arrives after hydration), wrapping `renderMarkdown` in a browser check is sufficient.
**Warning signs:** `ReferenceError: window is not defined` during build or SSR.

### Pitfall 2: streaming-markdown Container Reuse Without Reset
**What goes wrong:** Starting a new animation on a container that already has DOM nodes from a previous message produces doubled/corrupted output.
**Why it happens:** `parser_end()` flushes but doesn't clear the container DOM.
**How to avoid:** Each `MessageBubble` gets its own dedicated container element. Never reuse a container across messages.

### Pitfall 3: marked-highlight Integration — Wrong Import
**What goes wrong:** `import marked from 'marked'` (default import) then calling `marked.use()` throws because `marked` v15+ uses named exports.
**Why it happens:** marked changed to named exports. The `Marked` class must be instantiated.
**How to avoid:** Use `import { Marked } from 'marked'` and `const marked = new Marked(markedHighlight({...}))`. The instance is reusable; configure once at module level.

### Pitfall 4: Race Between Animation and Stop
**What goes wrong:** User clicks Stop while streaming animation is running; `clearInterval` is called but the container already has partial streaming-markdown DOM that doesn't match the final `done` content.
**Why it happens:** Stop aborts the SSE connection — but for simulated streaming (which runs after `done`), abort only means "cancel the animation interval". The `done` data is already in memory.
**How to avoid:** Stopping during animation keeps the partial text visible (user decision per CONTEXT.md). Store the animation cancel function; call it on stop. The message content is already set to the full `response` text; only the display is partial. After stop, swap container to `renderMarkdown(fullText)` immediately.

### Pitfall 5: 429 Before SSE Headers
**What goes wrong:** Trying to read `.body.getReader()` on a 429 JSON response throws or produces garbled output.
**Why it happens:** The backend returns plain JSON (not SSE) when the session is busy, before setting SSE headers.
**How to avoid:** Check `response.status === 429` before reading body. Show "Session is busy, please wait" inline error.

### Pitfall 6: highlight.js Theme Missing in Dark Mode
**What goes wrong:** Code blocks look correct in light mode but become illegible in dark mode (dark theme text on dark background).
**Why it happens:** highlight.js ships separate CSS files per theme; the theme isn't automatically dark-mode-aware.
**How to avoid:** Import a dark-mode-aware theme (e.g., `github-dark-dimmed`) and load it conditionally, OR use a theme that provides both light/dark variants. A practical approach: import `highlight.js/styles/github.css` for light and apply `highlight.js/styles/github-dark-dimmed.css` when `.dark` class is present via Tailwind's `@layer` or a conditional import.

### Pitfall 7: Svelte 5 Reactive Class — Method References
**What goes wrong:** Passing `chatStore.stop` as an event handler loses `this` context.
**Why it happens:** Class method references don't bind `this` automatically.
**How to avoid:** Use arrow function wrappers: `onclick={() => chatStore.stop()}` or define methods as arrow functions on the class.

---

## Code Examples

### Complete SSE Consumption Flow

```typescript
// Source: chimera-chat.js API contract + eventsource-parser v3 docs
async function sendMessage(text: string) {
  chatStore.status = 'loading';
  chatStore.currentActivity = 'Connecting...';
  chatStore.addUserMessage(text);

  const controller = new AbortController();
  chatStore.abortController = controller;

  try {
    await streamChat(text, sessionId, (type, data) => {
      switch (type) {
        case 'intent':
          chatStore.currentActivity = `Mode: ${data.mode}`;
          break;
        case 'tool':
          chatStore.currentActivity = `Using: ${data.tool}`;
          break;
        case 'done':
          chatStore.status = 'streaming'; // begin animation
          chatStore.addAssistantMessage(data.response);
          animateResponse(data.response, () => {
            chatStore.status = 'idle';
          });
          break;
        case 'error':
          chatStore.status = 'error';
          chatStore.lastError = data.error;
          break;
      }
    }, controller.signal);
  } catch (e) {
    if (!controller.signal.aborted) {
      chatStore.status = 'error';
      chatStore.lastError = e.message;
    }
  }
}
```

### Markdown Module Setup (browser-safe)

```typescript
// Source: marked-highlight v2.2.3 + DOMPurify v3 docs
// lib/chat/markdown.ts
import { browser } from '$app/environment';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

// Only execute in browser (DOMPurify requires window)
let _marked: Marked | null = null;
let _DOMPurify: typeof import('dompurify').default | null = null;

async function getRenderer() {
  if (!browser) return null;
  if (_marked && _DOMPurify) return { marked: _marked, DOMPurify: _DOMPurify };

  const { default: DOMPurify } = await import('dompurify');
  _DOMPurify = DOMPurify;
  _marked = new Marked(
    markedHighlight({
      emptyLangClass: 'hljs',
      langPrefix: 'hljs language-',
      highlight(code, lang) {
        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
        return hljs.highlight(code, { language }).value;
      }
    })
  );
  return { marked: _marked, DOMPurify };
}

export async function renderMarkdown(text: string): Promise<string> {
  const renderer = await getRenderer();
  if (!renderer) return text; // SSR fallback: return plain text
  const html = renderer.marked.parse(text) as string;
  return renderer.DOMPurify.sanitize(html);
}
```

### Message Bubble Component Shape

```svelte
<!-- lib/components/MessageBubble.svelte -->
<script lang="ts">
  import type { Message } from '$lib/chat/types';
  let { message }: { message: Message } = $props();
</script>

<div class={[
  'flex w-full',
  message.role === 'user' ? 'justify-end' : 'justify-start'
].join(' ')}>
  <div class={[
    'max-w-[80%] rounded-2xl px-4 py-2 text-sm',
    message.role === 'user'
      ? 'bg-primary text-primary-foreground rounded-br-sm'
      : 'bg-muted text-foreground rounded-bl-sm'
  ].join(' ')}>
    {#if message.role === 'assistant'}
      <!-- streaming-markdown or marked output goes here via bind:this -->
      <div bind:this={markdownContainer} class="prose prose-sm dark:prose-invert max-w-none"></div>
    {:else}
      <p class="whitespace-pre-wrap">{message.content}</p>
    {/if}
  </div>
</div>
```

---

## Recommendations for Claude's Discretion Items

**Message metadata:** Show timestamps only on hover (reduces visual clutter in bubble layout). Model name and token stats: skip from the bubble itself — optionally in a bottom status bar or omit entirely for Phase 2.

**Content area max-width:** `max-w-3xl mx-auto` (768px) for the message list. Matches Claude.ai and ChatGPT — readable on all supported breakpoints.

**Loading indicator:** Three-dot pulse animation with a text label showing `currentActivity` (e.g., "Using: read_file"). Positioned where the assistant bubble will appear. Use `tw-animate-css` pulse class.

**Auto-scroll:** Scroll to bottom only when already near bottom (within 80px threshold). Use `$effect.pre` + `tick()` pattern. Don't force-scroll when user has manually scrolled up to read history.

**Streaming text effect:** Character-by-character animation at ~8 chars/16ms tick (approximately 500 chars/sec). Provides visual streaming feel. Includes blinking cursor `|` appended during animation.

**Input area growth:** `min-height: 44px`, `max-height: 200px`, `overflow-y: auto` when capped. Use the `autoResize` action.

**Character limit indicator:** Show a soft warning at 2000 chars and hard limit at 4000. Display as `"1234 / 4000"` below the input, only visible when approaching limit (> 1500 chars).

**Error display:** Inline error within the chat, positioned as a failed assistant message with a retry button. No toast — errors are message-specific, not global.

**Empty state:** Simple centered welcome with "How can I help you today?" heading and 2–3 suggestion chips (hardcoded). Disappears once first message is sent.

**Offline/backend-down handling:** On fetch failure (network error before SSE headers), show inline error: "Cannot reach Chimera — is the server running?" with a retry button. No separate offline page.

**Message queuing during streaming:** Disable the input + button during active streaming. No queue. Simple, no edge cases. User can type in preparation (textarea stays editable for pre-typing) but Send is disabled until `status === 'idle'`.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `marked.highlight` option | `marked-highlight` package | marked v8.0.0 | Must install separate package; existing tutorials using `highlight` option will fail |
| EventSource for SSE | fetch + ReadableStream | Ongoing (POST SSE requirement) | EventSource doesn't support POST; required for Chimera |
| Svelte stores for shared state | Svelte 5 reactive class with `$state` | Svelte 5 stable | Cleaner class-based API; `.svelte.ts` files support runes |
| `tailwind.config.js` darkMode: 'class' | Tailwind v4 `@custom-variant dark` | Tailwind v4 | Already in `app.css`: `@custom-variant dark (&:is(.dark *))` |

**Deprecated/outdated:**
- `marked.setOptions({ highlight })`: Removed in marked v8. Use `marked-highlight`.
- `import DOMPurify from 'dompurify'` at module top-level in SvelteKit: Causes SSR errors. Use dynamic import or browser guard.
- Native `EventSource`: Cannot POST. Not usable with Chimera's SSE endpoint.

---

## Open Questions

1. **highlight.js theme in dark mode**
   - What we know: highlight.js themes are static CSS files, not CSS-variable-based
   - What's unclear: The simplest way to switch themes when `.dark` class toggles in Tailwind v4's custom-variant setup
   - Recommendation: Use CSS custom properties override in `app.css` for the two themes, or use a single theme that works acceptably in both modes (e.g., `atom-one-dark` works decently in dark mode, less so in light). Decide during implementation.

2. **streaming-markdown code block highlight timing**
   - What we know: streaming-markdown adds language classes to `<code>` elements as it parses; it does NOT call highlight.js
   - What's unclear: Whether `hljs.highlightElement()` can be safely called on elements while streaming-markdown is still writing to sibling elements
   - Recommendation: Call `hljs.highlightAll()` on the container after `parser_end()` (end of animation) and before swapping to the marked render. During the animation, accept unhighlighted code — it's still styled as a code block.

3. **Svelte 5 reactive class pattern stability**
   - What we know: `$state` in `.svelte.ts` class fields is documented and works per official Svelte docs
   - What's unclear: Edge cases with class instances passed across component boundaries (reactivity may not propagate through non-rune-aware props)
   - Recommendation: Export a singleton `chatStore` instance; import it directly in components rather than passing as props

---

## Sources

### Primary (HIGH confidence)
- `https://svelte.dev/docs/svelte/$state` — $state rune, reactive class pattern, $state.raw
- `https://svelte.dev/docs/svelte/$effect` — $effect cleanup, $effect.pre for scroll
- `https://svelte.dev/docs/svelte/use` — Svelte actions API and textarea pattern
- `https://marked.js.org/using_advanced` — confirmed highlight option removed in v8
- `https://github.com/markedjs/marked-highlight` — v2.2.3, complete setup with hljs
- `https://github.com/rexxars/eventsource-parser` — v3.0.6, EventSourceParserStream API
- `chimera-chat.js` — actual SSE endpoint contract (read directly)
- `chimera-orchestrator.js` — confirmed no token streaming; `done` event carries full response

### Secondary (MEDIUM confidence)
- `https://mode-watcher.sveco.dev/docs` — SSG/CSR compatible, FOUC prevention, 2-line setup
- `https://github.com/thetarnav/streaming-markdown` — v0.2.0, API confirmed; highlight hook absence confirmed
- `https://dev.to/willkre/persistent-theme-switch-dark-mode-with-svelte-sveltekit-tailwind-1b9g` — FOUC via app.html script

### Tertiary (LOW confidence)
- WebSearch: marked v17.0.4 (current version — verify at install time)
- WebSearch: DOMPurify v3.3.3 (current version — verify at install time)
- WebSearch: highlight.js v11.11.1 (current version — verify at install time)
- WebSearch: streaming-markdown syntax highlighting during animation — community patterns only, no official docs confirming `hljs.highlightElement()` approach

---

## Metadata

**Confidence breakdown:**
- SSE API contract: HIGH — read from source files directly
- Standard stack (libraries): MEDIUM-HIGH — verified via official docs for marked-highlight and eventsource-parser; versions from WebSearch (LOW for exact versions, verify at install)
- Architecture patterns: HIGH — Svelte 5 rune patterns from official docs
- Pitfalls: MEDIUM — several from source code analysis (HIGH), some from WebSearch community patterns (LOW)
- streaming-markdown highlight behavior: LOW — no official docs confirming exact behavior; recommended safe approach

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (30 days — stable libraries, but marked/eventsource-parser move fast; reverify versions at install)
