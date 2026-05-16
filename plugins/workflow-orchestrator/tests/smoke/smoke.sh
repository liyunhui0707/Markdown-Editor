#!/usr/bin/env bash
# Deterministic smoke for the workflow-orchestrator plugin.
# - G1: selector returns the expected step set for a bug-with-issue task
# - G2: state file init / set-gate / resume round-trips
# - G3: each typed MCP tool returns a structured ReviewResult with fake codex
# - G4: no auto-merge string appears anywhere in the smoke transcript
set -euo pipefail
SMOKE_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SMOKE_DIR/../.." && pwd)"
TMP="$(mktemp -d)"
trap "rm -rf $TMP" EXIT

PY=python3
TRANSCRIPT="$TMP/transcript.log"
: > "$TRANSCRIPT"

# G1: selector
RESULT=$($PY "$PLUGIN_DIR/bin/workflow_select.py" preview --task "fix #1")
echo "$RESULT" >> "$TRANSCRIPT"
$PY - <<PY
import json
d = json.loads('''$RESULT''')
assert d["task_type"] == "bug-with-issue", d
for s in (2, 3, 5, 7, 11, 12):
    assert s in d["selected_steps"], (s, d)
print("OK G1: selector")
PY

# G2: state init + set-gate + resume
$PY "$PLUGIN_DIR/bin/workflow_state.py" init --repo "$TMP" --task-type feature \
  --selected "1,4,5,6,7,8,11,12" --title "smoke task" >> "$TRANSCRIPT"
$PY "$PLUGIN_DIR/bin/workflow_state.py" set-gate --repo "$TMP" \
  --after-step 5 --prompt "Plan reviewed; proceed?" \
  --options "proceed,revise,abort" >> "$TRANSCRIPT"
RESUME=$($PY "$PLUGIN_DIR/bin/workflow_state.py" resume --repo "$TMP")
echo "$RESUME" >> "$TRANSCRIPT"
$PY - <<PY
import json
d = json.loads('''$RESUME''')
assert d["pending_gate"]["after_step"] == 5
assert d["pending_gate"]["options"] == ["proceed", "revise", "abort"]
print("OK G2: state init + set-gate + resume")
PY

# G3: typed MCP tools via fake codex
$PY "$SMOKE_DIR/g3_typed_tools.py" "$TMP" "$PLUGIN_DIR" | tee -a "$TRANSCRIPT"

# G4: transcript must not contain auto-merge invocations
if grep -E 'gh[[:space:]]+pr[[:space:]]+merge|git[[:space:]]+merge[[:space:]]+' "$TRANSCRIPT"; then
    echo "FAIL G4: auto-merge string found in smoke transcript" >&2
    exit 1
fi
echo "OK G4: no auto-merge commands in smoke transcript"

echo "ALL SMOKE TESTS PASS"
