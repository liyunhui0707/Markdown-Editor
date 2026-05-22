"""Selector tests for --stage, --scan-first, --retro, --auto-merge.

Split from test_workflow_select.py to keep both files under the plugin's
280-line per-file limit (see tests/test_file_size_guard.py).
"""

import json

import pytest

import workflow_select


def _run(args, capsys):
    rc = workflow_select.main(args)
    out = capsys.readouterr().out
    return rc, json.loads(out)


# ---------------------------------------------------------------------------
# Stage presets (--stage plan|implement|qa|ship|retro)
#
# Stage presets are FIXED step sets, not derived from task type. They REPLACE
# the base set (like --size does), then --skip/--force compose on top.
# Precedence: --step > --stage > --size > task-type default.
# ---------------------------------------------------------------------------

def test_stage_plan_preset_is_fixed(capsys):
    """--stage plan returns [1, 4, 5] regardless of task type."""
    _, data = _run(["preview", "--task", "add a feature", "--stage", "plan"], capsys)
    assert data["selected_steps"] == [1, 4, 5]
    assert data["stage"] == "plan"


def test_stage_implement_preset(capsys):
    """--stage implement returns [6, 7, 8]."""
    _, data = _run(["preview", "--task", "x", "--stage", "implement"], capsys)
    assert data["selected_steps"] == [6, 7, 8]
    assert data["stage"] == "implement"


def test_stage_qa_preset_includes_steps_normally_excluded(capsys):
    """--stage qa returns [9, 10] even for refactor where 9/10 are not in default."""
    _, data = _run(["preview", "--task", "refactor the parser", "--stage", "qa"], capsys)
    assert data["selected_steps"] == [9, 10]


def test_stage_ship_preset(capsys):
    """--stage ship returns [11, 12, 13]."""
    _, data = _run(["preview", "--task", "x", "--stage", "ship"], capsys)
    assert data["selected_steps"] == [11, 12, 13]


def test_stage_retro_preset_is_14_and_16(capsys):
    """--stage retro returns [14, 16], NOT [14, 15, 16]. Step 15 is side-channel only."""
    _, data = _run(["preview", "--task", "x", "--stage", "retro"], capsys)
    assert data["selected_steps"] == [14, 16]


def test_stage_overrides_size(capsys):
    """--stage wins over --size when both are passed."""
    _, data = _run([
        "preview", "--task", "add feature", "--stage", "plan", "--size", "medium",
    ], capsys)
    assert data["selected_steps"] == [1, 4, 5]


def test_stage_overrides_task_type_default(capsys):
    """--stage replaces the task-type-derived set entirely."""
    _, data = _run([
        "preview", "--task", "add a feature for users", "--stage", "implement",
    ], capsys)
    assert data["selected_steps"] == [6, 7, 8]


def test_step_overrides_stage(capsys):
    """--step is highest precedence; --stage is ignored when --step is given."""
    _, data = _run([
        "preview", "--task", "x", "--stage", "plan", "--step", "7",
    ], capsys)
    assert data["selected_steps"] == [7]


def test_stage_with_skip(capsys):
    """--skip composes on top of stage."""
    _, data = _run([
        "preview", "--task", "x", "--stage", "qa", "--skip", "9",
    ], capsys)
    assert data["selected_steps"] == [10]


def test_stage_with_force(capsys):
    """--force composes on top of stage."""
    _, data = _run([
        "preview", "--task", "x", "--stage", "qa", "--force", "11",
    ], capsys)
    assert data["selected_steps"] == [9, 10, 11]


def test_stage_plan_with_issue_includes_2_and_3(capsys):
    """--stage plan with --issue injects steps 2 and 3 → [1, 2, 3, 4, 5]."""
    _, data = _run([
        "preview", "--task", "investigate", "--stage", "plan",
        "--issue", "myorg/myrepo#42",
    ], capsys)
    assert data["selected_steps"] == [1, 2, 3, 4, 5]


def test_stage_implement_with_issue_unaffected(capsys):
    """--issue only injects 2/3 into the plan stage; other stages stay fixed."""
    _, data = _run([
        "preview", "--task", "x", "--stage", "implement",
        "--issue", "myorg/myrepo#42",
    ], capsys)
    assert data["selected_steps"] == [6, 7, 8]


# ---------------------------------------------------------------------------
# --scan-first → prepend step 0 (existing-system-bug-risk-scan)
#
# Rule: --scan-first adds step 0 only when step 1 is in the selected set
# (i.e., the run starts from clarification). On stages/sizes that begin
# mid-pipeline (implement/qa/ship/retro, size=trivial), --scan-first is
# a no-op — adding step 0 to a mid-pipeline run is meaningless.
# ---------------------------------------------------------------------------

def test_scan_first_prepends_step_0_on_default_profile(capsys):
    _, data = _run([
        "preview", "--task", "add a feature for users", "--scan-first",
    ], capsys)
    assert data["selected_steps"][0] == 0
    assert 1 in data["selected_steps"]


