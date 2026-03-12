---
phase: 02
plan: 03
subsystem: chat-ui-polish
tags: [dark-mode, mode-watcher, highlight.js, loading-indicator, responsive, error-handling]

requires:
  - 02-02  # MessageBubble, InputBar, ChatWindow, EmptyState, +page.svelte

provides:
  - web/src/lib/components/DarkModeToggle.svelte
  - web/src/lib/components/LoadingIndicator.svelte
  - Dark/light highlight.js theme switching
  - Responsive sidebar-ready layout
  - FOUC prevention script

affects:
  - 04-01  # Sidebar placeholder ready for session sidebar

tech-stack:
  added:
    - mode-watcher (ModeWatcher component + toggleMode API)
  patterns:
    - mode-watcher v1.x rune-based API (mode.current, not $mode store)
    - FOUC prevention via inline script in app.html
    - highlight.js dark theme via .dark scoped CSS overrides

key-files:
  created:
    - web/src/lib/components/DarkModeToggle.svelte
    - web/src/lib/components/LoadingIndicator.svelte
  modified:
    - web/src/routes/+layout.svelte
    - web/src/routes/+page.svelte
    - web/src/app.css
    - web/src/app.html
    - web/src/lib/components/ChatWindow.svelte

key-decisions:
  - id: "02-03-A"
    decision: "mode-watcher v1.x uses rune-based mode.current, not Svelte store $mode"
    rationale: "mode-watcher v1.x exports mode as a rune object. Using $mode caused type errors. mode.current is the correct API."
    impact: "DarkModeToggle reads mode.current directly in template"

  - id: "02-03-B"
    decision: "highlight.js dark theme via .dark scoped CSS overrides rather than CSS layers"
    rationale: "CSS @import layering with Tailwind v4 had potential ordering issues. Scoping github-dark-dimmed colors under .dark {} is simpler and works reliably."
    impact: "All .dark .hljs-* overrides in app.css"

patterns-established:
  - "FOUC prevention: inline script in app.html reads mode-watcher-mode from localStorage"
  - "Responsive sidebar placeholder: hidden lg:flex lg:w-64 for Phase 4 sidebar-ready layout"

duration: "~4 min"
completed: "2026-03-12"
---

# Phase 2 Plan 03: Chat UI Polish Summary

**Dark mode with OS preference + localStorage, three-dot loading indicator with activity text, inline error retry, highlight.js dual-theme, and responsive sidebar-ready layout**

## Performance

- **Duration:** ~4 min
- **Tasks:** 3 (2 auto + 1 human verification)
- **Files modified:** 7

## Accomplishments
- Dark mode toggle with OS preference default, manual override, localStorage persistence, and FOUC prevention
- Loading indicator with staggered pulse dots and live activity text (Connecting, Mode, Using tool)
- highlight.js github theme for light mode, github-dark-dimmed overrides for dark mode
- Responsive layout with sidebar placeholder for Phase 4
- Human-verified all 10 CHAT requirements (CHAT-01 through CHAT-10)

## Task Commits

1. **Task 1: Dark mode, loading indicator, hljs themes** - `0494b67` (feat)
2. **Task 2: Error display, responsive layout, page integration** - `e24c8ef` (feat)
3. **Task 3: Human verification** - Approved

## Files Created/Modified
- `web/src/lib/components/DarkModeToggle.svelte` - Sun/Moon toggle using mode-watcher
- `web/src/lib/components/LoadingIndicator.svelte` - Three-dot pulse with activity text
- `web/src/routes/+layout.svelte` - Added ModeWatcher component
- `web/src/routes/+page.svelte` - Sidebar placeholder, DarkModeToggle in header, LoadingIndicator wiring
- `web/src/app.css` - highlight.js github theme import, .dark overrides, prose overrides
- `web/src/app.html` - FOUC prevention inline script
- `web/src/lib/components/ChatWindow.svelte` - LoadingIndicator at bottom of message list

## Decisions Made
- mode-watcher v1.x uses rune-based `mode.current` (not Svelte store `$mode`)
- highlight.js dark theme via `.dark` scoped CSS overrides (simpler than CSS layers with Tailwind v4)
- Error display with retry was already complete from Plan 02-02 — no changes needed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] mode-watcher v1.x API change**
- **Found during:** Task 1 (DarkModeToggle)
- **Issue:** `$mode` store syntax caused type error; mode-watcher v1.x exports rune-based object
- **Fix:** Use `mode.current` directly in template
- **Files modified:** DarkModeToggle.svelte
- **Commit:** 0494b67

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minimal — API difference, same behavior.

## Issues Encountered
None — error display was already implemented, all other features built as planned.

## Next Phase Readiness
- Phase 2 complete — all CHAT-01 through CHAT-10 requirements verified
- Sidebar placeholder ready for Phase 4 session sidebar
- No blockers identified

## Self-Check: PASSED
