"""Subprocess wrapper around the locally installed `codex` CLI.

Only one entry point — `run_codex` — and only one process shape. The argv is
always built by `codex_bridge.argv.build_codex_argv`, so the denylist and the
"root flags before exec" contract are enforced uniformly.
"""

import os
import subprocess
from pathlib import Path
from typing import Callable, Sequence

from codex_bridge.argv import build_codex_argv
from codex_bridge.errors import (
    CodexExitError,
    CodexTimeoutError,
    InvalidCwdError,
)

DEFAULT_TIMEOUT_SECONDS = 900
_GRACE_AFTER_TERMINATE_SECONDS = 2

# Operators can override the wall-clock budget without code changes; an explicit
# `timeout` argument still wins over this. Reviews under gpt-5.5 routinely run
# past the old 300s ceiling, hence the higher default.
_TIMEOUT_ENV_VAR = "CODEX_BRIDGE_TIMEOUT_SECONDS"


def _resolve_timeout(timeout: float | None) -> float:
    if timeout is not None:
        return timeout
    raw = os.environ.get(_TIMEOUT_ENV_VAR, "").strip()
    if raw:
        try:
            return float(raw)
        except ValueError:
            pass
    return DEFAULT_TIMEOUT_SECONDS

# Allowlist of environment variables passed through to the Codex subprocess.
# Everything else (API keys, tokens, ad-hoc shell exports) is dropped to avoid
# leaking the parent environment into the model's view.
_ENV_ALLOWLIST: tuple[str, ...] = (
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "TMPDIR",
    "TERM",
    "SHELL",
)


# Common locations where `codex` (and other dev CLIs) are installed but which
# may be missing from PATH when the MCP server is launched from a GUI context
# (e.g. Claude.app spawned from the Dock on macOS — GUI apps inherit a minimal
# /usr/bin:/bin PATH and do NOT pick up shell rc files).
_FALLBACK_PATH_ENTRIES: tuple[str, ...] = (
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
)


def _sanitized_env() -> dict[str, str]:
    env = {k: os.environ[k] for k in _ENV_ALLOWLIST if k in os.environ}
    parts = env.get("PATH", "").split(os.pathsep) if env.get("PATH") else []
    parts = [p for p in parts if p]
    for p in _FALLBACK_PATH_ENTRIES:
        if p not in parts:
            parts.append(p)
    env["PATH"] = os.pathsep.join(parts)
    return env


def run_codex(
    *,
    repo: Path,
    schema: Path,
    out_message: Path,
    payload: str,
    timeout: float | None = None,
    extra_args: Sequence[str] = (),
    runner: Callable = subprocess.Popen,
) -> tuple[int, str, str]:
    """Invoke `codex` with the canonical argv and the given stdin payload.

    Returns (exit_code, stdout, stderr) on success. Raises:
      - InvalidCwdError      if `repo` is not an existing directory
      - CodexTimeoutError    if the process exceeds `timeout`
      - CodexExitError       if the process exits non-zero
    """
    repo = Path(repo)
    if not repo.is_dir():
        raise InvalidCwdError(f"repo must be an existing directory: {repo}")

    timeout = _resolve_timeout(timeout)

    argv = build_codex_argv(
        repo=repo,
        schema=schema,
        out_message=out_message,
        extra_args=extra_args,
    )

    proc = runner(
        argv,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=_sanitized_env(),
    )
    try:
        stdout, stderr = proc.communicate(input=payload, timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.terminate()
        try:
            proc.wait(timeout=_GRACE_AFTER_TERMINATE_SECONDS)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        raise CodexTimeoutError(f"codex exceeded timeout of {timeout}s")

    if proc.returncode != 0:
        raise CodexExitError(proc.returncode, stderr or "")
    return proc.returncode, stdout, stderr
