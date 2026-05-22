#!/usr/bin/env python3
"""CLI shim for workflow-orchestrator state management.

Subcommands write to `<repo>/.workflow/state.json` via the helpers in
`_state_lib.py`. All mutating writes are atomic (O_EXCL tmp → rename).
Locks persist until `release-lock` or `--force`; they are NOT keyed on the
short-lived helper PID.
"""

import argparse
import json
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _state_lib import (  # noqa: E402
    GATE_OPTIONS, SCHEMA_VERSION, atomic_write, empty_step_status,
    lock_file, now, parse_value, read_state, state_file,
)
import _review_cmds  # noqa: E402
import _partial_commit_cmd  # noqa: E402
import _pivot_cmd  # noqa: E402


def cmd_init(args):
    repo = Path(args.repo)
    steps = [int(s) for s in args.selected.split(",") if s.strip()]
    state = {
        "schema_version": SCHEMA_VERSION,
        "run_id": str(uuid.uuid4()),
        "started_at": now(),
        "updated_at": now(),
        "task": {
            "title": args.title or "",
            "type": args.task_type,
            "issue_ref": args.issue or None,
        },
        "selected_steps": steps,
        "step_status": empty_step_status(steps),
        "current_step": None,
        "pending_gate": None,
        "lock": None,
        "codex_run_context": args.run_context or None,
        "review_rounds": {},
        "max_review_rounds": args.max_review_rounds,
        "ui": bool(args.ui),
        "auto_merge": False,
        "partial_commits": [],
        "iteration": 1,
        "pivot_log": [],
    }
    atomic_write(state_file(repo), state)
    print(json.dumps(state, indent=2))
    return 0


def cmd_get(args):
    state = read_state(Path(args.repo))
    if args.field is None:
        print(json.dumps(state, indent=2))
        return 0
    value = state
    for part in args.field.split("."):
        if isinstance(value, dict) and part in value:
            value = value[part]
        else:
            print("null")
            return 1
    print(json.dumps(value))
    return 0


def cmd_set(args):
    repo = Path(args.repo)
    state = read_state(repo)
    parsed = parse_value(args.value)
    parts = args.field.split(".")
    target = state
    for part in parts[:-1]:
        if not isinstance(target, dict):
            print(
                f"cannot traverse field {args.field!r}: intermediate at "
                f"{part!r} is {type(target).__name__}, not dict",
                file=sys.stderr,
            )
            return 2
        target = target.setdefault(part, {})
    if not isinstance(target, dict):
        print(
            f"cannot assign into field {args.field!r}: parent is "
            f"{type(target).__name__}, not dict",
            file=sys.stderr,
        )
        return 2
    target[parts[-1]] = parsed
    state["updated_at"] = now()
    atomic_write(state_file(repo), state)
    return 0


def cmd_advance(args):
    repo = Path(args.repo)
    state = read_state(repo)
    state["current_step"] = args.to_step
    state["updated_at"] = now()
    atomic_write(state_file(repo), state)
    return 0


def cmd_set_gate(args):
    repo = Path(args.repo)
    state = read_state(repo)
    if args.options:
        options = [o.strip() for o in args.options.split(",")]
    elif args.after_step in GATE_OPTIONS:
        options = list(GATE_OPTIONS[args.after_step])
    else:
        print(
            f"no canonical options for gate after step {args.after_step}; "
            f"pass --options explicitly",
            file=sys.stderr,
        )
        return 2
    state["pending_gate"] = {
        "after_step": args.after_step,
        "prompt": args.prompt,
        "options": options,
    }
    state["updated_at"] = now()
    atomic_write(state_file(repo), state)
    return 0


def cmd_clear_gate(args):
    repo = Path(args.repo)
    state = read_state(repo)
    state["pending_gate"] = None
    state["updated_at"] = now()
    atomic_write(state_file(repo), state)
    return 0


