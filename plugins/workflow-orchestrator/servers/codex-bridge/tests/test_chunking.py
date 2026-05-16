import pytest

from codex_bridge.chunking import (
    HARD_CAP_BYTES,
    aggregate_results,
    split_diff_by_file,
)
from codex_bridge.errors import PayloadTooLargeError
from codex_bridge.result import ReviewFinding, ReviewResult


def test_split_single_file():
    diff = "diff --git a/foo b/foo\nindex 1..2 100644\n--- a/foo\n+++ b/foo\n@@\n+x\n"
    chunks = split_diff_by_file(diff)
    assert len(chunks) == 1


def test_split_multi_file():
    diff = (
        "diff --git a/foo b/foo\nindex 1..2\n@@\n+x\n"
        "diff --git a/bar b/bar\nindex 3..4\n@@\n+y\n"
        "diff --git a/baz b/baz\nindex 5..6\n@@\n+z\n"
    )
    chunks = split_diff_by_file(diff)
    assert len(chunks) == 3
    assert chunks[0].startswith("diff --git a/foo")
    assert chunks[1].startswith("diff --git a/bar")
    assert chunks[2].startswith("diff --git a/baz")


def test_split_too_large_raises():
    huge = "diff --git a/x b/x\n" + ("a" * (HARD_CAP_BYTES + 1))
    with pytest.raises(PayloadTooLargeError):
        split_diff_by_file(huge)


def test_split_empty_returns_empty():
    assert split_diff_by_file("") == []


def test_aggregate_worst_verdict():
    r1 = ReviewResult(verdict="approve", summary="ok")
    r2 = ReviewResult(verdict="revise", summary="needs work")
    r3 = ReviewResult(verdict="reject", summary="bad")
    agg = aggregate_results([r1, r2, r3])
    assert agg.verdict == "reject"
    assert agg.meta["chunks"] == 3


def test_aggregate_findings_tagged_with_chunk():
    r1 = ReviewResult(
        verdict="revise", summary="x",
        findings=[ReviewFinding(severity="minor", where="foo.py:3", what="bad")],
    )
    r2 = ReviewResult(verdict="approve", summary="ok", findings=[])
    agg = aggregate_results([r1, r2])
    assert agg.findings[0].where.startswith("[chunk 1/2]")


def test_aggregate_empty():
    agg = aggregate_results([])
    assert agg.verdict == "approve"
    assert agg.meta["chunks"] == 0
