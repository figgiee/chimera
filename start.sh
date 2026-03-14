#!/usr/bin/env bash
set -e

# ── Chimera AI — startup script (macOS / Linux) ────────────────────────────

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "  =============================="
echo "    Chimera AI - Starting Up"
echo "  =============================="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Node.js check ────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "${RED}[ERROR]${NC} Node.js not found. Install from https://nodejs.org"
  exit 1
fi

# ── Kill stale process on port 3210 ──────────────────────────────────────────
if lsof -ti:3210 &>/dev/null; then
  echo "[CLEANUP] Killing stale process on port 3210..."
  lsof -ti:3210 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# ── RAG stack (optional) ─────────────────────────────────────────────────────
if command -v docker &>/dev/null && [ -f "$SCRIPT_DIR/rag-setup/docker-compose.yml" ]; then
  echo "[1/3] Starting RAG stack..."
  docker compose -f "$SCRIPT_DIR/rag-setup/docker-compose.yml" up -d 2>/dev/null && echo "      Started." || echo -e "${YELLOW}[WARN]${NC} RAG stack failed to start. Continuing without it."
else
  echo "[1/3] Skipping RAG stack (Docker not found or no compose file)."
fi

# ── Web frontend build ────────────────────────────────────────────────────────
echo "[2/3] Building web frontend..."
cd "$SCRIPT_DIR/web"
npm install --prefer-offline
npm run build
cd "$SCRIPT_DIR"

# ── Start server ─────────────────────────────────────────────────────────────
echo "[3/3] Starting Chimera server..."
echo ""
echo "  =============================="
echo -e "    Chimera is running at:"
echo -e "    ${GREEN}http://localhost:3210${NC}"
echo "  =============================="
echo ""
echo "  Press Ctrl+C to stop."
echo ""

node "$SCRIPT_DIR/chimera-chat.js"
