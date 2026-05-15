import json

from codex_bridge.tools.review_plan import review_plan
from tests.conftest import fake_codex_runner


def test_review_plan_happy_path(tmp_path):
    last = json.dumps({
        "verdict": "approve",
        "summary": "Plan looks solid.",
        "findings": [],
    })
    runner = fake_codex_runner(last_message=last)
    out = review_plan(
        plan_text="A short plan.",
        context={"repo_root": str(tmp_path), "task_summary": "fix bug"},
        runner=runner,
    )
    assert out["verdict"] == "approve"
    assert out["summary"] == "Plan looks solid."
    assert out["meta"]["tool"] == "codex_review_plan"
    # Confirm the canonical argv was used (root flag before exec).
    argv = runner.captured[0].captured_argv  # type: ignore[attr-defined]
    assert argv[0] == "codex"
    assert argv.index("--ask-for-approval") < argv.index("exec")
    assert argv[-1] == "-"


def test_review_plan_uses_review_plan_schema(tmp_path):
    runner = fake_codex_runner(last_message='{"verdict":"revise","summary":"x"}')
    review_plan(
        plan_text="x",
        context={"repo_root": str(tmp_path), "task_summary": ""},
        runner=runner,
    )
    argv = runner.captured[0].captured_argv  # type: ignore[attr-defined]
    schema_idx = argv.index("--output-schema")
    schema_path = argv[schema_idx + 1]
    assert schema_path.endswith("review_plan.schema.json")
