#!/usr/bin/env python3
"""Task-type → step-set selector for the workflow-orchestrator plugin.

`preview` returns JSON `{"task_type", "selected_steps", "rationale"}`.
The matrix below is the authoritative mapping; do not mirror it in markdown.
"""

import argparse
import json
import re
import sys

_ISSUE_HINT = re.compile(r"(?i)(?:^|\s)#\d+\b|\bissue\s+\d+\b")

DEFAULT_STEPS: dict[str, list[int]] = {
    "bug-with-issue": [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14],
    "bug":            [1,       4, 5, 6, 7, 8, 9, 11, 12, 13, 14],
    "feature":        [1,       4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    "refactor":       [1,       4, 5, 6, 7, 8,    11, 12, 13, 14],
    "freeform":       [1,       4, 5, 6, 7, 8,    11, 12, 13, 14],
}

# When --size is given, it OVERRIDES the task-type-derived default set.
# Step 11 (commit readiness review) is preserved in every size — it's the
# last cheap-to-run check before code leaves the local machine. Other
# steps drop by size to match the actual ceremony a task needs.
SIZE_STEPS: dict[str, list[int]] = {
    "trivial":  [6, 7, 11, 12],                       # write → diff-review → readiness → push
    "small":    [1, 6, 7, 8, 11, 12],                 # +clarify, +review-fix
    "medium":   [1, 4, 5, 6, 7, 8, 11, 12, 14],       # +plan, +plan-review, +wrap-up
    # "large" intentionally absent — falls through to task-type defaults.
}

MANDATORY_GATE_STEPS = (5, 7, 11, 12)

# P1.b: UI auto-detection keywords. Match as whole-word, case-insensitive.
# Triggers --ui=true when present in the task text and --ui/--no-ui not given.
_UI_KEYWORDS = re.compile(
    r"\b(render|rendering|view|panel|ui|visual|display|browser|frontend|component)\b",
    re.IGNORECASE,
)


def _detect_ui(task: str, explicit: bool | None) -> bool:
    """--ui / --no-ui take precedence; otherwise keyword auto-detect."""
    if explicit is not None:
        return explicit
    return bool(_UI_KEYWORDS.search(task or ""))


def _detect_task_type(task: str, issue: str | None, override: str | None) -> str:
    if override:
        return override
    if issue or _ISSUE_HINT.search(task or ""):
        return "bug-with-issue"
    t = (task or "").lower()
    if any(k in t for k in ("bug", "regression", "broken", "fails", "crash")):
        return "bug"
    if any(k in t for k in ("refactor", "rename", "extract", "split", "tidy")):
        return "refactor"
    if any(k in t for k in ("add ", "implement", "new ", " feature", "support ")):
        return "feature"
    return "freeform"


def _parse_csv(s: str | None) -> list[int]:
    if not s:
        return []
    return [int(p.strip()) for p in s.split(",") if p.strip()]


def cmd_preview(args):
    task_type = _detect_task_type(args.task, args.issue, args.task_type)
    ui = _detect_ui(args.task, args.ui)
    if args.step is not None:
        steps = [args.step]
        source = "single-step"
    else:
        if args.size and args.size in SIZE_STEPS:
            steps = list(SIZE_STEPS[args.size])
            source = f"size={args.size}"
        else:
            steps = list(DEFAULT_STEPS[task_type])
            source = f"task_type={task_type}"
        # P1.b: --ui force-includes manual QA (step 9) and docs-sync (step 10)
        # in any size preset. Idempotent for size sets that already include them.
        if ui:
            for s in (9, 10):
                if s not in steps:
                    steps.append(s)
        for s in _parse_csv(args.force):
            if s not in steps:
                steps.append(s)
        for s in _parse_csv(args.skip):
            if s in steps:
                steps.remove(s)
        if args.from_step is not None:
            steps = [s for s in steps if s >= args.from_step]
        if args.to_step is not None:
            steps = [s for s in steps if s <= args.to_step]
        steps.sort()

    warnings: list[str] = []
    for step in MANDATORY_GATE_STEPS:
        if step not in steps:
            warnings.append(
                f"mandatory gate step {step} was removed from the selected set; "
                "the workflow will not pause for human approval at this point"
            )

    rationale = (
        f"task_type={task_type!r}; source={source}; ui={ui}; "
        f"size={args.size or 'none'}; "
        f"skip={args.skip or 'none'}; force={args.force or 'none'}; "
        f"from={args.from_step}; to={args.to_step}; step={args.step}."
    )
    print(json.dumps(
        {
            "task_type": task_type,
            "size": args.size,
            "ui": ui,
            "selected_steps": steps,
            "rationale": rationale,
            "warnings": warnings,
        },
        indent=2,
    ))
    return 0


def _build_parser():
    p = argparse.ArgumentParser(prog="workflow-select")
    sub = p.add_subparsers(dest="cmd", required=True)

    pv = sub.add_parser("preview")
    pv.add_argument("--task", required=True)
    pv.add_argument("--issue", default=None)
    pv.add_argument("--task-type", choices=list(DEFAULT_STEPS), default=None)
    pv.add_argument(
        "--size",
        choices=["trivial", "small", "medium", "large"],
        default=None,
        help=(
            "task size; overrides the task-type-derived step set. "
            "trivial=6,7,11,12  small=+1,8  medium=+4,5,14  "
            "large=use task-type defaults (current behavior)"
        ),
    )
    # P1.b: tri-state UI flag — explicit on (--ui), explicit off (--no-ui),
    # or auto-detect from task keywords (default None).
    ui_group = pv.add_mutually_exclusive_group()
    ui_group.add_argument(
        "--ui", dest="ui", action="store_const", const=True, default=None,
        help="P1.b: force ui=true; adds steps 9 (manual QA) + 10 (docs sync).",
    )
    ui_group.add_argument(
        "--no-ui", dest="ui", action="store_const", const=False,
        help="P1.b: force ui=false; skip the UI auto-detect.",
    )
    pv.add_argument("--skip", default=None, help="CSV of step numbers to remove")
    pv.add_argument("--force", default=None, help="CSV of step numbers to add")
    pv.add_argument("--from", dest="from_step", type=int, default=None)
    pv.add_argument("--to", dest="to_step", type=int, default=None)
    pv.add_argument("--step", type=int, default=None,
                    help="run only this single step")
    pv.set_defaults(func=cmd_preview)
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
