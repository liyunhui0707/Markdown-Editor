"""Pin the codex-bridge tool docstring contract.

Reads mcp_server.py as text + AST and asserts:

1. Each typed-tool @mcp.tool docstring's FIRST PARAGRAPH documents the
   implicit context["repo_root"] requirement that fires KeyError on
   omission (and, for codex_review_diff, the diff_path-inside-repo_root
   constraint).
2. The four @mcp.tool function signatures + decorators are intact —
   any accidental signature drift during a future docstring rewrite
   trips this guard before it reaches integration tests.

First-paragraph (not whole-docstring) assertions exist because some
MCP clients only render the first paragraph of a tool's description;
hiding the contract behind a blank line would defeat the point.
"""

import ast
import re

_REPO_ROOT_PATTERN = re.compile(r'''context\[["']repo_root["']\]''')
_INSIDE_REPO_ROOT_PATTERN = re.compile(r'(?i)(inside|under|below)\s+repo_root')

# Each entry: tool_name (must match @mcp.tool(name=...)),
# params as (param_name, has_default, default_value_repr_or_None).
# default_value_repr_or_None uses ast.unparse() for None/literal defaults
# so the comparison is exact ("None" vs "300" vs "'foo'").
_EXPECTED_SIGNATURES = {
    "codex_review_plan": {
        "tool_name": "codex_review_plan",
        "params": [
            ("plan_text", True, "None"),
            ("plan_path", True, "None"),
            ("context",   True, "None"),
        ],
    },
    "codex_review_diff": {
        "tool_name": "codex_review_diff",
        "params": [
            ("diff_text", True, "None"),
            ("diff_path", True, "None"),
            ("context",   True, "None"),
        ],
    },
    "codex_review_text": {
        "tool_name": "codex_review_text",
        "params": [
            ("skill_id",     False, None),
            ("payload",      True,  "None"),
            ("payload_path", True,  "None"),
            ("context",      True,  "None"),
        ],
    },
    "codex_run": {
        "tool_name": "codex_run",
        "params": [
            ("prompt",  False, None),
            ("cwd",     False, None),
            ("timeout", True,  "None"),
        ],
    },
}


def _mcp_server_path(plugin_root):
    return plugin_root / "servers" / "codex-bridge" / "mcp_server.py"


def _docstring_first_paragraph(func_name, plugin_root):
    """Return the first paragraph (text up to the first blank line) of
    the given function's docstring, or None if not found."""
    tree = ast.parse(_mcp_server_path(plugin_root).read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == func_name:
            doc = ast.get_docstring(node)
            if doc is None:
                return None
            # First paragraph = text before first blank line.
            return doc.split("\n\n", 1)[0]
    return None


def test_codex_review_plan_first_paragraph_mentions_repo_root(plugin_root):
    para = _docstring_first_paragraph("codex_review_plan", plugin_root)
    assert para is not None, "codex_review_plan docstring not found"
    assert _REPO_ROOT_PATTERN.search(para), (
        f'codex_review_plan first-paragraph docstring must mention '
        f'context["repo_root"]; got: {para!r}'
    )


def test_codex_review_text_first_paragraph_mentions_repo_root(plugin_root):
    para = _docstring_first_paragraph("codex_review_text", plugin_root)
    assert para is not None
    assert _REPO_ROOT_PATTERN.search(para), (
        f'codex_review_text first-paragraph docstring must mention '
        f'context["repo_root"]; got: {para!r}'
    )


def test_codex_review_diff_first_paragraph_mentions_repo_root_and_inside_constraint(plugin_root):
    para = _docstring_first_paragraph("codex_review_diff", plugin_root)
    assert para is not None
    assert _REPO_ROOT_PATTERN.search(para), (
        f'codex_review_diff first-paragraph docstring must mention '
        f'context["repo_root"]; got: {para!r}'
    )
    assert _INSIDE_REPO_ROOT_PATTERN.search(para), (
        f'codex_review_diff first-paragraph docstring must mention '
        f'the diff_path-inside-repo_root constraint; got: {para!r}'
    )


def _mcp_tool_name_from_decorator(decorator):
    """Return the value of @mcp.tool(name="X") if decorator matches; else None.
    Only matches Call decorators whose func is `mcp.tool`."""
    if not isinstance(decorator, ast.Call):
        return None
    f = decorator.func
    if not (isinstance(f, ast.Attribute) and f.attr == "tool"
            and isinstance(f.value, ast.Name) and f.value.id == "mcp"):
        return None
    for kw in decorator.keywords:
        if kw.arg == "name" and isinstance(kw.value, ast.Constant):
            return kw.value.value
    return None


def _param_shape(args):
    """Return a list of (name, has_default, default_value_repr_or_None)
    for an ast.arguments. Positional + keyword-only included."""
    positional = list(args.args)
    pos_defaults = list(args.defaults)
    # Align defaults to the tail of positional args (Python's standard rule).
    pos_with_defaults = [None] * (len(positional) - len(pos_defaults)) + pos_defaults
    out = []
    for arg, default in zip(positional, pos_with_defaults):
        out.append(
            (arg.arg, default is not None,
             ast.unparse(default) if default is not None else None)
        )
    for arg, default in zip(args.kwonlyargs, args.kw_defaults):
        out.append(
            (arg.arg, default is not None,
             ast.unparse(default) if default is not None else None)
        )
    return out


def test_mcp_tool_signatures_and_decorators_intact(plugin_root):
    """AST guard: assert each @mcp.tool function's exposed contract is intact.

    Specifically:
    - the decorator is @mcp.tool(name="X") and X matches the expected tool name
      (renaming a tool here would silently change the MCP-visible identifier);
    - parameters match expected (name, has_default, default repr) — so changing
      a default like timeout=300→timeout=600 trips here, not in production.
    """
    tree = ast.parse(_mcp_server_path(plugin_root).read_text())
    found = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue
        if node.name not in _EXPECTED_SIGNATURES:
            continue
        tool_names = [_mcp_tool_name_from_decorator(d) for d in node.decorator_list]
        tool_names = [n for n in tool_names if n is not None]
        assert tool_names, f"{node.name}: @mcp.tool(name=...) decorator missing"
        assert len(tool_names) == 1, f"{node.name}: multiple @mcp.tool decorators"
        found[node.name] = {
            "tool_name": tool_names[0],
            "params": _param_shape(node.args),
        }
    for name, expected in _EXPECTED_SIGNATURES.items():
        assert name in found, f"{name}: function not found in mcp_server.py"
        actual = found[name]
        assert actual["tool_name"] == expected["tool_name"], (
            f"{name}: decorator tool-name drift — expected "
            f"{expected['tool_name']!r}, got {actual['tool_name']!r}"
        )
        assert actual["params"] == expected["params"], (
            f"{name}: signature drift — expected {expected['params']}, "
            f"got {actual['params']}"
        )
