"""Audit probe T9 — production paths must not reference the fake runner.

The fake-runner harness (``fake_codex_runner``, ``FakeProc``, any
``runner=fake`` assignment, any ``--runner fake`` CLI form) lives in
``servers/codex-bridge/tests/conftest.py`` and is for tests only.
Production code in ``codex_bridge/`` must never import or alias it;
doing so would let Codex calls be silently stubbed in real workflows.

Per step-7 review (F-7.minor) the regex now covers whitespace, quoted,
and CLI-flag variants — not just the literal ``runner=fake``.

This complements ``test_no_bypass.py`` (which guards the
``dangerously-bypass-approvals-and-sandbox`` flag) with the same
strategy: recursive scan, allowlist excluded.
"""

import re
from pathlib import Path

# Each pattern is a (name, compiled-regex) pair. Names appear in error output
# without leaking secrets or matched bytes beyond the needle.
PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("fake_codex_runner_symbol", re.compile(r"\bfake_codex_runner\b")),
    ("FakeProc_symbol", re.compile(r"\bFakeProc\b")),
    # `runner = fake` / `runner=fake` / `runner = "fake"` / `runner='fake'`
    ("runner_eq_fake_assignment", re.compile(r"\brunner\s*=\s*['\"]?fake\b")),
    # CLI forms: `--runner fake`, `--runner=fake`, `--runner="fake"`
    ("runner_cli_flag_fake", re.compile(r"--runner[\s=]+['\"]?fake\b")),
)


def test_production_paths_do_not_inject_fake_runner():
    """Recursive scan of codex_bridge/ for any fake-runner pattern.

    Excludes:
      - tests/         (fake runner is a legitimate test fixture there)
      - __pycache__/   (compiled bytecode)
    """
    server_root = Path(__file__).resolve().parents[1]
    pkg_root = server_root / "codex_bridge"
    assert pkg_root.is_dir(), f"{pkg_root} not found"

    offenders: list[str] = []
    for path in pkg_root.rglob("*.py"):
        parts = set(path.relative_to(pkg_root).parts)
        if "tests" in parts or "__pycache__" in parts:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for name, pattern in PATTERNS:
            if pattern.search(text):
                offenders.append(f"{path.relative_to(server_root)}: {name}")

    assert not offenders, (
        "fake-runner pattern leaked into production code:\n"
        + "\n".join(offenders)
    )
