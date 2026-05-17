"""P3 — typed Codex tools prepend a Project-scope block when set.

When `<repo>/.workflow/state.json` carries a `codex_run_context` string,
every typed tool (codex_review_plan / codex_review_diff / codex_review_text)
prepends a "## Project scope" block to its stdin payload BEFORE the
existing "## Task summary" block. When no scope is set, the prompt is
byte-identical to the pre-P3 version (no surprise drift for runs that
never opted in).
"""

import json
from pathlib import Path

from codex_bridge.tools.review_plan import review_plan
from codex_bridge.tools.review_diff import review_diff
from codex_bridge.tools.review_text import review_text
from tests.conftest import fake_codex_runner


_CANNED = '{"verdict":"approve","summary":"ok"}'


def _setup_state_with_ctx(repo: Path, ctx: str) -> None:
    wf = repo / ".workflow"
    wf.mkdir(parents=True, exist_ok=True)
    (wf / "state.json").write_text(json.dumps({"codex_run_context": ctx}))


def _captured_stdin(runner) -> str:
    """The fake runner's first FakeProc records stdin in `passed_input`."""
    return runner.captured[0].passed_input


# --- review_plan ---------------------------------------------------------

def test_review_plan_prepends_scope_when_context_set(tmp_path):
    ctx = "Renderer is intentionally a minimal CommonMark subset; input is controlled."
    _setup_state_with_ctx(tmp_path, ctx)
    runner = fake_codex_runner(last_message=_CANNED)
    review_plan(
        plan_text="x",
        context={"repo_root": str(tmp_path), "task_summary": "y"},
        runner=runner,
    )
    stdin = _captured_stdin(runner)
    assert "## Project scope" in stdin
    assert ctx in stdin
    # Scope frames the review — must appear BEFORE the task summary.
    assert stdin.index("## Project scope") < stdin.index("## Task summary")


def test_review_plan_omits_scope_when_context_absent(tmp_path):
    """No state.json → no scope block; existing behavior preserved."""
    runner = fake_codex_runner(last_message=_CANNED)
    review_plan(
        plan_text="x",
        context={"repo_root": str(tmp_path), "task_summary": "y"},
        runner=runner,
    )
    assert "## Project scope" not in _captured_stdin(runner)


# --- review_diff ---------------------------------------------------------

def test_review_diff_prepends_scope_when_context_set(tmp_path):
    ctx = "Renderer is a subset, not CommonMark-strict."
    _setup_state_with_ctx(tmp_path, ctx)
    runner = fake_codex_runner(last_message=_CANNED)
    review_diff(
        diff_text="diff --git a/x b/x\n@@\n+y\n",
        context={"repo_root": str(tmp_path), "task_summary": "y"},
        runner=runner,
    )
    stdin = _captured_stdin(runner)
    assert "## Project scope" in stdin
    assert ctx in stdin


def test_review_diff_omits_scope_when_context_absent(tmp_path):
    runner = fake_codex_runner(last_message=_CANNED)
    review_diff(
        diff_text="diff --git a/x b/x\n@@\n+y\n",
        context={"repo_root": str(tmp_path), "task_summary": "y"},
        runner=runner,
    )
    assert "## Project scope" not in _captured_stdin(runner)


# --- review_text ---------------------------------------------------------

def test_review_text_prepends_scope_when_context_set(tmp_path):
    ctx = "Controlled input only; defensive checks for adversarial input are out of scope."
    _setup_state_with_ctx(tmp_path, ctx)
    runner = fake_codex_runner(last_message=_CANNED)
    review_text(
        payload="some content",
        skill_id="commit-pr-readiness-review",
        context={"repo_root": str(tmp_path), "task_summary": "y"},
        runner=runner,
    )
    stdin = _captured_stdin(runner)
    assert "## Project scope" in stdin
    assert ctx in stdin


def test_review_text_omits_scope_when_context_absent(tmp_path):
    runner = fake_codex_runner(last_message=_CANNED)
    review_text(
        payload="some content",
        skill_id="commit-pr-readiness-review",
        context={"repo_root": str(tmp_path), "task_summary": "y"},
        runner=runner,
    )
    assert "## Project scope" not in _captured_stdin(runner)
