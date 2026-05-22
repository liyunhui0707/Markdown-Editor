#!/usr/bin/env bash
# Narrower auto-merge guard.
#
# `gh pr merge` is allowed in exactly one file —
#   skills/workflow/docs/auto-merge.md
# which documents the opt-in merge procedure. Anywhere else in plugin
# source (outside tests/) the command is forbidden.
#
# `git merge` (any form) and `git push --force` to main/master are
# always forbidden, with no exceptions.
set -euo pipefail
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"

ALLOWED_AUTOMERGE_DOC="skills/workflow/docs/auto-merge.md"

GH_MERGE='gh[[:space:]]+pr[[:space:]]+merge\b'
GIT_MERGE='git[[:space:]]+merge[[:space:]]+'
GIT_FORCE_PUSH='git[[:space:]]+push[[:space:]]+.*--force[[:space:]]+.*\b(main|master)\b'

GREP_FLAGS=(
  --include='*.md' --include='*.sh' --include='*.py' --include='*.json'
  --exclude-dir=tests
  --exclude-dir=__pycache__
  --exclude-dir=.venv
)

fail=0

# `gh pr merge` — allow-listed for the auto-merge doc only.
gh_hits=$(grep -RnE "${GH_MERGE}" "${GREP_FLAGS[@]}" "$PLUGIN_DIR" || true)
if [ -n "${gh_hits}" ]; then
  unexpected=$(printf '%s\n' "${gh_hits}" | grep -v "${ALLOWED_AUTOMERGE_DOC}" || true)
  if [ -n "${unexpected}" ]; then
    echo "FAIL: 'gh pr merge' found outside ${ALLOWED_AUTOMERGE_DOC}:" >&2
    printf '%s\n' "${unexpected}" >&2
    fail=1
  fi
fi

# `git merge` — never allowed in plugin source.
if grep -RnE "${GIT_MERGE}" "${GREP_FLAGS[@]}" "$PLUGIN_DIR" ; then
  echo "FAIL: 'git merge' command found in plugin source" >&2
  fail=1
fi

# `git push --force` to main/master — never allowed.
if grep -RnE "${GIT_FORCE_PUSH}" "${GREP_FLAGS[@]}" "$PLUGIN_DIR" ; then
  echo "FAIL: force-push to main/master found in plugin source" >&2
  fail=1
fi

if [ "${fail}" -ne 0 ]; then
  exit 1
fi

echo "OK: no unauthorized merge commands in plugin source"
