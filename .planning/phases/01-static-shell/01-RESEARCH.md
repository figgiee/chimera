# Phase 1: Static Shell - Research

**Researched:** 2026-03-12
**Domain:** SvelteKit SPA scaffold + Node.js static serving + API prefix migration
**Confidence:** HIGH

## Summary

Phase 1 has two parallel tracks: (1) migrate the existing `chimera-chat.js` routes from bare paths (`/chat`, `/health`, `/sessions/:id/*`) to an `/api/` prefix and add static file serving + SPA fallback, and (2) scaffold a SvelteKit project using Svelte 5 / Tailwind v4 / shadcn-svelte with `adapter-static` and a Vite dev proxy.

The existing test suite (`test_e2e.js`, `test_mini_project.js`, `test_synapse.js`) bypasses `chimera-chat.js` entirely — all three test files talk directly to LM Studio (`127.0.0.1:1235`) and the RAG stack (`localhost:8080`). The "existing test suite passes" success criterion is safe: prefix migration cannot break these tests. No compatibility shim is required.

The SvelteKit scaffold uses the official `sv create` CLI with `--add tailwindcss`. shadcn-svelte is initialized afterwards via its own CLI. The Vite dev server proxies `/api/` to `http://127.0.0.1:3210` without stripping the prefix. `chimera-chat.js` uses the raw Node.js `http` module (no Express dependency) so static serving must be hand-written using `fs.createReadStream` with MIME type resolution.

**Primary recommendation:** Scaffold with `npx sv create web --template minimal --types ts --add tailwindcss`, then run `npx shadcn-svelte@latest init` inside the new directory. Add Vite proxy and Node.js static serving as separate, well-scoped changes.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@sveltejs/kit` | 2.54.0 | SvelteKit framework | Official; adapter-static SPA mode is documented |
| `svelte` | 5.53.11 | Component framework | Svelte 5 — required by shadcn-svelte current release |
| `@sveltejs/adapter-static` | 3.0.10 | Builds SPA-ready static output | Required for Node.js static serving; `fallback: '200.html'` for SPA mode |
| `tailwindcss` | 4.2.1 | Utility CSS | v4 uses Vite plugin only — no PostCSS, no config file |
| `@tailwindcss/vite` | 4.2.1 | Tailwind v4 Vite integration | Replaces `@tailwindcss/postcss`; single plugin in vite.config.ts |
| `shadcn-svelte` (CLI) | 1.1.1 | Component primitives scaffold | Copy-into-project model; `npx shadcn-svelte@latest init` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `bits-ui` | 2.16.3 | Headless primitives (shadcn-svelte dep) | Installed by shadcn-svelte CLI automatically |
| `clsx` | 2.1.1 | Conditional class names | Installed by shadcn-svelte CLI |
| `tailwind-merge` | 3.5.0 | Merge conflicting Tailwind classes | Installed by shadcn-svelte CLI |
| `tw-animate-css` | 1.4.0 | Animation utilities for shadcn-svelte | Replaces `tailwindcss-animate` in v4 migration |
| `lucide-svelte` | 0.577.0 | Icon set | Used by shadcn-svelte components |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `adapter-static` + Node.js serving | `adapter-node` | adapter-node requires separate Node server running SvelteKit — adds complexity vs. single chimera-chat.js process |
| Vite proxy for dev | No proxy + CORS headers | Proxy is cleaner for dev; production uses single-origin serving |
| shadcn-svelte CLI | DaisyUI / custom components | shadcn-svelte chosen in STATE.md prior decisions — not reconsidered |

**Installation (SvelteKit scaffold):**
```bash
npx sv create web --template minimal --types ts --add tailwindcss
cd web
npx shadcn-svelte@latest init
```

---

## Architecture Patterns

### Recommended Project Structure
```
web/                         # SvelteKit project root
├── src/
│   ├── app.css              # @import "tailwindcss" + shadcn-svelte theme
│   ├── app.html             # HTML shell template
│   ├── lib/
│   │   ├── components/
│   │   │   └── ui/          # shadcn-svelte components live here
│   │   └── utils.ts         # cn() helper (clsx + tailwind-merge)
│   └── routes/
│       ├── +layout.svelte   # Root layout: imports app.css, {#snippet children}
│       ├── +layout.ts       # export const ssr = false (SPA mode)
│       └── +page.svelte     # Entry page
├── static/                  # Static assets (favicon, etc.)
├── svelte.config.js         # adapter-static with fallback: '200.html'
├── vite.config.ts           # @tailwindcss/vite + sveltekit() + server.proxy
└── components.json          # shadcn-svelte configuration
```

### Pattern 1: SPA Mode (adapter-static + ssr: false)

**What:** Disables SSR globally so all routes render client-side. The build produces `200.html` as the SPA fallback served by the Node.js backend for all non-API, non-static routes.

**When to use:** Always, for this phase. Chat UI has no SEO requirement and no need for server rendering.

```javascript
// Source: https://svelte.dev/docs/kit/single-page-apps
// web/src/routes/+layout.ts
export const ssr = false;
```

```javascript
// Source: https://svelte.dev/docs/kit/adapter-static
// web/svelte.config.js
import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      fallback: '200.html'
    })
  }
};

