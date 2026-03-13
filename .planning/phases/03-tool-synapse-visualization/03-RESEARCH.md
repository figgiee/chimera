# Phase 3: Tool + Synapse Visualization - Research

**Researched:** 2026-03-12
**Domain:** Svelte 5 reactive UI — collapsible tool call blocks, real-time workflow progress panel
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Tool call blocks:**
- Collapsed by default — shows tool name, status icon, and elapsed time
- User clicks to expand and see arguments and truncated result
- "Show more" button inside expanded view to see full output
- Placement relative to message text: Claude's discretion (inline vs grouped)

**Synapse workflow panel:**
- Panel location (inline vs side panel): Claude's discretion — pick what works best with existing layout
- Phase transition visualization (stepper vs label): Claude's discretion
- Post-completion behavior (collapse vs persist): Claude's discretion
- Cancel button confirmation behavior: Claude's discretion

**Q&A cards:**
- Question presentation format: Claude's discretion (card-based vs main input bar)
- Answered state display: Claude's discretion (paired Q/A vs collapsed)
- Skip behavior: Claude's discretion
- Question count/progress: Claude's discretion — backend may not know total upfront

**Task checklist:**
- Detail level per task: Claude's discretion (name+status vs name+status+preview)
- Overall progress indicator: Claude's discretion (bar, count, or none)
- Failed task display: Claude's discretion
- Active/running task visual treatment: Claude's discretion (spinner, highlight, or both)

### Claude's Discretion

User delegated nearly all visual design decisions to Claude. Key areas of flexibility:
- Tool block placement and visual treatment (status icons, colors, borders)
- Error display strategy (auto-expand on error vs same as success)
- Synapse panel location and layout
- Phase transition visuals
- Q&A interaction pattern and state management
- Task checklist detail level and progress indicators
- All spacing, typography, and animation choices

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

## Summary

Phase 3 adds two visual layers on top of the existing Svelte 5 + Tailwind v4 chat: collapsible tool call blocks and a Synapse workflow progress panel. Both consume SSE events that are already flowing through SSEClient.ts and handled (partially) in ChatStore.svelte.ts — the backend is complete and stable. The work is purely frontend: new reactive data structures in ChatStore, new Svelte components, and wiring them into the message stream.

The standard approach for this domain is to extend the existing `Message` type to carry associated tool calls and Synapse state, use Svelte 5's deep-reactive `$state` proxies for in-place mutation of arrays, and build purpose-built components (`ToolCallBlock.svelte`, `SynapsePanel.svelte`, `QACard.svelte`, `TaskChecklist.svelte`). No new libraries are needed — Lucide Svelte (already installed) covers all icons, and Tailwind v4 utilities cover all visual treatment.

The biggest design decision is **where tool blocks live relative to message text**. Research into how ChatGPT, Cursor, and Pydantic AI Chat render this pattern shows a clear consensus: tool calls appear **above** the assistant's reply text in the same bubble, as a discrete list that collapses once the reply arrives. This is the recommended placement. The Synapse panel is a special-case message type that appears inline in the chat stream (not a sidebar), because it IS the response for build/plan workflows — there is no separate assistant text.

**Primary recommendation:** Extend `Message` to carry `toolCalls[]` and optional `synapseState`. Render tool blocks above the assistant text in `MessageBubble`. Render the Synapse panel as a dedicated message type (`role: 'synapse'`). Use `$state` deep proxy mutation for live updates during streaming.

---

## Existing Codebase — Critical Context

### SSE Event Shapes (from chimera-orchestrator.js — verified by reading source)

All events the frontend must handle. These are already sent; the frontend just ignores most of them today.

| Event | Payload Fields | When Emitted |
|-------|---------------|--------------|
| `tool` | `tool`, `args?`, `result?`, `error?`, `hadError?` | Each tool call (find_tool and call_tool) |
| `intent` | `mode` | When Chimera picks a routing mode |
| `loop` | `reason`, `signature?` | When loop detector fires |
| `synapse_start` | `session_id`, `mode`, `status` | Synapse session created |
| `synapse_question` | `area_id`, `text` | Q&A loop emits each question |
| `synapse_answer` | `area_id`, `answer` | Q&A loop emits each auto-answer |
| `task_start` | `id`, `description` | Each task begins |
| `task_done` | `id`, `response` | Each task finishes (response is 200-char preview) |
| `tasks_complete` | `count`, `message` | All tasks done |
| `done` | `response`, `session_id`, `stats?` | Final assistant message (always arrives) |