def test_scan_first_with_stage_plan(capsys):
    """--scan-first on plan stage gives [0, 1, 4, 5]."""
    _, data = _run([
        "preview", "--task", "x", "--stage", "plan", "--scan-first",
    ], capsys)
    assert data["selected_steps"] == [0, 1, 4, 5]


def test_scan_first_noop_on_implement_stage(capsys):
    """--scan-first is a no-op on stages that don't include step 1."""
    _, data = _run([
        "preview", "--task", "x", "--stage", "implement", "--scan-first",
    ], capsys)
    assert 0 not in data["selected_steps"]
    assert data["selected_steps"] == [6, 7, 8]


def test_scan_first_noop_on_size_trivial(capsys):
    """--scan-first is a no-op on size=trivial (which starts at step 6)."""
    _, data = _run([
        "preview", "--task", "x", "--size", "trivial", "--scan-first",
    ], capsys)
    assert 0 not in data["selected_steps"]


def test_scan_first_with_size_small_adds_step_0(capsys):
    """size=small includes step 1; --scan-first prepends 0."""
    _, data = _run([
        "preview", "--task", "x", "--size", "small", "--scan-first",
    ], capsys)
    assert data["selected_steps"] == [0, 1, 6, 7, 8, 11, 12]


def test_scan_first_with_stage_plan_and_issue(capsys):
    """--scan-first + --stage plan + --issue → [0, 1, 2, 3, 4, 5]."""
    _, data = _run([
        "preview", "--task", "investigate", "--stage", "plan",
        "--scan-first", "--issue", "myorg/myrepo#42",
    ], capsys)
    assert data["selected_steps"] == [0, 1, 2, 3, 4, 5]


# ---------------------------------------------------------------------------
# --retro → ensure step 14 (continuity) + step 16 (retrospective) are present
#
# Rule: --retro idempotently adds 14 and 16 to whatever set is selected.
# On default profiles 14 is already in; --retro only adds 16.
# On size=trivial/small (no 14), --retro adds BOTH 14 and 16.
# ---------------------------------------------------------------------------

def test_retro_on_default_adds_step_16(capsys):
    _, data = _run([
        "preview", "--task", "add a feature for users", "--retro",
    ], capsys)
    assert 16 in data["selected_steps"]
    assert 14 in data["selected_steps"]


def test_retro_on_size_trivial_adds_both_14_and_16(capsys):
    """Codex correction: trivial lacks 14; --retro must add both 14 and 16."""
    _, data = _run([
        "preview", "--task", "x", "--size", "trivial", "--retro",
    ], capsys)
    assert 14 in data["selected_steps"]
    assert 16 in data["selected_steps"]
    assert data["selected_steps"] == [6, 7, 11, 12, 14, 16]


def test_retro_on_size_small_adds_both_14_and_16(capsys):
    _, data = _run([
        "preview", "--task", "x", "--size", "small", "--retro",
    ], capsys)
    assert 14 in data["selected_steps"]
    assert 16 in data["selected_steps"]
    assert data["selected_steps"] == [1, 6, 7, 8, 11, 12, 14, 16]


def test_retro_on_stage_retro_is_noop(capsys):
    """--stage retro is already [14, 16]; --retro is a no-op."""
    _, data = _run([
        "preview", "--task", "x", "--stage", "retro", "--retro",
    ], capsys)
    assert data["selected_steps"] == [14, 16]


def test_retro_idempotent_when_14_already_in(capsys):
    """If 14 is already present (default feature profile), --retro adds only 16."""
    _, default = _run(["preview", "--task", "add feature for users"], capsys)
    assert 14 in default["selected_steps"]
    _, with_retro = _run([
        "preview", "--task", "add feature for users", "--retro",
    ], capsys)
    assert with_retro["selected_steps"].count(14) == 1
    assert 16 in with_retro["selected_steps"]


# ---------------------------------------------------------------------------
# --auto-merge → opt-in flag surfaced in preview JSON for the orchestrator
# to thread into state. The selector itself does not change step selection;
# it just reports the flag.
# ---------------------------------------------------------------------------

def test_auto_merge_default_false(capsys):
    _, data = _run(["preview", "--task", "x"], capsys)
    assert data["auto_merge"] is False


def test_auto_merge_flag_sets_true(capsys):
    _, data = _run(["preview", "--task", "x", "--auto-merge"], capsys)
    assert data["auto_merge"] is True


def test_auto_merge_does_not_change_step_selection(capsys):
    """--auto-merge is a state hint, not a step-set modifier."""
    _, base = _run(["preview", "--task", "add feature"], capsys)
    _, am = _run(["preview", "--task", "add feature", "--auto-merge"], capsys)
    assert am["selected_steps"] == base["selected_steps"]
