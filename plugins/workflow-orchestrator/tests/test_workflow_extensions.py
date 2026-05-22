"""Static checks for the 17-skill expansion + stage skills + auto-merge doc.

Layer-3 TDD tests. They cover the doc/manifest/scaffolding work that
turns the new selector/state flags (layers 1+2) into a real user-visible
feature surface:

  * step 0 (existing-system-bug-risk-scan)
  * step 16 (development-retrospective-review)
  * five named stage skills (plan/implement/qa/ship/retro)
  * docs/auto-merge.md as the single permitted location for `gh pr merge`
  * a narrower grep-no-merge.sh guard that allows that one file
  * --auto-merge / --stage / --scan-first / --retro documented in SKILL.md
"""

import json
import subprocess


# ---------------------------------------------------------------------------
# Manifest descriptions — bump 15-skill → 17-skill in both plugin.json and
# the marketplace manifest.
# ---------------------------------------------------------------------------

def test_plugin_manifest_says_17_skills(plugin_root):
    data = json.loads((plugin_root / ".claude-plugin" / "plugin.json").read_text())
    assert "17-skill" in data["description"], (
        f"plugin.json description does not advertise 17 skills: {data['description']!r}"
    )


def test_plugin_manifest_version_bumped(plugin_root):
    """A feature this large should bump the minor version."""
    data = json.loads((plugin_root / ".claude-plugin" / "plugin.json").read_text())
    assert data["version"] != "0.1.0", "version must be bumped from 0.1.0"


def test_marketplace_manifest_says_17_skills(plugin_root):
    """plugins/.claude-plugin/marketplace.json description must also reflect 17."""
    marketplace = plugin_root.parent / ".claude-plugin" / "marketplace.json"
    data = json.loads(marketplace.read_text())
    assert "17-skill" in data["description"], (
        f"marketplace.json top-level description: {data['description']!r}"
    )
    assert any("17-skill" in p["description"] for p in data["plugins"]), (
        "no plugin entry in marketplace.json advertises 17 skills"
    )


# ---------------------------------------------------------------------------
# Five new stage skills — thin entry points to the full workflow scoped
# to a single stage. Live under plugins/workflow-orchestrator/skills/.
# ---------------------------------------------------------------------------

def test_stage_skills_exist_with_valid_frontmatter(plugin_root):
    for stage in ("plan", "implement", "qa", "ship", "retro"):
        skill = plugin_root / "skills" / stage / "SKILL.md"
        assert skill.is_file(), f"missing stage skill: {skill}"
        text = skill.read_text(encoding="utf-8")
        assert text.startswith("---"), f"{stage}/SKILL.md missing frontmatter fence"
        assert f"name: {stage}" in text, (
            f"{stage}/SKILL.md frontmatter must declare name: {stage}"
        )
        assert f"--stage {stage}" in text or f"--stage \"{stage}\"" in text, (
            f"{stage}/SKILL.md must reference --stage {stage} in its body"
        )


# ---------------------------------------------------------------------------
# Supporting docs — auto-merge procedure + stage routing — pulled out so
# SKILL.md stays under the 280-line cap.
# ---------------------------------------------------------------------------

def test_auto_merge_doc_exists_and_has_safety_gates(plugin_root):
    path = plugin_root / "skills" / "workflow" / "docs" / "auto-merge.md"
    assert path.is_file(), f"missing supporting doc: {path}"
    text = path.read_text(encoding="utf-8")
    assert "gh pr merge" in text, (
        "auto-merge.md is the only doc allowed to mention `gh pr merge`; "
        "it must contain the literal command"
    )
    # Codex's correction: use GraphQL reviewThreads { isResolved } to detect
    # unresolved comments, not the /reviews REST endpoint.
    assert "reviewThreads" in text, (
        "auto-merge.md must document the GraphQL reviewThreads check"
    )
    assert "isResolved" in text, (
        "auto-merge.md must check isResolved on each review thread"
    )
    # Fail-safe: any gh/API failure must skip merge.
    assert "skip" in text.lower(), (
        "auto-merge.md must document the fail-safe skip behavior"
    )