**Key behavioral facts (verified from orchestrator source):**
- `tool` events come during normal direct mode too (not only Synapse)
- `synapse_start` always precedes `synapse_question`/`task_start`
- `synapse_answer` is always auto-generated (Chimera answers its own questions) — the user never types answers
- `done` event always arrives at the end of both Synapse and direct flows; for Synapse it contains a 2-3 sentence summary
- Cancel/Stop already works: existing `chatStore.stop()` aborts the fetch, which triggers `req.on('close', abort.abort())` server-side — no new backend endpoint needed for SYN-04

### Current ChatStore State (verified by reading source)

Today's `ChatStore` handles: `tool` (sets activity text only), `intent` (sets activity text), `loop` (sets activity text). Everything else is ignored.

Today's `Message` type:
```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  timestamp: number;
  isStreaming: boolean;
}
```

### Installed Package Versions (from web/package.json — verified)

| Package | Version |
|---------|---------|
| svelte | ^5.51.0 (installed: 5.53.11) |
| lucide-svelte | ^0.577.0 |
| tailwindcss | ^4.2.1 |
| bits-ui | ^2.16.3 |

---

## Standard Stack

No new packages needed. All work uses already-installed dependencies.

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| svelte | 5.53.11 | Reactive components, runes | Already in use throughout |
| lucide-svelte | ^0.577.0 | Status icons (Loader, Check, X, ChevronDown, Square) | Already in use (Copy, Check, RotateCcw, ArrowUp, Square) |
| tailwindcss v4 | ^4.2.1 | All visual treatment, spacing, colors | Already configured |
| bits-ui | ^2.16.3 | Collapsible primitive if needed | Already installed |

### No Installation Required

```bash
# No new packages — use what is already installed
```

### Lucide Icons for This Phase

From lucide-svelte (verified available in the package):
- `Loader2` — spinning animation for in-progress status
- `CheckCircle2` (or `Check`) — success status
- `XCircle` (or `X`) — error status
- `ChevronDown` / `ChevronRight` — expand/collapse toggle
- `Square` (filled) — already used as Stop; reuse for cancel
- `Wrench` — tool call icon (optional, alongside tool name)
- `Zap` — Synapse/workflow indicator

---

## Architecture Patterns

### Recommended Data Model Extension

Extend `types.ts` to add tool call and Synapse state to the Message type:

```typescript
// Source: verified from existing types.ts + SSE event shapes from orchestrator source

export type ToolCallStatus = 'running' | 'done' | 'error';

export interface ToolCall {
  id: string;              // crypto.randomUUID() — assigned when tool event arrives
  tool: string;            // tool name
  args?: unknown;          // from SSE event .args
  result?: unknown;        // from SSE event .result
  error?: string;          // from SSE event .error
  hadError: boolean;       // from SSE event .hadError
  status: ToolCallStatus;
  startedAt: number;       // Date.now() when tool event arrived
  durationMs?: number;     // set when status transitions to done/error
}

export type SynapsePhase = 'qa' | 'executing' | 'complete';

export interface SynapseState {
  sessionId: string;
  mode: string;            // 'feature' | 'bugfix' | 'research' | 'refactor' | 'debug'
  phase: SynapsePhase;
  qaCards: QACard[];
  tasks: TaskItem[];
  tasksCompleteMessage?: string;
}

export interface QACard {
  areaId: string;
  question: string;
  answer?: string;         // set when synapse_answer arrives
}

export interface TaskItem {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  responsePreview?: string; // first 200 chars from task_done.response
}

// Extended Message type — add to existing Message interface
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'error' | 'synapse'; // add 'synapse'
  content: string;
  timestamp: number;
  isStreaming: boolean;
  toolCalls?: ToolCall[];         // populated during loading/streaming
  synapseState?: SynapseState;   // present only when role === 'synapse'
}
```

### Recommended Component Structure

```
src/lib/components/
├── ChatWindow.svelte         # existing — no changes needed
├── MessageBubble.svelte      # existing — add ToolCallList rendering above text
├── InputBar.svelte           # existing — no changes needed
├── LoadingIndicator.svelte   # existing — update to show Synapse phase label
├── DarkModeToggle.svelte     # existing — no changes
├── EmptyState.svelte         # existing — no changes
├── ToolCallBlock.svelte      # NEW — single collapsible tool call
├── SynapsePanel.svelte       # NEW — full workflow progress panel
├── QACard.svelte             # NEW — single Q&A pair
└── TaskChecklist.svelte      # NEW — task list with live status
```

### Pattern 1: ChatStore Extension for Tool Calls and Synapse State

The key insight: during the `loading` phase (before `done` fires), tool calls accumulate on the **in-flight message**. The easiest model is a `pendingToolCalls` array on ChatStore that gets attached to the message when `done` fires.

