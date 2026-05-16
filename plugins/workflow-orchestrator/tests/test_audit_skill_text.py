"""Audit probes T4, T5, T6 — static text checks on orchestrator markdown.

Each test asserts the correct property. These are FINAL regression probes
— after step-8 fixes (see AUDIT.md), all three pass unmarked. The
xfail-strict mechanism that protected the audit phase has done its job
and was removed when the fixes landed.

Exact match rules: see plan-v3 (patched to v4), §"Static probe match rules".
"""

import re

import pytest


# ---------------------------------------------------------------------------
# T4 — SKILL.md invocation wording
# ---------------------------------------------------------------------------

def test_skill_md_uses_skill_tool_or_clarifies_invocation(plugin_root):
    """SKILL.md must mention 'Skill tool' OR carry a slash-command disclaimer.

    Property (per plan §T4): EITHER (a) literal phrase 'Skill tool'
    (case-insensitive) OR (b) text matching
    ``(?i)slash[- ]?command.*shorthand|invoke[^\\n]+via[^\\n]+tool`` is present.
    """
    text = (plugin_root / "skills" / "workflow" / "SKILL.md").read_text(
        encoding="utf-8"
    )
    has_skill_tool = re.search(r"(?i)skill\s+tool", text) is not None
    has_disclaimer = (
        re.search(
            r"(?i)slash[- ]?command.*shorthand|invoke[^\n]+via[^\n]+tool",
            text,
        )
        is not None
    )
    assert has_skill_tool or has_disclaimer, (
        "SKILL.md must either mention 'Skill tool' or include a disclaimer "
        "that the /slash-command form is runtime shorthand for invocation "
        "via the Skill tool"
    )


# ---------------------------------------------------------------------------
# T5 — Diff-source documentation for step 7
# ---------------------------------------------------------------------------

def test_skill_md_documents_diff_source_for_step_7(plugin_root):
    """At least one orchestrator doc mentions 'git diff' near the diff-review
    surfaces (codex_review_diff / step 7 / strict-git-diff-review).

    Property (per plan §T5): regex ``git\\s+diff\\b`` appears within
    +/- 20 source lines of ``codex_review_diff``, ``Step 7``, ``step 7``, or
    ``strict-git-diff-review`` in any of SKILL.md, mcp-contract.md,
    skill-routing.md, docs/step-catalog.md.
    """
    skill_dir = plugin_root / "skills" / "workflow"
    candidate_files = [
        skill_dir / "SKILL.md",
        skill_dir / "mcp-contract.md",
        skill_dir / "skill-routing.md",
        skill_dir / "docs" / "step-catalog.md",
    ]
    proximity = re.compile(
        r"codex_review_diff|Step 7|step 7|strict-git-diff-review"
    )
    diff_re = re.compile(r"git\s+diff\b")
    for path in candidate_files:
        if not path.is_file():
            continue
        lines = path.read_text(encoding="utf-8").splitlines()
        for i, line in enumerate(lines):
            if diff_re.search(line):
                start = max(0, i - 20)
                end = min(len(lines), i + 21)
                window = "\n".join(lines[start:end])
                if proximity.search(window):
                    return  # property satisfied
    pytest.fail(
        "no orchestrator doc mentions 'git diff' within +/-20 lines of "
        "codex_review_diff / step 7 / strict-git-diff-review"
    )


# ---------------------------------------------------------------------------
# T6 — README reinstall workflow documentation
# ---------------------------------------------------------------------------

def test_readme_documents_reinstall_after_source_change(plugin_root):
    """Plugin-root README must mention both '/plugin install' and
    '/plugin uninstall' so users know how to re-sync the cached copy.

    Property (per plan §T6): file contains BOTH literal '/plugin install'
    AND literal '/plugin uninstall' (case-sensitive — these are real slash
    commands).
    """
    text = (plugin_root / "README.md").read_text(encoding="utf-8")
    assert "/plugin install" in text, (
        "README.md must mention '/plugin install' so users know how to "
        "refresh the cached plugin after editing source"
    )
    assert "/plugin uninstall" in text, (
        "README.md must mention '/plugin uninstall' as the first half of "
        "the reinstall workflow"
    )
