# Technology Stack

**Project:** Chimera Web UI
**Researched:** 2026-03-12
**Dimension:** Frontend stack for local AI chat interface
**Overall Confidence:** HIGH (all versions verified against npm registry and official docs)

---

## Context: What Already Exists (Do Not Replace)

The backend is a zero-dependency Node.js HTTP server on port 3210. It already has:
- `POST /chat/stream` — SSE streaming endpoint (primary integration point)
- `POST /chat` — JSON (non-streaming) response
- `GET /health` — liveness check
- Session management endpoints

The frontend stack is purely additive. Nothing in the existing server changes except one new static-file handler.

---

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Svelte | 5.53.x | UI component model | Compile-time reactivity: no virtual DOM, ~1.6 KB runtime. Runes API (`$state`, `$derived`, `$effect`) is stable and ideal for streaming state. Open WebUI (40k+ stars) validates this choice at production scale. |
| SvelteKit | 2.54.x | App framework + build | File-based routing, first-party Vite integration, `adapter-static` produces a plain `build/` folder the existing Node.js server can serve. Latest release: 2.54.0 (March 11, 2026). |
| @sveltejs/adapter-static | 3.x | Build target | Prerenders the entire app to pure HTML/CSS/JS. Zero runtime dependency in production. The existing Node.js server reads from `build/` with ~20 lines of `fs.readFile` code. |
| Vite | 8.x (via SvelteKit) | Dev server + bundler | Ships with SvelteKit 2.53.0+. Vite 8 support is confirmed. Dev server proxy feature solves CORS to port 3210 during development. |

**Why SvelteKit over alternatives:**

1. **Bundle size.** Svelte compiles away the framework. React ships ~45 KB minified+gzipped for react + react-dom alone. For a local tool, every byte is waste the user pays with startup time.

2. **Streaming state.** Svelte 5 runes handle reactive streaming data with no boilerplate. React requires `useState` + `useEffect` + `useRef` choreography for SSE streaming. Assign to a `$state` variable; DOM updates automatically.

3. **Industry validation.** Open WebUI (the most popular open-source AI chat UI) uses SvelteKit. The same evaluation was done and the same conclusion reached.

4. **Static output is first-class.** `adapter-static` is mature and well-documented. `npm run build` → `build/` directory. Add one handler in `chimera-chat.js`.

5. **DX.** `.svelte` single-file components with scoped CSS are cleaner than JSX + CSS modules. Less context switching, less boilerplate.

**Why NOT React/Next.js:** React ecosystem overhead is unjustified for a local tool. Next.js requires a Node.js server at runtime; `adapter-static` gives a drop-in static folder with no runtime. AnythingLLM (React + Vite) has 40+ production dependencies including moment.js, lodash, recharts, react-beautiful-dnd, and onnxruntime-web — dependency bloat for a chat UI.

### CSS Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Tailwind CSS | 4.2.x | Utility-first styling | v4 eliminated `tailwind.config.js` — configuration lives in CSS via `@theme`. First-party `@tailwindcss/vite` plugin. Single `@import "tailwindcss"` in `app.css`. 5x faster builds vs v3. |
| @tailwindcss/vite | 4.2.x | Vite integration | Replaces the PostCSS pipeline entirely. Required for Tailwind v4 with SvelteKit. |

**Why Tailwind v4 specifically:**
- shadcn-svelte (component library below) expects Tailwind v4. Using v3 creates friction.
- No config file means the project stays lean.
- Utility classes keep styles colocated with markup in `.svelte` files — readable without context switching.
- Confirmed current version: 4.2.x (official Tailwind docs, March 2026).

**Why NOT other approaches:**
- Plain CSS: Too much boilerplate for a chat UI with many states (loading, streaming, error, collapsed activity blocks, expanded activity blocks).
- UnoCSS: Valid alternative but smaller ecosystem; the shadcn-svelte integration is smoother with Tailwind.
- Tailwind v3: Outdated. v4 is stable and has fewer moving parts.

