# Review-round cap is per-skill, not global

**Date:** 2026-05-16
**Status:** accepted
**Related code:** `bin/_review_cmds.py` (bump-review, should-escalate), `bin/_state_lib.py` (state.review_rounds, state.max_review_rounds), `skills/workflow/SKILL.md` (escalation gate section), `skills/workflow/gates.md`
**Related PRs:** #74

## Context

A prior session burned through 9 rounds of Codex review on one step-5 plan
before the user noticed and intervened. Codex was approving-with-notes each
round but the workflow kept dispatching new reviews because each round
nudged the plan slightly. Wall-clock cost: 30+ minutes; token cost:
non-trivial.

We needed a cap that pauses the run before the user is bled dry, but the cap
has to be smart enough not to fire prematurely on legitimately complex work
that genuinely needs multiple iterations on more than one dimension.

## Options considered

- **A.** Single global counter — 3 Codex dispatches total per run, period.
- **B.** Per-Codex-skill counter — 3 dispatches *per skill* (plan-review,
  diff-review, final-review each track independently).
- **C.** Wall-clock budget — escalate after N minutes of cumulative Codex
  time.

## Decision

We picked **B** — `state.review_rounds[skill_id]` is incremented on each
dispatch via `workflow_state.py bump-review`, and the orchestrator calls
`should-escalate` *before* the next dispatch to check whether
`review_rounds[skill] >= state.max_review_rounds`. When true, an escalation
gate (`dispatch-another`, `accept-as-is`, `abort`) fires instead of the
next dispatch.

## Why this, not the others

- **Why not A:** Too restrictive. A run that legitimately needs 3
  plan-review iterations *and* 3 diff-review iterations is normal, not
  pathological. A global cap of 3 would force the user to choose where to
  spend their budget — which they shouldn't have to do at the start.
- **Why not C:** Codex latency varies widely (cold start ~60s, hot ~20s,
  some retries even longer). A wall-clock budget penalizes slow Codex
  sessions even when the user isn't paying real money for the wait. The
  failure mode we are protecting against is *iteration count per dimension*,
  not elapsed time.
- **Why B:** Catches the exact failure mode we observed (one dimension
  looping) without artificially constraining the others. The counter is
  trivially inspectable via `workflow_state.py get --field review_rounds`.

## Consequences

What gets easier:
- Debugging "why did this run loop?": `state.review_rounds` shows which
  skill ran away. The pivot_log + history give the longer narrative.
- Per-skill caps later: the data structure is already a dict, so we can
  introduce `state.max_review_rounds_per_skill` without a schema change if
  it ever becomes necessary.

What gets harder:
- Global budgeting (if we ever want a hard ceiling across all skills)
  requires summing across the dict. Cheap, but a layer above current
  primitives.

New invariants to preserve:
- `bump-review` is called *after* the dispatch succeeds, not before — so a
  failed Codex call (e.g., timeout, schema rejection) does not consume a
  round. Tested in `test_review_rounds.py`.
- `should-escalate` runs *before* the next dispatch. If the counter is at
  the cap, the orchestrator presents the escalation gate instead of
  dispatching.
- The escalation gate is non-canonical (not keyed on `--after-step` in
  `GATE_OPTIONS`). It must be set with explicit
  `--options "dispatch-another,accept-as-is,abort"`.

## Open questions / followups

- The default cap (3) was picked by intuition. Once we have telemetry on
  how many rounds real runs use, revisit.
- The SKILL.md text recommends `accept-as-is` when the last 2 rounds had
  verdicts ∈ {approve, revise} with no blockers/majors — that's the
  signature of a converging review. But the gate prompt itself just lists
  three options. Could add a `recommended` field to the gate prompt to
  nudge the user toward the right choice based on recent verdict history.
- We currently don't reset `review_rounds` on `revise` — a user who picks
  `revise` and gets a new plan still counts against the cap. That is
  probably correct (revising is itself a round of work) but worth a
  conscious check the first time it bites.
