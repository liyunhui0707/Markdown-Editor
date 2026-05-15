from pathlib import Path
from typing import Callable

from codex_bridge.chunking import (
    MAX_PAYLOAD_BYTES,
    aggregate_results,
    split_diff_by_file,
)
from codex_bridge.payload import load_payload
from codex_bridge.tools._invoke import invoke_review

_SCHEMA = (
    Path(__file__).resolve().parents[2] / "schemas" / "review_diff.schema.json"
)


def review_diff(
    *,
    diff_text: str | None = None,
    diff_path: str | None = None,
    context: dict,
    runner: Callable | None = None,
) -> dict:
    """Codex review of a git diff. Chunks by file when over MAX_PAYLOAD_BYTES."""
    repo_root = Path(context["repo_root"])
    # Diff payloads can be large; bypass the inline limit by using a higher
    # ceiling here and lean on chunking. Secret-scanning still applies.
    payload = load_payload(
        text=diff_text,
        path=diff_path,
        repo_root=repo_root,
        max_bytes=4 * 1024 * 1024,
    )
    if len(payload.encode("utf-8")) <= MAX_PAYLOAD_BYTES:
        result = invoke_review(
            repo_root=repo_root,
            schema=_SCHEMA,
            payload=_compose_prompt(payload, context),
            tool_name="codex_review_diff",
            runner=runner,
        )
        return result.to_dict()

    chunks = split_diff_by_file(payload)
    per_chunk_results = [
        invoke_review(
            repo_root=repo_root,
            schema=_SCHEMA,
            payload=_compose_prompt(chunk, context),
            tool_name="codex_review_diff",
            runner=runner,
        )
        for chunk in chunks
    ]
    return aggregate_results(per_chunk_results).to_dict()


def _compose_prompt(diff: str, context: dict) -> str:
    summary = context.get("task_summary", "")
    return (
        "You are reviewing a git diff. "
        "Respond ONLY with JSON conforming to the provided output schema.\n\n"
        f"## Task summary\n{summary}\n\n"
        f"## Diff\n{diff}\n"
    )