```typescript
// Source: derived from existing ChatStore pattern + verified Svelte 5 $state docs

export class ChatStore {
  // ... existing fields ...

  // Accumulates during the current request; attached to message on done
  pendingToolCalls = $state<ToolCall[]>([]);

  // Active Synapse message id (if a synapse flow is running)
  activeSynapseMessageId = $state<string | null>(null);

  // Track active tool for elapsed timer
  activeToolId = $state<string | null>(null);
}
```

In the `onEvent` handler in `sendMessage`, extend the switch:

```typescript
case 'tool': {
  // Close any currently-running tool (set durationMs)
  if (this.activeToolId) {
    const running = this.pendingToolCalls.find(t => t.id === this.activeToolId);
    if (running) {
      running.status = d.hadError ? 'error' : 'done';
      running.durationMs = Date.now() - running.startedAt;
    }
  }
  // Open new tool call
  const toolCall: ToolCall = {
    id: crypto.randomUUID(),
    tool: typeof d.tool === 'string' ? d.tool : 'unknown',
    args: d.args,
    result: d.result,
    error: typeof d.error === 'string' ? d.error : undefined,
    hadError: Boolean(d.hadError),
    status: (d.result !== undefined || d.error !== undefined) ? (d.hadError ? 'error' : 'done') : 'running',
    startedAt: Date.now(),
    durationMs: (d.result !== undefined || d.error !== undefined) ? 0 : undefined,
  };
  this.pendingToolCalls.push(toolCall); // deep reactive — push() triggers update
  this.activeToolId = toolCall.id;
  this.currentActivity = `Using: ${d.tool}`;
  break;
}

case 'synapse_start': {
  // Create the synapse "message" immediately so panel appears inline
  const synapseMsg: Message = {
    id: crypto.randomUUID(),
    role: 'synapse',
    content: '',
    timestamp: Date.now(),
    isStreaming: true,
    synapseState: {
      sessionId: typeof d.session_id === 'string' ? d.session_id : '',
      mode: typeof d.mode === 'string' ? d.mode : 'feature',
      phase: 'qa',
      qaCards: [],
      tasks: [],
    }
  };
  this.messages.push(synapseMsg);
  this.activeSynapseMessageId = synapseMsg.id;
  break;
}

case 'synapse_question': {
  const msg = this.messages.find(m => m.id === this.activeSynapseMessageId);
  if (msg?.synapseState) {
    msg.synapseState.qaCards.push({
      areaId: typeof d.area_id === 'string' ? d.area_id : '',
      question: typeof d.text === 'string' ? d.text : '',
    });
  }
  break;
}

case 'synapse_answer': {
  const msg = this.messages.find(m => m.id === this.activeSynapseMessageId);
  if (msg?.synapseState) {
    const card = msg.synapseState.qaCards.find(c => c.areaId === d.area_id);
    if (card) card.answer = typeof d.answer === 'string' ? d.answer : '';
  }
  break;
}

case 'task_start': {
  const msg = this.messages.find(m => m.id === this.activeSynapseMessageId);
  if (msg?.synapseState) {
    msg.synapseState.phase = 'executing';
    msg.synapseState.tasks.push({
      id: typeof d.id === 'string' ? d.id : crypto.randomUUID(),
      description: typeof d.description === 'string' ? d.description : '',
      status: 'running',
    });
  }
  break;
}

case 'task_done': {
  const msg = this.messages.find(m => m.id === this.activeSynapseMessageId);
  if (msg?.synapseState) {
    const task = msg.synapseState.tasks.find(t => t.id === d.id);
    if (task) {
      task.status = 'done';
      task.responsePreview = typeof d.response === 'string' ? d.response : undefined;
    }
  }
  break;
}

case 'tasks_complete': {
  const msg = this.messages.find(m => m.id === this.activeSynapseMessageId);
  if (msg?.synapseState) {
    msg.synapseState.phase = 'complete';
    msg.synapseState.tasksCompleteMessage = typeof d.message === 'string' ? d.message : undefined;
    msg.isStreaming = false;
  }
  break;
}

case 'done': {
  // Attach accumulated tool calls to the new assistant message
  const toolCallsSnapshot = [...this.pendingToolCalls];
  this.pendingToolCalls = [];
  this.activeToolId = null;
  this.activeSynapseMessageId = null;

  this.status = 'streaming';
  if (typeof d.session_id === 'string') this.sessionId = d.session_id;
  this.messages.push({
    id: crypto.randomUUID(),
    role: 'assistant',
    content: typeof d.response === 'string' ? d.response : '',
    timestamp: Date.now(),
    isStreaming: true,
    toolCalls: toolCallsSnapshot.length > 0 ? toolCallsSnapshot : undefined,
  });
  break;
}
```

