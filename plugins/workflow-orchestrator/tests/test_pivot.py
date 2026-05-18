"""P4 — mid-flight task pivot.

When a workflow run is in flight and the user changes their mind about
the task, `pivot` archives the in-progress state + artifacts and resets
the run for a new task while preserving the same `run_id`. The audit
trail lives in `state.pivot_log` and via `workflow_state.py history`.

State fields:
- `iteration: int` — 1 at init, incremented per pivot.
- `pivot_log: list[{at, from_title, to_title, reason, archived_state, archived_artifacts}]`.

Archives:
- previous state.json → `.workflow/state.history/<timestamp>-<run_id>.json`
- previous artifacts dir → `.workflow/artifacts.v<iteration>/`
"""

import json

import workflow_state


def _state_path(repo):
    return repo / ".workflow" / "state.json"


def _stdout(capsys) -> dict:
    return json.loads(capsys.readouterr().out)


def _init(tmp_path, **extra) -> str:
    """Helper: init a state.json and return run_id."""
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", extra.get("task_type", "feature"),
        "--selected", extra.get("selected", "1,4,5,6,7,8,11,12"),
        "--title", extra.get("title", "First task"),
    ])
    return json.loads(_state_path(tmp_path).read_text())["run_id"]


# ---------------------------------------------------------------------------
# init writes the new fields with the right defaults
# ---------------------------------------------------------------------------

def test_init_iteration_defaults_to_1(tmp_path):
    _init(tmp_path)
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["iteration"] == 1


def test_init_pivot_log_defaults_empty(tmp_path):
    _init(tmp_path)
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["pivot_log"] == []


# ---------------------------------------------------------------------------
# pivot subcommand
# ---------------------------------------------------------------------------

def test_pivot_preserves_run_id(tmp_path):
    original_run_id = _init(tmp_path)
    workflow_state.main([
        "pivot", "--repo", str(tmp_path),
        "--new-task", "Second task",
        "--new-selected", "1,4,5,6,7,11,12",
        "--reason", "scope expanded",
    ])
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["run_id"] == original_run_id


def test_pivot_increments_iteration(tmp_path):
    _init(tmp_path)
    workflow_state.main([
        "pivot", "--repo", str(tmp_path),
        "--new-task", "Second task", "--new-selected", "1,4,5",
        "--reason", "rescope",
    ])
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["iteration"] == 2
    # Pivot again → 3.
    workflow_state.main([
        "pivot", "--repo", str(tmp_path),
        "--new-task", "Third task", "--new-selected", "1",
        "--reason", "again",
    ])
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["iteration"] == 3


def test_pivot_resets_step_status_and_current_step(tmp_path):
    _init(tmp_path, selected="1,4,5,6,7,11,12")
    # Simulate mid-run: mark step 4 done, current_step at 5.
    workflow_state.main([
        "set", "--repo", str(tmp_path),
        "--field", "step_status.4.state", "--value", '"done"',
    ])
    workflow_state.main([
        "advance", "--repo", str(tmp_path), "--to-step", "5",
    ])

    workflow_state.main([
        "pivot", "--repo", str(tmp_path),
        "--new-task", "Different work",
        "--new-selected", "1,4,5,6,7",
        "--reason", "task changed",
    ])
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["current_step"] is None
    assert data["pending_gate"] is None
    assert data["selected_steps"] == [1, 4, 5, 6, 7]
    # Step status is freshly empty (all pending) for the new selection.
    assert all(s["state"] == "pending" for s in data["step_status"].values())
    assert set(data["step_status"].keys()) == {"1", "4", "5", "6", "7"}


def test_pivot_resets_partial_commits_and_review_rounds(tmp_path):
    """The pivot starts a fresh sub-run; stale audit data shouldn't carry over."""
    _init(tmp_path)
    workflow_state.main([
        "record-partial-commit", "--repo", str(tmp_path),
        "--files", "x.py", "--reason", "early commit",
    ])
    workflow_state.main([
        "bump-review", "--repo", str(tmp_path),
        "--skill", "codex_review_plan",
    ])
    workflow_state.main([
        "pivot", "--repo", str(tmp_path),
        "--new-task", "New task", "--new-selected", "1",
        "--reason", "pivot",
    ])
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["partial_commits"] == []
    assert data["review_rounds"] == {}


