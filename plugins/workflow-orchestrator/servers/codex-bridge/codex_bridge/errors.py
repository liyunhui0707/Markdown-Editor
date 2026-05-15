class CodexBridgeError(Exception):
    """Base for all codex-bridge errors surfaced through the MCP."""


class BannedFlagError(CodexBridgeError):
    """A caller attempted to pass a denylisted Codex flag."""


class CodexExitError(CodexBridgeError):
    """Codex returned a non-zero exit code.

    Keeps the FULL stderr on the instance (`self.stderr`) but uses the TAIL
    of stderr in the string message — Codex prints a session header at the
    start and the actual `ERROR: { ... }` block at the end, so a head-truncated
    message hides the real failure.
    """

    _STDERR_MESSAGE_BUDGET = 4096

    def __init__(self, exit_code: int, stderr: str) -> None:
        if stderr and len(stderr) > self._STDERR_MESSAGE_BUDGET:
            tail = "...(stderr head truncated)...\n" + stderr[-self._STDERR_MESSAGE_BUDGET:]
        else:
            tail = stderr or ""
        super().__init__(f"codex exited {exit_code}: {tail}")
        self.exit_code = exit_code
        self.stderr = stderr


class CodexTimeoutError(CodexBridgeError):
    """Codex exceeded the wall-clock timeout."""


class InvalidCwdError(CodexBridgeError):
    """The provided working directory is invalid."""


class PathOutsideRepoError(CodexBridgeError):
    """A provided file path resolves outside the configured repo_root."""


class SecretInPayloadError(CodexBridgeError):
    """A payload matched a known secret pattern."""

    def __init__(self, pattern_name: str) -> None:
        super().__init__(f"payload matched secret pattern: {pattern_name}")
        self.pattern_name = pattern_name


class PayloadTooLargeError(CodexBridgeError):
    """A payload exceeds the configured size limit."""
