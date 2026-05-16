#!/usr/bin/env bash
# Fails if any contiguous secret-pattern literal appears in codex-bridge
# test source files. Covers all 6 entries in
# codex_bridge/redaction.py:_PATTERNS so the test tree stays redaction-clean
# (i.e. can be passed through the plugin's own scan_payload without raising).
#
# This guard mirrors `_PATTERNS` deliberately. If a new pattern is added
# there, add the corresponding -e clause here.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="$SCRIPT_DIR/../servers/codex-bridge/tests"

PATTERNS=(
  -e 'AKIA[0-9A-Z]{16}'
  -e 'sk-ant-[A-Za-z0-9_-]{40,}'
  -e 'sk-[A-Za-z0-9]{32,}'
  -e 'gh[poursb]_[A-Za-z0-9]{36,}'
  -e 'xox[baprs]-[A-Za-z0-9-]{10,}'
  -e '-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'
)

set +e
grep -RnE "${PATTERNS[@]}" "$TARGET" --include='*.py' --exclude-dir=__pycache__
rc=$?
set -e

if [ "$rc" -eq 0 ]; then
  echo "FAIL: contiguous secret-pattern literal found in test source" >&2
  exit 1
elif [ "$rc" -eq 1 ]; then
  echo "OK: no contiguous secret-pattern literals in test source"
  exit 0
else
  echo "ERROR: grep exited with status $rc" >&2
  exit "$rc"
fi
