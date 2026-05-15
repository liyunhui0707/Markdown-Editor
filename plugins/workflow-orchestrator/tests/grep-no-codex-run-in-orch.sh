#!/usr/bin/env bash
# Fails if codex_run is mentioned in orchestrator skill text outside mcp-contract.md.
# mcp-contract.md is the only file allowed to mention it, and only as a FALLBACK note.
set -euo pipefail
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"

OFFENDERS=$(grep -RlE 'codex_run' "$PLUGIN_DIR/skills" 2>/dev/null \
            | grep -v 'mcp-contract.md' || true)
if [ -n "$OFFENDERS" ]; then
  echo "FAIL: codex_run mentioned in orchestrator skill files outside mcp-contract.md:" >&2
  echo "$OFFENDERS" >&2
  exit 1
fi
echo "OK: codex_run not present in orchestrator skill files outside mcp-contract.md"
