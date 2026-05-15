from pathlib import Path
from typing import Sequence

from codex_bridge.errors import BannedFlagError
from codex_bridge.flags import DENYLIST


def build_codex_argv(
    *,
    repo: Path,
    schema: Path,
    out_message: Path,
    ask_for_approval: str = "never",
    sandbox: str = "read-only",
    extra_args: Sequence[str] = (),
) -> list[str]:
    """Build the canonical Codex argv for a non-interactive review run.

    Root-scoped flags (e.g. --ask-for-approval) MUST appear before `exec`.
    The payload is delivered via stdin; the trailing `-` signals that.
    """
    for arg in extra_args:
        if arg in DENYLIST:
            raise BannedFlagError(
                f"Refusing to invoke codex with denylisted flag: {arg}"
            )
    argv: list[str] = [
        "codex",
        "--ask-for-approval", ask_for_approval,
        "exec",
        "--cd", str(repo),
        "--sandbox", sandbox,
        "--output-schema", str(schema),
        "--output-last-message", str(out_message),
    ]
    argv.extend(extra_args)
    argv.append("-")
    return argv
