"""Resolve a payload from inline text or a file path under repo_root.

Single entry point used by all typed tools so size limits and secret
scanning are uniform. Path resolution must stay inside repo_root.

Inline text is capped at DEFAULT_MAX_BYTES_INLINE (256 KB) to keep MCP
messages small. Path-loaded content is capped at DEFAULT_MAX_BYTES_PATH
(4 MB) — the same as the diff hard cap. Callers can override either via
the explicit `max_bytes` argument.
"""

from pathlib import Path

from codex_bridge.errors import (
    PathOutsideRepoError,
    PayloadTooLargeError,
)
from codex_bridge.redaction import scan_payload

DEFAULT_MAX_BYTES_INLINE = 256 * 1024
DEFAULT_MAX_BYTES_PATH = 4 * 1024 * 1024


def load_payload(
    *,
    text: str | None = None,
    path: str | Path | None = None,
    repo_root: str | Path,
    max_bytes: int | None = None,
) -> str:
    if (text is None) == (path is None):
        raise ValueError("provide exactly one of text or path")
    if path is not None:
        resolved = Path(path).resolve()
        root = Path(repo_root).resolve()
        if not _is_within(resolved, root):
            raise PathOutsideRepoError(
                f"path {resolved} is not inside repo_root {root}"
            )
        if not resolved.is_file():
            raise FileNotFoundError(f"payload file not found: {resolved}")
        text = resolved.read_text(encoding="utf-8")
        limit = max_bytes if max_bytes is not None else DEFAULT_MAX_BYTES_PATH
    else:
        limit = max_bytes if max_bytes is not None else DEFAULT_MAX_BYTES_INLINE
    assert text is not None
    if len(text.encode("utf-8")) > limit:
        raise PayloadTooLargeError(
            f"payload exceeds {limit} bytes; pass via *_path or shrink"
        )
    scan_payload(text)
    return text


def _is_within(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
    except ValueError:
        return False
    return True