### UI Components: shadcn-svelte

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| shadcn-svelte | CLI-based (no runtime version) | Component scaffold | Not a dependency — a CLI that copies component source code into your project. Full ownership, no version lock-in, no breaking upstream updates. Svelte 5 + Tailwind v4 support confirmed current. |
| bits-ui | latest (pulled by shadcn-svelte) | Headless primitives | Accessible, unstyled component logic (Dialog, Dropdown, Tooltip, etc.). shadcn-svelte is built on top of bits-ui. ARIA attributes and keyboard navigation included. |

**Why shadcn-svelte:**
1. **You own the code.** Components are copied into your project. Customize the inline expandable activity block (Claude Code / Cursor style) without fighting a library API.
2. **Built on bits-ui.** Accessible headless primitives: keyboard navigation, focus trapping, ARIA — free.
3. **Svelte 5 + Tailwind v4 native.** The migration is confirmed complete as of early 2026.
4. **Only what you need.** `npx shadcn-svelte@latest add button dialog sheet scroll-area tooltip` — no unused component bloat.
5. **Chat UI pattern coverage.** Sheet (sidebar), Dialog (settings), ScrollArea (message list), Button, Input, Tooltip — all available.

**Why NOT other component libraries:**

| Library | Why Not |
|---------|---------|
| Skeleton UI | Full framework with its own design system, Figma kit, and class token naming. Too opinionated for a custom chat UX. Confirmed to conflict with shadcn-svelte at the Tailwind theme layer. |
| DaisyUI | Tailwind plugin with predefined themes. Less control over individual component behavior. No headless layer — accessibility is your problem. |
| Flowbite Svelte | Wraps Flowbite JS DOM manipulation which conflicts with Svelte's reactive model. Older Svelte 4 patterns. |
| Melt UI | Lower-level than bits-ui. More boilerplate. bits-ui (which shadcn-svelte uses) is already built on Melt UI. |

### Markdown Rendering

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| marked | 17.0.4 | Markdown → HTML at runtime | Parse complete LLM response text. Fast, lightweight, synchronous. v17.0.4 released March 4, 2026. |
| marked-shiki | latest | Shiki extension for marked | Wire Shiki into marked's code block renderer. Replaces the need for a separate highlight.js pass. |
| shiki | 4.0.2 | Code syntax highlighting | VSCode-quality highlighting with no CSS dependency (inline styles per token). v4 is ESM-only, fully tree-shakeable, fine-grained bundle imports. Supports Svelte language out of the box. v4.0.2 confirmed current. |
| DOMPurify | 3.x | HTML sanitization | Sanitize marked's HTML output before DOM insertion. Security requirement for any LLM output rendered as HTML. |

**Rendering strategy — two phases:**

1. **During streaming:** Append raw text tokens to a `$state` string. Render with `{@html markedSync(rawText)}` on a debounced 100ms tick. For short responses (< 1 KB per tick) this is fast enough. For longer responses, switch to incremental DOM patching via `streaming-markdown` (see alternatives).

2. **After stream complete:** Final full-quality render: `marked(completeText)` with `marked-shiki` for syntax-highlighted code blocks.

**Why this combination over alternatives:**

- **mdsvex:** Build-time preprocessor for authoring `.md` files as Svelte components. Cannot parse dynamic runtime strings. Wrong tool for LLM output.
- **markdown-it:** More extensible but 70 KB+ vs marked's 38 KB. Plugin system is powerful but unnecessary for a chat UI.
- **svelte-markdown:** Renders to Svelte components — elegant but slow for streaming because each chunk triggers component re-creation.
- **highlight.js:** The legacy choice. Shiki is strictly better: inline styles (no CSS file), VSCode theme quality, ESM tree-shaking, Svelte syntax support. highlight.js requires loading all language grammars or manual cherry-picking.

**Note on streaming-markdown:** The `streaming-markdown` package (3 KB gzipped) by thetarnav provides incremental DOM updates optimized for ChatGPT-style streaming — appends new chunks without re-parsing the entire document. If naive re-parse causes visible flicker at high token rates, add this package. Start without it and add if needed.

### SSE Consumption

No library required. Use the browser's native `fetch` API with `ReadableStream`.

**Why NOT native `EventSource`:** `EventSource` only supports GET requests. The existing backend endpoint is `POST /chat/stream`. This is a hard constraint.

