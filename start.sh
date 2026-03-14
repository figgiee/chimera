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

# ── Ollama check (warn, don't block) ─────────────────────────────────────────
if ! command -v ollama &>/dev/null; then
  echo -e "${YELLOW}[WARN]${NC} Ollama not found. Install from https://ollama.com"
  echo "       Then run: ollama pull qwen3:8b && ollama pull nomic-embed-text"
  echo ""
fi

# ── Kill stale process on port 3210 ──────────────────────────────────────────
if lsof -ti:3210 &>/dev/null; then
  echo "[CLEANUP] Killing stale process on port 3210..."
  lsof -ti:3210 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# ── Install dependencies ──────────────────────────────────────────────────────
echo "[1/3] Installing dependencies..."
cd "$SCRIPT_DIR"
npm install --prefer-offline

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
echo "  Requires Ollama running with:"
echo "    ollama pull qwen3:8b"
echo "    ollama pull nomic-embed-text"
echo ""
echo "  Press Ctrl+C to stop."
echo ""

node "$SCRIPT_DIR/chimera-chat.js"
