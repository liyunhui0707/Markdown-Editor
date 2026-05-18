"""P2 — review-round cap.

The orchestrator tracks how many times each Codex-owned skill has been
dispatched in this run. When the count reaches `max_review_rounds`
(default 3), the orchestrator sets an escalation gate instead of
silently dispatching yet another round. Stops the indefinite review-
revise spiral observed in a real session.

Two new subcommands on `bin/workflow_state.py`:

  bump-review --repo X --skill codex_review_plan
    → increments state.review_rounds[skill_id]; prints
      {"skill": "...", "round": N}

  should-escalate --repo X --skill codex_review_plan [--max N]
    → reads state.review_rounds.get(skill_id, 0) + max; prints
      {"skill": "...", "round": N, "max": M, "escalate": bool}

`max_review_rounds` defaults to 3 and is set at init via
`init --max-review-rounds N`. The `--max` flag on should-escalate is an
ad-hoc override; if absent, the state field is used.
"""

import json

import pytest

import workflow_state


def _state_path(repo):
    return repo / ".workflow" / "state.json"


def _stdout(capsys) -> dict:
    """Read the most recent captured stdout as JSON."""
    return json.loads(capsys.readouterr().out)


# ---------------------------------------------------------------------------
# init writes the new fields with the right defaults
# ---------------------------------------------------------------------------

def test_init_creates_review_rounds_empty_and_max_default_3(tmp_path):
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "bug", "--selected", "1,4,5,6,7,8,11,12",
    ])
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["review_rounds"] == {}
    assert data["max_review_rounds"] == 3


def test_init_max_review_rounds_override(tmp_path):
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "feature", "--selected", "1,4,5",
        "--max-review-rounds", "5",
    ])
    data = json.loads(_state_path(tmp_path).read_text())
    assert data["max_review_rounds"] == 5


# ---------------------------------------------------------------------------
# bump-review
# ---------------------------------------------------------------------------

def test_bump_review_increments_per_skill(tmp_path, capsys):
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "bug", "--selected", "1,4,5",
    ])
    capsys.readouterr()

    rc = workflow_state.main([
        "bump-review", "--repo", str(tmp_path),
        "--skill", "codex_review_plan",
    ])
    assert rc == 0
    out = _stdout(capsys)
    assert out == {"skill": "codex_review_plan", "round": 1}

    # bump again
    workflow_state.main([
        "bump-review", "--repo", str(tmp_path),
        "--skill", "codex_review_plan",
    ])
    out = _stdout(capsys)
    assert out == {"skill": "codex_review_plan", "round": 2}


def test_bump_review_independent_skills(tmp_path, capsys):
    """Per-skill counters don't interfere."""
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "bug", "--selected", "1,4,5",
    ])
    capsys.readouterr()

    workflow_state.main([
        "bump-review", "--repo", str(tmp_path),
        "--skill", "codex_review_plan",
    ])
    capsys.readouterr()
    workflow_state.main([
        "bump-review", "--repo", str(tmp_path),
        "--skill", "codex_review_diff",
    ])
    out = _stdout(capsys)
    assert out == {"skill": "codex_review_diff", "round": 1}

    data = json.loads(_state_path(tmp_path).read_text())
    assert data["review_rounds"] == {
        "codex_review_plan": 1,
        "codex_review_diff": 1,
    }


# ---------------------------------------------------------------------------
# should-escalate
# ---------------------------------------------------------------------------

def test_should_escalate_below_max(tmp_path, capsys):
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "bug", "--selected", "1,4,5",
    ])
    workflow_state.main([
        "bump-review", "--repo", str(tmp_path),
        "--skill", "codex_review_plan",
    ])
    capsys.readouterr()

    rc = workflow_state.main([
        "should-escalate", "--repo", str(tmp_path),
        "--skill", "codex_review_plan",
    ])
    assert rc == 0
    out = _stdout(capsys)
    assert out["skill"] == "codex_review_plan"
    assert out["round"] == 1
    assert out["max"] == 3
    assert out["escalate"] is False


def test_should_escalate_at_max(tmp_path, capsys):
    """When round count >= max, escalate is True."""
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "bug", "--selected", "1,4,5",
        "--max-review-rounds", "3",
    ])
    for _ in range(3):
        workflow_state.main([
            "bump-review", "--repo", str(tmp_path),
            "--skill", "codex_review_plan",
        ])
    capsys.readouterr()

    workflow_state.main([
        "should-escalate", "--repo", str(tmp_path),
        "--skill", "codex_review_plan",
    ])
    out = _stdout(capsys)
    assert out["round"] == 3
    assert out["max"] == 3
    assert out["escalate"] is True


def test_should_escalate_unknown_skill_is_zero(tmp_path, capsys):
    """A skill never dispatched in this run has round=0, does not escalate."""
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "bug", "--selected", "1,4,5",
    ])
    capsys.readouterr()

    workflow_state.main([
        "should-escalate", "--repo", str(tmp_path),
        "--skill", "codex_review_diff",  # never bumped
    ])
    out = _stdout(capsys)
    assert out["round"] == 0
    assert out["escalate"] is False


def test_should_escalate_max_flag_overrides_state(tmp_path, capsys):
    """--max overrides state.max_review_rounds for one-off checks."""
    workflow_state.main([
        "init", "--repo", str(tmp_path),
        "--task-type", "bug", "--selected", "1,4,5",
        "--max-review-rounds", "10",
    ])
    workflow_state.main([
        "bump-review", "--repo", str(tmp_path),
        "--skill", "codex_review_plan",
    ])
    workflow_state.main([
        "bump-review", "--repo", str(tmp_path),
        "--skill", "codex_review_plan",
    ])
    capsys.readouterr()

    # state.max = 10 → no escalate at round 2.
    workflow_state.main([
        "should-escalate", "--repo", str(tmp_path),
        "--skill", "codex_review_plan",
    ])
    assert _stdout(capsys)["escalate"] is False

    # but --max 2 overrides → escalate at round 2.
    workflow_state.main([
        "should-escalate", "--repo", str(tmp_path),
        "--skill", "codex_review_plan",
        "--max", "2",
    ])
    assert _stdout(capsys)["escalate"] is True
