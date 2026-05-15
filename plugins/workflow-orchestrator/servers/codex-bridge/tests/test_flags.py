from codex_bridge.flags import CANONICAL, DENYLIST


def test_canonical_includes_required_flags():
    required = {"--sandbox", "--ask-for-approval", "--output-schema", "--output-last-message"}
    assert required <= set(CANONICAL)


def test_denylist_blocks_bypass():
    assert "--dangerously-bypass-approvals-and-sandbox" in DENYLIST
