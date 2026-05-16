import pytest

from codex_bridge.errors import (
    PathOutsideRepoError,
    PayloadTooLargeError,
    SecretInPayloadError,
)
from codex_bridge.payload import load_payload

# Build the AWS-key-shaped payload from non-secret fragments so the source
# itself stays redaction-clean. See test_redaction.py header comment.
aws_real = "AKIA" + "0" * 16


def test_path_outside_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    outside = tmp_path / "elsewhere.txt"
    outside.write_text("hello")
    with pytest.raises(PathOutsideRepoError):
        load_payload(path=outside, repo_root=repo)


def test_path_inside_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    inside = repo / "p.txt"
    inside.write_text("hello world")
    out = load_payload(path=inside, repo_root=repo)
    assert out == "hello world"


def test_path_secret_scanned(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    bad = repo / "p.txt"
    bad.write_text(aws_real)
    with pytest.raises(SecretInPayloadError):
        load_payload(path=bad, repo_root=repo)


def test_text_secret_scanned(tmp_path):
    with pytest.raises(SecretInPayloadError):
        load_payload(text=f"token={aws_real}", repo_root=tmp_path)


def test_text_too_large(tmp_path):
    huge = "a" * (256 * 1024 + 1)
    with pytest.raises(PayloadTooLargeError):
        load_payload(text=huge, repo_root=tmp_path)


def test_requires_exactly_one_of_text_or_path(tmp_path):
    with pytest.raises(ValueError):
        load_payload(repo_root=tmp_path)
    with pytest.raises(ValueError):
        load_payload(text="x", path=tmp_path / "p.txt", repo_root=tmp_path)


def test_path_must_exist(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_payload(path=tmp_path / "missing.txt", repo_root=tmp_path)


def test_path_supports_1mb(tmp_path):
    """Path payloads should accept content larger than the 256 KB inline cap."""
    repo = tmp_path / "repo"
    repo.mkdir()
    big = repo / "big.txt"
    # 1 MB of innocuous text — over the inline cap, well under the 4 MB path cap.
    big.write_text("x" * (1024 * 1024))
    result = load_payload(path=big, repo_root=repo)
    assert len(result) == 1024 * 1024


def test_path_rejects_above_4mb(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    huge = repo / "huge.txt"
    huge.write_text("x" * (4 * 1024 * 1024 + 1))
    with pytest.raises(PayloadTooLargeError):
        load_payload(path=huge, repo_root=repo)
