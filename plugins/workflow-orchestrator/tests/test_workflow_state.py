import json
import os
import subprocess

import pytest

import workflow_state


def _state_path(repo):
    return repo / ".workflow" / "state.json"


def test_init_creates_state(tmp_path):
    rc = workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "feature",
        "--selected", "1,4,5,6,7,8,11,12",
        "--title", "Sample task",
    ])
    assert rc == 0
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["schema_version"] == 1
    assert data["task"]["type"] == "feature"
    assert data["selected_steps"] == [1, 4, 5, 6, 7, 8, 11, 12]
    assert data["current_step"] is None
    assert data["pending_gate"] is None
    # P3: codex_run_context defaults to null when --run-context is omitted.
    assert data["codex_run_context"] is None


def test_init_with_run_context_persists(tmp_path):
    """P3: --run-context "..." writes the string to state.codex_run_context."""
    ctx = (
        "Markdown renderer is intentionally a minimal subset, not CommonMark-strict. "
        "Input comes only from tools/import-claude.js and tools/import-codex.js."
    )
    rc = workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "feature",
        "--selected", "1,4,5",
        "--run-context", ctx,
    ])
    assert rc == 0
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["codex_run_context"] == ctx


def test_set_run_context_field(tmp_path):
    """P3: codex_run_context is settable via the generic `set` subcommand too."""
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "bug", "--selected", "1,4,5",
    ])
    rc = workflow_state.main([
        "set", "--repo", str(tmp_path),
        "--field", "codex_run_context",
        "--value", '"controlled input only; defensive checks out of scope"',
    ])
    assert rc == 0
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["codex_run_context"] == "controlled input only; defensive checks out of scope"


def test_set_field_atomically_replaces(tmp_path):
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "bug",
        "--selected", "1,4,5,6,7,8,11,12",
    ])
    rc = workflow_state.main([
        "set", "--repo", str(tmp_path),
        "--field", "current_step",
        "--value", "5",
    ])
    assert rc == 0
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["current_step"] == 5
    # No stale .tmp left behind.
    tmp_left = list((tmp_path / ".workflow").glob("*.tmp"))
    assert not tmp_left, f"stale tmp files: {tmp_left}"


def test_stale_tmp_does_not_corrupt(tmp_path):
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "bug",
        "--selected", "1,4,5",
    ])
    # Simulate a crashed prior write: place a garbage .tmp file.
    (tmp_path / ".workflow" / "state.json.tmp").write_text("{ not json")
    workflow_state.main([
        "set", "--repo", str(tmp_path),
        "--field", "current_step", "--value", "1",
    ])
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["current_step"] == 1


def test_lock_refuses_concurrent(tmp_path):
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "bug", "--selected", "1",
    ])
    rc1 = workflow_state.main(["acquire-lock", "--repo", str(tmp_path)])
    assert rc1 == 0
    rc2 = workflow_state.main(["acquire-lock", "--repo", str(tmp_path)])
    assert rc2 != 0, "second acquire-lock should fail while the first holds"
    workflow_state.main(["release-lock", "--repo", str(tmp_path)])


def test_lock_force_overrides_existing(tmp_path):
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "bug", "--selected", "1",
    ])
    rc1 = workflow_state.main(["acquire-lock", "--repo", str(tmp_path)])
    assert rc1 == 0
    rc2 = workflow_state.main(["acquire-lock", "--repo", str(tmp_path), "--force"])
    assert rc2 == 0, "--force should override an existing lock"
    workflow_state.main(["release-lock", "--repo", str(tmp_path)])


def test_lock_persists_across_subprocess_invocations(tmp_path, plugin_root):
    """Two real subprocess calls — second must NOT auto-reclaim the lock."""
    script = plugin_root / "bin" / "workflow_state.py"
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "bug", "--selected", "1",
    ])
    r1 = subprocess.run(
        ["python3", str(script), "acquire-lock", "--repo", str(tmp_path)],
        capture_output=True, text=True,
    )
    assert r1.returncode == 0, r1.stderr
    # A second helper subprocess — its parent is dead, but the lock must survive.
    r2 = subprocess.run(
        ["python3", str(script), "acquire-lock", "--repo", str(tmp_path)],
        capture_output=True, text=True,
    )
    assert r2.returncode != 0, (
        "second subprocess acquire-lock must refuse without --force; "
        f"got rc={r2.returncode} stderr={r2.stderr!r}"
    )
    # With --force, the second invocation should succeed.
    r3 = subprocess.run(
        ["python3", str(script), "acquire-lock", "--repo", str(tmp_path), "--force"],
        capture_output=True, text=True,
    )
    assert r3.returncode == 0, r3.stderr


def test_resume_with_no_state_returns_structured_output(tmp_path, capsys):
    capsys.readouterr()
    rc = workflow_state.main(["resume", "--repo", str(tmp_path)])
    out = capsys.readouterr().out
    assert rc == 0
    data = json.loads(out)
    assert data["no_state"] is True
    assert data["current_step"] is None
    assert data["pending_gate"] is None


def test_resume_returns_pending_gate(tmp_path, capsys):
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "feature", "--selected", "1,4,5",
    ])
    workflow_state.main([
        "set-gate", "--repo", str(tmp_path),
        "--after-step", "5",
        "--prompt", "Plan reviewed; proceed?",
        "--options", "proceed,revise,abort",
    ])
    capsys.readouterr()  # clear any prior output
    rc = workflow_state.main(["resume", "--repo", str(tmp_path)])
    out = capsys.readouterr().out
    assert rc == 0
    data = json.loads(out)
    assert data["pending_gate"]["after_step"] == 5
    assert data["pending_gate"]["options"] == ["proceed", "revise", "abort"]


@pytest.mark.parametrize("after_step,expected", [
    (5, ["proceed", "revise", "abort"]),
    (7, ["apply-fixes", "accept-as-is", "abort"]),
    (11, ["commit", "fix-more", "partial-commit-and-continue", "abort"]),
    (12, ["push", "cancel"]),
])
def test_gate_options_per_gate_when_unspecified(tmp_path, after_step, expected):
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "feature", "--selected", "1,4,5,6,7,8,11,12",
    ])
    rc = workflow_state.main([
        "set-gate", "--repo", str(tmp_path),
        "--after-step", str(after_step),
        "--prompt", "test prompt",
    ])
    assert rc == 0
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["pending_gate"]["options"] == expected


def test_gate_options_unknown_step_requires_explicit_options(tmp_path):
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "bug", "--selected", "1,2",
    ])
    rc = workflow_state.main([
        "set-gate", "--repo", str(tmp_path),
        "--after-step", "2",
        "--prompt", "x",
    ])
    assert rc == 2, "unknown gate step must require explicit --options"


def test_clear_gate(tmp_path):
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "bug", "--selected", "1",
    ])
    workflow_state.main([
        "set-gate", "--repo", str(tmp_path),
        "--after-step", "5", "--prompt", "ok?", "--options", "y,n",
    ])
    workflow_state.main(["clear-gate", "--repo", str(tmp_path)])
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["pending_gate"] is None


def test_cli_via_subprocess(tmp_path, plugin_root):
    """Sanity check: the script is also runnable as a subprocess."""
    script = plugin_root / "bin" / "workflow_state.py"
    result = subprocess.run(
        ["python", str(script), "init",
         "--repo", str(tmp_path),
         "--task-type", "bug",
         "--selected", "1"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    assert _state_path(tmp_path).is_file()