**Important:** `this.pendingToolCalls.push(toolCall)` works because `pendingToolCalls` is a `$state` deep-reactive proxy — Svelte 5 tracks array mutations including push(). Verified from official Svelte docs.

### Pattern 2: ToolCallBlock Component

```svelte
<!-- ToolCallBlock.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight } from 'lucide-svelte';
  import type { ToolCall } from '$lib/chat/types.js';

  let { toolCall }: { toolCall: ToolCall } = $props();

  let expanded = $state(false);
  let showFull = $state(false);

  // Elapsed timer — only runs while status === 'running'
  let elapsedMs = $state(0);

  $effect(() => {
    if (toolCall.status !== 'running') return;

    const start = toolCall.startedAt;
    const interval = setInterval(() => {
      elapsedMs = Date.now() - start;
    }, 100);

    return () => clearInterval(interval);
  });

  // Auto-expand on error (Claude's discretion — recommended)
  $effect(() => {
    if (toolCall.status === 'error') expanded = true;
  });

  const displayDuration = $derived(() => {
    const ms = toolCall.durationMs ?? elapsedMs;
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  });

  const resultText = $derived(() => {
    if (!toolCall.result) return '';
    const s = typeof toolCall.result === 'string'
      ? toolCall.result
      : JSON.stringify(toolCall.result, null, 2);
    return s;
  });

  const TRUNCATE_LENGTH = 500;
  const isTruncated = $derived(resultText.length > TRUNCATE_LENGTH);
</script>

<div class="group/tool my-1 rounded-lg border border-border bg-muted/40 text-xs">
  <!-- Collapsed header (always visible) -->
  <button
    onclick={() => expanded = !expanded}
    class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/60 transition-colors rounded-lg"
    aria-expanded={expanded}
  >
    <!-- Status icon -->
    {#if toolCall.status === 'running'}
      <Loader2 size={12} class="shrink-0 animate-spin text-muted-foreground" />
    {:else if toolCall.status === 'done'}
      <CheckCircle2 size={12} class="shrink-0 text-green-500" />
    {:else}
      <XCircle size={12} class="shrink-0 text-destructive" />
    {/if}

    <!-- Tool name -->
    <span class="font-mono font-medium text-foreground/80 flex-1">{toolCall.tool}</span>

    <!-- Duration -->
    <span class="text-muted-foreground">{displayDuration}</span>

    <!-- Chevron -->
    {#if expanded}
      <ChevronDown size={12} class="shrink-0 text-muted-foreground" />
    {:else}
      <ChevronRight size={12} class="shrink-0 text-muted-foreground" />
    {/if}
  </button>

  <!-- Expanded content -->
  {#if expanded}
    <div class="border-t border-border px-3 py-2 space-y-2">
      {#if toolCall.args && Object.keys(toolCall.args as object).length > 0}
        <div>
          <p class="text-muted-foreground mb-1 uppercase tracking-wide" style="font-size: 10px">Arguments</p>
          <pre class="text-foreground/80 whitespace-pre-wrap break-all font-mono">{JSON.stringify(toolCall.args, null, 2)}</pre>
        </div>
      {/if}

      {#if toolCall.error}
        <div>
          <p class="text-destructive mb-1 uppercase tracking-wide" style="font-size: 10px">Error</p>
          <pre class="text-destructive/80 whitespace-pre-wrap break-all font-mono">{toolCall.error}</pre>
        </div>
      {:else if resultText}
        <div>
          <p class="text-muted-foreground mb-1 uppercase tracking-wide" style="font-size: 10px">Result</p>
          <pre class="text-foreground/80 whitespace-pre-wrap break-all font-mono">{showFull ? resultText : resultText.slice(0, TRUNCATE_LENGTH)}</pre>
          {#if isTruncated && !showFull}
            <button
              onclick={() => showFull = true}
              class="mt-1 text-muted-foreground hover:text-foreground transition-colors"
            >Show more</button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
```

### Pattern 3: MessageBubble Tool Call Placement

Tool calls go **above** the assistant text, inside the same bubble. This matches the pattern used by ChatGPT, Cursor, and Pydantic AI Chat. During loading, tool calls appear in the LoadingIndicator area (before the `done` event fires). After `done`, they're attached to the assistant message and render above its text.

```svelte
<!-- MessageBubble.svelte — assistant section, inside the bubble div -->
{#if message.toolCalls && message.toolCalls.length > 0}
  <div class="mb-3 space-y-1">
    {#each message.toolCalls as toolCall (toolCall.id)}
      <ToolCallBlock {toolCall} />
    {/each}
  </div>
{/if}
<div bind:this={markdownContainer} class="prose prose-sm dark:prose-invert max-w-none"></div>
```

