"""Smoke: invoke each typed MCP tool with a fake codex runner.

Imported by smoke.sh. Argv: g3_typed_tools.py <tmp_repo> <plugin_dir>
Exit non-zero on any assertion failure.
"""

import json
import subprocess
import sys
from pathlib import Path


class _FakeProc:
    def __init__(self, *, stdout="", stderr="", returncode=0):
        self.stdout_value = stdout
        self.stderr_value = stderr
        self.returncode = returncode

    def communicate(self, input=None, timeout=None):
        return self.stdout_value, self.stderr_value

    def terminate(self): pass
    def kill(self): pass
    def wait(self, timeout=None): return self.returncode


def _fake_runner(*, last_message="", stdout="", stderr="", returncode=0):
    def _make(argv, **kwargs):
        if "--output-last-message" in argv:
            i = argv.index("--output-last-message")
            Path(argv[i + 1]).write_text(last_message, encoding="utf-8")
        return _FakeProc(stdout=stdout, stderr=stderr, returncode=returncode)
    return _make


def main(argv: list[str]) -> int:
    tmp_repo = Path(argv[1])
    plugin_dir = Path(argv[2])
    sys.path.insert(0, str(plugin_dir / "servers" / "codex-bridge"))

    from codex_bridge.tools.review_plan import review_plan
    from codex_bridge.tools.review_diff import review_diff
    from codex_bridge.tools.review_text import review_text
    from codex_bridge.tools.run import codex_run

    canned = json.dumps({"verdict": "approve", "summary": "ok"})
    context = {"repo_root": str(tmp_repo), "task_summary": "smoke"}

    r = review_plan(plan_text="a plan", context=context,
                    runner=_fake_runner(last_message=canned))
    assert r["verdict"] == "approve", r
    print("OK G3a: codex_review_plan")

    r = review_diff(diff_text="diff --git a/x b/x\n@@\n+y\n", context=context,
                    runner=_fake_runner(last_message=canned))
    assert r["verdict"] == "approve", r
    print("OK G3b: codex_review_diff")

    r = review_text(payload="some content", skill_id="commit-pr-readiness-review",
                    context=context, runner=_fake_runner(last_message=canned))
    assert r["verdict"] == "approve", r
    print("OK G3c: codex_review_text")

    r = codex_run(prompt="x", cwd=str(tmp_repo),
                  runner=_fake_runner(stdout="hi"))
    assert r["exit_code"] == 0, r
    print("OK G3d: codex_run (fallback)")

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
