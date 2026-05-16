import json

from codex_bridge.chunking import MAX_PAYLOAD_BYTES
from codex_bridge.tools.review_diff import review_diff
from tests.conftest import fake_codex_runner


def test_review_diff_single_chunk(tmp_path):
    runner = fake_codex_runner(last_message=json.dumps({"verdict": "approve", "summary": "ok"}))
    diff = "diff --git a/foo b/foo\nindex 1..2\n--- a/foo\n+++ b/foo\n@@\n+x\n"
    out = review_diff(
        diff_text=diff,
        context={"repo_root": str(tmp_path), "task_summary": ""},
        runner=runner,
    )
    assert out["verdict"] == "approve"
    assert out["meta"]["chunks"] == 1
    # Single chunk → one Codex call.
    assert len(runner.captured) == 1  # type: ignore[attr-defined]


def test_review_diff_multi_chunk_aggregates(tmp_path):
    runner = fake_codex_runner(last_message=json.dumps({"verdict": "revise", "summary": "x"}))
    # Build a diff > MAX_PAYLOAD_BYTES with 3 files.
    big_hunk = "+" + ("x" * (MAX_PAYLOAD_BYTES // 2)) + "\n"
    diff = (
        f"diff --git a/foo b/foo\nindex 1..2\n@@\n{big_hunk}"
        f"diff --git a/bar b/bar\nindex 3..4\n@@\n{big_hunk}"
        f"diff --git a/baz b/baz\nindex 5..6\n@@\n{big_hunk}"
    )
    out = review_diff(
        diff_text=diff,
        context={"repo_root": str(tmp_path), "task_summary": ""},
        runner=runner,
    )
    assert out["meta"]["chunks"] == 3
    assert out["verdict"] == "revise"
    assert len(runner.captured) == 3  # type: ignore[attr-defined]