export default config;
```

### Pattern 2: Vite Dev Proxy for /api/

**What:** Tells the Vite dev server to forward any request starting with `/api/` to the running Node.js backend. The prefix is kept intact (no `rewrite`) because the Node.js backend already handles `/api/*` paths after migration.

**When to use:** Development only. In production, chimera-chat.js serves both static files and API routes from the same port.

```typescript
// Source: https://vite.dev/config/server-options.html#server-proxy
// web/vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3210',
        changeOrigin: true
        // No rewrite — /api prefix is kept; backend handles /api/*
      }
    }
  }
});
```

### Pattern 3: Node.js Static File Serving + SPA Fallback

**What:** The existing `chimera-chat.js` uses the raw `node:http` module (no Express). Static serving must be implemented directly using `node:fs` with MIME type detection. All routes that are not `/api/*` and do not match a static file must serve `200.html` (the SPA fallback).

**When to use:** Production serving — when Vite dev server is not running.

```javascript
// Source: Node.js official docs + verified patterns
// In chimera-chat.js handleRequest(), before the 404 fallback:

const path = require('node:path');
const fs = require('node:fs');

const STATIC_DIR = path.join(__dirname, 'web/build');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
};

function serveStatic(req, res) {
  const urlPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(STATIC_DIR, urlPath);

  // Security: prevent path traversal
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403); res.end(); return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback — serve 200.html
      const fallback = path.join(STATIC_DIR, '200.html');
      fs.createReadStream(fallback).pipe(res);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return;
    }
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
}
```

Note: `writeHead` must be called BEFORE `pipe`. The pattern above has a bug where `writeHead` is called after `pipe` in the fallback path — the plan tasks should use the corrected order.

### Pattern 4: /api/ Prefix Migration in chimera-chat.js

**What:** All route matches in `handleRequest` change from bare paths (`/chat`, `/health`, `/sessions/:id/stats`) to `/api/*` paths. The 404 fallback at the end becomes the static file + SPA fallback handler.

Current routes that need migration:
- `GET /health` → `GET /api/health`
- `GET /sessions/:id/stats` → `GET /api/sessions/:id/stats`
- `GET /sessions/:id/logs` → `GET /api/sessions/:id/logs`
- `POST /chat/stream` → `POST /api/chat/stream`
- `POST /chat` → `POST /api/chat`

The startup log output also references these paths and must be updated.

### Anti-Patterns to Avoid
- **Stripping `/api` in the Vite proxy rewrite:** Don't rewrite the path. The backend handles `/api/*` directly after migration. Stripping breaks the routing.
- **Setting `ssr: true` with adapter-static and no prerender:** This saves empty shell HTML. Always set `ssr = false` for SPA mode.
- **Using `fallback: 'index.html'`:** Conflicts with prerendered homepage on some platforms. Use `fallback: '200.html'` — SvelteKit generates this file specifically for SPA fallback.
- **Adding Express as a dependency:** chimera-chat.js deliberately uses only `node:http` with no external dependencies. Keep it that way — add static serving inline.
- **Calling `writeHead` after `pipe(res)`:** Headers must be written before piping begins. A common error when adapting examples.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SvelteKit project scaffold | Custom Svelte setup | `npx sv create` | sv create wires TS, vite.config, svelte.config, layout files correctly |
| Tailwind v4 setup | Manual PostCSS config | `@tailwindcss/vite` plugin | v4 has no `tailwind.config.js`; PostCSS approach is deprecated |
| shadcn-svelte components | Custom UI primitives | `npx shadcn-svelte@latest add <component>` | Copy-in model means no runtime dep; already decided in prior decisions |
| CSS class merging utility | Custom merge logic | `tailwind-merge` + `clsx` via `cn()` | Handles arbitrary value conflicts, responsive prefix deduplication |

**Key insight:** The sv create + tailwindcss add-on handles the Vite plugin integration automatically. Running `npx sv create web --add tailwindcss` outputs a project where `vite.config.ts` already has `@tailwindcss/vite` configured. shadcn-svelte init then adds `components.json` and the `cn()` utility.

---

## Common Pitfalls

### Pitfall 1: writeHead After Pipe
**What goes wrong:** In Node.js `http` module, calling `res.writeHead()` or `res.setHeader()` after `stream.pipe(res)` starts sending data causes a "Cannot set headers after they are sent" error.
**Why it happens:** `pipe()` calls `res.write()` immediately on data events.
**How to avoid:** Always call `res.writeHead(status, headers)` before `fs.createReadStream(path).pipe(res)`.
**Warning signs:** `ERR_HTTP_HEADERS_SENT` in Node.js server logs.

### Pitfall 2: Path Traversal in Static File Serving
**What goes wrong:** A request to `/../../../etc/passwd` resolves to a file outside `STATIC_DIR`.
**Why it happens:** `path.join` resolves `..` segments. Without a bounds check, any file on disk can be served.
**How to avoid:** After resolving `filePath = path.join(STATIC_DIR, urlPath)`, assert `filePath.startsWith(STATIC_DIR)` before serving.
**Warning signs:** Serving content outside the build directory.

### Pitfall 3: Tailwind v4 PostCSS Config Left in Place
**What goes wrong:** If a `postcss.config.js` exists with `@tailwindcss/postcss`, it conflicts with the Vite plugin and styles break or double-apply.
**Why it happens:** The `sv create --add tailwindcss` command generates Tailwind v4 correctly, but developers sometimes add PostCSS based on old tutorials.
**How to avoid:** Delete `postcss.config.js` entirely. v4 only needs the Vite plugin.
**Warning signs:** Styles not applying, duplicate CSS in output.

### Pitfall 4: Static File Not Excluded from SPA Fallback
**What goes wrong:** Requesting `/favicon.ico` gets served the `200.html` SPA shell instead of the icon.
**Why it happens:** A catch-all SPA fallback that runs before checking for real files.
**How to avoid:** In the Node.js handler, always `fs.stat` the requested path first. Only fall back to `200.html` if the file does not exist.
**Warning signs:** Browser shows SPA content for asset requests; favicon/manifest 404s in devtools.

### Pitfall 5: CORS Headers Missing on /api/ Routes After Migration
**What goes wrong:** The Vite proxy adds `changeOrigin: true` but the Node.js backend must still set CORS headers for direct calls (health checks, curl, future API consumers).
**Why it happens:** Proxy hides the origin mismatch during development, so missing CORS headers aren't noticed until production.
**How to avoid:** Keep the existing CORS headers in `sendJson` and `sendSSE`. The headers already exist in chimera-chat.js — just confirm they survive the prefix migration.
**Warning signs:** `Access-Control-Allow-Origin` missing from `/api/health` response.

### Pitfall 6: Vite Dev Server Port Conflicts
**What goes wrong:** Vite's default dev port (5173) or the proxy target port (3210) conflicts with another process.
**Why it happens:** Port numbers are not locked to a project.
**How to avoid:** The Vite dev server port doesn't need to be specified — the default 5173 is fine. Ensure `chimera-chat.js` is running on 3210 before starting Vite.
**Warning signs:** `ECONNREFUSED` when proxying; proxy silently returns 502.

---

## Code Examples

### svelte.config.js (SPA mode with adapter-static)
```javascript
// Source: https://svelte.dev/docs/kit/single-page-apps
import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      fallback: '200.html'
    })
  }
};

export default config;
```

### src/routes/+layout.ts (disable SSR globally)
```typescript
// Source: https://svelte.dev/docs/kit/single-page-apps
export const ssr = false;
```

### src/routes/+layout.svelte (Svelte 5 snippet syntax)
```svelte
<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

{@render children()}
```

### src/app.css (Tailwind v4 + shadcn-svelte theme)
```css
/* Source: https://tailwindcss.com/docs/guides/sveltekit */
@import "tailwindcss";

