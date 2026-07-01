#!/usr/bin/env bash
#
# HORNET — stop the local stack (backend containers + Xray + agent).
# Safe to run repeatedly.
#
set -uo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_DIR="${HORNET_NODE_DIR:-/home/asi37/hornet-node}"
cd "$REPO_DIR"

log() { printf '\033[1;36m[stop]\033[0m %s\n' "$*"; }

log "Stopping node-agent…"
pkill -f "local-agent.js" 2>/dev/null && log "agent stopped" || log "agent not running"

log "Stopping Xray server…"
pkill -f "$NODE_DIR/xray run" 2>/dev/null
# Fallback: xray started with a relative ./xray path
for pid in $(pgrep -f "xray run -c .*xray-config.json" 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
log "xray stop signalled"

if [[ "${1:-}" == "--all" ]]; then
  log "Stopping Docker stack…"
  docker compose down
else
  log "Docker stack left running (use ./stop.sh --all to stop it too)"
fi
log "Done."
