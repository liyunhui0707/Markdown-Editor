"""Secret-pattern scanner for payloads about to be sent to Codex.

Policy is REFUSE (raise SecretInPayloadError) on any match, not silent
redaction — silent redaction risks Codex reviewing the wrong content. Names
are reported in the error; matched values never appear in messages or logs.
"""

import re
from typing import Pattern

from codex_bridge.errors import SecretInPayloadError

_PATTERNS: list[tuple[str, Pattern[str]]] = [
    ("aws_access_key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("anthropic_api_key", re.compile(r"sk-ant-[A-Za-z0-9_\-]{40,}")),
    ("openai_api_key", re.compile(r"sk-[A-Za-z0-9]{32,}")),
    ("github_token", re.compile(r"gh[poursb]_[A-Za-z0-9]{36,}")),
    ("slack_token", re.compile(r"xox[baprs]-[A-Za-z0-9\-]{10,}")),
    ("private_key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----")),
]

_ENV_LINE = re.compile(
    r"(?m)^[A-Z][A-Z0-9_]+\s*=\s*['\"]?[A-Za-z0-9_+/=.\-]{16,}"
)
_ENV_HEURISTIC_THRESHOLD = 3


def scan_payload(text: str) -> None:
    """Raise SecretInPayloadError if `text` matches any known secret pattern."""
    for name, pat in _PATTERNS:
        if pat.search(text):
            raise SecretInPayloadError(name)
    if len(_ENV_LINE.findall(text)) >= _ENV_HEURISTIC_THRESHOLD:
        raise SecretInPayloadError("env_file_heuristic")