def test_stages_doc_exists(plugin_root):
    path = plugin_root / "skills" / "workflow" / "docs" / "stages.md"
    assert path.is_file(), f"missing supporting doc: {path}"
    text = path.read_text(encoding="utf-8")
    for stage in ("plan", "implement", "qa", "ship", "retro"):
        assert stage in text, f"stages.md must document stage {stage!r}"


# ---------------------------------------------------------------------------
# step-catalog.md + skill-routing.md must include the two new opt-in steps.
# ---------------------------------------------------------------------------

def test_step_catalog_lists_step_0_and_16(plugin_root):
    text = (plugin_root / "skills" / "workflow" / "docs" / "step-catalog.md").read_text(encoding="utf-8")
    assert "existing-system-bug-risk-scan" in text
    assert "development-retrospective-review" in text
    # Step numbers must appear as column entries (allow leading space/pipe).
    assert " 0 " in text or "| 0" in text, "step 0 row missing from catalog"
    assert " 16" in text or "| 16" in text, "step 16 row missing from catalog"


def test_skill_routing_lists_step_0_and_16(plugin_root):
    text = (plugin_root / "skills" / "workflow" / "skill-routing.md").read_text(encoding="utf-8")
    assert "existing-system-bug-risk-scan" in text, (
        "skill-routing.md must mention the step 0 skill"
    )
    assert "development-retrospective-review" in text, (
        "skill-routing.md must mention the step 16 skill"
    )


# ---------------------------------------------------------------------------
# Replacement grep-no-merge.sh — narrower guard that allows gh pr merge ONLY
# inside skills/workflow/docs/auto-merge.md. Anywhere else in plugin source
# (outside tests/) still fails the build.
# ---------------------------------------------------------------------------

def test_grep_no_merge_script_passes_in_current_tree(plugin_root):
    """After all layer-6 work lands, the guard must pass with the new auto-merge
    doc present (since that one file is allow-listed)."""
    script = plugin_root / "tests" / "grep-no-merge.sh"
    result = subprocess.run(
        [str(script)], capture_output=True, text=True, cwd=str(plugin_root),
    )
    assert result.returncode == 0, (
        f"grep-no-merge.sh failed:\n"
        f"  stdout={result.stdout!r}\n  stderr={result.stderr!r}"
    )


def test_grep_no_merge_script_documents_allowed_path(plugin_root):
    """The replacement guard must mention the auto-merge.md exception in its
    own text — readers should be able to see why one file is allow-listed."""
    text = (plugin_root / "tests" / "grep-no-merge.sh").read_text(encoding="utf-8")
    assert "auto-merge.md" in text, (
        "grep-no-merge.sh must reference auto-merge.md as the documented exception"
    )


def test_grep_no_merge_rejects_forbidden_hit_in_file_mentioning_allowed_path(plugin_root, tmp_path):
    """Codex blocker: substring `grep -v "$ALLOWED"` allowed any forbidden
    `gh pr merge` line that ALSO mentioned `auto-merge.md` (e.g., a
    `# see auto-merge.md` comment on the same line). Fault-inject such a
    file into a synthetic plugin tree and assert the guard catches it."""
    import shutil
    synth = tmp_path / "synth_plugin"
    (synth / "tests").mkdir(parents=True)
    (synth / "skills" / "workflow" / "docs").mkdir(parents=True)
    (synth / "skills" / "other").mkdir(parents=True)
    shutil.copy(
        plugin_root / "tests" / "grep-no-merge.sh",
        synth / "tests" / "grep-no-merge.sh",
    )
    (synth / "tests" / "grep-no-merge.sh").chmod(0o755)
    # Legitimate allow-listed file — must contain the command for the script's
    # exception path to be exercised.
    (synth / "skills" / "workflow" / "docs" / "auto-merge.md").write_text(
        "Procedure: `gh pr merge <N>` after all safety guards pass.\n"
    )
    # Forbidden file: contains `gh pr merge` AND mentions auto-merge.md on
    # the same line. The buggy substring filter would silently allow this.
    (synth / "skills" / "other" / "SKILL.md").write_text(
        "Do not run `gh pr merge`; see skills/workflow/docs/auto-merge.md\n"
    )
    result = subprocess.run(
        [str(synth / "tests" / "grep-no-merge.sh")],
        capture_output=True, text=True,
    )
    assert result.returncode != 0, (
        "guard must reject `gh pr merge` in a non-allow-listed file even when "
        "that file mentions auto-merge.md on the same line"
    )
    assert "skills/other/SKILL.md" in result.stderr, (
        f"guard output should name the offending file. stderr={result.stderr!r}"
    )


