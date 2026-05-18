"""P1.b/c — UI flag in state + canonical options for the manual-QA gate.

State carries a `ui: bool` field set at init from the selector's --ui flag.
When ui=true, the orchestrator fires a manual-QA gate after step 6 (before
step 7) with options `pass | fail | skip-and-document`. These options
become canonical via `GATE_OPTIONS[6]` so set-gate --after-step 6 fills
them in automatically — same pattern as the existing canonical gates.
"""

import json

import workflow_state


def _state_path(repo):
    return repo / ".workflow" / "state.json"


def test_init_defaults_ui_to_false(tmp_path):
    """P1.b: state.ui defaults to false when --ui isn't passed at init."""
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "bug", "--selected", "1,4,5",
    ])
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["ui"] is False


def test_init_ui_flag_persists_true(tmp_path):
    """P1.b: state.ui is true when --ui is passed at init."""
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "feature",
        "--selected", "1,4,5,6,7,8,9,10,11,12,13,14",
        "--ui",
    ])
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["ui"] is True


def test_set_gate_after_step_6_uses_manual_qa_options(tmp_path):
    """P1.c: GATE_OPTIONS[6] should be ['pass', 'fail', 'skip-and-document']."""
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "feature", "--selected", "1,4,5,6,7,8,9,10,11,12",
        "--ui",
    ])
    rc = workflow_state.main([
        "set-gate", "--repo", str(tmp_path),
        "--after-step", "6",
        "--prompt", "Manual QA: did the UI look right?",
    ])
    assert rc == 0
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["pending_gate"]["options"] == ["pass", "fail", "skip-and-document"]
