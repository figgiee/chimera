---
phase: 02
plan: 02
subsystem: chat-ui-components
tags: [svelte5, runes, markdown, streaming, tailwind, lucide, dompurify, highlight.js]

requires:
  - 02-01  # chatStore singleton, renderMarkdown, animateStreaming, types

provides:
  - web/src/lib/components/MessageBubble.svelte
  - web/src/lib/components/InputBar.svelte
  - web/src/lib/components/ChatWindow.svelte
  - web/src/lib/components/EmptyState.svelte
  - web/src/routes/+page.svelte (full chat page)

affects:
  - 02-03  # dark mode toggle, loading indicator, error retry polish builds on these components

tech-stack:
  added:
    - lucide-svelte (Copy, Check, ArrowUp, Square, RotateCcw icons)
  patterns:
    - Two-mode markdown rendering: animateStreaming on mount, swap to renderMarkdown on done
    - Svelte action for textarea auto-resize (use:autoResize)
    - Code copy buttons injected into DOM post-render via injectCopyButtons()
    - $derived for reactive timestamp formatting (avoids Svelte 5 state_referenced_locally warning)

key-files:
  created:
    - web/src/lib/components/MessageBubble.svelte
    - web/src/lib/components/InputBar.svelte
    - web/src/lib/components/ChatWindow.svelte
    - web/src/lib/components/EmptyState.svelte
  modified:
    - web/src/routes/+page.svelte

key-decisions:
  - id: "02-02-A"
    decision: "Use $derived for timestamp instead of const declaration"
    rationale: "Svelte 5 emits state_referenced_locally warning when message.timestamp is read outside a reactive context. $derived correctly tracks the reactive prop and eliminates the warning."
    impact: "timestamp computed via $derived in MessageBubble"

  - id: "02-02-B"
    decision: "Code copy buttons injected imperatively via injectCopyButtons()"
    rationale: "The rendered HTML comes from renderMarkdown (raw innerHTML swap). Svelte cannot template over unknown HTML structure. Direct DOM manipulation after the innerHTML swap is the only viable approach."
    impact: "Copy buttons attached to pre elements after each renderMarkdown call"

  - id: "02-02-C"
    decision: "Auto-scroll effect depends on messages.length AND chatStore.status"
    rationale: "Depending only on messages.length would miss streaming updates where message count stays constant but content changes. Status dependency ensures scroll on streaming → idle transition."
    impact: "ChatWindow scrolls correctly through all phases of a response"

patterns-established:
  - "Svelte action pattern for textarea auto-resize (use:autoResize inline in component)"
  - "Post-render DOM injection for dynamically structured content (copy buttons on code blocks)"
  - "Two-effect pattern: onMount for initial streaming, $effect for isStreaming→false transition"

duration: "~3 min"
completed: "2026-03-12"
---

# Phase 2 Plan 02: Chat UI Components Summary

**One-liner:** Five Svelte 5 components delivering bubble-layout chat with two-mode markdown rendering, Enter-to-send textarea, auto-scroll, and suggestion chip empty state.

## What Was Built

### MessageBubble (`MessageBubble.svelte`)

Single message rendering for all three roles: user, assistant, error.

- **User messages:** Right-aligned bubble (`bg-primary`), `whitespace-pre-wrap` plain text.
- **Assistant messages:** Left-aligned bubble (`bg-muted`), two-mode markdown rendering:
  - `onMount`: if `message.isStreaming`, call `animateStreaming()`, register cancel with `chatStore.registerAnimationCancel()`. On animation done: `highlightCodeBlocks()` → `chatStore.markDone()` → swap innerHTML to `await renderMarkdown()` → inject copy buttons.
  - `$effect` watching `message.isStreaming`: when it transitions to false mid-animation (user hit Stop), swap immediately to `renderMarkdown()` final render.
  - Non-streaming assistant messages (restored from history): separate `$effect` checks `innerHTML === ''` and renders.
- **Copy buttons:** `injectCopyButtons()` scans `pre > code` blocks post-render and injects absolute-positioned "Copy/Copied!" buttons. Whole-message copy button appears on hover with Copy/Check icon toggle.
- **Error messages:** Left-aligned destructive-tinted bubble with retry button calling `chatStore.retry()`.
- **Hover timestamps:** Opacity transition on group-hover, formatted as HH:MM.

### InputBar (`InputBar.svelte`)

- Textarea with `use:autoResize` action — sets `height: auto` then `scrollHeight` on each input event.
- `onkeydown`: `e.preventDefault()` before `handleSend()` when Enter is pressed without Shift (prevents newline insertion).
- Send/Stop button: `$derived` `isBusy` drives the swap between ArrowUp (send, disabled when empty) and Square (stop, always enabled).
- On send: calls `chatStore.sendMessage()`, clears input, resets textarea height via `requestAnimationFrame`.

### ChatWindow (`ChatWindow.svelte`)

- `flex-1 overflow-y-auto` outer + `max-w-3xl mx-auto` inner.
- `{#each chatStore.messages as message (message.id)}` — messages keyed by id for correct reconciliation.
- `$effect` auto-scroll: reads `messages.length` + `status`, checks `distanceFromBottom < 80px`, scrolls smoothly via `tick()` + `scrollTo({ behavior: 'smooth' })` only when near bottom.

### EmptyState (`EmptyState.svelte`)

- Centered `flex-1` container with "How can I help you today?" heading.
- Three suggestion chips as `<button>` pills — clicking calls `chatStore.sendMessage(chipText)`.
- Disappears automatically when `chatStore.messages.length > 0` (controlled by `+page.svelte`).

### +page.svelte

Full `h-screen` flex column: header bar (Chimera title, dark mode toggle slot for Plan 03), conditional empty state / chat window, and input bar pinned at bottom.

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | MessageBubble + InputBar | f7827b8 | MessageBubble.svelte, InputBar.svelte |
| 2 | ChatWindow + EmptyState + page | 9a4d4af | ChatWindow.svelte, EmptyState.svelte, +page.svelte |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Svelte 5 state_referenced_locally warning on message.timestamp**

- **Found during:** Task 1 (svelte-check)
- **Issue:** `const timestamp = new Date(message.timestamp)...` read the prop outside a reactive context, triggering Svelte's `state_referenced_locally` warning.
- **Fix:** Wrapped in `$derived(...)` so Svelte tracks the reactive prop correctly.
- **Files modified:** `web/src/lib/components/MessageBubble.svelte`
- **Commit:** f7827b8

## Next Phase Readiness

Plan 02-03 can proceed immediately. All components are wired and building cleanly:

- `chatStore.currentActivity` is available for the loading indicator (already in ChatStore).
- The header in `+page.svelte` has a comment slot for the dark mode toggle.
- Error state is fully rendered — Plan 02-03 polish can focus on loading spinner and toast/retry enhancements.

No blockers identified.

## Self-Check: PASSED
