"""Fake-codex runner helpers for tool-level tests.

`fake_codex_runner(...)` returns a callable that mimics subprocess.Popen but:
  - writes the canned `last_message` content to the --output-last-message arg
  - returns a FakeProc with the canned stdout/stderr/exit
"""

import subprocess
from pathlib import Path
from typing import Callable


class FakeProc:
    def __init__(self, *, stdout="", stderr="", returncode=0,
                 timeout_on_communicate=False):
        self.stdout_value = stdout
        self.stderr_value = stderr
        self.returncode = returncode
        self.timeout_on_communicate = timeout_on_communicate
        self.terminated = False
        self.killed = False
        self.passed_input: str | None = None
        self.captured_argv: list[str] | None = None

    def communicate(self, input=None, timeout=None):
        self.passed_input = input
        if self.timeout_on_communicate:
            raise subprocess.TimeoutExpired(cmd="codex", timeout=timeout or 0)
        return self.stdout_value, self.stderr_value

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.killed = True

    def wait(self, timeout=None):
        return self.returncode


def fake_codex_runner(
    *,
    last_message: str = "",
    stdout: str = "",
    stderr: str = "",
    returncode: int = 0,
) -> Callable:
    """Build a runner that simulates Codex writing to --output-last-message."""
    captured: list[FakeProc] = []

    def _make(argv, **kwargs):
        # Write canned content to the --output-last-message argument value.
        if "--output-last-message" in argv:
            i = argv.index("--output-last-message")
            out_path = Path(argv[i + 1])
            out_path.write_text(last_message, encoding="utf-8")
        proc = FakeProc(stdout=stdout, stderr=stderr, returncode=returncode)
        proc.captured_argv = list(argv)
        captured.append(proc)
        return proc

    _make.captured = captured  # type: ignore[attr-defined]
    return _make
