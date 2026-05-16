#!/usr/bin/env bash
# Fails if any absolute machine path appears in plugin source (outside tests/ and fixtures).
set -euo pipefail
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# POSIX-style abs paths starting at /Users/ or /home/, or Windows drive letters.
FORBIDDEN='(/Users/|/home/|^[A-Za-z]:\\)'

if grep -RnE "$FORBIDDEN" "$PLUGIN_DIR" \
    --include='*.md' --include='*.json' --include='*.py' --include='*.sh' --include='*.toml' \
    --exclude-dir=tests \
    --exclude-dir=__pycache__ \
    --exclude-dir=.venv \
    --exclude='uv.lock' ; then
  echo "FAIL: absolute machine path found in plugin source" >&2
  exit 1
fi
echo "OK: no absolute machine paths in plugin source"
