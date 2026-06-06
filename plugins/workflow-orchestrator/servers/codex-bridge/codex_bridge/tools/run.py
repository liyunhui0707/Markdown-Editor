"""FALLBACK tool only. Use the typed review tools for the six Codex-owned skills."""

import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from codex_bridge.executor import run_codex

_SCHEMA = (
    Path(__file__).resolve().parents[2] / "schemas" / "codex_run.schema.json"
)


@dataclass
class RawRunResult:
    stdout: str
    stderr: str
    exit_code: int

    def to_dict(self) -> dict:
        return {
            "stdout": self.stdout,
            "stderr": self.stderr,
            "exit_code": self.exit_code,
        }


def codex_run(
    *,
    prompt: str,
    cwd: str,
    timeout: int | None = None,
    runner: Callable | None = None,
) -> dict:
    fd, tmp = tempfile.mkstemp(suffix=".json", prefix="codex-out-")
    import os as _os
    _os.close(fd)
    out_path = Path(tmp)
    try:
        run_kwargs: dict = {"timeout": timeout}
        if runner is not None:
            run_kwargs["runner"] = runner
        code, stdout, stderr = run_codex(
            repo=Path(cwd),
            schema=_SCHEMA,
            out_message=out_path,
            payload=prompt,
            **run_kwargs,
        )
        return RawRunResult(stdout=stdout, stderr=stderr, exit_code=code).to_dict()
    finally:
        out_path.unlink(missing_ok=True)
