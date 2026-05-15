"""Enforce the project file-size rule for plugin-owned source files.

Generated artifacts (uv.lock, venvs, caches) are skipped. The orchestrator
servers tree and the skill/bin source tree are both checked.
"""

LIMIT = 280
_CHECK_SUFFIXES = (".py", ".md", ".sh", ".toml", ".json")
_SKIP_DIR_NAMES = {".venv", "__pycache__", ".pytest_cache"}
_SKIP_FILE_NAMES = {"uv.lock"}


def test_no_plugin_source_exceeds_limit(plugin_root):
    failures = []
    for path in plugin_root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(plugin_root)
        if any(p in _SKIP_DIR_NAMES for p in rel.parts):
            continue
        if path.name in _SKIP_FILE_NAMES:
            continue
        if path.suffix not in _CHECK_SUFFIXES:
            continue
        with path.open("rb") as f:
            line_count = sum(1 for _ in f)
        if line_count > LIMIT:
            failures.append(f"{rel}: {line_count} lines (limit {LIMIT})")
    assert not failures, (
        "Plugin-owned source files exceed the per-file line limit:\n"
        + "\n".join(failures)
    )
