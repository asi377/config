#!/usr/bin/env bash
#
# HORNET — one-command local startup (idempotent, no manual IP edits)
#
# What it does:
#   1. Auto-detects this machine's LAN IP (hostname -I; override: ./start.sh <IP>)
#   2. Injects it into .env as BASE_URL / BACKEND_URL
#   3. Brings up the backend stack (Docker Compose)   [--build to rebuild image]
#   4. Seeds the local Xray node (Server row) with the detected IP
#   5. Starts the local Xray server (port 8443) if not already running
#   6. Starts the local node-agent if not already running
#
# Safe to run repeatedly. Processes are detached (nohup) so they survive the
# terminal; re-run this script after a reboot to restore everything.
#
# Usage:
#   ./start.sh              # start everything (fast, no image rebuild)
#   ./start.sh --build      # rebuild the backend image first (after code changes)
#   ./start.sh 192.168.1.50 # force a specific IP
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_DIR="${HORNET_NODE_DIR:-/home/asi37/hornet-node}"
cd "$REPO_DIR"

BUILD=0
IP_ARG=""
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    *) IP_ARG="$arg" ;;
  esac
done

log() { printf '\033[1;36m[start]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[start]\033[0m %s\n' "$*"; }

# ── 1. Detect LAN IP ──────────────────────────────────────────────────────────
# Prefer an explicit arg; otherwise take the first non-loopback IPv4 from
# `hostname -I`, skipping Docker bridge gateways (…172.1x.0.1).
detect_ip() {
  if [[ -n "$IP_ARG" ]]; then echo "$IP_ARG"; return; fi
  local ip
  ip="$(hostname -I 2>/dev/null | tr ' ' '\n' \
        | grep -E '^([0-9]{1,3}\.){3}[0-9]{1,3}$' \
        | grep -vE '^127\.' \
        | grep -vE '^172\.(1[7-9]|2[0-9]|3[0-1])\.0\.1$' \
        | head -n1)"
  [[ -z "$ip" ]] && ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "$ip"
}
IP="$(detect_ip)"
if [[ -z "$IP" ]]; then warn "Could not detect an IP; falling back to localhost"; IP="127.0.0.1"; fi
BASE_URL="http://${IP}:3000"
log "Detected IP: ${IP}  →  BASE_URL=${BASE_URL}"

# ── 2. Inject into .env (idempotent) ──────────────────────────────────────────
[[ -f .env ]] || { [[ -f .env.example ]] && cp .env.example .env; }
set_env() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
}
set_env BASE_URL "$BASE_URL"
set_env BACKEND_URL "$BASE_URL"
log ".env updated (BASE_URL / BACKEND_URL)"

# ── 3. Backend stack ──────────────────────────────────────────────────────────
if [[ "$BUILD" == "1" ]]; then
  log "Building + starting backend stack…"
  docker compose up -d --build
else
  log "Starting backend stack…"
  docker compose up -d
fi

log "Waiting for backend health…"
for _ in $(seq 1 60); do
  if curl -fs http://localhost:3000/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fs http://localhost:3000/health >/dev/null 2>&1 \
  && log "Backend healthy" || warn "Backend not healthy yet (check: docker compose logs backend)"

# ── 4. Seed local node with the detected IP ───────────────────────────────────
log "Seeding local Xray node (IP ${IP})…"
docker compose exec -T -e LOCAL_NODE_IP="$IP" backend node scripts/seed-local-node.mjs \
  || warn "Seed step failed (is scripts/seed-local-node.mjs in the image? run: ./start.sh --build)"

# ── 5. Local Xray server ──────────────────────────────────────────────────────
if ss -tlnp 2>/dev/null | grep -q ':8443'; then
  log "Xray server already running on :8443"
elif [[ -x "$NODE_DIR/xray" ]]; then
  log "Starting Xray server…"
  ( cd "$NODE_DIR" && nohup ./xray run -c xray-config.json > xray.log 2>&1 & )
  sleep 2
  ss -tlnp 2>/dev/null | grep -q ':8443' && log "Xray up on :8443" || warn "Xray failed to bind :8443 (see $NODE_DIR/xray.log)"
else
  warn "Xray binary not found at $NODE_DIR/xray — skipping (set HORNET_NODE_DIR)"
fi

# ── 6. Local node-agent ───────────────────────────────────────────────────────
if pgrep -f "infra/node-agent/local-agent.js" >/dev/null 2>&1 || pgrep -f "node local-agent.js" >/dev/null 2>&1; then
  log "Node agent already running"
else
  log "Starting node-agent…"
  ( cd "$REPO_DIR/infra/node-agent" && nohup node local-agent.js > agent.log 2>&1 & )
  sleep 2
  pgrep -f "local-agent.js" >/dev/null 2>&1 && log "Agent running" || warn "Agent failed to start (see infra/node-agent/agent.log)"
fi

echo
log "✅ Done."
echo "   Admin panel : http://localhost:3000/admin/   (admin@hornet.com / admin123456)"
echo "   Sub links   : ${BASE_URL}/sub/<uuid>"
echo "   Phone must be on the same LAN and able to reach ${IP}:8443"
