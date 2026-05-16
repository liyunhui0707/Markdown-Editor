import json

from codex_bridge.result import parse_review


def test_parse_schema_conformant():
    raw = json.dumps({
        "verdict": "approve",
        "summary": "Looks good.",
        "findings": [
            {"severity": "minor", "where": "plan §3", "what": "nit", "suggested_fix": "x"}
        ],
    })
    r = parse_review(raw, tool="codex_review_plan")
    assert r.verdict == "approve"
    assert r.summary == "Looks good."
    assert len(r.findings) == 1
    assert r.findings[0].severity == "minor"
    assert r.meta["tool"] == "codex_review_plan"


def test_parse_freetext_fallback():
    raw = "Codex said something that isn't JSON at all."
    r = parse_review(raw, tool="codex_review_diff")
    assert r.verdict == "revise"
    assert "Codex said" in r.summary
    assert r.raw_output == raw
    assert r.findings == []


def test_parse_empty_output():
    r = parse_review("", tool="codex_run")
    assert r.verdict == "revise"
    assert "(empty output)" in r.summary


def test_parse_invalid_verdict_falls_back():
    raw = json.dumps({"verdict": "maybe", "summary": "x"})
    r = parse_review(raw, tool="codex_review_text")
    assert r.verdict == "revise"


def test_review_result_to_dict_roundtrip():
    raw = json.dumps({"verdict": "reject", "summary": "no", "findings": []})
    r = parse_review(raw, tool="codex_review_plan")
    d = r.to_dict()
    assert d["verdict"] == "reject"
    assert d["summary"] == "no"
    assert "meta" in d