**Why NOT `@microsoft/fetch-event-source`:** 12 KB for what is ~30 lines of code. AnythingLLM uses it but it is unnecessary overhead.

**Why NOT `sveltekit-sse`:** Designed for SvelteKit server-side SSE endpoints. Chimera's SSE is produced by the existing `chimera-chat.js`, not by a SvelteKit route handler.

**Recommended pattern:**

```javascript
// src/lib/api/client.js
async function streamChat(message, sessionId, onEvent) {
  const response = await fetch('/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // retain incomplete line for next chunk

    let eventType = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) eventType = line.slice(7).trim();
      else if (line.startsWith('data: ') && eventType) {
        try { onEvent(eventType, JSON.parse(line.slice(6))); } catch {}
        eventType = '';
      }
    }
  }
}
```

**SSE event types the frontend must handle** (from existing chimera-chat.js):

| Event | Data Shape | UI Behavior |
|-------|------------|-------------|
| `tool` | `{ tool, hadError }` | Inline expandable activity block |
| `synapse_question` | `{ text }` | Planning question in activity block |
| `synapse_answer` | `{ answer }` | Planning answer in activity block |
| `task_start` | `{ description }` | Add task to activity list |
| `task_done` | `{ id }` | Mark task complete in list |
| `tasks_complete` | `{ count }` | Collapse activity section |
| `auto_save` | `{ content }` | Show save indicator |
| `intent` | `{ mode }` | Show intent badge (chat/synapse/task) |
| `done` | `{ response, session_id, stats }` | Render final response, enable input |
| `error` | `{ error }` | Show error state, re-enable input |

### Icon Library

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| lucide-svelte | 0.577.0 | UI icons | Tree-shakeable (import only used icons). 1000+ icons. Svelte 5 compatible. shadcn-svelte uses lucide-svelte natively — consistent. Confirmed current: 0.577.0 (March 6, 2026). |

**Why lucide-svelte over heroicons:** heroicons has ~316 icons; lucide has 1000+. A chat UI needs send, stop, copy, expand/collapse, settings, sidebar toggle, upload, search, check, trash, download — lucide covers all of these. heroicons is maintained primarily for Tailwind UI subscribers; lucide has broader independent community adoption.

### Class Utilities

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tailwind-merge | latest | Merge conditional Tailwind classes without conflicts | Required for component variants: `twMerge('px-4', large && 'px-8')`. Installed by shadcn-svelte. |
| clsx | latest | Conditional class composition | Companion to tailwind-merge. Standard shadcn-svelte pattern: `cn(clsx(...), twMerge(...))`. Installed by shadcn-svelte. |

---

## Integration with Existing Stack

### Serving Static Build from chimera-chat.js

```javascript
// Add to existing chimera-chat.js request handler (node:http, no Express)
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const STATIC_DIR = resolve(process.cwd(), 'chimera-web', 'build');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

function serveStatic(req, res) {
  const urlPath = req.url.split('?')[0];  // strip query string
  let filePath = join(STATIC_DIR, urlPath === '/' ? 'index.html' : urlPath);

  // Path traversal guard
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403); res.end(); return true;
  }

  // SPA fallback: serve index.html for unknown routes (enables client-side routing)
  if (!existsSync(filePath)) {
    filePath = join(STATIC_DIR, 'index.html');
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=3600',
  });
  res.end(readFileSync(filePath));
  return true;
}

// In the request handler: check API routes first, then fall through to serveStatic
```

### SvelteKit adapter-static Configuration

```javascript
// svelte.config.js
import adapter from '@sveltejs/adapter-static';

export default {
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',  // SPA mode — client-side routing works
    }),
  },
};
```

The `fallback: 'index.html'` is critical. Without it, navigating directly to `/settings` returns 404 from the Node.js static handler.

### API Proxy During Development

SvelteKit dev server runs on port 5173; the API is on port 3210. Vite's built-in proxy eliminates CORS:

```typescript
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    proxy: {
      '/chat':     'http://127.0.0.1:3210',
      '/health':   'http://127.0.0.1:3210',
      '/sessions': 'http://127.0.0.1:3210',
    },
  },
});
```