### Pattern 4: SynapsePanel — Inline Message Approach

Synapse renders as a `role: 'synapse'` message in the chat list. `MessageBubble` switches on role to render `SynapsePanel` instead of markdown:

```svelte
<!-- MessageBubble.svelte — add to role checks -->
{:else if message.role === 'synapse' && message.synapseState}
  <div class="flex w-full justify-start">
    <SynapsePanel state={message.synapseState} isStreaming={message.isStreaming} />
  </div>
```

```svelte
<!-- SynapsePanel.svelte skeleton -->
<script lang="ts">
  import { Square } from 'lucide-svelte';
  import { chatStore } from '$lib/chat/ChatStore.svelte.js';
  import type { SynapseState } from '$lib/chat/types.js';
  import QACard from './QACard.svelte';
  import TaskChecklist from './TaskChecklist.svelte';

  let { state, isStreaming }: { state: SynapseState; isStreaming: boolean } = $props();

  const phaseLabel = $derived(() => ({
    qa: 'Clarifying requirements',
    executing: 'Executing tasks',
    complete: 'Complete',
  }[state.phase]));
</script>

<div class="w-full max-w-[80%] rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3 space-y-3">
  <!-- Header: mode badge + phase label + cancel -->
  <div class="flex items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      <span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary capitalize">{state.mode}</span>
      <span class="text-sm text-muted-foreground">{phaseLabel}</span>
    </div>
    {#if isStreaming}
      <button
        onclick={() => chatStore.stop()}
        class="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
        aria-label="Cancel workflow"
      >
        <Square size={10} fill="currentColor" />
        Cancel
      </button>
    {/if}
  </div>

  <!-- Q&A cards (shown during qa phase and after) -->
  {#if state.qaCards.length > 0}
    <div class="space-y-2">
      {#each state.qaCards as card (card.areaId)}
        <QACard {card} />
      {/each}
    </div>
  {/if}

  <!-- Task checklist (shown during executing phase and after) -->
  {#if state.tasks.length > 0}
    <TaskChecklist tasks={state.tasks} complete={state.phase === 'complete'} completeMessage={state.tasksCompleteMessage} />
  {/if}
</div>
```

### Pattern 5: Live Elapsed Timer in ToolCallBlock

Use `$effect` with cleanup (verified pattern from Svelte 5 official docs):

```typescript
// Source: https://svelte.dev/docs/svelte/$effect (verified)
$effect(() => {
  if (toolCall.status !== 'running') return; // no cleanup needed, effect does nothing

  const start = toolCall.startedAt;
  const interval = setInterval(() => {
    elapsedMs = Date.now() - start;
  }, 100); // 100ms = smooth enough, not excessive

  return () => clearInterval(interval); // runs before re-run or unmount
});
```

### Pattern 6: Deep Reactive Mutation vs. Reassignment

**Critical rule:** Within ChatStore (a class using `$state` runes), deep proxy mutation works for arrays — `array.push()` and `item.field = value` both trigger reactivity. But exported values from `.svelte.ts` modules sometimes need reassignment when crossing module boundaries. Since ChatStore is accessed as a singleton instance (`chatStore.messages`), mutation of nested objects is fine:

```typescript
// CORRECT — deep proxy mutation (verified from Svelte docs)
msg.synapseState.qaCards.push(newCard);       // push triggers reactivity
task.status = 'done';                          // property assignment triggers reactivity

// ALSO CORRECT — reassignment (safe fallback)
this.pendingToolCalls = [...this.pendingToolCalls, newTool];

// WRONG for ChatStore class fields — don't use $state.raw here
// (raw is for large read-only collections)
```

### Anti-Patterns to Avoid

- **Adding event handling to SSEClient.ts directly:** Keep SSEClient.ts pure transport. All business logic stays in ChatStore's onEvent handler.
- **Separate Synapse message list:** Don't track Synapse state outside the `messages` array. Putting it in the messages array keeps ordering correct and lets ChatWindow auto-scroll naturally.
- **Polling for tool call status:** Tool call events are push-based via SSE. No polling needed.
- **Storing `Date.now()` in `$derived`:** The elapsed timer uses `$state(elapsedMs)` updated by `setInterval`, not a derived from `Date.now()` (derived has no dependency to trigger reruns).
- **Using `{@html}` for tool args/results:** These are untrusted data. Use `JSON.stringify` in a `<pre>` tag to display safely without DOMPurify.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Collapsible container | Custom show/hide logic | Native `{#if expanded}` with Svelte transitions, OR bits-ui Collapsible | Both are in the project already |
| Spin animation | CSS keyframes | `animate-spin` Tailwind utility | Already in Tailwind |
| Icon set | SVG files | lucide-svelte (already installed) | Consistent, sized via `size` prop |
| Elapsed timer display | Complex time formatting | `ms < 1000 ? ms + 'ms' : (ms/1000).toFixed(1) + 's'` — dead simple | No library needed |
| Status color coding | Design system tokens | `text-green-500`, `text-destructive` via Tailwind | Consistent with existing patterns |
| Text truncation | Character count logic | Slice at `TRUNCATE_LENGTH` + "Show more" state | Already locked in the decision |