/* shadcn-svelte init adds theme variables here */
@custom-variant dark (&:is(.dark *));
```

### vite.config.ts (Tailwind v4 Vite plugin + dev proxy)
```typescript
// Source: https://tailwindcss.com/docs/guides/sveltekit + https://vite.dev/config/server-options.html
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3210',
        changeOrigin: true
      }
    }
  }
});
```

### chimera-chat.js: /api/ prefix migration (route pattern)
```javascript
// Source: direct analysis of existing chimera-chat.js routes
// Before:
if (req.method === 'GET' && url.pathname === '/health') { ... }
if (req.method === 'POST' && url.pathname === '/chat/stream') { ... }
if (req.method === 'POST' && url.pathname === '/chat') { ... }
const statsMatch = url.pathname.match(/^\/sessions\/([^/]+)\/stats$/);
const logsMatch  = url.pathname.match(/^\/sessions\/([^/]+)\/logs$/);

// After:
if (req.method === 'GET' && url.pathname === '/api/health') { ... }
if (req.method === 'POST' && url.pathname === '/api/chat/stream') { ... }
if (req.method === 'POST' && url.pathname === '/api/chat') { ... }
const statsMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/stats$/);
const logsMatch  = url.pathname.match(/^\/api\/sessions\/([^/]+)\/logs$/);
```

### chimera-chat.js: static file serving + SPA fallback
```javascript
// Source: Node.js http docs + verified static file serving patterns
const path = require('node:path');
const fs = require('node:fs');

