"""Audit probe T8 — redaction case-sensitivity on real token formats.

For each of the 8 rows in the plan-v3 §T8 table, we either expect
``scan_payload`` to raise ``SecretInPayloadError`` with a specific
``pattern_name`` (real-format token), or we expect it to return cleanly
(a case-shifted lookalike that is not a real token format).

CRITICAL: payloads are constructed at runtime from non-secret fragments.
No contiguous secret-shaped literal is ever committed to source — that
would risk the file itself being flagged by other secret-scanners. The
per-row id mentions the case variant so divergences map cleanly to
AUDIT.md F-T8.
"""

import pytest

from codex_bridge.errors import SecretInPayloadError
from codex_bridge.redaction import scan_payload


# ---------------------------------------------------------------------------
# Runtime-built payloads (no contiguous secret-shaped literals in source)
# ---------------------------------------------------------------------------

# Row 1: ghp_ + 36 lowercase alnum  -> matches `gh[poursb]_[A-Za-z0-9]{36,}`
GHP_REAL = "ghp" + "_" + "a" * 36
# Row 2: GHP_ + 36 lowercase alnum  -> prefix is uppercase, must NOT match
GHP_FAKE = "GHP" + "_" + "a" * 36

# Row 3: xoxb- + 22 mixed-case alnum -> matches `xox[baprs]-[A-Za-z0-9\-]{10,}`
SLACK_REAL = "xox" + "b-" + ("Ab" * 11)  # 22 mixed-case chars
# Row 4: XOXB- + 22 mixed-case alnum -> uppercase prefix, must NOT match
SLACK_FAKE = "XOX" + "B-" + ("Ab" * 11)

# Row 5: AKIA + 16 uppercase alnum -> matches `AKIA[0-9A-Z]{16}`
AWS_REAL = "AKIA" + "0" * 16
# Row 6: akia + 16 lowercase alnum -> lowercase prefix, must NOT match
AWS_FAKE = "akia" + "0" * 16

# Row 7: sk-ant- + 50 lowercase alnum -> matches `sk-ant-[A-Za-z0-9_\-]{40,}`
ANTHROPIC_REAL = "sk-" + "ant-" + "a" * 50
# Row 8: SK-ANT- + 50 lowercase alnum -> uppercase prefix, must NOT match
ANTHROPIC_FAKE = "SK-" + "ANT-" + "a" * 50


# ---------------------------------------------------------------------------
# Parametrized contract (per plan §T8)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "payload, must_raise, expected_name",
    [
        pytest.param(GHP_REAL, True, "github_token",
                     id="row1_ghp_lower"),
        pytest.param(GHP_FAKE, False, None,
                     id="row2_ghp_upper"),
        pytest.param(SLACK_REAL, True, "slack_token",
                     id="row3_xoxb_lower"),
        pytest.param(SLACK_FAKE, False, None,
                     id="row4_xoxb_upper"),
        pytest.param(AWS_REAL, True, "aws_access_key",
                     id="row5_akia_upper"),
        pytest.param(AWS_FAKE, False, None,
                     id="row6_akia_lower"),
        pytest.param(ANTHROPIC_REAL, True, "anthropic_api_key",
                     id="row7_sk_ant_lower"),
        pytest.param(ANTHROPIC_FAKE, False, None,
                     id="row8_sk_ant_upper"),
    ],
)
def test_real_token_formats_match_case_correctly(
    payload, must_raise, expected_name,
):
    """Per-row contract:
      - must_raise=True  -> scan_payload raises SecretInPayloadError and
                            the pattern_name matches expected_name.
      - must_raise=False -> scan_payload returns without raising
                            (false positives on similar-but-non-real
                            text are themselves bugs).
    """
    if must_raise:
        with pytest.raises(SecretInPayloadError) as ei:
            scan_payload(payload)
        assert ei.value.pattern_name == expected_name, (
            f"expected pattern_name={expected_name!r}, "
            f"got {ei.value.pattern_name!r}"
        )
    else:
        # Should return cleanly. If this raises, redaction is over-matching
        # on a case-shifted lookalike — record per-row in AUDIT.md F-T8.
        scan_payload(payload)
