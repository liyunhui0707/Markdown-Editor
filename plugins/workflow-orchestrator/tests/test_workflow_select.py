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


def test_size_trivial_minimal_step_set(capsys):
    """trivial size: just write → diff-review → readiness → push."""
    rc, data = _run(["preview", "--task", "rename a constant", "--size", "trivial"], capsys)
    assert rc == 0
    assert data["size"] == "trivial"
    assert data["selected_steps"] == [6, 7, 11, 12]


def test_size_small(capsys):
    rc, data = _run(["preview", "--task", "tighten one helper", "--size", "small"], capsys)
    assert rc == 0
    assert data["size"] == "small"
    assert data["selected_steps"] == [1, 6, 7, 8, 11, 12]


def test_size_medium(capsys):
    rc, data = _run(["preview", "--task", "add a focused feature", "--size", "medium"], capsys)
    assert rc == 0
    assert data["size"] == "medium"
    assert data["selected_steps"] == [1, 4, 5, 6, 7, 8, 11, 12, 14]


def test_size_large_falls_through_to_task_type(capsys):
    """large: behave exactly as if --size were omitted."""
    rc_with, data_with = _run(["preview", "--task", "add feature for users", "--size", "large"], capsys)
    rc_no, data_no = _run(["preview", "--task", "add feature for users"], capsys)
    assert rc_with == 0 and rc_no == 0
    assert data_with["selected_steps"] == data_no["selected_steps"]
    assert data_with["size"] == "large"
    assert data_no["size"] is None


def test_size_preserves_step_11_in_every_preset(capsys):
    """Step 11 (commit readiness) must survive every size preset (Codex correction)."""
    for size in ("trivial", "small", "medium", "large"):
        _, data = _run(["preview", "--task", "x", "--size", size], capsys)
        assert 11 in data["selected_steps"], (
            f"size={size}: step 11 (commit-readiness) must always survive"
        )


def test_size_overrides_task_type_step_count(capsys):
    """A 'feature' task with --size trivial gets the trivial set, not the feature set."""
    _, feature_default = _run(["preview", "--task", "add a new feature"], capsys)
    _, feature_trivial = _run(["preview", "--task", "add a new feature", "--size", "trivial"], capsys)
    assert len(feature_trivial["selected_steps"]) < len(feature_default["selected_steps"])
    assert feature_trivial["selected_steps"] == [6, 7, 11, 12]


def test_size_skip_and_force_still_work(capsys):
    """--skip / --force compose with --size."""
    _, data = _run([
        "preview", "--task", "x", "--size", "medium",
        "--skip", "14", "--force", "9",
    ], capsys)
    assert 14 not in data["selected_steps"]
    assert 9 in data["selected_steps"]


def test_size_trivial_warns_about_skipped_plan_gate(capsys):
    """trivial drops step 5 (plan review) by design; the workflow should surface that."""
    _, data = _run(["preview", "--task", "x", "--size", "trivial"], capsys)
    # Step 5 is in MANDATORY_GATE_STEPS; trivial omits it intentionally.
    assert any("5" in w for w in data["warnings"]), data["warnings"]
