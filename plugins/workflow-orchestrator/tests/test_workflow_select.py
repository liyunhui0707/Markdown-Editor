import json

import pytest

import workflow_select


def _run(args, capsys):
    rc = workflow_select.main(args)
    out = capsys.readouterr().out
    return rc, json.loads(out)


def test_bug_with_issue_includes_2_and_3(capsys):
    rc, data = _run(["preview", "--task", "fix bug from issue #42"], capsys)
    assert rc == 0
    assert data["task_type"] == "bug-with-issue"
    assert 2 in data["selected_steps"]
    assert 3 in data["selected_steps"]


def test_freeform_excludes_2_and_3(capsys):
    rc, data = _run(["preview", "--task", "explore the codebase a bit"], capsys)
    assert rc == 0
    assert data["task_type"] == "freeform"
    assert 2 not in data["selected_steps"]
    assert 3 not in data["selected_steps"]


def test_explicit_issue_flag_overrides_text(capsys):
    rc, data = _run([
        "preview", "--task", "anything", "--issue", "myorg/myrepo#7",
    ], capsys)
    assert data["task_type"] == "bug-with-issue"


def test_skip_removes_steps(capsys):
    rc, data = _run([
        "preview", "--task", "add a feature for users",
        "--skip", "9,10",
    ], capsys)
    assert data["task_type"] == "feature"
    assert 9 not in data["selected_steps"]
    assert 10 not in data["selected_steps"]


def test_force_adds_step(capsys):
    rc, data = _run([
        "preview", "--task", "explore", "--force", "3",
    ], capsys)
    # freeform normally excludes 3; --force re-adds it.
    assert 3 in data["selected_steps"]


def test_from_and_to_window(capsys):
    rc, data = _run([
        "preview", "--task", "add a feature",
        "--from", "4", "--to", "8",
    ], capsys)
    assert min(data["selected_steps"]) >= 4
    assert max(data["selected_steps"]) <= 8


def test_single_step(capsys):
    rc, data = _run(["preview", "--task", "x", "--step", "7"], capsys)
    assert data["selected_steps"] == [7]


def test_skip_mandatory_gate_emits_warning(capsys):
    rc, data = _run([
        "preview", "--task", "add a feature", "--skip", "5,7",
    ], capsys)
    assert rc == 0
    warnings = data["warnings"]
    assert any("5" in w for w in warnings), warnings
    assert any("7" in w for w in warnings), warnings
    # Default profile (no --skip) has no mandatory-gate warnings.
    _, clean = _run(["preview", "--task", "add a feature"], capsys)
    assert clean["warnings"] == []


@pytest.mark.parametrize("task,task_type", [
    ("fix bug #1", "bug-with-issue"),
    ("crash on save", "bug"),
    ("add feature for users", "feature"),
    ("refactor the parser", "refactor"),
    ("just explore", "freeform"),
])
def test_invariant_gate_steps_present(capsys, task, task_type):
    """Gates after 5/7/11 and before 12 must always be present in default profile."""
    rc, data = _run(["preview", "--task", task], capsys)
    assert data["task_type"] == task_type
    for step in (5, 7, 11, 12):
        assert step in data["selected_steps"], (
            f"task_type={task_type}: step {step} missing from default profile"
        )
