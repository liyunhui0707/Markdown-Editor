"""Parse Codex's `--output-last-message` text into a typed ReviewResult.

Schema-conformant JSON (matching the per-tool schema in `schemas/`) populates
all fields. Anything else falls back to verdict="revise" so the orchestrator
still has a safe answer to show the user.
"""

import json
from dataclasses import dataclass, field

VALID_VERDICTS = ("approve", "revise", "reject")


@dataclass
class ReviewFinding:
    severity: str
    where: str
    what: str
    suggested_fix: str = ""


@dataclass
class ReviewResult:
    verdict: str
    summary: str
    findings: list[ReviewFinding] = field(default_factory=list)
    raw_output: str = ""
    meta: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "verdict": self.verdict,
            "summary": self.summary,
            "findings": [
                {
                    "severity": f.severity,
                    "where": f.where,
                    "what": f.what,
                    "suggested_fix": f.suggested_fix,
                }
                for f in self.findings
            ],
            "raw_output": self.raw_output,
            "meta": self.meta,
        }


def parse_review(raw: str, *, tool: str, duration_ms: int = 0) -> ReviewResult:
    meta = {
        "tool": tool,
        "duration_ms": duration_ms,
        "chunks": 1,
        "schema_version": "1",
    }
    try:
        obj = json.loads(raw) if raw else None
    except (ValueError, TypeError):
        obj = None

    if not isinstance(obj, dict):
        summary = (raw.strip()[:280] if raw and raw.strip() else "(empty output)")
        return ReviewResult(
            verdict="revise",
            summary=summary,
            findings=[],
            raw_output=raw,
            meta=meta,
        )

    verdict = obj.get("verdict", "revise")
    if verdict not in VALID_VERDICTS:
        verdict = "revise"
    findings = [
        ReviewFinding(
            severity=f.get("severity", "minor"),
            where=f.get("where", ""),
            what=f.get("what", ""),
            suggested_fix=f.get("suggested_fix", ""),
        )
        for f in obj.get("findings", [])
        if isinstance(f, dict)
    ]
    return ReviewResult(
        verdict=verdict,
        summary=obj.get("summary", ""),
        findings=findings,
        raw_output=raw,
        meta=meta,
    )
