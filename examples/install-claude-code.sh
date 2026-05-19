#!/usr/bin/env bash
# One-step Claude Code installation script for the Firefly Services MCP server.
#
# Usage:
#   FIREFLY_SERVICES_CLIENT_ID=<id> FIREFLY_SERVICES_CLIENT_SECRET=<secret> \
#     ./examples/install-claude-code.sh
#
# Assumes:
#   - You have `claude` CLI installed (Claude Code)
#   - This repo is cloned locally and built (`npm install && npm run build`)
#   - FIREFLY_SERVICES_CLIENT_ID and FIREFLY_SERVICES_CLIENT_SECRET are exported

set -euo pipefail

cd "$(dirname "$0")/.."

# Resolve absolute path to the built server entry point.
SERVER="$(pwd)/dist/server.js"

if [[ ! -f "$SERVER" ]]; then
  echo "[error] Built server not found at: $SERVER"
  echo "        Run 'npm install && npm run build' first."
  exit 1
fi

if [[ -z "${FIREFLY_SERVICES_CLIENT_ID:-}" ]]; then
  echo "[error] FIREFLY_SERVICES_CLIENT_ID env var is not set."
  exit 1
fi

if [[ -z "${FIREFLY_SERVICES_CLIENT_SECRET:-}" ]]; then
  echo "[error] FIREFLY_SERVICES_CLIENT_SECRET env var is not set."
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "[error] 'claude' CLI not found in PATH. Install Claude Code first:"
  echo "        https://docs.anthropic.com/claude-code"
  exit 1
fi

echo "[ok] Server entry:     $SERVER"
echo "[ok] Client ID:        ${FIREFLY_SERVICES_CLIENT_ID:0:6}..."
echo "[ok] Client secret:    (set, ${#FIREFLY_SERVICES_CLIENT_SECRET} chars)"
echo ""
echo "Registering MCP server 'firefly-services' with Claude Code..."

# Remove any existing registration with the same name (idempotent re-install).
claude mcp remove firefly-services 2>/dev/null || true

claude mcp add firefly-services \
  --env FIREFLY_SERVICES_CLIENT_ID="$FIREFLY_SERVICES_CLIENT_ID" \
  --env FIREFLY_SERVICES_CLIENT_SECRET="$FIREFLY_SERVICES_CLIENT_SECRET" \
  -- node "$SERVER"

echo ""
echo "Verifying registration..."
claude mcp list | grep firefly-services || {
  echo "[error] 'firefly-services' not in 'claude mcp list' output."
  echo "        Check 'claude mcp list' manually."
  exit 1
}

echo ""
echo "Done. Open Claude Code in any project and ask:"
echo ""
echo "  > Run firefly_check_auth and tell me whether the credentials work."
echo ""
echo "If the response says ok=true, you're good. Then try:"
echo ""
echo "  > Generate an image of a red apple on a white background."
echo ""
