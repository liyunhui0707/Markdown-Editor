"""Grep test: the bypass flag must not appear in production code paths.

The only allowed occurrences are:
  - inside `codex_bridge/flags.py` (the DENYLIST definition)
  - inside `tests/` (assertion fixtures)
"""

from pathlib import Path

BYPASS = "dangerously-bypass-approvals-and-sandbox"


def test_bypass_flag_not_in_production_code():
    server_root = Path(__file__).resolve().parents[1]
    pkg_root = server_root / "codex_bridge"
    offenders = []
    for path in pkg_root.rglob("*.py"):
        if path.name == "flags.py":
            continue
        if BYPASS in path.read_text(encoding="utf-8"):
            offenders.append(str(path))
    assert not offenders, (
        f"Bypass flag string found outside flags.py: {offenders}"
    )
