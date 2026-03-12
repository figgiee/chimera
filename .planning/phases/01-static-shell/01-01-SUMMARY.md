---
phase: 01-static-shell
plan: 01
subsystem: backend
tags: [api-routes, static-serving, spa-fallback, chimera-chat]

# Dependency graph
requires: []
provides:
  - All backend routes under /api/* prefix (/api/health, /api/chat, /api/chat/stream, /api/sessions/:id/stats, /api/sessions/:id/logs)
  - Static file serving from web/build/ for non-API routes
  - SPA fallback to 200.html for unknown non-API routes
  - Path traversal protection (403 on directory escape)
affects:
  - phase 01-plan-02 (SvelteKit Vite proxy targets /api/ prefix)
  - phase 02 (chat UI calls /api/chat/stream)
  - phase 04 (session/health endpoints already at /api/*)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "API prefix: all backend routes under /api/* namespace"
    - "Static serving: fs.stat check then createReadStream.pipe with writeHead before pipe"
    - "SPA fallback: non-matching non-API routes serve web/build/200.html"
    - "Path traversal guard: path.resolve + startsWith(STATIC_DIR)"

key-files:
  created: []
  modified:
    - chimera-chat.js

key-decisions:
  - "Replaced 404 JSON response with serveStatic fallthrough — non-API routes now serve frontend"
  - "MIME_TYPES lookup table for common web file extensions with application/octet-stream fallback"
  - "No cache headers, etag, or gzip — deferred to later optimization"

patterns-established:
  - "All new backend endpoints must use /api/ prefix"
  - "writeHead() always before createReadStream().pipe() to avoid ERR_HTTP_HEADERS_SENT"

# Metrics
duration: 2min
completed: 2026-03-12
---

# Phase 01 Plan 01: API Migration + Static Serving Summary

**All backend routes migrated to /api/* prefix; static file serving with SPA fallback replaces 404 handler — single Node.js process serves both API and frontend**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-12
- **Completed:** 2026-03-12
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- All 5 backend routes migrated from bare paths to /api/* prefix (/health → /api/health, /chat → /api/chat, etc.)
- Static file serving added for web/build/ directory with MIME type detection
- SPA fallback serves 200.html for non-API routes that don't match a static file
- Path traversal guard blocks directory escape attacks (403)
- Startup log output updated to show /api/ prefixed paths
- `node -c chimera-chat.js` syntax check passes

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate all routes to /api/* prefix** - `b0ada79` (feat)
2. **Task 2: Add static file serving and SPA fallback** - `f7f26ca` (feat)

## Files Modified

- `chimera-chat.js` - Route prefix migration (/api/*), path/fs requires, STATIC_DIR + MIME_TYPES constants, serveStatic function, 404→serveStatic fallthrough

## Deviations from Plan

None — both tasks executed as specified.

## Issues Encountered

None.

## Self-Check: PASSED
