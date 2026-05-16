"""Diff chunking + per-chunk review aggregation.

Diffs above MAX_PAYLOAD_BYTES are split at `diff --git` file boundaries and
sent to Codex one chunk at a time. Aggregation picks the worst verdict
across chunks and tags findings with their origin chunk.
"""

import re

from codex_bridge.errors import PayloadTooLargeError
from codex_bridge.result import ReviewFinding, ReviewResult

MAX_PAYLOAD_BYTES = 256 * 1024
HARD_CAP_BYTES = 4 * 1024 * 1024

_FILE_HEADER = re.compile(r"^diff --git ", re.MULTILINE)

_VERDICT_RANK = {"approve": 0, "revise": 1, "reject": 2}


def split_diff_by_file(diff_text: str) -> list[str]:
    """Split a unified diff into per-file chunks by `diff --git` boundaries."""
    if len(diff_text.encode("utf-8")) > HARD_CAP_BYTES:
        raise PayloadTooLargeError(
            f"diff exceeds hard cap of {HARD_CAP_BYTES} bytes; split the change"
        )
    if not diff_text:
        return []
    matches = list(_FILE_HEADER.finditer(diff_text))
    if not matches:
        return [diff_text]
    chunks = []
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(diff_text)
        chunks.append(diff_text[start:end])
    return chunks


def aggregate_results(results: list[ReviewResult]) -> ReviewResult:
    if not results:
        return ReviewResult(
            verdict="approve",
            summary="empty diff",
            meta={"tool": "codex_review_diff", "chunks": 0, "schema_version": "1"},
        )
    worst = max(results, key=lambda r: _VERDICT_RANK.get(r.verdict, 1))
    all_findings: list[ReviewFinding] = []
    for i, r in enumerate(results):
        for f in r.findings:
            all_findings.append(
                ReviewFinding(
                    severity=f.severity,
                    where=f"[chunk {i+1}/{len(results)}] {f.where}",
                    what=f.what,
                    suggested_fix=f.suggested_fix,
                )
            )
    return ReviewResult(
        verdict=worst.verdict,
        summary=(
            f"Aggregated review across {len(results)} chunk(s); "
            f"worst verdict: {worst.verdict}."
        ),
        findings=all_findings,
        raw_output="\n\n".join(r.raw_output for r in results),
        meta={
            "tool": results[0].meta.get("tool", "codex_review_diff"),
            "chunks": len(results),
            "schema_version": "1",
        },
    )
