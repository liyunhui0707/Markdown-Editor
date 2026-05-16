"""Audit probes F-7 and F-8 — design-evidence assertions.

F-7: no cache-drift detector lives in production source (drift handling is
     by-design manual reinstall, not automated). Restricted to executable
     source files (*.py, *.sh, *.toml); docs are excluded so AUDIT.md can
     freely cite cache-drift terms without poisoning its own probe.

F-8: gate-on-disk recovery is already pinned by an existing test in
     tests/test_workflow_state.py — this probe is a pure source-text check
     that the existing test still names and asserts the right things.
"""

import re
from pathlib import Path


# ---------------------------------------------------------------------------
# F-7 — Cache-drift detector presence (source-only grep)
# ---------------------------------------------------------------------------

def test_no_cache_drift_detector_exists(plugin_root):
    """Grep production source (*.py, *.sh, *.toml) for cache-drift terms.

    Excludes tests/, __pycache__/, .venv/, and all *.md docs. Property:
    zero matches across the executable surface. If this ever fires we have
    a detector we did not document — treat as `latent` and re-inspect.
    """
    needle = re.compile(r"installed_copy|cache_drift|\.claude/plugins/cache")
    matches: list[str] = []
    exclude_dirs = {"tests", "__pycache__", ".venv"}
    allowed_suffixes = {".py", ".sh", ".toml"}

    for path in plugin_root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix not in allowed_suffixes:
            continue
        # Skip if any path component is an excluded directory.
        parts = set(path.relative_to(plugin_root).parts)
        if parts & exclude_dirs:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for i, line in enumerate(text.splitlines(), start=1):
            if needle.search(line):
                rel = path.relative_to(plugin_root)
                matches.append(f"{rel}:{i}:{line.rstrip()}")
    assert not matches, (
        "expected zero cache-drift terms in production source; found:\n"
        + "\n".join(matches)
    )


# ---------------------------------------------------------------------------
# F-8 — Existing resume test pins pending_gate recovery
# ---------------------------------------------------------------------------

def test_existing_resume_test_pins_pending_gate_recovery(plugin_root):
    """test_workflow_state.py must contain a function
    `test_resume_returns_pending_gate` whose body references BOTH
    ``set-gate`` and a ``pending_gate`` assertion. This is the only
    evidence we have that /clear mid-workflow can recover from disk, so
    its source must not silently rot.
    """
    path = plugin_root / "tests" / "test_workflow_state.py"
    assert path.is_file(), f"{path} missing"
    text = path.read_text(encoding="utf-8")

    func_match = re.search(
        r"^def\s+test_resume_returns_pending_gate\s*\([^)]*\)\s*:\s*\n"
        r"(?P<body>(?:    .*\n|    \n|\n)+)",
        text,
        flags=re.MULTILINE,
    )
    assert func_match, (
        "test_resume_returns_pending_gate not found in test_workflow_state.py; "
        "AUDIT.md F-8 cites this test as evidence for soft spot #8"
    )
    body = func_match.group("body")
    assert "set-gate" in body, (
        "test_resume_returns_pending_gate must drive set-gate to produce a "
        "real on-disk pending_gate before asserting recovery"
    )
    assert re.search(r"pending_gate", body), (
        "test_resume_returns_pending_gate must assert against pending_gate"
    )
