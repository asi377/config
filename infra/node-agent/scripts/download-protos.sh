#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# download-protos.sh
#
# Downloads the Xray-core .proto files required by XrayGrpcManager.
#
# Xray uses the TypedMessage pattern: all RPC operations and account payloads
# are double-wrapped in TypedMessage { type, value }.  The gRPC service
# definitions need only 4 proto files plus their transitive imports; the
# account message types (VLESS / Trojan / VMess) are defined inline inside
# XrayGrpcManager.js via protobufjs schema strings, so you do NOT need to
# download those from the repo.
#
# Usage:
#   ./scripts/download-protos.sh                     # uses main branch
#   ./scripts/download-protos.sh v1.260327.0         # pin to a specific tag
#   ./scripts/download-protos.sh main protos          # custom output dir
#
# Required: curl, mkdir
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BRANCH="${1:-main}"
OUTDIR="${2:-$(dirname "$0")/../protos}"
OUTDIR="$(cd "$OUTDIR" 2>/dev/null && pwd || echo "$OUTDIR")"

BASE="https://raw.githubusercontent.com/XTLS/Xray-core/${BRANCH}"

# === Proto files needed for gRPC service loading (proto-loader) ===
# app/proxyman/command/command.proto     → AlterInbound, ListInbounds, etc.
#   imports → common/protocol/user.proto → imports common/serial/typed_message.proto
#   imports → core/config.proto           → imports common/serial/typed_message.proto
# app/stats/command/command.proto        → GetStats, QueryStats (self-contained)

FILES=(
  app/proxyman/command/command.proto
  common/protocol/user.proto
  common/serial/typed_message.proto
  core/config.proto
  app/stats/command/command.proto
)

FAILED=0

for relpath in "${FILES[@]}"; do
  url="${BASE}/${relpath}"
  dest="${OUTDIR}/${relpath}"
  mkdir -p "$(dirname "$dest")"
  if curl -sfL "$url" -o "$dest"; then
    echo "  OK  ${relpath}"
  else
    echo "  FAIL  ${relpath}  (${url})"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "All ${#FILES[@]} proto files downloaded to ${OUTDIR}"
else
  echo "${FAILED}/${#FILES[@]} proto files FAILED — check branch/tag name: ${BRANCH}"
  exit 1
fi
