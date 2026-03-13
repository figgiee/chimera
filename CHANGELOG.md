# Changelog

All notable changes to Chimera are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [0.1.0] — 2026-03-13

Initial public release.

### Features
- **Agentic chat** — Qwen 3.5 9B via LM Studio with tool use: file read/write, shell commands, web search, RAG memory
- **Synapse workflow engine** — structured Q&A + task execution for complex multi-step work
- **RAG pipeline** — Docker-based FastAPI + PostgreSQL/pgvector + TEI embeddings for semantic document search
- **Session persistence** — conversation history survives server restarts (7-day TTL, disk-backed)
- **SvelteKit frontend** — streaming SSE chat UI with Synapse panel, session sidebar, knowledge base sidebar
- **MCP meta-protocol** — token-efficient tool routing via find_tool/call_tool gateway
- **Cross-platform startup** — `start.sh` (macOS/Linux) and `start.bat` (Windows) one-click launchers
- **Web search** — SearXNG integration for fully local, privacy-preserving search

### Security
- Shell injection protection: operators `|;&\`$()%^!><` blocked before allowlist check
- Path traversal protection: `path.relative()` used instead of `startsWith()`
- CORS restricted to localhost origins only
- `CHIMERA_HOST` warning when server is exposed beyond localhost
- Session files excluded from git

### Bug Fixes
- Default session ID now uses `randomUUID()` — eliminates millisecond-resolution collision risk
- `serveStatic` read stream now has error handler — prevents silent response hangs
- Corrupt session files are deleted on load instead of silently accumulating
- Dynamic OS detection for shell hints — no more Unix commands on Windows
- All hardcoded `C:/Users/<username>` paths replaced with `os.homedir()`
