from codex_bridge.tools.run import codex_run
from tests.conftest import fake_codex_runner


def test_codex_run_returns_raw(tmp_path):
    runner = fake_codex_runner(stdout="hello", stderr="warn", returncode=0)
    out = codex_run(prompt="say hi", cwd=str(tmp_path), runner=runner)
    assert out["stdout"] == "hello"
    assert out["stderr"] == "warn"
    assert out["exit_code"] == 0


def test_codex_run_uses_codex_run_schema(tmp_path):
    runner = fake_codex_runner()
    codex_run(prompt="x", cwd=str(tmp_path), runner=runner)
    argv = runner.captured[0].captured_argv  # type: ignore[attr-defined]
    schema = argv[argv.index("--output-schema") + 1]
    assert schema.endswith("codex_run.schema.json")
