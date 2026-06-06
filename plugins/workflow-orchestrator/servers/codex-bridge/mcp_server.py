"""FastMCP entry point for the codex-bridge plugin server."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mcp.server.fastmcp import FastMCP  # noqa: E402

from codex_bridge.tools.review_plan import review_plan as _review_plan  # noqa: E402
from codex_bridge.tools.review_diff import review_diff as _review_diff  # noqa: E402
from codex_bridge.tools.review_text import review_text as _review_text  # noqa: E402
from codex_bridge.tools.run import codex_run as _codex_run  # noqa: E402

mcp = FastMCP("codex-bridge")


@mcp.tool(name="codex_review_plan")
def codex_review_plan(plan_text: str | None = None,
                      plan_path: str | None = None,
                      context: dict | None = None) -> dict:
    """Review an implementation plan via Codex. Requires context["repo_root"] (absolute path); a KeyError is raised if omitted. Returns a ReviewResult."""
    return _review_plan(plan_text=plan_text, plan_path=plan_path, context=context or {})


@mcp.tool(name="codex_review_diff")
def codex_review_diff(diff_text: str | None = None,
                      diff_path: str | None = None,
                      context: dict | None = None) -> dict:
    """Review a git diff via Codex. Requires context["repo_root"] (absolute path); diff_path, if used, must live inside repo_root. Chunks by file when over the inline limit."""
    return _review_diff(diff_text=diff_text, diff_path=diff_path, context=context or {})


@mcp.tool(name="codex_review_text")
def codex_review_text(skill_id: str,
                      payload: str | None = None,
                      payload_path: str | None = None,
                      context: dict | None = None) -> dict:
    """Generic Codex text review, parameterised by Codex-owned skill id. Requires context["repo_root"] (absolute path); a KeyError is raised if omitted."""
    return _review_text(
        payload=payload, payload_path=payload_path,
        skill_id=skill_id, context=context or {},
    )


@mcp.tool(name="codex_run")
def codex_run(prompt: str, cwd: str, timeout: int | None = None) -> dict:
    """FALLBACK ONLY. Direct Codex invocation; prefer typed review tools. timeout defaults to CODEX_BRIDGE_TIMEOUT_SECONDS or 900s."""
    return _codex_run(prompt=prompt, cwd=cwd, timeout=timeout)


if __name__ == "__main__":
    mcp.run()
