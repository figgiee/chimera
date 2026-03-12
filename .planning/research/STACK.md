# Technology Stack

**Project:** Chimera Web UI
**Researched:** 2026-03-12
**Dimension:** Frontend stack for local AI chat interface
**Overall Confidence:** HIGH

## Recommended Stack

### Framework: SvelteKit + Svelte 5

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Svelte | ^5.53 | UI framework | Smallest bundle size, true reactivity without virtual DOM, runes model is ideal for streaming state. Open WebUI validates this choice at scale. |
| SvelteKit | ^2.53 | App framework | File-based routing, adapter-static for building to static files, first-party Vite integration. |
| @sveltejs/adapter-static | ^3.0 | Build target | Prerenders to pure HTML/CSS/JS that the existing Node.js chat server can serve as static files. Zero runtime dependency. |
| Vite | ^6.x | Build tool | Ships with SvelteKit. Fast HMR, production bundling. |

**Why SvelteKit over React/Vite:**

1. **Bundle size matters for local-first.** Svelte compiles away the framework -- the runtime is effectively zero. React ships ~45kB minified+gzipped just for react + react-dom. For a local tool, every byte is waste the user pays for.

2. **Streaming state is simpler.** Svelte 5 runes (`$state`, `$derived`) handle reactive streaming data with zero boilerplate. React requires `useState` + `useEffect` + `useRef` gymnastics for SSE streaming. Svelte just works: assign to a `$state` variable and the DOM updates.

3. **Open WebUI validates the choice.** The most popular open-source AI chat UI (40k+ GitHub stars) uses SvelteKit. They chose it for the same reasons. AnythingLLM uses React/Vite but has a much heavier dependency tree (see Alternatives Considered below).

4. **Static output is first-class.** `adapter-static` is mature and well-documented. `npm run build` produces a `build/` directory of static files. Add one route in chimera-chat.js to serve them.

5. **DX advantage.** `.svelte` single-file components with scoped CSS are cleaner than JSX + CSS modules. Less context switching, less boilerplate.

**Why NOT React:**

- AnythingLLM's package.json reveals 40+ dependencies including moment.js, lodash, recharts, react-beautiful-dnd, and onnxruntime-web. That is dependency bloat for a chat UI.
- `@microsoft/fetch-event-source` is needed because native EventSource does not support POST requests. In Svelte, a simple fetch + ReadableStream handles this natively.
- React 18 is the current stable; React 19 has had a rocky adoption. The ecosystem is in transition.

### CSS: Tailwind CSS v4

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| tailwindcss | ^4.2 | Utility CSS | v4 has zero-config setup, first-party Vite plugin, 5x faster builds. One CSS import line, no tailwind.config.js needed. |

**Why Tailwind v4 specifically:**

- v4 eliminated the config file -- just `@import "tailwindcss"` in your CSS. Perfect for keeping the project lean.
- First-party `@tailwindcss/vite` plugin integrates natively with SvelteKit's Vite pipeline.
- shadcn-svelte (see below) expects Tailwind v4.
- Utility classes keep styles colocated with markup in `.svelte` files.

**Why NOT other CSS approaches:**

- Plain CSS: Too much boilerplate for a chat UI with many states (loading, streaming, error, collapsed, expanded).
- CSS-in-JS: Wrong ecosystem (React-centric), runtime overhead.
- Tailwind v3: Outdated. v4 is stable and has fewer moving parts.

### UI Components: shadcn-svelte

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| shadcn-svelte | ^1.1 | Component primitives | Copy-paste components, not a dependency. Full control over styling. Built on bits-ui (headless). |
| bits-ui | ^2.16 | Headless primitives | Accessible, unstyled component logic (dialog, dropdown, tooltip, etc.). shadcn-svelte depends on this. |

**Why shadcn-svelte:**

