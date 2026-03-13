# Contributing to Chimera

Thanks for your interest in contributing. Here's how to get started.

## Running locally

1. **Prerequisites**: Node.js 20+, Docker Desktop (for the RAG stack), LM Studio with a model loaded
2. **Clone and start**:
   ```bash
   git clone https://github.com/figgiee/chimera
   cd chimera
   cp .env.example .env        # edit DB_PASSWORD at minimum
   ./start.sh                  # macOS/Linux
   start.bat                   # Windows
   ```
3. Open `http://localhost:3210`

The startup script handles Docker, the web build, and the Node server automatically.

## Project layout

```
chimera-chat.js          HTTP server (sessions, SSE, static files)
chimera-orchestrator.js  LLM orchestration, tool dispatch, Synapse
mcp-chimera-gateway/     Meta-MCP: routes tool calls to the right server
mcp-chimera-rag/         RAG tools (search, upload, memory)
mcp-chimera-synapse/     Synapse workflow planner
rag-setup/               Docker: FastAPI + PostgreSQL + TEI + SearXNG
web/                     SvelteKit frontend
```

## Making changes

- **Backend**: edit `chimera-chat.js` or `chimera-orchestrator.js`, restart `node chimera-chat.js`
- **Frontend**: `cd web && npm run dev` starts the Vite dev server on a different port; the backend proxies API calls
- **MCP servers**: restart the relevant `node index.js` process (or restart everything via `start.sh`)

## Submitting a pull request

1. Fork the repo and create a branch: `git checkout -b my-fix`
2. Keep changes focused — one fix or feature per PR
3. Test manually: start the server, send a message, confirm nothing regressed
4. Open a PR with a clear description of what changed and why

## Reporting issues

Open a GitHub issue with:
- OS and Node.js version
- Steps to reproduce
- What you expected vs. what happened
- Relevant logs (the server prints structured logs to stdout)