In production, SvelteKit's static output is served by the same Node.js process on the same port — no proxy needed.

---

## Installation

```bash
# 1. Scaffold SvelteKit project
npx sv create chimera-web
# Choose: SvelteKit minimal, Svelte 5, TypeScript (recommended), ESLint + Prettier

cd chimera-web

# 2. Tailwind CSS v4 (Vite plugin — no postcss.config.js needed)
npm install tailwindcss @tailwindcss/vite

# 3. Markdown rendering
npm install marked marked-shiki shiki dompurify
npm install -D @types/dompurify  # if using TypeScript

# 4. Icons
npm install lucide-svelte

# 5. Static adapter
npm install -D @sveltejs/adapter-static

# 6. shadcn-svelte (CLI adds components, also installs tailwind-merge, clsx, bits-ui)
npx shadcn-svelte@latest init
npx shadcn-svelte@latest add button input scroll-area sheet dialog tooltip
```

---

## Recommended Project Structure

```
chimera-web/
  src/
    lib/
      components/
        ui/               # shadcn-svelte generated (button, dialog, etc.)
        chat/
          MessageBubble.svelte
          ActivityBlock.svelte    # Inline expandable (Claude Code style)
          ChatInput.svelte
          StreamingText.svelte    # Handles marked + shiki render
      api/
        client.js         # fetch wrapper + SSE stream consumer
        types.js          # SSE event type definitions
      utils/
        markdown.js       # marked config with marked-shiki
        cn.js             # clsx + tailwind-merge helper
    routes/
      +layout.svelte      # App shell (sidebar, header)
      +page.svelte        # Main chat view
      settings/
        +page.svelte      # Settings
  static/                 # favicon, icons
  svelte.config.js        # adapter-static config
  vite.config.ts          # Tailwind plugin + dev proxy
  build/                  # Output (gitignored) — served by chimera-chat.js
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not Alternative |
|----------|-------------|-------------|---------------------|
| Framework | SvelteKit 2.54 | React + Vite | ~45 KB React runtime; SSE streaming requires hook choreography; no first-class static adapter |
| Framework | SvelteKit 2.54 | Next.js | Requires Node.js runtime in production; adapter-static eliminates this entirely |
| CSS | Tailwind v4 | UnoCSS | Smaller ecosystem; less tooling; shadcn-svelte integration smoother with Tailwind |
| Components | shadcn-svelte | Skeleton UI | Opinionated design system conflicts at CSS custom property level with shadcn-svelte |
| Markdown | marked 17 | markdown-it | 70 KB+ vs 38 KB; plugin flexibility not needed for simple chat rendering |
| Markdown | marked 17 | remark/rehype | 100 KB+ with plugins; AST-based pipeline is overkill for runtime LLM output |
| Highlighting | shiki 4 | highlight.js | highlight.js requires separate CSS file, manual language registration; Shiki has inline styles and better quality |
| Highlighting | shiki 4 | Prism | Prism is older, requires CSS; less actively maintained than Shiki |
| Icons | lucide-svelte | heroicons | heroicons has 316 icons; lucide has 1000+; lucide is shadcn-svelte's default |
| SSE | fetch + ReadableStream | @microsoft/fetch-event-source | 12 KB for 30 lines of code; unjustified dependency |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Express.js (for static serving) | chimera-chat.js uses raw `node:http`. Adding Express for static file serving is 200 KB of dependency for 20 lines of code. | `fs.readFileSync` + MIME type map (shown above) |
| native `EventSource` | Only supports GET. `/chat/stream` is POST. Hard constraint. | `fetch` + `response.body.getReader()` |
| `sveltekit-sse` library | Designed for SvelteKit-produced SSE endpoints, not external server SSE. | Native fetch + ReadableStream |
| Socket.IO | Chimera already has SSE. WebSockets add bidirectional complexity for a problem that is solved. | SSE via POST |
| State management library (Zustand, etc.) | Svelte 5 runes replace all state management needs. No external store library required. | `$state`, `$derived`, `$effect` |
| mdsvex | Build-time preprocessor for .md file routing. Cannot parse dynamic runtime strings. | `marked` + `marked-shiki` |
| highlight.js | Legacy. Shiki is strictly better in every dimension relevant to this project. | `shiki` with fine-grained imports |
| CDN-loaded libraries in production | Violates local-only constraint. No `<script src="https://...">`. | Vite bundles everything at build time |
| moment.js | 300 KB, deprecated. | Native `Intl.DateTimeFormat` and `Date` |
| lodash | AnythingLLM dependency creep. A 5-line debounce function replaces lodash.debounce. | Svelte `$effect` with a timer |
| TypeScript (hard requirement) | SvelteKit works well with TypeScript and it is strongly recommended, but it is not required to start. | Begin with TypeScript from day one via `npx sv create` scaffolder |

---

## Version Compatibility Matrix

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| svelte@5.53.x | @sveltejs/kit@2.54.x | SvelteKit 2.x ships Svelte 5 by default. Do not mix Svelte 4 + SvelteKit 2. |
| tailwindcss@4.2.x | @tailwindcss/vite@4.2.x | Major versions must match. No postcss.config.js in v4. |
| shadcn-svelte (CLI) | svelte@5.x + tailwindcss@4.x | Svelte 5 + Tailwind v4 migration confirmed complete (early 2026). |
| bits-ui@latest | svelte@5.x only | bits-ui v1+ requires Svelte 5 runes. Do not use bits-ui v0.x with Svelte 5. |
| shiki@4.0.2 | ESM only | Shiki v4 is ESM-only. SvelteKit/Vite is ESM — no issue. Do not `require()`. |
| marked@17.0.4 | Node.js 18+ / modern browsers | v17 has breaking changes to list token handling vs v15. Start fresh, do not migrate from v15. |
| lucide-svelte@0.577.0 | svelte@4 and svelte@5 | Both Svelte generations supported. Import named: `import { Send } from 'lucide-svelte'`. |
| @sveltejs/adapter-static@3.x | @sveltejs/kit@2.x | Official adapter, ships in the SvelteKit repo. |

---

## Sources

- [SvelteKit releases (GitHub)](https://github.com/sveltejs/kit/releases) — confirmed latest stable 2.54.0 (March 11, 2026). HIGH confidence.
- [Svelte "What's New" March 2026](https://svelte.dev/blog/whats-new-in-svelte-march-2026) — confirmed Svelte 5.53.x, SvelteKit 2.53.x feature set. HIGH confidence.
- [Tailwind CSS SvelteKit guide (official)](https://tailwindcss.com/docs/guides/sveltekit) — confirmed v4.2 setup with @tailwindcss/vite plugin. HIGH confidence.
- [adapter-static docs (official)](https://svelte.dev/docs/kit/adapter-static) — confirmed pages/assets/fallback options. HIGH confidence.
- [marked releases (GitHub)](https://github.com/markedjs/marked/releases) — confirmed v17.0.4 (March 4, 2026). HIGH confidence.
- [Shiki install guide (official)](https://shiki.style/guide/install) — confirmed v4.0.2, ESM-only, fine-grained bundles. HIGH confidence.
- [shadcn-svelte docs (official)](https://www.shadcn-svelte.com/docs) — confirmed Svelte 5 + Tailwind v4 support. HIGH confidence.
- [lucide-svelte (npm)](https://www.npmjs.com/package/lucide-svelte) — confirmed v0.577.0, Svelte 5 compatible (March 6, 2026). HIGH confidence.
- WebSearch: SvelteKit vs React/Next.js comparison 2025-2026 — multiple sources agree on bundle size and local AI tool fit. MEDIUM confidence.
- WebSearch: SSE consumption patterns (fetch vs EventSource) — confirmed POST endpoint requires fetch+ReadableStream, not EventSource. MEDIUM confidence.
- WebSearch: shadcn-svelte vs Skeleton vs bits-ui comparison — confirmed shadcn-svelte is "copy and own" model, distinct from Skeleton. MEDIUM confidence.

---

*Stack research for: Chimera Web UI (local AI assistant frontend)*
*Researched: 2026-03-12*