def test_grep_no_merge_accepts_allowed_file_only(plugin_root, tmp_path):
    """Complementary positive test: when `gh pr merge` appears ONLY in
    skills/workflow/docs/auto-merge.md, the guard passes."""
    import shutil
    synth = tmp_path / "synth_plugin"
    (synth / "tests").mkdir(parents=True)
    (synth / "skills" / "workflow" / "docs").mkdir(parents=True)
    shutil.copy(
        plugin_root / "tests" / "grep-no-merge.sh",
        synth / "tests" / "grep-no-merge.sh",
    )
    (synth / "tests" / "grep-no-merge.sh").chmod(0o755)
    (synth / "skills" / "workflow" / "docs" / "auto-merge.md").write_text(
        "Procedure: `gh pr merge <N> --<method>` after all guards pass.\n"
    )
    result = subprocess.run(
        [str(synth / "tests" / "grep-no-merge.sh")],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, (
        f"guard rejected an allow-listed file: stderr={result.stderr!r}"
    )


# ---------------------------------------------------------------------------
# Main workflow SKILL.md — references the new flags so users discover them.
# ---------------------------------------------------------------------------

def test_skill_md_documents_auto_merge_flag(plugin_root):
    text = (plugin_root / "skills" / "workflow" / "SKILL.md").read_text(encoding="utf-8")
    assert "--auto-merge" in text, "SKILL.md must document the --auto-merge flag"


def test_skill_md_documents_stage_flag(plugin_root):
    text = (plugin_root / "skills" / "workflow" / "SKILL.md").read_text(encoding="utf-8")
    assert "--stage" in text


def test_skill_md_documents_scan_first_and_retro_flags(plugin_root):
    text = (plugin_root / "skills" / "workflow" / "SKILL.md").read_text(encoding="utf-8")
    assert "--scan-first" in text
    assert "--retro" in text


def test_skill_md_links_to_auto_merge_doc(plugin_root):
    """SKILL.md should point readers at docs/auto-merge.md for the procedure."""
    text = (plugin_root / "skills" / "workflow" / "SKILL.md").read_text(encoding="utf-8")
    assert "auto-merge.md" in text, (
        "SKILL.md must reference docs/auto-merge.md as the procedure doc"
    )


def test_skill_md_no_longer_says_always_manual(plugin_root):
    """The unconditional 'Final merge is always manual' is replaced by an
    opt-in contract. Allow the phrase only if it is qualified by --auto-merge
    on the same line/paragraph."""
    text = (plugin_root / "skills" / "workflow" / "SKILL.md").read_text(encoding="utf-8")
    # The literal absolute must be gone — or any remaining occurrence must
    # share its paragraph with the --auto-merge qualifier.
    if "always manual" in text.lower():
        # Crude paragraph proximity: same 400-char window must mention the flag.
        idx = text.lower().index("always manual")
        window = text[max(0, idx - 200): idx + 200]
        assert "--auto-merge" in window, (
            "'always manual' phrasing must be qualified by --auto-merge nearby"
        )
