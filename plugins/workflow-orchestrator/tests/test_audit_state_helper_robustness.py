"""Audit probes T1 and T2 — robustness of the workflow_state helper.

T1: non-canonical-gate clear/parse via Python-level imports.
T2: dotted-set into a list intermediate must exit non-zero, must NOT emit
    a Python Traceback, and must NOT mutate state.json.

T3 is intentionally NOT exercised here — the existing
``test_lock_persists_across_subprocess_invocations`` in
``tests/test_workflow_state.py`` already pins the lock-survival contract.
AUDIT.md F-T3 cites that test path directly.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

import workflow_state


def _state_path(repo: Path) -> Path:
    return repo / ".workflow" / "state.json"


# ---------------------------------------------------------------------------
# T1 — Non-canonical gate clear/parse
# ---------------------------------------------------------------------------

def test_clear_gate_handles_noncanonical_after_step(tmp_path, capsys):
    """Single contract: gate set with an ad-hoc --after-step + explicit
    --options is parseable, clearable, and re-settable.

    Four sub-assertions (per plan §T1):
      1. After set-gate --after-step 99 --options "x,y,z",
         get pending_gate.options prints ["x","y","z"] and exits 0.
      2. clear-gate exits 0 and leaves pending_gate == null.
      3. set-gate --after-step 99 --options "a,b" exits 0.
      4. get pending_gate.options prints ["a","b"].
    """
    rc = workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "feature",
        "--selected", "1,4,5",
    ])
    assert rc == 0

    # (1) set + read non-canonical gate
    rc = workflow_state.main([
        "set-gate", "--repo", str(tmp_path),
        "--after-step", "99",
        "--prompt", "ad-hoc gate after a revise round",
        "--options", "x,y,z",
    ])
    assert rc == 0
    capsys.readouterr()
    rc = workflow_state.main([
        "get", "--repo", str(tmp_path),
        "--field", "pending_gate.options",
    ])
    out = capsys.readouterr().out
    assert rc == 0
    assert json.loads(out) == ["x", "y", "z"]

    # (2) clear-gate then verify
    rc = workflow_state.main([
        "clear-gate", "--repo", str(tmp_path),
    ])
    assert rc == 0
    data = json.loads(_state_path(tmp_path).read_text(encoding="utf-8"))
    assert data["pending_gate"] is None

    # (3) re-set with a different option set
    rc = workflow_state.main([
        "set-gate", "--repo", str(tmp_path),
        "--after-step", "99",
        "--prompt", "second ad-hoc gate",
        "--options", "a,b",
    ])
    assert rc == 0

    # (4) read back
    capsys.readouterr()
    rc = workflow_state.main([
        "get", "--repo", str(tmp_path),
        "--field", "pending_gate.options",
    ])
    out = capsys.readouterr().out
    assert rc == 0
    assert json.loads(out) == ["a", "b"]


# ---------------------------------------------------------------------------
# T2 — Dotted-set into a list intermediate
#
# Split per step-7 review: two assertions, both unmarked after step-8 fix.
# (a) Stable invariants: rc != 0 AND state.json byte-for-byte unchanged.
# (b) No-traceback invariant: stderr contains no Python "Traceback".
# Pre-fix, (b) was xfailed because cmd_set let a raw TypeError leak. The
# step-8 fix added an intermediate type-check and a clean error message,
# at which point the xfail mark was removed (xfail-strict caught the fix).
# ---------------------------------------------------------------------------

def _run_set_into_list_intermediate(tmp_path, plugin_root):
    rc = workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "feature",
        "--selected", "1,4,5",
    ])
    assert rc == 0
    state_path = _state_path(tmp_path)
    before = state_path.read_bytes()

    script = plugin_root / "bin" / "workflow_state.py"
    result = subprocess.run(
        [
            sys.executable, str(script),
            "set", "--repo", str(tmp_path),
            "--field", "selected_steps.0",
            "--value", '"x"',
        ],
        capture_output=True, text=True,
    )
    after = state_path.read_bytes()
    return result, before, after


def test_set_into_list_intermediate_exit_code_and_immutability(tmp_path, plugin_root):
    """Stable invariants of T2 — these MUST pass regardless of the Traceback
    leak (which is tracked separately below).

      (a) command exits non-zero
      (b) state.json is byte-for-byte unchanged
    """
    result, before, after = _run_set_into_list_intermediate(tmp_path, plugin_root)
    assert result.returncode != 0, (
        f"dotted-set into a list intermediate must exit non-zero; "
        f"got rc={result.returncode}"
    )
    assert before == after, (
        "dotted-set into a list intermediate must NOT mutate state.json"
    )


def test_set_into_list_intermediate_no_traceback_in_stderr(tmp_path, plugin_root):
    """No-traceback invariant of T2 (regression probe, post-fix).

    `cmd_set` must emit a user-facing error message on a non-dict
    intermediate; it must NOT let a raw Python `TypeError` from
    `dict.setdefault` propagate to stderr.
    """
    result, _, _ = _run_set_into_list_intermediate(tmp_path, plugin_root)
    assert "Traceback" not in result.stderr, (
        "dotted-set into a list intermediate must produce a clean error "
        f"message, not a Python traceback. stderr:\n{result.stderr}"
    )
