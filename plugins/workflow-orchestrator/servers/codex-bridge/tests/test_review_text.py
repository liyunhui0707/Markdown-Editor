import json

import pytest

from codex_bridge.tools.review_text import ALLOWED_SKILL_IDS, review_text
from tests.conftest import fake_codex_runner


@pytest.mark.parametrize("skill_id", sorted(ALLOWED_SKILL_IDS))
def test_review_text_each_allowed_skill(tmp_path, skill_id):
    runner = fake_codex_runner(last_message=json.dumps({"verdict": "approve", "summary": "ok"}))
    out = review_text(
        payload="some content",
        skill_id=skill_id,
        context={"repo_root": str(tmp_path), "task_summary": "t"},
        runner=runner,
    )
    assert out["verdict"] == "approve"
    assert out["meta"]["tool"] == "codex_review_text"


def test_review_text_rejects_unknown_skill(tmp_path):
    with pytest.raises(ValueError):
        review_text(
            payload="x",
            skill_id="not-a-real-skill",
            context={"repo_root": str(tmp_path), "task_summary": ""},
            runner=fake_codex_runner(),
        )


def test_review_text_uses_text_schema(tmp_path):
    runner = fake_codex_runner(last_message=json.dumps({"verdict": "revise", "summary": "x"}))
    review_text(
        payload="x",
        skill_id="commit-pr-readiness-review",
        context={"repo_root": str(tmp_path), "task_summary": ""},
        runner=runner,
    )
    argv = runner.captured[0].captured_argv  # type: ignore[attr-defined]
    schema = argv[argv.index("--output-schema") + 1]
    assert schema.endswith("review_text.schema.json")