const STATIC_DIR = path.resolve(__dirname, 'web/build');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
  '.txt':  'text/plain',
};

function serveStatic(req, res, pathname) {
  const urlPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(STATIC_DIR, '.' + urlPath);

  // Path traversal guard
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403); res.end(); return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    } else {
      // SPA fallback
      const fallback = path.join(STATIC_DIR, '200.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(fallback).pipe(res);
    }
  });
}

// In handleRequest, replace the final 404 block with:
// serveStatic(req, res, url.pathname);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@tailwindcss/postcss` + `postcss.config.js` | `@tailwindcss/vite` plugin, no config file | Tailwind v4 (2025) | No `tailwind.config.js`, no content paths, no PostCSS |
| `@tailwind base/components/utilities` directives | `@import "tailwindcss"` in CSS | Tailwind v4 | Single import replaces three directives |
| `npx create-svelte` (old CLI) | `npx sv create` (new Svelte CLI) | SvelteKit 2.x era | Supports `--add tailwindcss` flag directly |
| `let { children } = $$props;` (Svelte 4) | `let { children } = $props();` (Svelte 5) | Svelte 5 | Runes syntax; `{@render children()}` replaces `<slot>` |
| `tailwindcss-animate` | `tw-animate-css` | shadcn-svelte Tailwind v4 migration | Drop-in replacement for animation utilities |
| `export const prerender = true` everywhere | `export const ssr = false` in root layout | SPA mode pattern | One global setting disables SSR for all routes |

**Deprecated/outdated:**
- `postcss.config.js` for Tailwind: removed entirely in v4 workflow
- `tailwind.config.js`: replaced by CSS `@theme` directive in v4
- `<slot>` in layout components: replaced by `{@render children()}` in Svelte 5
- `export const ssr = false` per-page: still works but root `+layout.ts` is the SPA-mode idiom

