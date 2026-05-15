"""Smoke-load mcp_server and confirm the four expected tools register."""

import asyncio
import sys
from pathlib import Path

# mcp_server.py lives at the server root (sibling of codex_bridge/).
SERVER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_ROOT))


def _list_tool_names(mcp) -> set[str]:
    """FastMCP exposes list_tools() as an async method — call it via asyncio."""
    tools = asyncio.run(mcp.list_tools())
    return {t.name for t in tools}


def test_mcp_server_loads_and_registers_four_tools():
    import mcp_server  # noqa: WPS433

    assert mcp_server.mcp.name == "codex-bridge"
    names = _list_tool_names(mcp_server.mcp)
    expected = {"codex_review_plan", "codex_review_diff", "codex_review_text", "codex_run"}
    assert names == expected, f"expected {expected}, got {names}"
