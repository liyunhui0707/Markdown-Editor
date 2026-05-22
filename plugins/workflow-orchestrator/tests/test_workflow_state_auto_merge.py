"""State tests for the auto_merge opt-in field.

Split from test_workflow_state.py to stay under the plugin's 280-line cap.

The orchestrator sets state.auto_merge = true via the generic `set`
subcommand after init, when the user passed --auto-merge at workflow
invocation. The state helper does not gain a dedicated --auto-merge
flag (which would inflate workflow_state.py past the 280-line cap).
Readers must default to False via .get() for schema-1 compatibility.
"""

import json

import workflow_state


def _state_path(repo):
    return repo / ".workflow" / "state.json"


def test_init_sets_auto_merge_false_by_default(tmp_path):
    """New init writes auto_merge: false to state."""
    rc = workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "feature", "--selected", "1,4,5",
    ])
    assert rc == 0
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["auto_merge"] is False


def test_auto_merge_settable_via_set_field(tmp_path):
    """The orchestrator opts into auto-merge by setting state.auto_merge=true."""
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "feature", "--selected", "1,4,5",
    ])
    rc = workflow_state.main([
        "set", "--repo", str(tmp_path),
        "--field", "auto_merge", "--value", "true",
    ])
    assert rc == 0
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["auto_merge"] is True


def test_legacy_state_without_auto_merge_field_still_readable(tmp_path):
    """Schema-1 backward compat: pre-existing state.json files without an
    auto_merge field must still resume cleanly. Readers default to False
    via .get()."""
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "feature", "--selected", "1,4,5",
    ])
    sf = _state_path(tmp_path)
    state = json.loads(sf.read_text())
    del state["auto_merge"]
    sf.write_text(json.dumps(state))
    rc = workflow_state.main(["resume", "--repo", str(tmp_path)])
    assert rc == 0
    data = json.loads(sf.read_text())
    assert data.get("auto_merge", False) is False