1. **Not a dependency -- a starting point.** Components are copied into your project. You own them. No version lock-in, no breaking updates.
2. **Built on bits-ui.** Accessible headless primitives with keyboard navigation, focus management, ARIA attributes. You get a11y for free.
3. **Tailwind v4 + Svelte 5 native.** Latest version supports both.
4. **Only what you need.** Add components individually: `npx shadcn-svelte@latest add button dialog sheet`. No unused component bloat.
5. **Perfect for chat UI patterns.** Sheet (sidebar), Dialog (settings), ScrollArea (message list), Button, Input, Tooltip -- all available.

**Why NOT other component libraries:**

| Library | Why Not |
|---------|---------|
| Skeleton UI | Full framework with its own design system. Too opinionated for a custom chat UI. Heavier. |
| DaisyUI | Tailwind plugin with predefined themes. Less control over individual component behavior. No headless layer. |
| Melt UI | Lower-level than bits-ui, more boilerplate. bits-ui (which shadcn-svelte uses) is built on Melt UI anyway. |
| Flowbite Svelte | Pre-styled components. Less customizable. Older Svelte 4 patterns. |

### Markdown Rendering: marked + streaming-markdown + highlight.js

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| marked | ^17.0 | Markdown-to-HTML | Fast, lightweight (38kB), extensible. Used widely in AI chat UIs. |
| streaming-markdown | latest | Incremental streaming render | 3kB gzipped. Appends new chunks instead of re-parsing entire document. Purpose-built for ChatGPT-style streaming. |
| highlight.js | ^11.9 | Syntax highlighting | AnythingLLM uses it. Lighter than Shiki for client-side use. Good language coverage. |
| DOMPurify | ^3.x | HTML sanitization | Sanitize rendered markdown before DOM insertion. Security requirement for LLM output. |

**Rendering strategy -- two modes:**

1. **During streaming:** Use `streaming-markdown` for incremental DOM updates. Each SSE chunk is appended, not re-parsed. This avoids the O(n^2) re-render problem that plagues naive `marked()` + `innerHTML` approaches.

2. **After streaming complete:** Final pass with `marked` + `highlight.js` for full-quality rendering with syntax highlighting, proper list nesting, etc. This is a single O(n) parse of the complete response.

**Why NOT other markdown approaches:**

| Library | Why Not |
|---------|---------|
| markdown-it | Slightly slower than marked, heavier (70kB+). Plugin system is powerful but unnecessary here. |
| svelte-markdown | Renders to Svelte components, which is elegant but slow for streaming -- each chunk triggers component re-creation. |
| mdsvex | Build-time markdown preprocessing. Wrong tool for runtime AI response rendering. |
| Shiki | Superior highlighting quality but 7x slower than highlight.js and requires WASM. Overkill for a local chat tool. |
| @nlux/markdown | Interesting but small community, less battle-tested. |

### SSE Consumption: Native fetch + ReadableStream

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Native fetch API | (built-in) | HTTP POST + stream reading | No library needed. Works in all modern browsers. |

**Pattern for consuming Chimera's POST /chat/stream:**

```javascript
// Chimera uses POST for SSE (non-standard but common for AI APIs)
// Native EventSource only supports GET, so we use fetch + ReadableStream

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
    buffer = lines.pop(); // keep incomplete line

    let eventType = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) eventType = line.slice(7);
      else if (line.startsWith('data: ') && eventType) {
        onEvent(eventType, JSON.parse(line.slice(6)));
        eventType = '';
      }
    }
  }
}
```

**Why NOT library-based SSE:**

| Library | Why Not |
|---------|---------|
| `EventSource` (native) | Only supports GET requests. Chimera uses POST /chat/stream. |
| `@microsoft/fetch-event-source` | 12kB for what is 30 lines of code. AnythingLLM uses it but it is unnecessary complexity. |
| `sveltekit-sse` | Designed for SvelteKit server-side SSE endpoints. Chimera's SSE comes from chimera-chat.js, not SvelteKit. |

### Icons: Lucide Svelte

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| @lucide/svelte | latest | Icon set | Tree-shakeable, only imports icons you use. shadcn-svelte uses it natively. Consistent with the component library. |

## Integration with Existing Stack

### Static File Serving

The existing `chimera-chat.js` uses raw `node:http`. To serve the built frontend, add static file serving:

