---
phase: 02
plan: 01
subsystem: chat-data-layer
tags: [svelte5, runes, sse, markdown, dompurify, highlight.js, eventsource-parser, streaming-markdown]

requires:
  - 01-02  # SvelteKit scaffold with Tailwind v4, $app/environment available

provides:
  - web/src/lib/chat/types.ts
  - web/src/lib/chat/SSEClient.ts
  - web/src/lib/chat/ChatStore.svelte.ts
  - web/src/lib/chat/markdown.ts

affects:
  - 02-02  # MessageBubble and input components depend on chatStore and renderMarkdown
  - 02-03  # ChatInterface layout depends on chatStore.status and messages

tech-stack:
  added:
    - streaming-markdown@0.2.15
    - marked@17.0.4
    - marked-highlight@2.2.3
    - highlight.js@11.11.1
    - dompurify@3.3.3
    - eventsource-parser@3.0.6
    - mode-watcher@1.1.0
    - "@types/dompurify (devDep)"
  patterns:
    - Svelte 5 reactive class with $state runes in .svelte.ts files
    - Arrow function class methods to avoid this-binding issues
    - Lazy dynamic import for browser-only dependencies (DOMPurify)
    - ReadableStreamDefaultReader iteration (TypeScript DOM lib limitation workaround)

key-files:
  created:
    - web/src/lib/chat/types.ts
    - web/src/lib/chat/SSEClient.ts
    - web/src/lib/chat/ChatStore.svelte.ts
    - web/src/lib/chat/markdown.ts
  modified:
    - web/package.json

key-decisions:
  - id: "02-01-A"
    decision: "Use ReadableStreamDefaultReader instead of for-await on ReadableStream"
    rationale: "TypeScript's DOM lib does not declare ReadableStream as AsyncIterable even with DOM.Iterable in tsconfig. Reader API achieves identical behavior."
    impact: "SSEClient.ts reads events via reader.read() loop; functionally equivalent"

  - id: "02-01-B"
    decision: "streaming-markdown uses named imports (not default import)"
    rationale: "Package exports individual functions (parser, default_renderer, parser_write, parser_end). The plan suggested `import * as smd` which is correct — confirmed against package types."
    impact: "markdown.ts imports as `import * as smd from 'streaming-markdown'`"

  - id: "02-01-C"
    decision: "AbortError from stop() does not produce error UI"
    rationale: "User-initiated cancellation is not an error. streamChat lets AbortError propagate; ChatStore catches it by name and returns early without pushing an error message."
    impact: "stop() → idle state cleanly without error banner"

patterns-established:
  - "Reactive class pattern: $state fields in .svelte.ts, arrow function methods, singleton export"
  - "SSR-safe browser dependency: guard with `browser` check, lazy dynamic import"
  - "Two-mode markdown: animateStreaming during generation, renderMarkdown after done"

duration: "~4 min"
completed: "2026-03-12"
---

# Phase 2 Plan 01: Chat Data Layer Summary

**One-liner:** Svelte 5 reactive ChatStore + POST SSE client + DOMPurify/marked/streaming-markdown utilities with full TypeScript coverage.

## What Was Built

All four `src/lib/chat/` modules are in place. Every UI component in Plans 02 and 03 can now import from this layer without writing any data-fetching or state logic themselves.

### Types (`types.ts`)

Defines `Message`, `ChatStatus`, `SSEEventMap`, and `SendMessageOptions`. The `SSEEventMap` union captures the full `/api/chat/stream` event contract: `user_message`, `intent`, `tool`, `done`, `error`, `loop`.

### SSE Client (`SSEClient.ts`)

`streamChat` POSTs to `/api/chat/stream`, checks for 429 before reading the body, then pipes through `TextDecoderStream` → `EventSourceParserStream`. Uses `ReadableStreamDefaultReader` for iteration (TypeScript workaround — see Decision 02-01-A). AbortError propagates to the caller for clean stop handling.

### Markdown Utilities (`markdown.ts`)

- `renderMarkdown`: Lazy-initializes a `Marked` instance with `markedHighlight`, then lazy-imports DOMPurify on first call. SSR-safe — returns plain text on the server. Allows `class` attributes through DOMPurify so highlight.js classes survive sanitization.
- `animateStreaming`: Uses `streaming-markdown` named exports to progressively render into a container at 8 chars/16ms. Returns a cancel function.
- `highlightCodeBlocks`: Post-animation hljs pass for code blocks that streaming-markdown didn't highlight.

### ChatStore (`ChatStore.svelte.ts`)

Svelte 5 reactive class with `$state` runes. State machine:

```
idle → (sendMessage) → loading → (done event) → streaming → (markDone) → idle
                                               ↓
                                    (stop) → idle (no error UI)
                     ↓
              (error event / HTTP error) → error → (retry) → idle → loading → ...
```

Arrow function methods (`sendMessage`, `stop`, `retry`, `markDone`, `registerAnimationCancel`) avoid `this` rebinding issues. Singleton `chatStore` exported for application-wide use.

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Install deps + type definitions | 2dff609 | package.json, types.ts |
| 2 | SSEClient + markdown utilities | 33495d9 | SSEClient.ts, markdown.ts |
| 3 | Reactive ChatStore | 0823eef | ChatStore.svelte.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TypeScript `for await...of` on ReadableStream not supported**

- **Found during:** Task 2 (SSEClient.ts)
- **Issue:** TypeScript's DOM lib does not declare `ReadableStream` as `AsyncIterable`, causing a type error even with `DOM.Iterable` in tsconfig.
- **Fix:** Replaced `for await (const event of stream)` with `ReadableStreamDefaultReader` loop (`reader.read()` in a while loop with `finally { reader.releaseLock() }`). Functionally identical.
- **Files modified:** `web/src/lib/chat/SSEClient.ts`
- **Commit:** 33495d9

**2. [Rule 1 - Bug] Callback type mismatch in ChatStore onEvent handler**

- **Found during:** Task 3 (ChatStore.svelte.ts, svelte-check)
- **Issue:** `streamChat` declares `onEvent: (type: string, data: unknown) => void` but the inner handler typed `data` as `Record<string, unknown>`, which is not assignable from `unknown`.
- **Fix:** Renamed parameter to `raw: unknown`, cast immediately to `const d = (raw ?? {}) as Record<string, unknown>`, used `d` throughout the switch.
- **Files modified:** `web/src/lib/chat/ChatStore.svelte.ts`
- **Commit:** 0823eef

**3. [Rule 1 - Bug] Unreachable `status !== 'streaming'` check in finally block**

- **Found during:** Task 3 (svelte-check flagged type overlap)
- **Issue:** TypeScript correctly noted that `status` could only be `'error'` or `'loading'` at the finally point — never `'streaming'` — making the guard a no-op with an impossible comparison.
- **Fix:** Removed conditional, always clear `abortController = null` in finally. Added explanatory comment noting all three possible status values at that point.
- **Files modified:** `web/src/lib/chat/ChatStore.svelte.ts`
- **Commit:** 0823eef

## Next Phase Readiness

Plans 02-02 and 02-03 can proceed immediately. All exported symbols are available:

- `chatStore` (ChatStore singleton) — from `$lib/chat/ChatStore.svelte.ts`
- `renderMarkdown`, `animateStreaming`, `highlightCodeBlocks` — from `$lib/chat/markdown.ts`
- `streamChat` — from `$lib/chat/SSEClient.ts` (used internally by ChatStore)
- All types — from `$lib/chat/types.ts`

No blockers identified.

## Self-Check: PASSED