---

## Open Questions

1. **Does sv create --add tailwindcss generate v4 or v3 config?**
   - What we know: `tailwindcss` npm latest is 4.2.1; shadcn-svelte docs reference v4 migration; `sv create` add-on list includes `tailwindcss`
   - What's unclear: Whether `sv create --add tailwindcss` generates a Vite plugin config (v4) or PostCSS config (v3) — depends on what version sv CLI installs
   - Recommendation: After scaffolding, verify `vite.config.ts` uses `@tailwindcss/vite` not `@tailwindcss/postcss`. If PostCSS, follow the v4 migration to replace it.

2. **shadcn-svelte init: does it support Tailwind v4 automatically?**
   - What we know: The shadcn-svelte Tailwind v4 migration guide exists at `shadcn-svelte.com/docs/migration/tailwind-v4`; the CLI is version 1.1.1
   - What's unclear: Whether `npx shadcn-svelte@latest init` auto-detects Tailwind v4 and emits the correct `app.css` or requires manual post-init editing
   - Recommendation: After `init`, verify `app.css` uses `@import "tailwindcss"` not the three-directive pattern. Apply the migration guide steps if needed.

3. **Node.js static serving: does chimera-chat.js need to handle etag/cache headers?**
   - What we know: This is the static shell phase; performance optimization is out of scope
   - What's unclear: Whether missing cache headers will cause issues during development iteration
   - Recommendation: Skip cache headers in Phase 1. Simple `200 OK` with `Content-Type` is sufficient for a working shell. Add cache control in a later phase.

4. **web/ subdirectory vs. monorepo root for SvelteKit project**
   - What we know: The roadmap plan says "Scaffold SvelteKit project"; chimera-chat.js serves `web/build`
   - What's unclear: Exact directory name — `web/`, `frontend/`, `ui/` are all valid
   - Recommendation: Use `web/` as the directory name. It's short, describes the artifact type, and matches the `web/build` path used in code examples above.

---

## Sources

### Primary (HIGH confidence)
- `https://svelte.dev/docs/kit/single-page-apps` — SPA mode with adapter-static, ssr: false, fallback option
- `https://svelte.dev/docs/kit/adapter-static` — fallback configuration, SPA caveats
- `https://tailwindcss.com/docs/guides/sveltekit` — Tailwind v4 Vite plugin installation steps
- `https://vite.dev/config/server-options.html#server-proxy` — proxy API, changeOrigin, rewrite options
- `https://svelte.dev/docs/cli/sv-create` — CLI flags, --add tailwindcss add-on
- `https://www.shadcn-svelte.com/docs/installation/sveltekit` — shadcn-svelte init steps, components.json
- `https://shadcn-svelte.com/docs/migration/tailwind-v4` — Tailwind v4 migration: replace postcss with vite, update app.css
- npm registry (verified live) — @sveltejs/kit 2.54.0, svelte 5.53.11, @sveltejs/adapter-static 3.0.10, tailwindcss 4.2.1, @tailwindcss/vite 4.2.1, shadcn-svelte 1.1.1

### Secondary (MEDIUM confidence)
- Direct code analysis of `chimera-chat.js` — current route structure, http module usage, no Express dependency
- Direct code analysis of `test_e2e.js`, `test_mini_project.js`, `test_synapse.js` — confirmed these tests do NOT call chimera-chat.js; prefix migration cannot break them

### Tertiary (LOW confidence)
- WebSearch: "Node.js http module serve static files" — general pattern for fs.createReadStream serving; verified against Node.js core docs pattern

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified from npm registry (live) and official docs
- Architecture: HIGH — SPA mode pattern verified from svelte.dev official docs; Node.js serving pattern is well-established
- Pitfalls: HIGH — writeHead/pipe ordering and path traversal are documented Node.js behaviors; Tailwind v4/PostCSS conflict is documented in shadcn-svelte migration guide

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (SvelteKit/Tailwind are active projects; version numbers may drift, patterns are stable)
