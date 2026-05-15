#!/usr/bin/env bash
# Fails if any auto-merge command appears in plugin source (outside tests/).
set -euo pipefail
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"

FORBIDDEN='gh[[:space:]]+pr[[:space:]]+merge\b|git[[:space:]]+merge[[:space:]]+|git[[:space:]]+push[[:space:]]+.*--force[[:space:]]+.*\b(main|master)\b'

if grep -RnE "$FORBIDDEN" "$PLUGIN_DIR" \
    --include='*.md' --include='*.sh' --include='*.py' --include='*.json' \
    --exclude-dir=tests \
    --exclude-dir=__pycache__ \
    --exclude-dir=.venv ; then
  echo "FAIL: auto-merge command found in plugin source" >&2
  exit 1
fi
echo "OK: no auto-merge commands in plugin source"
