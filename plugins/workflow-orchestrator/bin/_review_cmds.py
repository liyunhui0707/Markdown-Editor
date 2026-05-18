"""P2 — review-round cap. Per-Codex-skill counter + escalation check.

Tracks how many times each Codex-owned skill has been dispatched in this
run. When the count reaches `state.max_review_rounds` (default 3), the
orchestrator sets an escalation gate (options: dispatch-another /
accept-as-is / abort) instead of silently dispatching yet another
round. Stops the review-revise spiral.

Split out of `workflow_state.py` to keep that file under the 280-line
project rule. Same import pattern as `_state_lib.py` (added to
sys.path by the shim).
"""

import json
from pathlib import Path

from _state_lib import atomic_write, now, read_state, state_file


def cmd_bump_review(args):
    """Increment review_rounds[skill] and print the new count."""
    repo = Path(args.repo)
    state = read_state(repo)
    rounds = state.setdefault("review_rounds", {})
    rounds[args.skill] = rounds.get(args.skill, 0) + 1
    state["updated_at"] = now()
    atomic_write(state_file(repo), state)
    print(json.dumps({"skill": args.skill, "round": rounds[args.skill]}))
    return 0


def cmd_should_escalate(args):
    """Read review_rounds[skill] and decide whether to escalate.

    --max overrides state.max_review_rounds for the check; without it,
    state.max_review_rounds is used (default 3 from init).
    """
    state = read_state(Path(args.repo))
    rounds = state.get("review_rounds", {})
    count = rounds.get(args.skill, 0)
    if args.max is not None:
        max_rounds = args.max
    else:
        max_rounds = state.get("max_review_rounds", 3)
    print(json.dumps({
        "skill": args.skill,
        "round": count,
        "max": max_rounds,
        "escalate": count >= max_rounds,
    }))
    return 0


def register_subparsers(sub) -> None:
    """Add the bump-review and should-escalate subcommands to a shim parser."""
    br = sub.add_parser(
        "bump-review",
        help="P2: increment the Codex-review counter for a skill.",
    )
    br.add_argument("--repo", required=True)
    br.add_argument(
        "--skill", required=True,
        help="MCP tool name, e.g. codex_review_plan",
    )
    br.set_defaults(func=cmd_bump_review)

    se = sub.add_parser(
        "should-escalate",
        help=(
            "P2: check whether the current review-round count for a "
            "skill has reached max_review_rounds."
        ),
    )
    se.add_argument("--repo", required=True)
    se.add_argument("--skill", required=True)
    se.add_argument(
        "--max", type=int, default=None,
        help="One-off max override; defaults to state.max_review_rounds.",
    )
    se.set_defaults(func=cmd_should_escalate)
