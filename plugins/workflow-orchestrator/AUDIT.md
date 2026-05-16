# workflow-orchestrator audit (final post-fix state)

Audit of `plugins/workflow-orchestrator/` against the 9 named soft spots
defined in `.workflow/artifacts/01-task-clarification.md`. Probe contracts
follow the approved plan (`.workflow/artifacts/04-plan-v3.md`, patched to
v4 per `05-plan-review.md`).

**Final outcome:** the audit identified 3 confirmed defects (one code,
two doc). All three were fixed in the same workflow run (step 8). Five
probe-test files were added; **zero xfails remain.** Suite is 116
verifications green. See "Audit history" below for the initial pre-fix
classification that drove the fix patches.

## Verdict tally (final, post-fix)

| Soft spot | Probe(s) | Final verdict | Evidence |
|----------|---------|---------------|----------|
| #1 gate clear/parse non-canonical          | T1   | not-a-bug     | T1 passes unmarked |
| #2 dotted-set into list/non-dict           | T2   | confirmed → FIXED | type-check added in `cmd_set`; both T2 probes pass unmarked |
| #3 lock leak across invocations            | T3*  | not-a-bug     | existing test cited; no new test |
| #4 SKILL.md invocation wording             | T4   | confirmed → FIXED | Skill-tool disclaimer added to "Run loop" step 2; T4 passes |
| #5 diff-source plumbing                    | T5   | not-a-bug     | T5 passes — `mcp-contract.md` |
| #6 redaction case-sensitivity              | T8   | not-a-bug     | all 8 rows pass; no xfail marks needed |
| #7 cache-drift detector presence           | F-7  | not-a-bug by design | grep returns 0; mitigation now documented (F-T6 fix) |
| #8 `/clear` mid-workflow recovery          | F-8  | not-a-bug     | existing `test_resume_returns_pending_gate` pins it |
| #9 fake runner in production               | T9   | not-a-bug     | recursive regex scan returns 0 |
| extra: README reinstall workflow doc       | T6   | confirmed → FIXED | "After source edits" subsection added; T6 passes |

\* T3: no new test added — `tests/test_workflow_state.py::test_lock_persists_across_subprocess_invocations` already pins the contract.

## Audit history (initial pre-fix verdict)

Before step 8's fixes, the same probes produced:

| Soft spot | Initial verdict |
|---|---|
| #2 dotted-set | confirmed (T2 xfailed — TypeError traceback leaked to stderr) |
| #4 SKILL.md wording | confirmed (T4 xfailed — only `/<skill>` form, no Skill-tool disclaimer) |
| #7 cache-drift | latent (coupled to F-T6) |
| README reinstall doc | confirmed (T6 xfailed — no `/plugin install` mention) |

Steps 6 → 7 → 8 turned the three `confirmed` xfails into passing probes by applying the minimal single-file fixes described above. F-7 automatically rehomed to `not-a-bug by design` once F-T6 landed (mitigation documented).

## Probe tests added

| File | Probes |
|------|--------|
| `tests/test_audit_skill_text.py`                                          | T4, T5, T6 |
| `tests/test_audit_state_helper_robustness.py`                             | T1, T2     |
| `tests/test_audit_design_evidence.py`                                     | F-7, F-8   |
| `servers/codex-bridge/tests/test_audit_redaction_case_variants.py`        | T8         |
| `servers/codex-bridge/tests/test_audit_no_fake_runner_in_production.py`   | T9         |

(Line counts intentionally omitted — they churn under minor edits and aren't the audit's contract.)

Suite counts (final, post-fix):
- codex-bridge: 59 → 68 passed (T8 contributes 8 rows, T9 contributes 1)
- orchestrator: 40 → 48 passed, **0 xfailed** (all probes now pass unmarked after step-8 fixes)
- See "Audit history" above for the pre-fix counts (45 passed + 3 xfailed)

## Findings

### F-T1 — non-canonical gate clear/parse (#1) — not-a-bug

Probe: `test_clear_gate_handles_noncanonical_after_step` (passes unmarked).
The four-step contract (set ad-hoc gate → read options → clear → re-set →
re-read) executes cleanly. `cmd_set_gate` accepts any `--after-step`
integer when `--options` is supplied; `cmd_clear_gate` unconditionally
nulls `pending_gate`. No defect.

### F-T2 — dotted-set into list intermediate (#2) — confirmed → **FIXED**

**Final status:** both T2 probes pass unmarked after the step-8 fix.

- `test_set_into_list_intermediate_exit_code_and_immutability` — passes
  unmarked (was always passing; the pre-fix bug only affected stderr).
- `test_set_into_list_intermediate_no_traceback_in_stderr` — **now passes
  unmarked.** Was xfailed pre-fix because a raw `TypeError` leaked.

**Fix applied (step 8):** `bin/workflow_state.py:cmd_set` now validates
each intermediate before `setdefault` AND validates the terminal-parent
before assignment. On a non-dict, it writes a one-line error to stderr
and returns exit code 2. For the audit probe input `selected_steps.0`,
the terminal-parent branch fires and the message is `cannot assign into
field 'selected_steps.0': parent is list, not dict`. Deeper paths
(e.g., `selected_steps.0.foo`) trip the traverse branch instead. State.json
untouched in both cases. Scope: single function, single file (~14 lines added).

### F-T3 — lock leak across invocations (#3) — not-a-bug