```javascript
// Add to chimera-chat.js request handler
const path = require('node:path');
const fs = require('node:fs');

const STATIC_DIR = path.join(__dirname, 'web', 'build');
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function serveStatic(req, res) {
  let filePath = path.join(STATIC_DIR, req.url === '/' ? 'index.html' : req.url);
  if (!filePath.startsWith(STATIC_DIR)) { sendJson(res, 403, { error: 'Forbidden' }); return false; }
  if (!fs.existsSync(filePath)) {
    // SPA fallback: serve index.html for client-side routing
    filePath = path.join(STATIC_DIR, 'index.html');
  }
  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' });
  res.end(content);
  return true;
}
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
      fallback: 'index.html',  // SPA mode -- all routes serve index.html
    }),
    paths: {
      base: '',  // served from root
    },
  },
};
```

The `fallback: 'index.html'` is critical -- it enables SPA mode so client-side routing works. Without it, refreshing on `/settings` would 404.

### API Proxy During Development

During `npm run dev`, SvelteKit runs on port 5173 but the API is on port 3210. Use Vite's proxy:

```javascript
// vite.config.js
export default {
  server: {
    proxy: {
      '/chat': 'http://127.0.0.1:3210',
      '/health': 'http://127.0.0.1:3210',
      '/sessions': 'http://127.0.0.1:3210',
    },
  },
};
```

### SSE Event Types to Handle

From chimera-chat.js, the frontend must handle these SSE event types:

| Event | Data | UI Behavior |
|-------|------|-------------|
| `tool` | `{ tool, hadError }` | Show in expandable activity block |
| `synapse_question` | `{ text }` | Show planning question |
| `synapse_answer` | `{ answer }` | Show planning answer |
| `task_start` | `{ description }` | Add to activity list |
| `task_done` | `{ id }` | Mark task complete |
| `tasks_complete` | `{ count }` | Collapse activity section |
| `auto_save` | `{ content }` | Show save indicator |
| `intent` | `{ mode }` | Show intent badge |
| `done` | `{ response, session_id, stats }` | Render final response, enable input |
| `error` | `{ error }` | Show error state |

## What NOT to Add

| Technology | Why Not |
|------------|---------|
| Express.js | chimera-chat.js uses raw `node:http`. Adding Express for static file serving is dependency bloat for what is 20 lines of code. |
| Socket.IO | Chimera already has SSE working. WebSockets add bidirectional complexity that is unnecessary -- the client sends messages via POST, server streams via SSE. |
| State management library | Svelte 5 runes (`$state`, `$derived`, `$effect`) replace all state management needs. No Zustand, no Redux, no stores library. |
| React | See framework comparison above. Wrong choice for this project. |
| TypeScript (optional) | Svelte 5 has excellent type inference with JSDoc. TypeScript adds build complexity. Use it if the team prefers it, but it is not required. Start with JS, migrate later if needed. |
| moment.js | AnythingLLM uses it. It is 300kB and deprecated in favor of native `Intl.DateTimeFormat` and `Date`. |
| lodash | AnythingLLM uses lodash.debounce. A 5-line debounce function or Svelte's `$effect` with a timer replaces it. |
| i18next | Chimera is a personal local tool. Internationalization is premature optimization. |
| onnxruntime-web | AnythingLLM bundles this for client-side ML. Chimera does all ML server-side via LM Studio. |

## Alternatives Considered

### Framework Comparison

| Criterion | SvelteKit (Recommended) | React + Vite | Solid + Vite |
|-----------|------------------------|--------------|--------------|
| Bundle size | Smallest (compiled away) | ~45kB runtime | ~7kB runtime |
| Streaming DX | $state auto-updates DOM | useState + useEffect dance | Signals (good, but smaller ecosystem) |
| Static build | adapter-static (official) | vite build (manual SPA setup) | vite build (manual SPA setup) |
| Component libraries | shadcn-svelte, bits-ui | shadcn/ui (largest ecosystem) | Limited options |
| AI chat precedent | Open WebUI (40k stars) | AnythingLLM (35k stars) | None major |
| Learning curve | Low (HTML + superpowers) | Medium (JSX, hooks, effects) | Medium (similar to React but different) |
| Community size | Smaller but growing fast | Largest | Smallest |

