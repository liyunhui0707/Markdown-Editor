from pathlib import Path
from typing import Callable

from codex_bridge.payload import load_payload
from codex_bridge.run_context import format_scope_block
from codex_bridge.tools._invoke import invoke_review

_SCHEMA = (
    Path(__file__).resolve().parents[2] / "schemas" / "review_text.schema.json"
)

ALLOWED_SKILL_IDS = frozenset({
    "issue-investigation-plan-review",
    "commit-pr-readiness-review",
    "pr-final-merge-review",
    "answer-fact-check-review",
})


def review_text(
    *,
    payload: str | None = None,
    payload_path: str | None = None,
    skill_id: str,
    context: dict,
    runner: Callable | None = None,
) -> dict:
    """Codex review of generic text, parameterised by skill_id."""
    if skill_id not in ALLOWED_SKILL_IDS:
        raise ValueError(
            f"skill_id must be one of {sorted(ALLOWED_SKILL_IDS)}; got {skill_id!r}"
        )
    repo_root = Path(context["repo_root"])
    body = load_payload(text=payload, path=payload_path, repo_root=repo_root)
    prompt = _compose_prompt(body, skill_id, context)
    result = invoke_review(
        repo_root=repo_root,
        schema=_SCHEMA,
        payload=prompt,
        tool_name="codex_review_text",
        runner=runner,
    )
    return result.to_dict()


def _compose_prompt(body: str, skill_id: str, context: dict) -> str:
    summary = context.get("task_summary", "")
    scope = format_scope_block(context["repo_root"])
    return (
        f"You are running the {skill_id} review skill. "
        "Respond ONLY with JSON conforming to the provided output schema.\n\n"
        f"{scope}"
        f"## Task summary\n{summary}\n\n"
        f"## Content to review\n{body}\n"
    )
