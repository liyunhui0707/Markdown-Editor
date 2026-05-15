"""Shared invocation helper for the typed review tools.

Builds a unique --output-last-message tempfile, runs Codex with the chosen
schema, reads the file (preferred) or falls back to stdout, parses the
result, and cleans up.
"""

import tempfile
from pathlib import Path
from typing import Callable

from codex_bridge.executor import run_codex
from codex_bridge.result import ReviewResult, parse_review


def invoke_review(
    *,
    repo_root: Path,
    schema: Path,
    payload: str,
    tool_name: str,
    runner: Callable | None = None,
) -> ReviewResult:
    fd, tmp = tempfile.mkstemp(suffix=".json", prefix="codex-out-")
    out_path = Path(tmp)
    try:
        import os as _os
        _os.close(fd)
        run_kwargs: dict = {}
        if runner is not None:
            run_kwargs["runner"] = runner
        _, stdout, _ = run_codex(
            repo=repo_root,
            schema=schema,
            out_message=out_path,
            payload=payload,
            **run_kwargs,
        )
        raw = ""
        if out_path.exists() and out_path.stat().st_size > 0:
            raw = out_path.read_text(encoding="utf-8")
        else:
            raw = stdout or ""
        return parse_review(raw, tool=tool_name)
    finally:
        out_path.unlink(missing_ok=True)
