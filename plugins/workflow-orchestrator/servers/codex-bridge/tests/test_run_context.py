"""P3 — persistent codex_run_context.

The plugin's `<repo>/.workflow/state.json` carries an optional
`codex_run_context` field set once per workflow run. Every typed Codex
tool reads it via `codex_bridge.run_context.load_run_context(repo_root)`
and prepends a "## Project scope" block to its prompt when the field is
set. When missing, malformed, or empty, the loader returns None and no
block is prepended.
"""

import json
from pathlib import Path

import pytest

from codex_bridge.run_context import load_run_context


def _write_state(repo: Path, payload: dict | str) -> None:
    wf = repo / ".workflow"
    wf.mkdir(parents=True, exist_ok=True)
    sf = wf / "state.json"
    if isinstance(payload, dict):
        sf.write_text(json.dumps(payload), encoding="utf-8")
    else:
        sf.write_text(payload, encoding="utf-8")


def test_returns_value_when_set(tmp_path):
    _write_state(tmp_path, {
        "schema_version": 1,
        "codex_run_context": "Renderer is a minimal subset of CommonMark.",
    })
    out = load_run_context(tmp_path)
    assert out == "Renderer is a minimal subset of CommonMark."


def test_returns_none_when_state_file_missing(tmp_path):
    """No .workflow/state.json at all — caller invoked the tool directly."""
    assert load_run_context(tmp_path) is None


def test_returns_none_when_field_absent(tmp_path):
    """state.json exists but predates P3 (no codex_run_context key)."""
    _write_state(tmp_path, {"schema_version": 1, "task": {"title": "x"}})
    assert load_run_context(tmp_path) is None


def test_returns_none_when_field_is_null(tmp_path):
    _write_state(tmp_path, {"codex_run_context": None})
    assert load_run_context(tmp_path) is None


def test_returns_none_when_field_is_empty_string(tmp_path):
    """Empty string should behave the same as null — no scope block to inject."""
    _write_state(tmp_path, {"codex_run_context": ""})
    assert load_run_context(tmp_path) is None


def test_returns_none_when_field_is_whitespace_only(tmp_path):
    _write_state(tmp_path, {"codex_run_context": "   \n\t  "})
    assert load_run_context(tmp_path) is None


def test_returns_none_when_state_file_is_malformed_json(tmp_path):
    _write_state(tmp_path, "{ not json")
    assert load_run_context(tmp_path) is None


def test_returns_none_when_field_is_not_string(tmp_path):
    """Defensive: a dict/list in the field shouldn't crash the loader."""
    _write_state(tmp_path, {"codex_run_context": {"oops": 1}})
    assert load_run_context(tmp_path) is None


def test_accepts_repo_root_as_string(tmp_path):
    """The loader is called with `context["repo_root"]` which is a str."""
    _write_state(tmp_path, {"codex_run_context": "ok"})
    assert load_run_context(str(tmp_path)) == "ok"


# ---------------------------------------------------------------------------
# Scope-block formatter (single source of truth for prompt prefixing).
# ---------------------------------------------------------------------------

from codex_bridge.run_context import format_scope_block


def test_format_scope_block_returns_empty_when_no_context(tmp_path):
    """Empty string preserves byte-identical prompts for runs without a scope."""
    assert format_scope_block(tmp_path) == ""


def test_format_scope_block_wraps_context(tmp_path):
    ctx = "Renderer is a minimal subset."
    _write_state(tmp_path, {"codex_run_context": ctx})
    block = format_scope_block(tmp_path)
    assert "## Project scope" in block
    assert ctx in block
    # Block must end with a blank-line separator so it slots cleanly before
    # the next "##" section.
    assert block.endswith("\n\n")