def cmd_acquire_lock(args):
    repo = Path(args.repo)
    lock = lock_file(repo)
    lock.parent.mkdir(parents=True, exist_ok=True)
    if args.force and lock.exists():
        lock.unlink()
    payload = {"acquired_at": now(), "host": os.uname().nodename}
    try:
        fd = os.open(str(lock), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        try:
            existing = json.loads(lock.read_text(encoding="utf-8"))
            acquired = existing.get("acquired_at", "?")
            print(
                f"lock held since {acquired}; rerun with --force to override",
                file=sys.stderr,
            )
        except (ValueError, OSError):
            print(
                "existing lock file is unreadable; rerun with --force to override",
                file=sys.stderr,
            )
        return 1
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    return 0


def cmd_release_lock(args):
    lock = lock_file(Path(args.repo))
    if lock.exists():
        lock.unlink()
    return 0


def cmd_resume(args):
    repo = Path(args.repo)
    sf = state_file(repo)
    if not sf.is_file():
        print(json.dumps({
            "no_state": True,
            "current_step": None,
            "pending_gate": None,
        }, indent=2))
        return 0
    state = read_state(repo)
    print(json.dumps({
        "no_state": False,
        "run_id": state["run_id"],
        "current_step": state["current_step"],
        "pending_gate": state["pending_gate"],
        "selected_steps": state["selected_steps"],
    }, indent=2))
    return 0


def _build_parser():
    p = argparse.ArgumentParser(prog="workflow-state")
    sub = p.add_subparsers(dest="cmd", required=True)

    init = sub.add_parser("init")
    init.add_argument("--repo", required=True)
    init.add_argument("--task-type", required=True)
    init.add_argument("--selected", required=True, help="CSV of step numbers")
    init.add_argument("--title", default="")
    init.add_argument("--issue", default=None)
    init.add_argument("--run-context", dest="run_context", default=None,
                      help="P3: project-scope hint for typed Codex review.")
    init.add_argument("--max-review-rounds", dest="max_review_rounds",
                      type=int, default=3, help="P2: per-skill review cap.")
    init.add_argument("--ui", action="store_true",
                      help="P1.b: this run touches UI; manual-QA gate fires after step 6.")
    init.set_defaults(func=cmd_init)

    g = sub.add_parser("get")
    g.add_argument("--repo", required=True)
    g.add_argument("--field", default=None)
    g.set_defaults(func=cmd_get)

    s = sub.add_parser("set")
    s.add_argument("--repo", required=True)
    s.add_argument("--field", required=True)
    s.add_argument("--value", required=True)
    s.set_defaults(func=cmd_set)

    adv = sub.add_parser("advance")
    adv.add_argument("--repo", required=True)
    adv.add_argument("--to-step", required=True, type=int)
    adv.set_defaults(func=cmd_advance)

    sg = sub.add_parser("set-gate")
    sg.add_argument("--repo", required=True)
    sg.add_argument("--after-step", required=True, type=int)
    sg.add_argument("--prompt", required=True)
    sg.add_argument(
        "--options",
        default=None,
        help="CSV of options; if omitted, looked up from GATE_OPTIONS by --after-step",
    )
    sg.set_defaults(func=cmd_set_gate)

    cg = sub.add_parser("clear-gate")
    cg.add_argument("--repo", required=True)
    cg.set_defaults(func=cmd_clear_gate)

    al = sub.add_parser("acquire-lock")
    al.add_argument("--repo", required=True)
    al.add_argument("--force", action="store_true",
                    help="override an existing lock (use to clear stale locks)")
    al.set_defaults(func=cmd_acquire_lock)

    rl = sub.add_parser("release-lock")
    rl.add_argument("--repo", required=True)
    rl.set_defaults(func=cmd_release_lock)

    for _mod in (_review_cmds, _partial_commit_cmd, _pivot_cmd):
        _mod.register_subparsers(sub)

    rs = sub.add_parser("resume")
    rs.add_argument("--repo", required=True)
    rs.set_defaults(func=cmd_resume)

    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
