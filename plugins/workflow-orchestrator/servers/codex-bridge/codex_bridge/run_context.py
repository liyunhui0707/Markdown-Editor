"""Load the per-run codex_run_context from <repo>/.workflow/state.json.

This is the bridge between the orchestrator's state (managed by
`bin/workflow_state.py`) and the typed Codex review tools' prompt
composition. Every typed tool calls `load_run_context(repo_root)` and
prepends a "## Project scope" block to its prompt when the loader
returns a non-empty string.

The loader is intentionally permissive: missing file, missing field,
malformed JSON, non-string value, or whitespace-only string all map to
None (no scope block prepended). It must never raise — the typed tools
fall back to their original behavior on any error.
"""

import json
from pathlib import Path


def load_run_context(repo_root: str | Path) -> str | None:
    """Read codex_run_context from `<repo_root>/.workflow/state.json`.

    Returns the trimmed string if present and non-empty, else None.
    """
    state_file = Path(repo_root) / ".workflow" / "state.json"
    try:
        text = state_file.read_text(encoding="utf-8")
    except (FileNotFoundError, OSError):
        return None
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    value = data.get("codex_run_context")
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped if stripped else None


_SCOPE_HEADER = "## Project scope (applies to all reviews in this run)"


def format_scope_block(repo_root: str | Path) -> str:
    """Return the prompt block for the current run's codex_run_context.

    Returns "" when no context is set, so callers can unconditionally
    prepend it without changing prompt bytes for non-opted-in runs. The
    block always ends with a blank-line separator so it slots cleanly
    in front of the next "##" section.
    """
    ctx = load_run_context(repo_root)
    if not ctx:
        return ""
    return f"{_SCOPE_HEADER}\n{ctx}\n\n"
