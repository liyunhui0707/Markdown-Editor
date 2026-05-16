import pytest

from codex_bridge.argv import build_codex_argv
from codex_bridge.errors import BannedFlagError


def _argv(tmp_path, **kwargs):
    schema = tmp_path / "s.json"
    schema.write_text("{}")
    out = tmp_path / "out.json"
    return build_codex_argv(repo=tmp_path, schema=schema, out_message=out, **kwargs)


def test_codex_is_first(tmp_path):
    argv = _argv(tmp_path)
    assert argv[0] == "codex"


def test_root_flags_before_exec(tmp_path):
    argv = _argv(tmp_path)
    exec_idx = argv.index("exec")
    ask_idx = argv.index("--ask-for-approval")
    assert ask_idx < exec_idx, f"--ask-for-approval must precede exec; argv={argv}"
    assert argv[ask_idx + 1] == "never"
    assert ask_idx + 1 < exec_idx


def test_stdin_marker_last(tmp_path):
    argv = _argv(tmp_path)
    assert argv[-1] == "-"


def test_bypass_flag_banned(tmp_path):
    with pytest.raises(BannedFlagError):
        _argv(tmp_path, extra_args=["--dangerously-bypass-approvals-and-sandbox"])


def test_sandbox_and_cd_after_exec(tmp_path):
    argv = _argv(tmp_path)
    exec_idx = argv.index("exec")
    tail = argv[exec_idx + 1:]
    assert "--sandbox" in tail
    assert "read-only" in tail
    assert "--cd" in tail
    assert "--output-schema" in tail
    assert "--output-last-message" in tail
