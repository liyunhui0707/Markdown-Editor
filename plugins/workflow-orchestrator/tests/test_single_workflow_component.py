def test_only_skill_workflow_exists(plugin_root):
    skill = plugin_root / "skills" / "workflow" / "SKILL.md"
    cmd = plugin_root / "commands" / "workflow.md"
    assert skill.is_file(), f"Missing skill: {skill}"
    assert not cmd.exists(), (
        f"commands/workflow.md must not exist (duplicate-component risk): {cmd}"
    )
