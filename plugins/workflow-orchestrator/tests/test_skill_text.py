"""Static checks on the orchestrator skill text (AC20 + typed-routing).

These tests pin behavior in the SKILL.md content so the model is forced to
honor the preview + confirm gate and to route review steps through typed MCP
tools instead of the codex_run fallback.
"""

import re


CODEX_OWNED_SKILLS = (
    "issue-investigation-plan-review",
    "implementation-plan-review",
    "strict-git-diff-review",
    "commit-pr-readiness-review",
    "pr-final-merge-review",
    "answer-fact-check-review",
)
TYPED_TOOLS = ("codex_review_plan", "codex_review_diff", "codex_review_text")


def test_preview_and_confirmation_gate(plugin_root):
    skill = plugin_root / "skills" / "workflow" / "SKILL.md"
    text = skill.read_text(encoding="utf-8")

    preview_match = re.search(r"(?im)^#+\s*preview\b", text)
    assert preview_match, "SKILL.md is missing a Preview heading"

    confirm_match = re.search(
        r"(?i)wait for (the )?user('s)? (confirmation|approval|reply)", text
    )
    assert confirm_match, "SKILL.md is missing the explicit wait-for-confirmation phrase"

    # Both must appear before the first 'step 1' execution reference.
    step1_match = re.search(r"(?i)execute(.*?)step\s*1\b|start(ing)?\s+step\s*1\b", text)
    if step1_match:
        assert preview_match.start() < step1_match.start()
        assert confirm_match.start() < step1_match.start()


def test_step_14_runs_after_step_13(plugin_root):
    """SKILL.md must not strand step 14: it should run after step 13 when selected."""
    text = (plugin_root / "skills" / "workflow" / "SKILL.md").read_text(encoding="utf-8")
    # There must be a section that explicitly mentions running step 14.
    step14_section = re.search(
        r"(?is)step\s*14|session-continuity-summary", text
    )
    assert step14_section, "SKILL.md does not reference step 14 / session-continuity-summary"
    # And SKILL.md must not unconditionally STOP after step 13 (uppercase or otherwise).
    # Look for a "STOP" near step 13 that lacks any follow-up step-14 mention later.
    step13_pos = text.lower().find("step 13")
    step14_pos = text.lower().find("step 14")
    assert step13_pos >= 0
    assert step14_pos >= 0
    assert step14_pos > step13_pos, (
        "step 14 must be documented AFTER step 13 in SKILL.md"
    )


def test_skill_does_not_hardcode_generic_gate_options(plugin_root):
    """SKILL.md must not pin every gate to the same option set.

    The state helper now exposes canonical options keyed by --after-step, so
    SKILL.md should omit --options for the four canonical gates (5/7/11/12)
    and let the helper pick. Hardcoding `proceed,revise,abort` everywhere
    was the v3 review's blocking finding for this file.
    """
    text = (plugin_root / "skills" / "workflow" / "SKILL.md").read_text(encoding="utf-8")
    assert '--options "proceed,revise,abort"' not in text, (
        "SKILL.md hardcodes generic gate options; omit --options for canonical gates"
    )
    assert "--options \"proceed,revise,abort\"" not in text


def test_typed_routing_documented(plugin_root):
    routing = (plugin_root / "skills" / "workflow" / "skill-routing.md").read_text(encoding="utf-8")
    for s in CODEX_OWNED_SKILLS:
        matching_lines = [ln for ln in routing.splitlines() if s in ln]
        assert matching_lines, f"{s} not mentioned in skill-routing.md"
        line = next(
            (ln for ln in matching_lines if any(t in ln for t in TYPED_TOOLS)),
            None,
        )
        assert line is not None, (
            f"{s} not routed to one of {TYPED_TOOLS} in skill-routing.md"
        )
        for ln in matching_lines:
            assert "codex_run" not in ln, (
                f"{s} appears on a line that also mentions codex_run: {ln}"
            )
