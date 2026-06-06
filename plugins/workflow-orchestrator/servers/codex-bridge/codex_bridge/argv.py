import os
from pathlib import Path
from typing import Sequence

from codex_bridge.errors import BannedFlagError
from codex_bridge.flags import DENYLIST

# The global ~/.codex/config.toml may pin a slow reasoning effort (e.g. xhigh)
# that pushes a single review past the wall-clock budget. The bridge overrides
# it per-call so interactive codex is left untouched. Set
# CODEX_BRIDGE_REASONING_EFFORT to another level, or to "" / "default" to skip
# the override and fall back to config.toml.
DEFAULT_REASONING_EFFORT = "high"
_REASONING_ENV_VAR = "CODEX_BRIDGE_REASONING_EFFORT"
_UNSET = object()


def _resolve_reasoning_effort(reasoning_effort) -> str | None:
    if reasoning_effort is _UNSET:
        raw = os.environ.get(_REASONING_ENV_VAR)
        reasoning_effort = DEFAULT_REASONING_EFFORT if raw is None else raw
    value = (reasoning_effort or "").strip()
    if not value or value.lower() == "default":
        return None
    return value


def build_codex_argv(
    *,
    repo: Path,
    schema: Path,
    out_message: Path,
    ask_for_approval: str = "never",
    sandbox: str = "read-only",
    reasoning_effort=_UNSET,
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
    ]
    effort = _resolve_reasoning_effort(reasoning_effort)
    if effort:
        argv += ["-c", f"model_reasoning_effort={effort}"]
    argv += [
        "--output-schema", str(schema),
        "--output-last-message", str(out_message),
    ]
    argv.extend(extra_args)
    argv.append("-")
    return argv
