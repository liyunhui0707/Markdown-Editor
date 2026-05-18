"""Library for `bin/workflow_state.py`.

Hosts constants, path helpers, atomic-write primitives, and gate-option
lookup so the CLI shim stays under the project's per-file line limit.

Importable from tests via `bin` on pythonpath; also imported by the shim
through a runtime `sys.path` fixup. Stdlib-only.
"""

import datetime
import json
import os
from pathlib import Path

SCHEMA_VERSION = 1

# Authoritative gate options keyed by the step number the gate fires AFTER.
# Mirrored in `skills/workflow/docs/gate-policy.md`.
GATE_OPTIONS: dict[int, list[str]] = {
    5: ["proceed", "revise", "abort"],
    # P1.c: post-step-6 manual-QA gate, fired only when state.ui is true.
    6: ["pass", "fail", "skip-and-document"],
    7: ["apply-fixes", "accept-as-is", "abort"],
    # P5: 'partial-commit-and-continue' lets the user ship a Codex-approved
    # subset and keep iterating on the contested rest.
    11: ["commit", "fix-more", "partial-commit-and-continue", "abort"],
    12: ["push", "cancel"],
}


def state_dir(repo: Path) -> Path:
    return Path(repo) / ".workflow"


def state_file(repo: Path) -> Path:
    return state_dir(repo) / "state.json"


def lock_file(repo: Path) -> Path:
    return state_dir(repo) / "state.lock"


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def atomic_write(path: Path, data: dict) -> None:
    """Atomic JSON write: O_EXCL tmp → fsync → rename → fsync directory."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    if tmp.exists():
        tmp.unlink()
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    dir_fd = os.open(str(path.parent), os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)


def read_state(repo: Path) -> dict:
    return json.loads(state_file(repo).read_text(encoding="utf-8"))


def parse_value(value: str):
    """Parse a CLI --value as JSON; fall back to the raw string."""
    try:
        return json.loads(value)
    except (ValueError, TypeError):
        return value


def empty_step_status(steps: list[int]) -> dict:
    return {
        str(s): {
            "state": "pending",
            "artifact_path": None,
            "verdict": None,
            "ended_at": None,
        }
        for s in steps
    }
