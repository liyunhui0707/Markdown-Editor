import pytest

from codex_bridge.errors import SecretInPayloadError
from codex_bridge.redaction import scan_payload

# Build secret-shaped payloads from non-secret fragments so the source file
# itself doesn't contain contiguous matches for codex_bridge.redaction
# patterns. The runtime concatenation still produces strings the redaction
# correctly catches. See AUDIT.md F-T-runtime-fragments for the policy.
aws_real = "AKIA" + "0" * 16
slack_real = "xoxb-" + "a" * 22
key_header = "-----BEGIN " + "RSA PRIVATE KEY" + "-----"


def test_blocks_aws_key():
    with pytest.raises(SecretInPayloadError) as ei:
        scan_payload(f"Here is a token: {aws_real} and more text")
    assert ei.value.pattern_name == "aws_access_key"


def test_blocks_openai_key():
    with pytest.raises(SecretInPayloadError) as ei:
        scan_payload("API_KEY = sk-" + "A" * 40)
    assert ei.value.pattern_name == "openai_api_key"


def test_blocks_anthropic_key():
    with pytest.raises(SecretInPayloadError) as ei:
        scan_payload("key: sk-ant-" + "x" * 50)
    assert ei.value.pattern_name == "anthropic_api_key"


def test_blocks_github_token():
    with pytest.raises(SecretInPayloadError) as ei:
        scan_payload("token=ghp_" + "x" * 40)
    assert ei.value.pattern_name == "github_token"


def test_blocks_slack_token():
    with pytest.raises(SecretInPayloadError) as ei:
        scan_payload(f"SLACK={slack_real}")
    assert ei.value.pattern_name == "slack_token"


def test_blocks_private_key_header():
    with pytest.raises(SecretInPayloadError) as ei:
        scan_payload(f"{key_header}\n...")
    assert ei.value.pattern_name == "private_key"


def test_blocks_env_file_heuristic():
    payload = (
        "API_KEY=ABCDEFGHIJKLMNOPQR\n"
        "DATABASE_URL=postgres1234567890abc\n"
        "SECRET_TOKEN=abc1234567890XYZ\n"
    )
    with pytest.raises(SecretInPayloadError) as ei:
        scan_payload(payload)
    assert ei.value.pattern_name == "env_file_heuristic"


def test_allows_clean_payload():
    scan_payload("This is regular text without any secrets.")
    scan_payload("def add(a, b):\n    return a + b\n")
    # Single env-like line should not trigger heuristic.
    scan_payload("API_URL=https://api.example.com/v1/something/long")