**Key insight:** This phase is pure composition of existing primitives. Every visual problem has a 2-5 line solution using installed tools.

---

## Recommended Design Decisions (Claude's Discretion Areas)

These are recommendations the planner should treat as the approach:

### Tool block placement: above message text
Place `<ToolCallBlock>` list above the markdown content, inside the same bubble. Separator via `mb-3` margin. Rationale: the tool calls explain how the answer was produced — reading them before the answer is natural; they also load before the text (arriving during `loading` status).

### Error display: auto-expand on error
When a tool call has `status === 'error'`, auto-set `expanded = true` via `$effect`. Users need to see what failed without an extra click. Success calls stay collapsed. Rationale: errors need immediate attention.

### Synapse panel location: inline in chat stream
Render as a `role: 'synapse'` message in the main chat list, not a side panel. Rationale: the page already has a sidebar placeholder reserved for Phase 4 (session history). Using inline keeps the mobile layout intact and doesn't conflict with Phase 4.

### Phase transition: label only (no stepper)
Show `"Clarifying requirements"` → `"Executing tasks"` → `"Complete"` as a text label inside the panel header. No stepper widget. Rationale: simpler, no library needed, phases can't go backwards so a progress bar adds no information.

### Q&A display: stacked Q/A pairs (both always visible after answer arrives)
Each `synapse_question` event pushes a new card. When `synapse_answer` arrives, it fills in the answer below the question. Both remain visible. Rationale: user can read the full Q&A history. Collapsing answered questions loses context.

### Task checklist: name + status + preview on completion
Show `description` always. Show `responsePreview` only when `status === 'done'`. Use `animate-spin` on running task icon. Show a simple `X done / Y total` count, not a progress bar. Rationale: preview gives useful feedback without requiring expand.

### Cancel behavior: no confirmation dialog
Cancel = existing `chatStore.stop()` which aborts the fetch. Server-side the orchestrator checks `signal.aborted` between tasks and stops cleanly. No confirmation needed — the chat was already in-progress and the stop button is already familiar.

### Post-completion: panel persists, isStreaming false, cancel button hidden
After `tasks_complete`, set `msg.isStreaming = false` which hides the cancel button and freezes the panel. Panel stays visible in the chat history. Rationale: the completed workflow is reference material.

---

## Common Pitfalls

### Pitfall 1: Message Mutation Across Module Boundary
**What goes wrong:** Accessing `this.messages.find(m => ...)` returns a reactive proxy. Mutating `msg.synapseState.qaCards.push(...)` works inside the class, but only if `messages` was declared with `$state` (not `$state.raw`). If you accidentally use `$state.raw`, mutations don't propagate.
**Why it happens:** The `$state.raw` variant skips deep proxification for performance.
**How to avoid:** Keep `messages = $state<Message[]>([])` (not raw). Already correct in existing code.
**Warning signs:** Panel renders once then never updates reactively.

### Pitfall 2: Tool Call Timing — Tool Events Arrive Before `done`
**What goes wrong:** Tool events arrive during `status === 'loading'`. The assistant message doesn't exist yet. You can't attach tool calls to a message that doesn't exist.
**Why it happens:** `done` fires last; tool calls accumulate before it.
**How to avoid:** Buffer tool calls in `pendingToolCalls` on ChatStore. Attach them when creating the message in the `done` handler.
**Warning signs:** Tool calls don't appear on the message, or you get a crash because the message ID doesn't exist.

### Pitfall 3: Elapsed Timer Not Stopping
**What goes wrong:** `setInterval` in ToolCallBlock keeps running after `status` changes to `done` or `error`.
**Why it happens:** `$effect` with `setInterval` returns a cleanup function, but only if the effect returns it explicitly.
**How to avoid:** Always `return () => clearInterval(interval)` from `$effect`. Verified from Svelte 5 official docs.
**Warning signs:** DevTools shows many intervals accumulating; elapsed time keeps counting after completion.

