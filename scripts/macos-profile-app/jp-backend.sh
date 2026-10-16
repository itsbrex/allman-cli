#!/bin/bash
# Backend-only isolation for the personal BrowserOS JP instance.
# Install as ~/.config/allman/jp/mcp-resources/bin/browseros-claw-server.
set -euo pipefail
jp_base=/Users/hack/.config/allman/jp
jp_state="$jp_base/browserclaw-state"
jp_binary="$jp_base/backend-vendor/0.0.72/resources/bin/browseros-claw-server"
if [[ ! -x "$jp_binary" || ! -d "$jp_state" ]]; then
  echo 'JP backend binary or private state directory is missing.' >&2
  exit 1
fi
export BROWSERCLAW_DIR="$jp_state"
# Large MCP results use BROWSEROS_DIR, independently of the backend state root.
# Keep tool artifacts inside the same writable, JP-only sandbox directory.
export BROWSEROS_DIR="$jp_state"
# Keep the real HOME. Upstream boot reconciliation otherwise adopts and rewrites
# existing browseros-neo MCP entries, even with a separate BROWSERCLAW_DIR.
# Only this backend process is constrained; browser downloads/extensions retain
# their existing permissions. Plugin configuration is managed by Codex instead.
exec /usr/bin/sandbox-exec \
  -D "USER_HOME=$HOME" -D "JP_STATE=$jp_state" \
  -p '(version 1)(allow default)(deny file-write* (subpath (param "USER_HOME")))(allow file-write* (subpath (param "JP_STATE")))' \
  "$jp_binary" "$@"
