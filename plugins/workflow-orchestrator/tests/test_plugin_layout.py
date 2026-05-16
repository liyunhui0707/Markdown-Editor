import json


def test_manifest_path(plugin_root):
    manifest = plugin_root / ".claude-plugin" / "plugin.json"
    assert manifest.is_file(), f"Missing manifest: {manifest}"
    data = json.loads(manifest.read_text())
    assert data.get("name") == "workflow-orchestrator"


def test_plugin_mcp_present(plugin_root):
    mcp = plugin_root / ".mcp.json"
    assert mcp.is_file(), f"Missing plugin .mcp.json: {mcp}"
    data = json.loads(mcp.read_text())
    assert "codex-bridge" in data.get("mcpServers", {})
