import json


def _server(plugin_root):
    data = json.loads((plugin_root / ".mcp.json").read_text())
    return data["mcpServers"]["codex-bridge"]


def test_command_uses_plugin_root(plugin_root):
    args = _server(plugin_root).get("args", [])
    for arg in args:
        looks_like_path = "/" in arg or arg.startswith(".")
        if looks_like_path:
            assert "${CLAUDE_PLUGIN_ROOT}" in arg, (
                f"Path arg without ${{CLAUDE_PLUGIN_ROOT}}: {arg!r}"
            )


def test_uv_directory_arg(plugin_root):
    server = _server(plugin_root)
    assert server.get("command") == "uv"
    expected = [
        "run",
        "--directory",
        "${CLAUDE_PLUGIN_ROOT}/servers/codex-bridge",
        "python",
        "mcp_server.py",
    ]
    assert server.get("args") == expected, (
        f"Expected args {expected}, got {server.get('args')}"
    )