No new test added. The existing
`tests/test_workflow_state.py::test_lock_persists_across_subprocess_invocations`
already drives two separate subprocesses, one of which exits before the
second runs, and asserts the second `acquire-lock` refuses without
`--force`. "Orchestrator abort" is functionally the same scenario: the
parent process dies leaving the lockfile on disk. Behavior already pinned.

### F-T4 — SKILL.md invocation wording (#4) — confirmed → **FIXED**

**Final status:** `test_skill_md_uses_skill_tool_or_clarifies_invocation`
now passes unmarked.

**Fix applied (step 8):** SKILL.md "Run loop" step 2 now reads its
original sentence followed by *"In runtime contexts where direct
slash-command invocation is unavailable (e.g., when this orchestrator
skill is already active and is the one initiating the next step), use
the Skill tool instead."* Scope: one sentence, one file.

### F-T5 — diff-source plumbing for step 7 (#5) — not-a-bug

Probe: `test_skill_md_documents_diff_source_for_step_7` passes
unmarked. `mcp-contract.md:13` reads *"Reviews a git diff. Chunks by
file when over 256 KB; aggregates per-chunk verdicts (worst-of). Use
for step 7."* — `git diff` appears within ±20 lines of `step 7` (same
line) and `codex_review_diff` (same section). Property satisfied.

### F-T6 — README reinstall workflow (extra finding) — confirmed → **FIXED**

**Final status:** `test_readme_documents_reinstall_after_source_change`
now passes unmarked.

**Fix applied (step 8):** `plugins/workflow-orchestrator/README.md` now
has an *"After source edits"* subsection naming `/plugin uninstall`,
`/plugin install`, and `/reload-plugins` in a runnable block, plus a
note about the schema-files dev-loop shortcut. Scope: one new section,
one file (~12 lines added). F-7 is rehomed to *not-a-bug by design*
because the mitigation is now documented.

### F-T8 — redaction case-sensitivity (#6) — not-a-bug

Probe: `test_real_token_formats_match_case_correctly` — 8 parametrized
rows, all pass unmarked. All four real-format token patterns
(`github_token`, `slack_token`, `aws_access_key`, `anthropic_api_key`)
match the canonical case and reject the case-shifted lookalike. Patterns
are case-sensitive by construction in `codex_bridge/redaction.py:13–20`.
No false positives on the four lookalike rows.

### F-7 — cache-drift detector presence (#7) — **not-a-bug by design** (after F-T6 fix)

Probe: `test_no_cache_drift_detector_exists` passes unmarked (0 matches
across `*.py`/`*.sh`/`*.toml`, excluding `tests/`). By design the plugin
has no automated cache-drift detector; the mitigation is a manual
reinstall. With F-T6 fixed in step 8 (README "After source edits"
subsection), the mitigation is now documented and F-7 settles cleanly
as *not-a-bug by design*. Pre-fix this verdict was *latent* (coupled to
F-T6) — see "Audit history" above.

### F-8 — gate recovery after `/clear` (#8) — not-a-bug

Probe: `test_existing_resume_test_pins_pending_gate_recovery` passes
unmarked. `tests/test_workflow_state.py::test_resume_returns_pending_gate`
exists, calls `set-gate`, and asserts the resume-output `pending_gate`
matches. `/clear` is a Claude-Code in-session reset; on-disk
`state.json` is untouched, so resume reads the same bytes back. No
recovery defect.

### F-T9 — fake runner in production (#9) — not-a-bug

(Per step-7 review F-9.minor, the probe regex now covers whitespace,
quoted, and CLI-flag variants — `runner=fake`, `runner="fake"`,
`--runner fake`, `--runner=fake` — not just the literal `runner=fake`.)


Probe: `test_production_paths_do_not_inject_fake_runner` passes
unmarked. Recursive scan of `servers/codex-bridge/codex_bridge/` for
`fake_codex_runner`, `FakeProc`, `runner=fake` returns zero matches.
The fake runner is correctly confined to
`servers/codex-bridge/tests/conftest.py`. This probe joins the
existing `test_no_bypass.py` as a structural guard.

## Follow-ups — APPLIED IN STEP 8 OF THIS RUN

After the step-7 gate returned `apply-fixes`, all three confirmed
findings were patched in the same workflow run. The xfail-strict
mechanism then caught no accidental no-ops: every previously-xfailed
probe now passes unmarked.

1. **F-T2 — FIXED.** `bin/workflow_state.py:cmd_set` now type-checks
   each intermediate before `setdefault` and writes a one-line error to
   stderr returning code 2. Probe
   `test_set_into_list_intermediate_no_traceback_in_stderr` passes
   unmarked.
2. **F-T4 — FIXED.** `skills/workflow/SKILL.md` "Run loop" step 2 now
   includes the Skill-tool disclaimer. Probe
   `test_skill_md_uses_skill_tool_or_clarifies_invocation` passes
   unmarked.
3. **F-T6 + F-7 — FIXED.** `plugins/workflow-orchestrator/README.md` now
   has an *"After source edits"* subsection covering `/plugin uninstall`
   and `/plugin install`. Probe
   `test_readme_documents_reinstall_after_source_change` passes
   unmarked. F-7 is rehomed to *"not-a-bug by design"*.

Final suite (post-fix): 116 verifications all green, zero xfails. No
multi-module scope; each fix lived in a single file.

## Stop conditions

None tripped. F-7 grep returned 0 matches (the halt condition for
"matches > 0" did not fire). No security defect; no audit > 30 min; no
ambiguity; no regression on existing tests.