**Verdict:** SvelteKit wins on bundle size, streaming DX, and static output. React has a larger ecosystem but brings unnecessary weight. Solid is technically excellent but has too small an ecosystem for component libraries.

### Markdown Library Comparison

| Criterion | marked (Recommended) | markdown-it | remark/rehype |
|-----------|---------------------|-------------|---------------|
| Size | 38kB | 70kB+ | 100kB+ (with plugins) |
| Speed | Fastest | Fast | Slower (AST-based) |
| Extensibility | Good (extensions API) | Best (plugin system) | Best (unified ecosystem) |
| Streaming | Needs streaming-markdown helper | Same issue | Same issue |
| AI chat usage | Common | AnythingLLM uses it | Less common for chat |

**Verdict:** marked is fastest and smallest. For a chat UI that will use streaming-markdown during streaming anyway, the full-document parser only runs once at stream completion. Speed and size win.

## Installation

```bash
# Create SvelteKit project
npx sv create chimera-web
# Select: SvelteKit minimal, Svelte 5, No TypeScript (or TypeScript if preferred)

cd chimera-web

# Core dependencies
npm install marked streaming-markdown highlight.js dompurify

# UI components (copy-paste model, not all are npm installs)
npx shadcn-svelte@latest init
npx shadcn-svelte@latest add button input scroll-area sheet dialog tooltip

# Icons (installed by shadcn-svelte init, but for reference)
npm install @lucide/svelte

# Adapter for static build
npm install -D @sveltejs/adapter-static
```

## Project Structure

```
chimera-web/
  src/
    lib/
      components/       # shadcn-svelte components + custom
        ui/             # shadcn-svelte generated
        chat/           # ChatMessage, ChatInput, ActivityBlock
      api/
        client.js       # fetch wrapper, SSE consumer
      stores/
        chat.svelte.js  # $state for messages, session, streaming
      utils/
        markdown.js     # marked config, streaming-markdown wrapper
    routes/
      +layout.svelte    # App shell, sidebar
      +page.svelte      # Chat view (main route)
      settings/
        +page.svelte    # Settings page
  static/               # Static assets (favicon, etc.)
  svelte.config.js      # adapter-static config
  vite.config.js        # Proxy config for dev
  build/                # Output (gitignored, served by chimera-chat.js)
```

## Sources

- Open WebUI architecture: https://deepwiki.com/open-webui/open-webui/2-architecture (MEDIUM confidence)
- AnythingLLM package.json: fetched via GitHub API (HIGH confidence - direct source)
- Svelte 5 latest (5.53.9): https://www.npmjs.com/package/svelte (HIGH confidence)
- SvelteKit latest (2.53.4): https://www.npmjs.com/package/@sveltejs/kit (HIGH confidence)
- Tailwind CSS v4 (4.2.1): https://www.npmjs.com/package/tailwindcss (HIGH confidence)
- shadcn-svelte (1.1.0): https://www.npmjs.com/package/shadcn-svelte (HIGH confidence)
- bits-ui (2.16.3): https://www.npmjs.com/package/bits-ui (HIGH confidence)
- adapter-static (3.0.10): https://www.npmjs.com/package/@sveltejs/adapter-static (HIGH confidence)
- marked (17.0.4): https://www.npmjs.com/package/marked (HIGH confidence)
- streaming-markdown: https://github.com/thetarnav/streaming-markdown (MEDIUM confidence)
- Chrome LLM rendering best practices: https://developer.chrome.com/docs/ai/render-llm-responses (HIGH confidence)
- SvelteKit adapter-static docs: https://svelte.dev/docs/kit/adapter-static (HIGH confidence)
- highlight.js vs Shiki comparison: https://dev.to/begin/tale-of-the-tape-highlightjs-vs-shiki-27ce (MEDIUM confidence)
