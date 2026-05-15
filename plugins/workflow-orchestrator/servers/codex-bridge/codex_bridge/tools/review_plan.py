from pathlib import Path
from typing import Callable

from codex_bridge.payload import load_payload
from codex_bridge.tools._invoke import invoke_review

_SCHEMA = (
    Path(__file__).resolve().parents[2] / "schemas" / "review_plan.schema.json"
)


def review_plan(
    *,
    plan_text: str | None = None,
    plan_path: str | None = None,
    context: dict,
    runner: Callable | None = None,
) -> dict:
    """Codex review of an implementation plan. Returns a ReviewResult dict."""
    repo_root = Path(context["repo_root"])
    payload = load_payload(text=plan_text, path=plan_path, repo_root=repo_root)
    prompt = _compose_prompt(payload, context)
    result = invoke_review(
        repo_root=repo_root,
        schema=_SCHEMA,
        payload=prompt,
        tool_name="codex_review_plan",
        runner=runner,
    )
    return result.to_dict()


def _compose_prompt(plan: str, context: dict) -> str:
    summary = context.get("task_summary", "")
    return (
        "You are reviewing an engineering implementation plan. "
        "Respond ONLY with JSON conforming to the provided output schema.\n\n"
        f"## Task summary\n{summary}\n\n"
        f"## Plan\n{plan}\n"
    )
