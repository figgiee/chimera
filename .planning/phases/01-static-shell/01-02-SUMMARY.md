---
phase: 01-static-shell
plan: 02
subsystem: ui
tags: [sveltekit, svelte5, tailwindcss, tailwind-v4, shadcn-svelte, adapter-static, vite, typescript]

# Dependency graph
requires:
  - phase: 01-static-shell-plan-01
    provides: chimera-chat.js API routes on /api/* prefix that the Vite proxy targets
provides:
  - SvelteKit SPA project in web/ building to web/build/200.html
  - Tailwind v4 via @tailwindcss/vite plugin (no PostCSS, no tailwind.config)
  - shadcn-svelte zinc theme (components.json, cn() utility, CSS variables in app.css)
  - Vite dev proxy /api/ -> http://127.0.0.1:3210
  - adapter-static SPA mode (ssr=false, fallback 200.html)
affects:
  - phase 02 (chat interface - builds all UI components on this foundation)
  - phase 03 (session sidebar - depends on SvelteKit routing)
  - phase 04 (knowledge panel - depends on component system)

# Tech tracking
tech-stack:
  added:
    - "@sveltejs/kit ^2.50.2"
    - "svelte ^5.51.0"
    - "@sveltejs/adapter-static ^3.0.10"
    - "tailwindcss ^4.2.1"
    - "@tailwindcss/vite ^4.2.1"
    - "bits-ui ^2.16.3"
    - "clsx ^2.1.1"
    - "tailwind-merge ^3.5.0"
    - "tw-animate-css ^1.4.0"
    - "lucide-svelte ^0.577.0"
    - "vite ^7.3.1"
    - "typescript ^5.9.3"
  patterns:
    - "SPA mode: ssr=false in +layout.ts, adapter-static fallback 200.html"
    - "Tailwind v4 Vite plugin pattern: @import 'tailwindcss' + @tailwindcss/vite, no config file"
    - "shadcn-svelte theme: @theme inline block maps --color-* to CSS custom properties, zinc palette"
    - "Svelte 5 runes: $props() in +layout.svelte, @render children()"

key-files:
  created:
    - web/package.json
    - web/svelte.config.js
    - web/vite.config.ts
    - web/tsconfig.json
    - web/components.json
    - web/src/app.css
    - web/src/app.html
    - web/src/app.d.ts
    - web/src/routes/+layout.ts
    - web/src/routes/+layout.svelte
    - web/src/routes/+page.svelte
    - web/src/lib/utils.ts
  modified: []

key-decisions:
  - "Used @tailwindcss/vite Vite plugin instead of PostCSS — Tailwind v4 preferred approach, cleaner config"
  - "Manually created shadcn-svelte config (components.json, app.css theme, utils.ts) instead of running interactive init — shadcn-svelte CLI does not support fully non-interactive mode"
  - "Zinc color palette chosen for dark chat UI aesthetic matching Chimera brand"
  - "Removed @sveltejs/adapter-auto from devDependencies — unused after switching to adapter-static"

patterns-established:
  - "All new UI components go in web/src/lib/components/"
  - "shadcn-svelte components added via: npx shadcn-svelte@latest add <component>"
  - "cn() utility imported from $lib/utils for conditional class merging"
  - "Tailwind CSS variables accessed as bg-background, text-foreground, text-muted-foreground (not raw oklch values)"

# Metrics
duration: 3min
completed: 2026-03-12
---

# Phase 01 Plan 02: Static Shell Summary

**SvelteKit 5 SPA scaffolded in web/ with Tailwind v4 Vite plugin, shadcn-svelte zinc theme, adapter-static fallback, and /api Vite proxy — builds to web/build/200.html in under 600ms**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-12T20:45:49Z
- **Completed:** 2026-03-12T20:49:43Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments

- SvelteKit project scaffolded in web/ with Svelte 5, TypeScript, adapter-static SPA mode
- Tailwind v4 configured via @tailwindcss/vite (no postcss.config.js, no tailwind.config)
- shadcn-svelte zinc theme integrated: components.json, cn() utility, complete CSS variable palette in app.css
- Vite proxy forwards /api/ requests to http://127.0.0.1:3210 in dev mode
- `npm run build` produces web/build/200.html with JS bundles in 582ms

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold SvelteKit project with Tailwind v4 and shadcn-svelte** - `6befb63` (feat)
2. **Task 2: Create landing page and verify build** - `8e7fdca` (feat)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified

- `web/svelte.config.js` - adapter-static with fallback: '200.html'
- `web/vite.config.ts` - @tailwindcss/vite plugin + /api proxy to 127.0.0.1:3210
- `web/src/routes/+layout.ts` - ssr = false (SPA mode)
- `web/src/routes/+layout.svelte` - app.css import, Svelte 5 $props + @render children
- `web/src/routes/+page.svelte` - landing page with Chimera heading, Tailwind + theme CSS vars
- `web/src/app.css` - @import "tailwindcss" + tw-animate-css + zinc oklch theme variables
- `web/components.json` - shadcn-svelte registry config, zinc base color
- `web/src/lib/utils.ts` - cn() utility (clsx + tailwind-merge)
- `web/package.json` - all dependencies (svelte 5, kit, adapter-static, tailwindcss, shadcn-svelte deps)
- `web/tsconfig.json` - TypeScript config
- `web/src/app.html` - SvelteKit HTML template
- `web/src/app.d.ts` - SvelteKit type declarations

## Decisions Made

- **Tailwind v4 Vite plugin approach:** Used `@tailwindcss/vite` plugin with `@import "tailwindcss"` in CSS. No postcss.config.js, no tailwind.config.ts. This is the Tailwind v4 recommended pattern.
- **shadcn-svelte manual init:** The shadcn-svelte CLI (v1.1.1) does not support fully non-interactive initialization. Created components.json and app.css theme variables manually from the shadcn-svelte zinc theme spec. This produces identical output to what the CLI would generate.
- **Zinc theme palette:** Chose zinc (neutral with slight blue-gray) for the dark chat UI. This aligns with Chimera's terminal/AI aesthetic.
- **Removed adapter-auto:** Uninstalled @sveltejs/adapter-auto since adapter-static is the chosen production adapter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] shadcn-svelte CLI does not support non-interactive mode**
- **Found during:** Task 1 (scaffold)
- **Issue:** `npx shadcn-svelte@latest init --defaults` is not a valid flag. CLI requires interactive prompts. `--base-color zinc` flag works but still prompts for lib alias.
- **Fix:** Manually created all shadcn-svelte artifacts: components.json (registry config), app.css theme variables (zinc oklch palette, @theme inline block, @custom-variant dark), and src/lib/utils.ts (cn() function). All files are functionally identical to what the CLI would generate.
- **Files modified:** web/components.json, web/src/app.css, web/src/lib/utils.ts
- **Verification:** Build succeeds, CSS variables present in built output
- **Committed in:** 6befb63 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required workaround for non-interactive shadcn-svelte init. All plan artifacts delivered as specified. No scope creep.

## Issues Encountered

- shadcn-svelte v1.1.1 CLI requires interactive prompts even when all configurable options are provided as flags — the lib alias prompt appears regardless. Resolved by creating files manually.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SvelteKit foundation complete — all Phase 2 UI work can proceed immediately
- `web/src/lib/components/` directory ready for shadcn-svelte component additions (`npx shadcn-svelte@latest add <component>`)
- Vite proxy is wired: start chimera-chat.js then `npm run dev` in web/ for full local development
- No blockers for Phase 2

---
*Phase: 01-static-shell*
*Completed: 2026-03-12*

## Self-Check: PASSED
