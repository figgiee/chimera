<a name="readme-top"></a>

<div align="center">

<br>

# CHIMERA

**Fully local AI assistant with RAG, web search, and persistent memory.**

*Runs entirely on your hardware. No API keys. No cloud. No telemetry.*

<br>

[![Status](https://img.shields.io/badge/status-active-brightgreen?style=for-the-badge)](https://github.com/figgiee/chimera)
[![LM Studio](https://img.shields.io/badge/LM%20Studio-0.4.6-7C3AED?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJ3aGl0ZSI+PHBhdGggZD0iTTEyIDJMMiA3bDEwIDUgMTAtNS0xMC01ek0yIDE3bDEwIDUgMTAtNS0xMC01LTEwIDV6TTIgMTJsMTAgNSAxMC01LTEwLTUtMTAgNXoiLz48L3N2Zz4=)](https://lmstudio.ai)
[![Docker](https://img.shields.io/badge/Docker-4_Services-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com)
[![MCP](https://img.shields.io/badge/MCP-7_Servers-F97316?style=for-the-badge)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/badge/license-MIT-22C55E?style=for-the-badge)](LICENSE)

<br>

[Getting Started](#-getting-started) · [Architecture](#-architecture) · [MCP Tools](#-mcp-tools) · [API Reference](#-api-reference) · [Configuration](#-configuration)

</div>

<br>

---

<br>

## What is Chimera?

Chimera connects [LM Studio](https://lmstudio.ai) to a production-grade RAG pipeline through the [Model Context Protocol](https://modelcontextprotocol.io). Your local LLM gains real capabilities:

<table>
<tr>
<td width="50%">

**Knowledge & Search**
- Semantic document search via pgvector
- Web search across 11 engines (SearXNG)
- Live library docs via Context7

</td>
<td width="50%">

**Memory & Interaction**
- Conversation memory with semantic recall
- Persistent knowledge graph
- File system access (read/write/search)

</td>
</tr>
<tr>
<td width="50%">

**Document Processing**
- Upload & index PDF, DOCX, TXT, MD
- Batch embedding with TEI
- Cosine similarity ranking

</td>
<td width="50%">

**Vision & Analysis**
- Screenshot capture & analysis
- PDF text extraction
- Multi-modal with vision models

</td>
</tr>
</table>

> [!IMPORTANT]
> All processing happens locally. Documents are embedded on your machine, stored in your database, and never leave your network.

<br>

## Architecture

```
                          ┌─────────────────────────────────┐
                          │         LM Studio (Host)         │
                          │     Qwen 3.5 · localhost:1234    │
                          └───────────────┬─────────────────┘
                                          │ MCP (stdio)
                 ┌────────────────────────┼────────────────────────┐
                 │                        │                        │
        ┌────────┴────────┐    ┌──────────┴──────────┐    ┌───────┴───────┐
        │   chimera-rag   │    │  searxng · filesys   │    │  memory · pdf │
        │   (custom MCP)  │    │  context7 · screenshot│    │  (stdlib MCP) │
        └────────┬────────┘    └──────────┬──────────┘    └───────────────┘
                 │                        │
                 ▼                        ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                        Docker Network                            │
  │                                                                  │
  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
  │  │  PostgreSQL   │    │     TEI      │    │   SearXNG    │      │
  │  │  + pgvector   │    │  embeddings  │    │  meta-search │      │
  │  │  port 5432    │    │  port 8001   │    │  port 8888   │      │
  │  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
  │         └───────────────────┼───────────────────┘               │
  │                      ┌──────┴──────┐                            │
  │                      │  RAG Server │                            │
  │                      │  FastAPI    │                            │
  │                      │  port 8080  │                            │
  │                      └─────────────┘                            │
  └──────────────────────────────────────────────────────────────────┘
```

<p align="right"><a href="#readme-top">back to top</a></p>

<br>

## Getting Started

### Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| **GPU** | 8 GB VRAM | 16 GB VRAM |
| **RAM** | 16 GB | 64 GB |
| **Software** | [Docker Desktop](https://docker.com/products/docker-desktop/), [LM Studio](https://lmstudio.ai), [Node.js 18+](https://nodejs.org) | — |

### Step 1 — Clone & Start Docker

```bash
git clone https://github.com/figgiee/chimera.git
cd chimera/rag-setup
docker compose up -d
```

> [!TIP]
> First launch pulls ~3 GB of Docker images and takes 2-3 minutes. Subsequent starts are instant.

Wait for health checks:

```bash
docker compose ps    # all 4 services should show "healthy"
```

### Step 2 — Start LM Studio

1. Open LM Studio and load a model
2. Start the server on port `1234`
3. Copy `mcp.json` to your LM Studio config (see [Configuration](#-configuration))

### Step 3 — Connect Docker to LM Studio

LM Studio binds to `localhost` only. Docker containers need a port proxy to reach it:

```powershell
# Run once in Admin PowerShell — persists across reboots
netsh interface portproxy add v4tov4 listenport=1234 listenaddress=0.0.0.0 connectport=1234 connectaddress=127.0.0.1
```

### Step 4 — Verify

```bash
curl http://localhost:8080/health
```

```json
{
  "status": "ok",
  "services": {
    "database": "ok",
    "embeddings": "ok",
    "search": "ok",
    "llm_studio": "ok"
  }
}
```

> [!NOTE]
> If `llm_studio` shows an error, ensure LM Studio is running and the port proxy is set up (Step 3).

<p align="right"><a href="#readme-top">back to top</a></p>

<br>

## MCP Tools

Chimera provides **7 MCP servers** that give your LLM tool access via LM Studio's plugin system.

### chimera-rag — *Custom RAG Pipeline*

| Tool | Description |
|------|-------------|
| `search_documents` | Semantic vector search across indexed documents with configurable similarity threshold |
| `upload_document` | Upload and index a document (PDF, DOCX, TXT, MD) with automatic chunking and embedding |
| `list_documents` | List all indexed documents with IDs, filenames, and content previews |
| `delete_document` | Remove a document and all its embeddings from the knowledge base |
| `store_conversation` | Save a conversation turn with semantic embedding for long-term memory |
| `recall_conversation` | Search past conversations using semantic similarity |
| `rag_health` | Check health of all RAG pipeline services |

### External MCP Servers

| Server | Source | Capabilities |
|--------|--------|-------------|
| **searxng-search** | [mcp-searxng](https://github.com/erithwik/mcp-searxng) | Privacy-respecting meta-search across 11 engines (DuckDuckGo, Google, Bing, Wikipedia, arXiv, GitHub, Brave, etc.) |
| **filesystem** | [@modelcontextprotocol/server-filesystem](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem) | Read, write, search, and manage files across configured directories |
| **memory** | [@modelcontextprotocol/server-memory](https://www.npmjs.com/package/@modelcontextprotocol/server-memory) | Persistent knowledge graph for entities and relationships across sessions |
| **pdf-reader** | [mcp-pdf-reader](https://github.com/mendableai/mcp-pdf-reader) | Advanced PDF text extraction and structured reading |
| **screenshot** | [mcp-screenshot](https://github.com/nichochar/mcp-screenshot) | Screen capture for vision model analysis |
| **context7** | [@upstash/context7-mcp](https://www.npmjs.com/package/@upstash/context7-mcp) | On-demand, up-to-date library documentation lookup |

<p align="right"><a href="#readme-top">back to top</a></p>

<br>

## Docker Services

<table>
<thead>
<tr>
<th>Service</th>
<th>Image</th>
<th>Port</th>
<th>Description</th>
</tr>
</thead>
<tbody>
<tr>
<td><strong>chimera-rag-server</strong></td>
<td><code>python:3.11-slim</code> (custom)</td>
<td><code>8080</code></td>
<td>FastAPI orchestrator — handles document upload, search, conversation memory, and LM Studio integration</td>
</tr>
<tr>
<td><strong>chimera-postgres</strong></td>
<td><code>pgvector/pgvector:pg15</code></td>
<td><code>5432</code></td>
<td>PostgreSQL with pgvector extension — stores 384-dimensional embeddings with cosine similarity search</td>
</tr>
<tr>
<td><strong>chimera-tei</strong></td>
<td><code>ghcr.io/huggingface/text-embeddings-inference</code></td>
<td><code>8001</code></td>
<td>HuggingFace Text Embeddings Inference — runs <code>all-MiniLM-L6-v2</code> for fast vectorization</td>
</tr>
<tr>
<td><strong>chimera-searxng</strong></td>
<td><code>searxng/searxng:latest</code></td>
<td><code>8888</code></td>
<td>Privacy-respecting meta-search engine — aggregates 11 search backends with no API keys</td>
</tr>
</tbody>
</table>

<p align="right"><a href="#readme-top">back to top</a></p>

<br>

## API Reference

<details>
<summary><strong>GET</strong> <code>/health</code> — Service health check</summary>

```bash
curl localhost:8080/health
```

```json
{
  "status": "ok",
  "timestamp": "2026-03-11T07:45:09.469968",
  "services": {
    "database": "ok",
    "embeddings": "ok",
    "search": "ok",
    "llm_studio": "ok"
  }
}
```

</details>

<details>
<summary><strong>POST</strong> <code>/api/search</code> — Semantic document search</summary>

```bash
curl -X POST localhost:8080/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "machine learning", "limit": 5, "threshold": 0.3}'
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | *required* | Search query text |
| `limit` | int | `5` | Maximum results to return |
| `threshold` | float | `0.3` | Minimum cosine similarity (0-1) |

</details>

<details>
<summary><strong>POST</strong> <code>/api/documents/upload</code> — Upload and index a document</summary>

```bash
curl -X POST localhost:8080/api/documents/upload -F "file=@paper.pdf"
```

Supports: `.pdf`, `.docx`, `.txt`, `.md`

Documents are automatically chunked, embedded via TEI in batches of 32, and stored in pgvector.

</details>

<details>
<summary><strong>GET</strong> <code>/api/documents</code> — List indexed documents</summary>

```bash
curl localhost:8080/api/documents
```

Returns all documents with their IDs, filenames, upload timestamps, and content previews.

</details>

<details>
<summary><strong>DELETE</strong> <code>/api/documents/{id}</code> — Delete a document</summary>

```bash
curl -X DELETE localhost:8080/api/documents/{document_id}
```

Removes the document and all associated embeddings from the database.

</details>

<details>
<summary><strong>POST</strong> <code>/api/conversations/store</code> — Store a conversation turn</summary>

```bash
curl -X POST localhost:8080/api/conversations/store \
  -H "Content-Type: application/json" \
  -d '{"conversation_id": "research-1", "role": "user", "content": "What is RAG?"}'
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `conversation_id` | string | Unique conversation identifier |
| `role` | string | `user` or `assistant` |
| `content` | string | Message content to embed and store |

</details>

<details>
<summary><strong>POST</strong> <code>/api/conversations/recall</code> — Recall past conversations</summary>

```bash
curl -X POST localhost:8080/api/conversations/recall \
  -H "Content-Type: application/json" \
  -d '{"query": "RAG architecture", "limit": 5}'
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | *required* | Semantic search query |
| `conversation_id` | string | `null` | Limit to specific conversation |
| `limit` | int | `5` | Maximum results |

</details>

<p align="right"><a href="#readme-top">back to top</a></p>

<br>

## Configuration

### MCP Server Config

Copy this to your LM Studio MCP config (`~/.lmstudio/mcp.json`), replacing paths with your install location:

<details>
<summary><strong>mcp.json</strong></summary>

```json
{
  "mcpServers": {
    "chimera-rag": {
      "command": "node",
      "args": ["<CHIMERA_PATH>/mcp-chimera-rag/index.js"],
      "env": { "RAG_SERVER_URL": "http://localhost:8080" }
    },
    "searxng-search": {
      "command": "node",
      "args": ["<CHIMERA_PATH>/mcp-searxng/dist/index.js"],
      "env": { "SEARXNG_URL": "http://localhost:8888" }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "~/Desktop", "~/Documents", "~/Downloads"]
    },
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },
    "pdf-reader": {
      "command": "node",
      "args": ["<CHIMERA_PATH>/mcp-pdf-reader/dist/index.js"]
    },
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@latest"]
    },
    "screenshot": {
      "command": "node",
      "args": ["<CHIMERA_PATH>/mcp-screenshot/dist/index.js"]
    }
  }
}
```

</details>

### System Prompt

The recommended system prompt for Chimera is minimal by design — small models perform better with concise instructions:

<details>
<summary><strong>Optimized system prompt (~120 tokens)</strong></summary>

```
You are Chimera, a local AI assistant. Use your tools proactively. Be concise — lead with the answer.

Images, text, and code shared in chat are already in your context. Respond directly.

For dates, versions, current events, or anything time-sensitive: web_search first, then answer.

For questions that might relate to past sessions: recall_conversation to check, then answer.

After significant exchanges (research, analysis, problem-solving): store_conversation with a descriptive conversation_id.

If a tool fails, try an alternative approach. If a file path is given, read it immediately.
```

</details>

### Recommended Models

| Use Case | Model | VRAM | Speed |
|----------|-------|------|-------|
| Daily driver | Qwen 3.5-9B Q4_K_M | ~7 GB | ~93 tok/s |
| Heavy tasks | Qwen 3.5-35B-A3B Q4_K_M | ~14 GB | ~18 tok/s |
| Low VRAM | Qwen 3.5-9B Q3_K_M | ~5 GB | ~100 tok/s |

### LM Studio Settings (for 35B model)

| Setting | Value | Notes |
|---------|-------|-------|
| Context Length | 16,384 | Higher = more VRAM, slower |
| GPU Offload | 25 | Layers offloaded to GPU |
| CPU Threads | 24 | Leave headroom for OS |
| Concurrent Predictions | 1 | Avoid context splitting |

<p align="right"><a href="#readme-top">back to top</a></p>

<br>

## Project Structure

```
chimera/
├── rag-setup/                     # Docker infrastructure + RAG server
│   ├── docker-compose.yml         # 4-service orchestration
│   ├── Dockerfile                 # RAG server image (Python 3.11)
│   ├── app.py                     # FastAPI application
│   ├── db.py                      # SQLAlchemy models + pgvector ops
│   ├── embeddings.py              # TEI client (embed + batch)
│   ├── search.py                  # Document search + SearXNG client
│   ├── llm.py                     # LM Studio health + model detection
│   ├── init.sql                   # pgvector extension bootstrap
│   ├── requirements.txt           # Python dependencies
│   ├── searxng-settings.yml       # 11 search engine configs
│   ├── documents/                 # Uploaded document storage
│   └── scripts/
│       ├── manage.sh              # Service management CLI
│       └── ingest-documents.py    # Batch document processor
│
├── mcp-chimera-rag/               # Custom MCP server
│   ├── index.js                   # 7 tool definitions + handlers
│   └── package.json
│
├── .env.example                   # Environment template
├── .gitignore
├── LICENSE
└── README.md
```

<p align="right"><a href="#readme-top">back to top</a></p>

<br>

## Management

```bash
cd rag-setup

./scripts/manage.sh start       # Start all services
./scripts/manage.sh stop        # Stop all services
./scripts/manage.sh restart     # Restart all services
./scripts/manage.sh rebuild     # Rebuild RAG server after code changes
./scripts/manage.sh health      # Check all service endpoints
./scripts/manage.sh logs        # Tail all logs (or: logs rag-server)
./scripts/manage.sh db-backup   # Backup PostgreSQL to ./backups/
./scripts/manage.sh reset       # Nuclear reset — destroys all data
```

<br>

## Hardware

Tested and optimized on:

| Component | Spec |
|-----------|------|
| **CPU** | 16 cores / 32 threads |
| **RAM** | 64 GB DDR5 |
| **GPU** | NVIDIA RTX 5070 Ti (16 GB VRAM) |
| **OS** | Windows 11 Pro |

<p align="right"><a href="#readme-top">back to top</a></p>

<br>

---

<div align="center">

**Built with** [LM Studio](https://lmstudio.ai) · [pgvector](https://github.com/pgvector/pgvector) · [SearXNG](https://github.com/searxng/searxng) · [HuggingFace TEI](https://github.com/huggingface/text-embeddings-inference) · [MCP](https://modelcontextprotocol.io)

<br>

MIT License

</div>