### Pitfall 4: `find()` on `$state` Array Returns Proxy
**What goes wrong:** `this.messages.find(m => m.id === id)` returns a proxy object, not the raw object. Mutations on this proxy DO propagate — that's the desired behavior. But passing it to components via props works fine too.
**Why it happens:** Svelte 5's deep proxy wraps everything in the array.
**How to avoid:** Nothing special needed — just mutate the proxy directly. Don't try to `JSON.parse(JSON.stringify(...))` a proxy to get a "clean" copy before mutating.
**Warning signs:** Accidental `JSON.stringify` of proxy triggers infinite recursion or loses reactivity.

### Pitfall 5: Synapse Panel in Loading Indicator vs. Message List
**What goes wrong:** Some implementations put Synapse state in `LoadingIndicator.svelte` which only renders when `status === 'loading'`. But Synapse continues after `done` fires (the `done` event carries the summary). The panel disappears when `status` transitions.
**Why it happens:** `LoadingIndicator` is gated on `status === 'loading'`.
**How to avoid:** Put Synapse as a `role: 'synapse'` message in the messages array. It persists regardless of status.
**Warning signs:** Synapse panel flickers out when the summary message arrives.

### Pitfall 6: `{@html}` on Tool Args/Results
**What goes wrong:** Using `{@html JSON.stringify(toolCall.result)}` bypasses XSS protection.
**Why it happens:** Tool results can contain arbitrary content from web_search, read_file, etc.
**How to avoid:** Always use `<pre>` with text content interpolation: `{JSON.stringify(toolCall.result, null, 2)}`. Svelte escapes text interpolation automatically. DOMPurify is only needed for AI markdown, not tool call data in `<pre>` blocks.
**Warning signs:** Tool results render HTML — if a file contained `<script>` and it executed, you have a bug.

### Pitfall 7: $derived with No Reactive Dependencies
**What goes wrong:** `const elapsed = $derived(Date.now() - toolCall.startedAt)` never updates because `Date.now()` is not reactive.
**Why it happens:** `$derived` only reruns when its reactive dependencies change. `Date.now()` has no Svelte dependency.
**How to avoid:** Use `$state(elapsedMs)` updated by `setInterval`, then display `elapsedMs` directly.
**Warning signs:** Timer shows a static value and never counts up.

---

## Code Examples

### Elapsed Duration Display (minimal, no library)
```typescript
// Used in ToolCallBlock — no imports needed
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
```

### $effect Timer Pattern (verified from https://svelte.dev/docs/svelte/$effect)
```svelte
<script lang="ts">
  let elapsedMs = $state(0);

  $effect(() => {
    if (toolCall.status !== 'running') return;

    const interval = setInterval(() => {
      elapsedMs = Date.now() - toolCall.startedAt;
    }, 100);

    return () => clearInterval(interval);
  });
</script>
```

### Deep Proxy Array Mutation (verified from https://svelte.dev/docs/svelte/$state)
```typescript
// In ChatStore class — all of these trigger reactivity:
this.pendingToolCalls.push(newToolCall);          // push is reactive
msg.synapseState!.qaCards.push(newCard);           // nested push is reactive
task.status = 'done';                               // property assignment is reactive
```

### Svelte 5 $props with TypeScript (verified from existing codebase pattern)
```svelte
<script lang="ts">
  import type { ToolCall } from '$lib/chat/types.js';

  let { toolCall }: { toolCall: ToolCall } = $props();
</script>
```

### QACard (minimal)
```svelte
<!-- QACard.svelte -->
<script lang="ts">
  import type { QACard as QACardType } from '$lib/chat/types.js';
  let { card }: { card: QACardType } = $props();
</script>

<div class="rounded-lg bg-muted/50 border border-border p-3 space-y-1.5">
  <p class="text-sm text-foreground/80">{card.question}</p>
  {#if card.answer}
    <p class="text-sm text-muted-foreground border-t border-border pt-1.5">{card.answer}</p>
  {:else}
    <p class="text-xs text-muted-foreground animate-pulse">Thinking...</p>
  {/if}
</div>
```

