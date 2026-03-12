# Chimera

## What This Is

A local-first AI assistant that runs entirely on your machine using open-source models (Qwen 3.5 9B via LM Studio). Chimera can search the web, read/write files, run shell commands, remember conversations, search a knowledge base, and autonomously plan and execute multi-step projects — all without sending data to the cloud.

## Core Value

A user says what they want in plain language, and the framework handles the rest — intent detection, workflow planning, task execution, memory — even with a small 9B model. No prompt engineering required.

## Requirements

### Validated

- MCP gateway with find_tool/call_tool meta-protocol (token-efficient for small models) — v0.1
- RAG pipeline: document upload, semantic search, conversation memory — v0.1
- Synapse workflow engine: session creation, Q&A, task generation, execution tracking — v0.1
- Web search via SearXNG integration — v0.1
- File operations: read, write, list, search with path restrictions — v0.1
- Shell command execution with allowlist security — v0.1
- Orchestrator: intent routing, Synapse Q&A driving, task execution loop — v0.1
- Loop detection for error-driven retries (3 consecutive identical calls) — v0.1
- Think-tag stripping from model responses — v0.1
- Auto-save conversation summaries to RAG memory — v0.1
- Chat server: HTTP API with session management, SSE streaming, abort/timeout — v0.1
- Security: sensitive file blocklist, command allowlist, path restrictions — v0.1

### Active

- [ ] Web frontend for chat + real-time activity display
- [ ] Model flexibility (support models beyond Qwen 3.5 9B)
- [ ] One-command setup (`docker compose up`)

### Out of Scope

- Cloud/hosted deployment — Chimera is local-first by design
- Mobile app — web-first, revisit after frontend is solid
- Multi-user auth — personal assistant, single user
- Plugin marketplace — focus on core capabilities first

## Context

- Running on Windows 11, LM Studio with Qwen 3.5 9B (48K context)
- Docker Compose runs RAG stack (FastAPI + SQLite + SearXNG + embeddings)
- MCP servers: gateway, RAG, Synapse, SearXNG, shell, PDF reader, screenshot
- Orchestrator bypasses LM Studio chat UI — drives model programmatically via OpenAI-compatible API
- Competitive landscape: Open WebUI (45k stars), AnythingLLM (53k stars), Khoj (~12k stars) — none have autonomous workflow planning with small models
- Key differentiator: Synapse + intent routing + small-model robustness in one integrated local system

## Constraints

- **Model size**: Must work reliably with 9B parameter models (not just 70B+)
- **Local only**: No external API calls for core functionality (web search is opt-in)
- **No build tools for v1 frontend**: Vanilla HTML stepping stone before SvelteKit
- **Zero dependencies for chat server**: Node.js standard library only (no Express, no npm packages)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Meta-MCP gateway (find_tool + call_tool) | Reduces tool token overhead for small models | ✓ Good — 15/15 tools work through 2 endpoints |
| Orchestrator drives model (not user) | 9B models can't self-orchestrate reliably | ✓ Good — autonomous calculator build proved it |
| SvelteKit for production frontend | Open WebUI proved it at 50k stars, less boilerplate than React | — Pending |
| Vanilla HTML as stepping stone | Gets out of curl-land immediately, no risk | — Pending |

---
*Last updated: 2026-03-12 after v0.1 completion*
