"""P4 — mid-flight task pivot.

When a workflow run is in flight and the user changes their mind, `pivot`
archives the in-progress state.json + .workflow/artifacts/ and resets the
run for a new task while preserving the same `run_id`. Audit trail lives
in `state.pivot_log` (and via the `history` subcommand).

Split out of `workflow_state.py` to keep that file under the 280-line
project rule.
"""

import json
import shutil
import sys
from pathlib import Path

from _state_lib import (
    atomic_write,
    empty_step_status,
    now,
    read_state,
    state_dir,
    state_file,
)


def _archive_state_file(repo: Path, state: dict) -> Path:
    """Copy current state.json into state.history/<timestamp>-<run_id>.json."""
    history = state_dir(repo) / "state.history"
    history.mkdir(parents=True, exist_ok=True)
    ts = state["updated_at"].replace(":", "").replace("-", "")
    dest = history / f"{ts}-{state['run_id']}.json"
    dest.write_text(json.dumps(state, indent=2), encoding="utf-8")
    return dest


def _archive_artifacts_dir(repo: Path, iteration: int) -> Path | None:
    """Move .workflow/artifacts/ → .workflow/artifacts.v<iteration>/."""
    live = state_dir(repo) / "artifacts"
    if not live.is_dir():
        return None
    archived = state_dir(repo) / f"artifacts.v{iteration}"
    shutil.move(str(live), str(archived))
    return archived


def cmd_pivot(args):
    """Archive current state + artifacts, reset for the new task."""
    repo = Path(args.repo)
    state = read_state(repo)
    prev_iteration = state.get("iteration", 1)

    archived_state = _archive_state_file(repo, state)
    archived_artifacts = _archive_artifacts_dir(repo, prev_iteration)

    new_steps = [int(s) for s in args.new_selected.split(",") if s.strip()]
    new_iteration = prev_iteration + 1

    pivot_entry = {
        "at": now(),
        "from_title": state.get("task", {}).get("title", ""),
        "to_title": args.new_task,
        "reason": args.reason,
        "archived_state": str(archived_state.relative_to(repo)),
        "archived_artifacts": (
            str(archived_artifacts.relative_to(repo))
            if archived_artifacts else None
        ),
    }

    state["task"]["title"] = args.new_task
    if args.new_task_type:
        state["task"]["type"] = args.new_task_type
    state["selected_steps"] = new_steps
    state["step_status"] = empty_step_status(new_steps)
    state["current_step"] = None
    state["pending_gate"] = None
    state["partial_commits"] = []
    state["review_rounds"] = {}
    state["iteration"] = new_iteration
    state.setdefault("pivot_log", []).append(pivot_entry)
    state["updated_at"] = now()
    atomic_write(state_file(repo), state)
    print(json.dumps(pivot_entry))
    return 0


def cmd_history(args):
    """Print the pivot_log as JSON."""
    state = read_state(Path(args.repo))
    print(json.dumps(state.get("pivot_log", [])))
    return 0


def register_subparsers(sub) -> None:
    pv = sub.add_parser(
        "pivot",
        help="P4: archive current run + reset for a new task (preserves run_id).",
    )
    pv.add_argument("--repo", required=True)
    pv.add_argument("--new-task", required=True, dest="new_task",
                    help="Title of the task replacing the current one.")
    pv.add_argument("--new-selected", required=True, dest="new_selected",
                    help="CSV of step numbers for the new sub-run.")
    pv.add_argument("--new-task-type", dest="new_task_type", default=None,
                    help="Optional: change task type (e.g. feature → bug).")
    pv.add_argument("--reason", required=True,
                    help="One-line reason for the pivot (audit trail).")
    pv.set_defaults(func=cmd_pivot)

    h = sub.add_parser(
        "history",
        help="P4: print the run's pivot_log as JSON.",
    )
    h.add_argument("--repo", required=True)
    h.set_defaults(func=cmd_history)
