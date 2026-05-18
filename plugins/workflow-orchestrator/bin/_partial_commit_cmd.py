"""P5 — partial-commit affordance. Audit-trail recorder.

When part of the working tree is Codex-approved and part isn't, the user
should be able to commit the approved subset and continue iterating on
the rest. This module records the partial commit to `state.partial_commits`
for audit; it does NOT shell out to git itself — the orchestrator skill
drives `git add` + `git commit` via Bash so the user can review the diff
first.

Split out of `workflow_state.py` to keep that file under the 280-line
project rule. Same import pattern as `_state_lib.py` (added to
sys.path by the shim).
"""

import json
import sys
from pathlib import Path

from _state_lib import atomic_write, now, read_state, state_file


def cmd_record_partial_commit(args):
    """Append a partial-commit entry to state.partial_commits."""
    files = [f.strip() for f in args.files.split(",") if f.strip()]
    if not files:
        print(
            "--files must be a non-empty CSV of paths (got empty after trim)",
            file=sys.stderr,
        )
        return 2
    repo = Path(args.repo)
    state = read_state(repo)
    log = state.setdefault("partial_commits", [])
    entry = {"at": now(), "files": files, "reason": args.reason}
    log.append(entry)
    state["updated_at"] = now()
    atomic_write(state_file(repo), state)
    print(json.dumps(entry))
    return 0


def register_subparsers(sub) -> None:
    """Add the record-partial-commit subcommand to a shim parser."""
    rc = sub.add_parser(
        "record-partial-commit",
        help="P5: append an audit entry for a partial commit to state.",
    )
    rc.add_argument("--repo", required=True)
    rc.add_argument(
        "--files", required=True,
        help="CSV of file paths that were just committed.",
    )
    rc.add_argument(
        "--reason", required=True,
        help="Why this subset was committed alone (e.g. 'Codex-approved; rest contested').",
    )
    rc.set_defaults(func=cmd_record_partial_commit)