def test_pivot_appends_pivot_log_entry(tmp_path, capsys):
    _init(tmp_path, title="First task")
    capsys.readouterr()
    workflow_state.main([
        "pivot", "--repo", str(tmp_path),
        "--new-task", "Second task",
        "--new-selected", "1,4,5",
        "--reason", "user changed direction after step 4",
    ])
    capsys.readouterr()
    data = json.loads(_state_path(tmp_path).read_text())
    assert len(data["pivot_log"]) == 1
    entry = data["pivot_log"][0]
    assert entry["from_title"] == "First task"
    assert entry["to_title"] == "Second task"
    assert entry["reason"] == "user changed direction after step 4"
    assert "at" in entry
    assert "archived_state" in entry
    assert "archived_artifacts" in entry


def test_pivot_archives_prior_state_file(tmp_path):
    _init(tmp_path, title="First task")
    workflow_state.main([
        "pivot", "--repo", str(tmp_path),
        "--new-task", "Second task", "--new-selected", "1",
        "--reason", "rescope",
    ])
    history_dir = tmp_path / ".workflow" / "state.history"
    assert history_dir.is_dir()
    archives = list(history_dir.glob("*.json"))
    assert len(archives) == 1
    archived = json.loads(archives[0].read_text())
    assert archived["task"]["title"] == "First task"


def test_pivot_archives_prior_artifacts_dir(tmp_path):
    _init(tmp_path)
    # Drop a couple of fake artifacts to verify they survive archival.
    artifacts = tmp_path / ".workflow" / "artifacts"
    artifacts.mkdir(parents=True, exist_ok=True)
    (artifacts / "01-task-clarification.md").write_text("# original task spec")
    (artifacts / "04-plan.md").write_text("# original plan")

    workflow_state.main([
        "pivot", "--repo", str(tmp_path),
        "--new-task", "New task", "--new-selected", "1",
        "--reason", "pivot",
    ])
    # The pre-pivot artifacts are archived under .v1 (current iteration was 1).
    archived = tmp_path / ".workflow" / "artifacts.v1"
    assert archived.is_dir()
    assert (archived / "01-task-clarification.md").is_file()
    assert (archived / "04-plan.md").is_file()
    # The live artifacts/ dir starts empty (or doesn't exist) for the new sub-run.
    live = tmp_path / ".workflow" / "artifacts"
    if live.exists():
        assert list(live.iterdir()) == []


def test_pivot_can_change_task_type(tmp_path):
    _init(tmp_path)
    workflow_state.main([
        "pivot", "--repo", str(tmp_path),
        "--new-task", "Fix a bug from issue #1",
        "--new-selected", "1,2,3,4,5,6,7,8,9,11,12,13,14",
        "--new-task-type", "bug-with-issue",
        "--reason", "actually it's a bug",
    ])
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["task"]["type"] == "bug-with-issue"
    assert data["task"]["title"] == "Fix a bug from issue #1"


# ---------------------------------------------------------------------------
# history subcommand
# ---------------------------------------------------------------------------

def test_history_returns_empty_list_initially(tmp_path, capsys):
    _init(tmp_path)
    capsys.readouterr()
    rc = workflow_state.main(["history", "--repo", str(tmp_path)])
    assert rc == 0
    assert _stdout(capsys) == []


def test_history_returns_pivot_entries_in_order(tmp_path, capsys):
    _init(tmp_path, title="A")
    workflow_state.main([
        "pivot", "--repo", str(tmp_path),
        "--new-task", "B", "--new-selected", "1", "--reason", "first pivot",
    ])
    workflow_state.main([
        "pivot", "--repo", str(tmp_path),
        "--new-task", "C", "--new-selected", "1", "--reason", "second pivot",
    ])
    capsys.readouterr()

    workflow_state.main(["history", "--repo", str(tmp_path)])
    log = _stdout(capsys)
    assert len(log) == 2
    assert log[0]["from_title"] == "A"
    assert log[0]["to_title"] == "B"
    assert log[1]["from_title"] == "B"
    assert log[1]["to_title"] == "C"
