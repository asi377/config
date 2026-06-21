#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# VPS Bootstrap Script — HORNET VPN Infrastructure
# ============================================================
# Usage:
#   curl -fsSL https://your-backend.com/bootstrap.sh | bash -s -- \
#     --backend https://panel.hornet.com \
#     --token NODE_REGISTRATION_TOKEN \
#     --region de-fra
# ============================================================

BACKEND=""
TOKEN=""
REGION=""
INTERFACE="eth0"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

while [[ $# -gt 0 ]]; do
  case $1 in
    --backend) BACKEND="$2"; shift 2 ;;
    --token)   TOKEN="$2";   shift 2 ;;
    --region)  REGION="$2";  shift 2 ;;
    --interface) INTERFACE="$2"; shift 2 ;;
    *) error "Unknown option: $1" ;;
  esac
done

[[ -z "$BACKEND" || -z "$TOKEN" ]] && error "Usage: bootstrap.sh --backend <url> --token <token> [--region <code>]"

# --- Detect OS ---
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS="$ID"
  VER="$VERSION_ID"
else
  error "Cannot detect OS. Only Ubuntu/Debian supported."
fi
info "Detected OS: $OS $VER"

# --- Prerequisites ---
info "Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq curl wget unzip jq ufw nodejs npm certbot python3 python3-pip || true

# Ensure Node.js >= 18
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 18 ]]; then
  info "Installing Node.js 20.x..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
info "Node.js: $(node -v)"

# --- Install XRay ---
install_xray() {
  info "Installing XRay-core..."
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/XTLS/Xray-install/main/install-release.sh)" @ install
  systemctl enable xray
  info "XRay installed: $(xray --version 2>/dev/null | head -1)"
}

install_xray

# --- Configure Firewall ---
info "Configuring UFW firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 443/tcp
ufw allow 80/tcp
ufw allow "$(xray api port 2>/dev/null || echo 10085)"/tcp 2>/dev/null || true
ufw --force enable
info "Firewall enabled. Ports: 22, 80, 443"

# --- System Tuning ---
info "Applying system network optimizations..."
cat >> /etc/sysctl.conf <<'EOF'
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_rmem = 4096 87380 67108864
net.ipv4.tcp_wmem = 4096 65536 67108864
net.core.rmem_max = 67108864
net.core.wmem_max = 67108864
net.ipv4.tcp_mtu_probing = 1
EOF
sysctl -p

# --- Install Node Agent ---
info "Installing HORNET Node Agent..."
mkdir -p /opt/hornet-agent
cd /opt/hornet-agent

cat > package.json <<'PKGJSON'
{
  "name": "hornet-node-agent",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "node-fetch": "^3.3.0"
  }
}
PKGJSON

npm install --production --quiet

# Download agent from backend (or deploy manually)
info "Downloading Node Agent from backend..."
AGENT_URL="${BACKEND}/api/node-agent/install.sh"
if curl -fsSL "$AGENT_URL" -o /opt/hornet-agent/agent.js 2>/dev/null; then
  info "Agent downloaded from backend"
else
  warn "Could not fetch agent from backend. Deploy agent.js manually to /opt/hornet-agent/"
  warn "Create /opt/hornet-agent/agent.js with the Node Agent code"
fi

# --- Agent Config ---
cat > /opt/hornet-agent/config.json <<CONF
{
  "backendUrl": "${BACKEND}",
  "nodeToken": "${TOKEN}",
  "region": "${REGION}",
  "interface": "${INTERFACE}",
  "heartbeatInterval": 30,
  "metricsInterval": 60,
  "logLevel": "info"
}
CONF
info "Agent configuration written"

# --- Systemd Service for Agent ---
cat > /etc/systemd/system/hornet-agent.service <<'SERVICE'
[Unit]
Description=HORNET VPN Node Agent
After=network.target xray.service
Wants=xray.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/hornet-agent
ExecStart=/usr/bin/node /opt/hornet-agent/agent.js
Restart=always
RestartSec=10
LimitNOFILE=1048576
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable hornet-agent
systemctl start hornet-agent

# --- Register with Backend ---
info "Registering node with backend..."
REGISTER_RESP=$(curl -s -X POST "${BACKEND}/api/nodes/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"$(hostname)\",
    \"ipAddress\": \"$(curl -4 -fsSL ifconfig.me 2>/dev/null || echo 'unknown')\",
    \"region\": \"${REGION}\",
    \"port\": 443,
    \"xrayApiPort\": 10085,
    \"maxCapacity\": 200,
    \"bootstrapToken\": \"${TOKEN}\"
  }")

PERMANENT_TOKEN=""
if echo "$REGISTER_RESP" | jq -e '.success' >/dev/null 2>&1; then
  PERMANENT_TOKEN=$(echo "$REGISTER_RESP" | jq -r '.data.nodeToken')
  info "Node registered successfully with backend"
  info "Updating agent config with permanent token..."
  cat > /opt/hornet-agent/config.json <<CONF
{
  "backendUrl": "${BACKEND}",
  "nodeToken": "${PERMANENT_TOKEN}",
  "region": "${REGION}",
  "interface": "${INTERFACE}",
  "heartbeatInterval": 30,
  "metricsInterval": 60,
  "logLevel": "info"
}
CONF
  systemctl restart hornet-agent 2>/dev/null || true
else
  warn "Registration response: $REGISTER_RESP"
  warn "Node will retry registration via agent heartbeat"
fi

# --- Verify ---
info ""
info "==================================="
info " HORNET VPS Bootstrap Complete!"
info " Region:      ${REGION:-unset}"
info " Backend:     ${BACKEND}"
info " XRay:        $(xray --version 2>/dev/null | head -1)"
info " Agent:       $(systemctl is-active hornet-agent)"
info " Firewall:    $(ufw status | head -1)"
info "==================================="
