import subprocess

import pytest

from codex_bridge.errors import (
    CodexExitError,
    CodexTimeoutError,
    InvalidCwdError,
)
from codex_bridge.executor import run_codex


class FakeProc:
    def __init__(
        self,
        *,
        stdout: str = "",
        stderr: str = "",
        returncode: int = 0,
        timeout_on_communicate: bool = False,
    ):
        self.stdout_value = stdout
        self.stderr_value = stderr
        self.returncode = returncode
        self.timeout_on_communicate = timeout_on_communicate
        self.terminated = False
        self.killed = False
        self.passed_input: str | None = None
        self.passed_timeout: float | None = None
        self.captured_argv: list[str] | None = None

    def communicate(self, input=None, timeout=None):
        self.passed_input = input
        self.passed_timeout = timeout
        if self.timeout_on_communicate:
            raise subprocess.TimeoutExpired(cmd="codex", timeout=timeout or 0)
        return self.stdout_value, self.stderr_value

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.killed = True

    def wait(self, timeout=None):
        return self.returncode


def _runner(proc: FakeProc):
    def _make(argv, **kwargs):
        proc.captured_argv = argv
        return proc
    return _make


def test_invocation_shape_and_stdin(tmp_path):
    schema = tmp_path / "s.json"; schema.write_text("{}")
    out = tmp_path / "o.json"
    proc = FakeProc(stdout='{"ok":true}')
    code, stdout, _ = run_codex(
        repo=tmp_path, schema=schema, out_message=out,
        payload="hello\n", runner=_runner(proc),
    )
    assert code == 0
    assert stdout == '{"ok":true}'
    assert proc.passed_input == "hello\n"
    assert proc.captured_argv is not None
    assert proc.captured_argv[0] == "codex"
    assert proc.captured_argv[-1] == "-"


def test_default_timeout_resolves_to_900(tmp_path, monkeypatch):
    monkeypatch.delenv("CODEX_BRIDGE_TIMEOUT_SECONDS", raising=False)
    schema = tmp_path / "s.json"; schema.write_text("{}")
    out = tmp_path / "o.json"
    proc = FakeProc(stdout="{}")
    run_codex(
        repo=tmp_path, schema=schema, out_message=out,
        payload="", runner=_runner(proc),
    )
    assert proc.passed_timeout == 900


def test_timeout_env_override(tmp_path, monkeypatch):
    monkeypatch.setenv("CODEX_BRIDGE_TIMEOUT_SECONDS", "1234")
    schema = tmp_path / "s.json"; schema.write_text("{}")
    out = tmp_path / "o.json"
    proc = FakeProc(stdout="{}")
    run_codex(
        repo=tmp_path, schema=schema, out_message=out,
        payload="", runner=_runner(proc),
    )
    assert proc.passed_timeout == 1234


def test_explicit_timeout_beats_env(tmp_path, monkeypatch):
    monkeypatch.setenv("CODEX_BRIDGE_TIMEOUT_SECONDS", "1234")
    schema = tmp_path / "s.json"; schema.write_text("{}")
    out = tmp_path / "o.json"
    proc = FakeProc(stdout="{}")
    run_codex(
        repo=tmp_path, schema=schema, out_message=out,
        payload="", timeout=5, runner=_runner(proc),
    )
    assert proc.passed_timeout == 5


def test_invalid_cwd(tmp_path):
    schema = tmp_path / "s.json"; schema.write_text("{}")
    out = tmp_path / "o.json"
    missing = tmp_path / "does-not-exist"
    with pytest.raises(InvalidCwdError):
        run_codex(
            repo=missing, schema=schema, out_message=out,
            payload="", runner=_runner(FakeProc()),
        )


def test_timeout_terminates_and_raises(tmp_path):
    schema = tmp_path / "s.json"; schema.write_text("{}")
    out = tmp_path / "o.json"
    proc = FakeProc(timeout_on_communicate=True)
    with pytest.raises(CodexTimeoutError):
        run_codex(
            repo=tmp_path, schema=schema, out_message=out,
            payload="", timeout=1, runner=_runner(proc),
        )
    assert proc.terminated


def test_subprocess_env_is_sanitized(tmp_path, monkeypatch):
    """A secret-looking env var must NOT be inherited by the codex subprocess."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-do-not-leak")
    monkeypatch.setenv("PATH", "/usr/bin:/bin")
    captured: dict = {}

    def capturing_runner(argv, **kwargs):
        captured.update(kwargs)
        return FakeProc(stdout="")

    schema = tmp_path / "s.json"; schema.write_text("{}")
    out = tmp_path / "o.json"
    run_codex(
        repo=tmp_path, schema=schema, out_message=out,
        payload="", runner=capturing_runner,
    )
    env = captured.get("env")
    assert env is not None, "executor must pass a sanitized env to Popen"
    assert "PATH" in env, "PATH must survive sanitization"
    assert "ANTHROPIC_API_KEY" not in env, (
        "secret-bearing env vars must not be forwarded to Codex"
    )


def test_nonzero_exit_raises(tmp_path):
    schema = tmp_path / "s.json"; schema.write_text("{}")
    out = tmp_path / "o.json"
    proc = FakeProc(returncode=1, stderr="boom")
    with pytest.raises(CodexExitError) as ei:
        run_codex(
            repo=tmp_path, schema=schema, out_message=out,
            payload="", runner=_runner(proc),
        )
    assert ei.value.exit_code == 1
    assert "boom" in ei.value.stderr


def test_exit_error_message_includes_stderr_tail():
    """Real Codex prints a session header at the start of stderr and the
    actual `ERROR: { ... }` block at the end. The exception message must
    include the tail, not just the head.
    """
    long_preamble = "session preamble line\n" * 500  # ~10 KB
    error_block = 'ERROR: {"code": "invalid_json_schema", "message": "..."}'
    err = CodexExitError(1, long_preamble + error_block)
    assert error_block in str(err), (
        "exception message must include the stderr tail where Codex puts the "
        "real error; got head-truncated message instead"
    )
    # Full stderr is still preserved on the instance.
    assert err.stderr.startswith("session preamble")