### TaskChecklist (minimal)
```svelte
<!-- TaskChecklist.svelte -->
<script lang="ts">
  import { Loader2, CheckCircle2, XCircle, Circle } from 'lucide-svelte';
  import type { TaskItem } from '$lib/chat/types.js';

  let { tasks, complete, completeMessage }:
    { tasks: TaskItem[]; complete: boolean; completeMessage?: string } = $props();

  const doneCount = $derived(tasks.filter(t => t.status === 'done').length);
</script>

<div class="space-y-2">
  <div class="flex items-center justify-between">
    <p class="text-xs text-muted-foreground uppercase tracking-wide">Tasks</p>
    <p class="text-xs text-muted-foreground">{doneCount} / {tasks.length}</p>
  </div>

  {#each tasks as task (task.id)}
    <div class="flex items-start gap-2">
      {#if task.status === 'running'}
        <Loader2 size={14} class="mt-0.5 shrink-0 animate-spin text-primary" />
      {:else if task.status === 'done'}
        <CheckCircle2 size={14} class="mt-0.5 shrink-0 text-green-500" />
      {:else if task.status === 'failed'}
        <XCircle size={14} class="mt-0.5 shrink-0 text-destructive" />
      {:else}
        <Circle size={14} class="mt-0.5 shrink-0 text-muted-foreground" />
      {/if}
      <div class="flex-1 min-w-0">
        <p class="text-sm text-foreground/80">{task.description}</p>
        {#if task.responsePreview && task.status === 'done'}
          <p class="text-xs text-muted-foreground mt-0.5 truncate">{task.responsePreview}</p>
        {/if}
      </div>
    </div>
  {/each}

  {#if complete && completeMessage}
    <p class="text-xs text-muted-foreground border-t border-border pt-2">{completeMessage}</p>
  {/if}
</div>
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|-----------------|--------|
| EventSource (GET only) | fetch + ReadableStream (POST SSE) | Already locked — don't change |
| Svelte 4 stores + `$:` | Svelte 5 `$state`, `$derived`, `$effect` runes | Already in use — continue |
| Tool calls shown only in activity bar | Tool calls as inline collapsible blocks (ChatGPT/Cursor pattern) | This phase |
| No workflow visibility | Inline Synapse progress panel (inline message type) | This phase |

---

## Open Questions

1. **Task `failed` status — no SSE event for it**
   - What we know: Backend emits `task_start` then `task_done`. There is no `task_failed` event in the orchestrator source. If a task errors, `task_done` still fires (the response contains the error info).
   - What's unclear: Whether to ever show `status: 'failed'` on a TaskItem.
   - Recommendation: Treat all `task_done` as `status: 'done'`. Remove `'failed'` from the TaskItem type, or keep it unused for future use. The planner should default to not implementing a failed state unless backend adds it.

2. **`loop` event display**
   - What we know: The `loop` event fires when the loop detector kicks in. Current code just sets `currentActivity = 'Thinking...'`.
   - What's unclear: Whether to show loop events in the tool call list or ignore them visually.
   - Recommendation: Show `loop` as a special non-collapsible inline note (e.g., "Detected repeated action — redirecting") that appears in the tool calls list during loading. It provides transparency without being a tool call.

3. **Multiple simultaneous tool calls on one message**
   - What we know: The orchestrator can call `find_tool` and then immediately `call_tool`, generating 2 tool events in sequence.
   - What's unclear: Whether `find_tool` events should be shown to users (they are internal routing, not useful).
   - Recommendation: Filter out `find_tool` from the visible tool call list. It's an internal mechanism (find the tool name, then call it). Only show `call_tool` results with the inner tool name.

---

## Sources

### Primary (HIGH confidence)
- `/c/Users/sandv/Desktop/chimera/chimera-orchestrator.js` — SSE event shapes, emit calls, Synapse flow, verified by direct file read
- `/c/Users/sandv/Desktop/chimera/chimera-chat.js` — SSE forwarding, cancel mechanism, verified by direct file read
- `/c/Users/sandv/Desktop/chimera/web/src/**` — all existing component code, types, store, verified by direct file read
- https://svelte.dev/docs/svelte/$state — deep proxy mutation, array push reactivity
- https://svelte.dev/docs/svelte/$effect — cleanup function syntax, setInterval pattern
- https://svelte.dev/docs/svelte/lifecycle-hooks — onMount/onDestroy

### Secondary (MEDIUM confidence)
- WebSearch: "chat UI tool call visualization pattern collapsible blocks 2025 2026" — confirmed tool-above-text placement as consensus pattern (ChatGPT, Pydantic AI Chat examples cited)
- WebSearch: "Svelte 5 runes $state array update patterns" — confirmed push() is reactive on $state arrays

---

## Metadata

**Confidence breakdown:**
- SSE event shapes: HIGH — read directly from backend source files
- Standard stack: HIGH — read directly from package.json
- Architecture patterns: HIGH — verified against Svelte 5 official docs + existing codebase patterns
- Visual design recommendations: MEDIUM — based on WebSearch ecosystem research (ChatGPT/Cursor patterns)
- Pitfalls: HIGH — derived from deep reading of existing code and Svelte 5 docs

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (Svelte 5 is stable; no library changes expected)
