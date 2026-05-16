import re


def test_workflow_dir_ignored(repo_root):
    gi = repo_root / ".gitignore"
    assert gi.is_file(), f"Missing .gitignore: {gi}"
    text = gi.read_text()
    assert re.search(r"^\.workflow/?\s*$", text, re.MULTILINE), (
        ".gitignore must contain a line matching .workflow or .workflow/"
    )
