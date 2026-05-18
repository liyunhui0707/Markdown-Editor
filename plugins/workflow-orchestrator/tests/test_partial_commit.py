"""P5 — partial-commit affordance.

When part of the working tree is Codex-approved and part isn't, the user
should be able to commit the approved subset and continue iterating on
the rest. The state helper just RECORDS the partial commit for audit;
the orchestrator skill drives the actual `git add` + `git commit` via
Bash so the user can review the diff first.

State carries `state.partial_commits: list[{at, files, reason}]` and a
new `record-partial-commit --files CSV --reason "..."` subcommand
appends to it. The new option at gate-11 is
`partial-commit-and-continue` (canonical via `GATE_OPTIONS[11]`).
"""

import json

import pytest

import workflow_state


def _state_path(repo):
    return repo / ".workflow" / "state.json"


def _stdout(capsys) -> dict:
    return json.loads(capsys.readouterr().out)


# ---------------------------------------------------------------------------
# init writes the new field with the right default
# ---------------------------------------------------------------------------

def test_init_partial_commits_defaults_empty(tmp_path):
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "bug", "--selected", "1,4,5",
    ])
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["partial_commits"] == []


# ---------------------------------------------------------------------------
# record-partial-commit
# ---------------------------------------------------------------------------

def test_record_partial_commit_appends_entry(tmp_path, capsys):
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "feature", "--selected", "1,4,5,6",
    ])
    capsys.readouterr()

    rc = workflow_state.main([
        "record-partial-commit", "--repo", str(tmp_path),
        "--files", "a.py,b.py",
        "--reason", "Codex-approved subset; remaining contested",
    ])
    assert rc == 0
    entry = _stdout(capsys)
    assert entry["files"] == ["a.py", "b.py"]
    assert entry["reason"] == "Codex-approved subset; remaining contested"
    assert "at" in entry  # timestamp present, format checked separately

    data = json.loads(_state_path(tmp_path).read_text())
    assert len(data["partial_commits"]) == 1
    assert data["partial_commits"][0]["files"] == ["a.py", "b.py"]


def test_record_partial_commit_multiple_appends_in_order(tmp_path):
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "feature", "--selected", "1,4,5,6",
    ])
    workflow_state.main([
        "record-partial-commit", "--repo", str(tmp_path),
        "--files", "x.py", "--reason", "first",
    ])
    workflow_state.main([
        "record-partial-commit", "--repo", str(tmp_path),
        "--files", "y.py,z.py", "--reason", "second",
    ])
    data = json.loads(_state_path(tmp_path).read_text())
    assert len(data["partial_commits"]) == 2
    assert data["partial_commits"][0]["reason"] == "first"
    assert data["partial_commits"][1]["reason"] == "second"
    assert data["partial_commits"][1]["files"] == ["y.py", "z.py"]


def test_record_partial_commit_trims_whitespace_in_files(tmp_path):
    """`--files 'a.py , b.py'` should land as ['a.py', 'b.py']."""
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "feature", "--selected", "1",
    ])
    workflow_state.main([
        "record-partial-commit", "--repo", str(tmp_path),
        "--files", "  a.py  ,  b.py  ", "--reason", "trim",
    ])
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["partial_commits"][0]["files"] == ["a.py", "b.py"]


def test_record_partial_commit_rejects_empty_files(tmp_path, capsys):
    """`--files ''` is meaningless; should exit non-zero with a clear error."""
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "feature", "--selected", "1",
    ])
    capsys.readouterr()
    rc = workflow_state.main([
        "record-partial-commit", "--repo", str(tmp_path),
        "--files", "", "--reason", "empty",
    ])
    assert rc != 0
    err = capsys.readouterr().err
    assert "--files" in err or "empty" in err.lower()


# ---------------------------------------------------------------------------
# GATE_OPTIONS[11] now includes partial-commit-and-continue
# ---------------------------------------------------------------------------

def test_gate_options_step_11_includes_partial_commit(tmp_path):
    """P5: the after-step-11 gate has a 4th canonical option."""
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "feature", "--selected", "1,4,5,6,7,8,11,12",
    ])
    rc = workflow_state.main([
        "set-gate", "--repo", str(tmp_path),
        "--after-step", "11",
        "--prompt", "Ready to commit?",
    ])
    assert rc == 0
    data = json.loads(_state_path(tmp_path).read_text())
    options = data["pending_gate"]["options"]
    assert options == ["commit", "fix-more", "partial-commit-and-continue", "abort"]
