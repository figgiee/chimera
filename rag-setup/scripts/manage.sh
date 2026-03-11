#!/bin/bash
# Chimera Management Script

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RAG_DIR="$( dirname "$SCRIPT_DIR" )"

case "${1:-help}" in
  start)
    echo "Starting Chimera services..."
    cd "$RAG_DIR"
    docker compose up -d
    echo "Waiting for health checks..."
    sleep 5
    docker compose ps
    echo ""
    echo "RAG server: http://localhost:8080"
    echo "SearXNG:    http://localhost:8888"
    ;;

  stop)
    cd "$RAG_DIR" && docker compose stop
    echo "Services stopped"
    ;;

  restart)
    cd "$RAG_DIR" && docker compose restart
    echo "Services restarted"
    ;;

  rebuild)
    echo "Rebuilding RAG server..."
    cd "$RAG_DIR" && docker compose up -d --build rag-server
    ;;

  logs)
    cd "$RAG_DIR" && docker compose logs -f "${2:-}"
    ;;

  status)
    cd "$RAG_DIR" && docker compose ps
    ;;

  health)
    echo "Service Health:"
    echo ""
    echo "RAG Server:"
    curl -s http://localhost:8080/health | python -m json.tool 2>/dev/null || echo "  Not responding"
    echo ""
    echo "TEI Embeddings:"
    curl -s http://localhost:8001/health && echo " OK" || echo "  Not responding"
    echo ""
    echo "SearXNG:"
    curl -s -o /dev/null -w "  HTTP %{http_code}" http://localhost:8888/ && echo "" || echo "  Not responding"
    ;;

  reset)
    echo "WARNING: This will remove all data!"
    read -p "Continue? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      cd "$RAG_DIR" && docker compose down -v
      echo "All data removed. Run './manage.sh start' to rebuild."
    fi
    ;;

  db-backup)
    BACKUP_FILE="$RAG_DIR/backups/nexus-$(date +%Y%m%d-%H%M%S).sql"
    mkdir -p "$RAG_DIR/backups"
    cd "$RAG_DIR"
    docker compose exec -T postgres pg_dump -U nexus nexus_rag > "$BACKUP_FILE"
    echo "Backup saved: $BACKUP_FILE"
    ;;

  help|*)
    cat << 'EOF'
Usage: ./manage.sh <command>

Commands:
  start       Start all services
  stop        Stop all services
  restart     Restart all services
  rebuild     Rebuild and restart the RAG server
  logs [svc]  Tail logs (optional: postgres, tei, searxng, rag-server)
  status      Show container status
  health      Check all service endpoints
  db-backup   Backup PostgreSQL to ./backups/
  reset       Remove all data and volumes (destructive)
EOF
    ;;
esac
