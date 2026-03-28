
## Eight roles

1. You = Team Lead
2. Architect = Planner (Define the scope and solution structure)
3. Implementer A and B = Builder A and B Candidate Builders
4. Test Agent = Verifier (Check what behavior is actually proven)
5. Reviewer = Judge (Checks correctness, scope, maintainability, and merge readiness)
6. Merge / Integration Agent = Consolidator (Helps decide whether controlled combination is justified.)
7. Reliability / Troubleshooting Agent = Recovery Specialist (Diagnoses weakness and recommends the next safe recovery step.)
8. Documentation / Report Agent = Explainer (Creates the final handoff)

## Agents used

- Architect: Claude Code
- Implementer A: Claude Code / Codex CLI
- Implementer B: Claude Code / Codex CLI
- Test Agent: Claude Code
- Reviewer: Claude Code
- Merge / Integration Agent: Claude Code
- Documentation/Report Agent: Claude Code
## Workflow Overview

- choose one bounded capstone task    
- write one shared task spec
- run Architect    
- refine the spec, validation gates, integration expectations, reliability expectations, and handoff expectations
- run Implementer A
- run Implementer B
- run Test Agent
- run Reviewer
- make a preliminary human decision
- run Merge / Integration Agent if needed
- run Reliability / Troubleshooting Agent
- apply the smallest justified recovery if needed
- re-check trustworthiness
- make the final human decision
- run Documentation / Report Agent
- write the capstone run log
- write a short post-capstone reflection on the workflow itself

## Task Spec

```
# Task Spec: Full Capstone Multi-Agent Workflow Run

## Task ID
task007

## Goal
Improve one MCP tool-call failure handling path so that failures are clearer and easier to diagnose, while preserving existing success-path behavior and supporting a full multi-agent workflow with validation, review, controlled integration if justified, reliability recovery if needed, and a final handoff report.

## Background
The current behavior works, but the failure path is not as clear as it could be. We want to improve diagnosability without broad architectural change, and we want to run the complete multi-agent workflow end-to-end in a disciplined way.

## Scope
Allowed files:
- mcp_server.py
- tests/*
- docs/* only if needed

## Out of scope
- No architecture redesign
- No broad refactor
- No public interface renaming
- No unrelated cleanup
- No repo-wide logging redesign

## Constraints
- Keep both implementations minimal
- Both implementations must solve the same task
- Preserve current success-path behavior
- Validation must cover both changed failure behavior and unchanged success behavior
- Any final integration must be narrow, explicit, and justified
- Any reliability recovery step must be smaller and safer than a chaotic full rerun
- Final report must reflect the actual workflow evidence

## Done definition
- One targeted failure path is improved
- Failure output is clearer and more diagnosable
- At least one meaningful validation step covers the changed failure path
- At least one meaningful validation step covers the unchanged success path
- Both implementations remain comparable
- A final human decision is made
- If integration is used, the integrated result is re-validated
- If reliability recovery is needed, the recovery step is documented and justified
- A structured handoff report is produced
- A capstone reflection is written

## Validation gates
- Relevant tests pass
- Failure-path validation is meaningful
- Success-path behavior remains unchanged
- Reviewer confirms scope discipline
- If integration occurs, the integrated result is validated again
- If recovery occurs, the corrected result is checked again
- Documentation/Report Agent produces an accurate final handoff report

## Integration expectations
If a selective merge is used, the final result must:
- choose one clear base implementation
- define exactly which small piece is borrowed from the other implementation
- justify why that borrowed piece improves the final result
- remain inside the original scope
- be re-validated after integration

## Reliability expectations
If the workflow result is weak or unclear, the recovery step must:
- identify the main failure type
- identify the most likely failure point
- avoid unnecessary broad reruns
- choose the smallest justified corrective action
- document why that corrective action was selected

## Handoff expectations
The final handoff report must clearly explain:
- the task goal
- the difference between implementation A and B
- what validation was performed
- what review found
- whether the final result was A, B, or an integrated version
- whether a recovery step was needed
- why the final result was chosen
- what risks or follow-ups remain

## Deliverables
- Implementation A summary
- Implementation B summary
- Test Agent evaluation
- Reviewer evaluation
- Integration evaluation if used
- Reliability / Troubleshooting evaluation
- Final human decision
- Final handoff report
- Capstone reflection

## Risks / ambiguities
- One implementation may drift into refactoring
- One implementation may validate only the changed path but not the preserved path
- Selective merge may look attractive but reduce coherence
- Integration may accidentally expand the scope unless kept narrow
- Recovery may be misapplied if the failure type is diagnosed incorrectly
```

## 1.Human Pre-Run Thinking

1. What exact failure behavior am I improving?
2. What exact success-path behavior must remain unchanged?
3. What would make A and B meaningfully comparable?
4. What would make integration worth considering?
5. What is the most likely workflow weakness for this task?
6. If weakness appears, what would count as the smallest safe recovery?
7. What would make the final handoff truly useful to future me?

## 2.Run the Architect Agent
### Architect Prompt

```
You are the Architect Agent for this repo.

Read the task spec below and inspect the relevant parts of the codebase.

Your responsibilities:
1. Explain the current structure related to this task
2. Identify the most relevant files and functions
3. Recommend the safest minimal scope boundary
4. Propose two different but comparable implementation approaches
5. Identify the most important validation targets
6. Identify likely risks, edge cases, and scope drift problems
7. Refine the done definition, validation gates, integration expectations, and reliability expectations if needed
8. Identify what evidence will matter most in the final handoff report
9. Identify which parts of this workflow are most likely to become unreliable or ambiguous later

Important rules:
- Do not start broad refactors
- Prefer minimal, maintainable changes
- Stay inside the stated scope
- The two implementations must solve the same task
- Validation must cover both the improved failure path and the unchanged success path
- Do not implement unless explicitly asked

Task spec:
[paste your task spec here]

Output format:
1. Current structure
2. Relevant files/functions
3. Recommended scope boundary
4. Implementation approach A
5. Implementation approach B
6. Validation targets
7. Risks and edge cases
8. Refined done definition
9. Refined validation gates
10. Important evidence for final handoff
11. Early workflow reliability risks
```

## 3.Refine the Spec Before Any Implementation Starts

### Integration expectations
```
If a selective merge is used, the final result must:
- choose one clear base implementation
- define exactly which small piece is borrowed from the other implementation
- justify why that borrowed piece improves the final result
- remain inside the original scope
- be re-validated after integration
```

## 4.Prepare the Two Implementation Lanes

### Use separate branches or work-trees

```
wt-impl-a-task005
wt-impl-b-task005

feat/task005-impl-a
feat/task005-impl-b
```

## 5.Run Implementer A

### Exact Implementer A Prompt

```
You are Implementer A for this repo.

Your job is to implement the task according to the shared spec and the Architect’s recommended Approach A.

Task spec:
[paste updated task spec here]

Architect guidance:
[paste Architect’s Approach A here]

Rules:
- Stay strictly within scope
- Solve the same task defined in the spec
- Keep the implementation minimal
- Do not do unrelated cleanup
- Do not redesign architecture
- Preserve success-path behavior unless absolutely necessary
- Support the validation gates defined in the spec

Before finishing:
1. Review your own changes for likely regressions
2. Check whether you stayed within scope
3. Summarize changed files and why each was changed
4. Explain what makes this implementation style distinct
5. List any open risks or uncertainties
6. Explain how this implementation should be validated

Output format:
1. Files changed
2. What changed
3. Why this implementation style
4. Suggested validation
5. Risks / follow-ups
```

## 6.Run Implementer B

### Exact Implementer B Prompt

```
You are Implementer B for this repo.

Your job is to implement the task according to the shared spec and the Architect’s recommended Approach B.

Task spec:
[paste updated task spec here]

Architect guidance:
[paste Architect’s Approach B here]

Rules:
- Stay strictly within scope
- Solve the same task defined in the spec
- Keep the implementation minimal
- Do not do unrelated cleanup
- Do not redesign architecture
- Preserve success-path behavior unless absolutely necessary
- Support the validation gates defined in the spec

Before finishing:
1. Review your own changes for likely regressions
2. Check whether you stayed within scope
3. Summarize changed files and why each was changed
4. Explain what makes this implementation style distinct
5. List any open risks or uncertainties
6. Explain how this implementation should be validated

Output format:
1. Files changed
2. What changed
3. Why this implementation style
4. Suggested validation
5. Risks / follow-ups
```

## 7.Write the Comparison Note Before the Test Agent

```
# Comparison Note: task007

## Shared task
What exact task were both implementations trying to solve?

## Implementation A
### Strengths
-
### Weaknesses
-
### Scope discipline
-
### Maintainability
-
### Likely validation concerns
-

## Implementation B
### Strengths
-
### Weaknesses
-
### Scope discipline
-
### Maintainability
-
### Likely validation concerns
-

## Initial human judgment
Which one currently looks safer?
Which one looks easier to validate?
Which one looks easier to maintain?
```

## 8.Run the Test Agent

The Test Agent remains focused on validation quality.

It should compare:

- changed behavior
- unchanged behavior
- test sufficiency
- weaknesses
- which implementation is better validated
### Exact Test Agent Prompt

```
You are the Test Agent for this repo.

Your job is to evaluate two implementations of the same task using the shared validation gates.

Task spec:
[paste the final updated task spec here]

Architect guidance:
[paste the Architect’s validation targets and scope boundary here]

Implementation A summary:
[paste Implementer A summary here]

Implementation B summary:
[paste Implementer B summary here]

Please inspect the relevant changed files and test coverage for both implementations.

Focus on:
1. whether the changed failure path is meaningfully validated
2. whether the unchanged success path is meaningfully validated
3. whether the tests are real, relevant, and sufficient for this task size
4. which implementation has stronger validation support
5. what important behavior is still weakly tested or untested

Important rules:
- Do not redesign the architecture
- Do not rewrite the implementation
- Stay focused on validation and test quality
- Evaluate both implementations using the same standard

Output format:
1. Validation strengths of A
2. Validation weaknesses of A
3. Validation strengths of B
4. Validation weaknesses of B
5. Which implementation is better validated and why
6. Missing tests or weak coverage
7. Validation recommendation
```

## 9.Run the Reviewer Agent

The Reviewer still focuses on:

- correctness
- scope discipline
- clarity
- maintainability
- merge readiness

### Exact Reviewer Prompt

```
You are the Reviewer Agent for this repo.

Your job is to review two separate implementations of the same task against the shared task spec.

Task spec:
[paste the final updated task spec here]

Architect guidance:
[paste the Architect’s scope boundary and both approaches here]

Implementation A summary:
[paste Implementer A summary here]

Implementation B summary:
[paste Implementer B summary here]

Test Agent findings:
[paste the Test Agent findings here]

Please inspect the actual changed files for both implementations and compare them.

Focus on:
1. correctness
2. scope discipline
3. clarity
4. maintainability
5. how well each implementation aligns with the validation evidence
6. risks
7. which implementation is safer to accept
8. whether selective integration appears justified or unnecessary

Important rules:
- Review against the shared spec
- Do not turn this into a new implementation
- Do not duplicate the Test Agent
- Use test findings as input, not as your only criterion
- Be explicit when one implementation is better than the other

Output format:
1. What A does well
2. What A does poorly
3. What B does well
4. What B does poorly
5. How the test evidence affects the comparison
6. Whether integration is justified
7. Which result is safer and why
8. Must-fix items before acceptance
9. Merge recommendation
```

## 10.Make a Preliminary Human Decision

Now stop and make your own preliminary decision.

Use one of these:

- choose A directly
- choose B directly
- A as base with possible narrow borrow from B
- B as base with possible narrow borrow from A
- reject both for now

This preliminary decision is important.

## 11.Write Integration Note Before Running the Integration Agent If needed

```
# Integration Note: task007

## Preliminary human decision
Which implementation currently looks like the better base?

## Base candidate
A / B

## Borrowable candidate pieces
List only small, specific pieces from the other implementation that may be worth integrating.

## Why each piece is attractive
Explain why it may improve the final result.

## Why each piece may be risky
Explain what could become worse if it is integrated.

## Non-borrowable elements
What should definitely NOT be merged?

## Re-validation needs
If integration happens, what must be validated again?
```

## 12.Run the Merge / Integration Agent If Needed

### Exact Merge / Integration Agent Prompt

```
You are the Merge / Integration Agent for this repo.

Your job is to evaluate whether two implementations of the same task should be kept separate, selected directly, or combined in a narrowly controlled way.

Task spec:
[paste the final updated task spec here]

Architect guidance:
[paste the Architect’s scope boundary and integration guidance here]

Implementation A summary:
[paste Implementer A summary here]

Implementation B summary:
[paste Implementer B summary here]

Test Agent findings:
[paste the Test Agent findings here]

Reviewer findings:
[paste the Reviewer findings here]

Preliminary human decision:
[paste your preliminary decision here]

Integration note:
[paste your integration note here]

Important rules:
- Do not redesign the architecture
- Do not invent a broad third solution
- Do not merge for the sake of merging
- If integration is justified, choose one clear base
- Only recommend narrow, explicit borrowable pieces
- Explain why each recommended integration improves the final result
- Identify what must be re-validated after integration

Output format:
1. Whether direct selection or integration is better
2. Recommended base implementation
3. Specific borrowable pieces, if any
4. Why those pieces should be integrated
5. What should NOT be integrated
6. Risks of integration
7. Required re-validation after integration
8. Final integration recommendation
```

## 13.Write the Reliability Note Before Running the Reliability / Troubleshooting Agent

### Reliability note template
```
# Reliability Note: task007

## Current workflow status
What currently looks weak, unclear, or untrustworthy?

## Suspected failure type
- implementation failure
- validation failure
- review failure
- integration failure
- workflow design failure

## Most likely failure point
Where did the workflow become unreliable?

## Evidence for that diagnosis
What concrete signs support this diagnosis?

## Recovery options
List 2–3 possible next steps.

## Smallest safe recovery
Which recovery step currently looks safest and why?

## What should be avoided
What recovery move would likely create more chaos than clarity?
```

## 14.Run the Reliability / Troubleshooting Agent

### Exact Reliability / Troubleshooting Agent Prompt

```
You are the Reliability / Troubleshooting Agent for this repo.

Your job is to diagnose workflow weakness and recommend the safest recovery step.

Task spec:
[paste the final updated task spec here]

Architect findings:
[paste the Architect summary here]

Implementation A summary:
[paste Implementer A summary here]

Implementation B summary:
[paste Implementer B summary here]

Test Agent findings:
[paste the Test Agent findings here]

Reviewer findings:
[paste the Reviewer findings here]

Integration findings:
[paste the Integration Agent findings here, if applicable]

Preliminary human decision:
[paste your preliminary decision here]

Reliability note:
[paste your reliability note here]

Important rules:
- Do not redesign the architecture
- Do not rewrite the whole implementation
- Do not recommend a broad rerun unless it is clearly necessary
- Diagnose the main failure type first
- Identify the likely failure point
- Prefer the smallest justified corrective action
- Explain why the recommended recovery is safer than the alternatives

Output format:
1. Main failure type
2. Most likely failure point
3. Evidence for that diagnosis
4. Recovery option A
5. Recovery option B
6. Recommended smallest safe recovery
7. What should NOT be done
8. Re-checks required after recovery
9. Reliability recommendation
```

## 15.Apply the Smallest Justified Recovery Step

If the Troubleshooting Agent identifies a real weakness, do the smallest safe fix.

Examples:

- strengthen one weak preserved-behavior test
- reject one scope-drifted path instead of trying to rescue it
- avoid integration and simplify the final decision
- re-run only the validation check after a narrow correction

Do **not** turn this into a giant new workflow.
## 16.Re-Validate the Final Result

### Optional Re-Validation Prompt(Ask Test Agent)

```
You are the Test Agent for this repo.

A final integrated result has now been formed.

Base implementation:
[paste base choice]

Integrated pieces:
[paste exactly what was borrowed from the other implementation]

Please inspect the final integrated result and evaluate whether:
1. the original changed failure-path behavior is still meaningfully validated
2. the unchanged success-path behavior still appears preserved
3. the borrowed integrated piece is correctly incorporated
4. any new gaps or risks were introduced by integration

Output format:
1. Re-validation strengths
2. Re-validation weaknesses
3. New risks introduced by integration
4. Final validation recommendation
```

## 17.Make the Final Human Decision

Choose one of these:

- select A directly    
- select B directly
- select A plus one narrow borrowed piece from B
- select B plus one narrow borrowed piece from A
- reject both and rerun later with a better workflow design

At this point, your decision should be able to explain:

- what the task was
- what A and B each did
- what validation showed
- what review showed
- whether integration was justified
- whether recovery was needed
- why the final result is trustworthy enough now
## 18.Run the Documentation / Report Agent

### Exact Documentation / Report Agent Prompt

```
You are the Documentation and Report Agent for this repo.

Your job is to produce a structured final handoff report for a completed workflow run.

Task spec:
[paste the final updated task spec here]

Architect summary:
[paste the Architect summary here]

Implementation A summary:
[paste Implementer A summary here]

Implementation B summary:
[paste Implementer B summary here]

Test Agent findings:
[paste the Test Agent findings here]

Reviewer findings:
[paste the Reviewer findings here]

Integration findings:
[paste the Integration Agent findings here, if applicable]

Reliability / Troubleshooting findings:
[paste the Reliability / Troubleshooting findings here]

Final human decision:
[paste your final decision and short reasoning here]

Important rules:
- Do not invent new technical conclusions
- Do not redesign the task
- Do not replace the human decision
- Base the report on the actual workflow evidence
- Write clearly for a future human reader who was not present during the run
- If recovery occurred, explain the weakness, the diagnosis, the recovery step, and the re-check clearly
- If integration occurred, explain the base, the borrowed piece, and the re-validation clearly

Produce a report with this structure:
1. Task overview
2. Implementation A summary
3. Implementation B summary
4. Validation summary
5. Review summary
6. Integration summary
7. Reliability / recovery summary
8. Final decision
9. Why this decision was made
10. Remaining risks or follow-ups
11. Recommended next step
```

## 19.Write the Run Log

```
# Run Log: 2026-03-20-run-007

## Task
Run a full multi-agent capstone workflow for one MCP tool-call failure handling improvement, including comparison, validation, review, integration judgment, reliability recovery, and final handoff.

## Agents used
- Architect: Claude Code
- Implementer A: Claude Code / Codex CLI
- Implementer B: Claude Code / Codex CLI
- Test Agent: Claude Code
- Reviewer: Claude Code
- Merge / Integration Agent: Claude Code
- Reliability / Troubleshooting Agent: Claude Code
- Documentation/Report Agent: Claude Code

## Shared spec quality
- Was the task clear enough?
- Were the validation gates strong enough?
- Were the integration expectations strong enough?
- Were the reliability expectations strong enough?
- Were the handoff expectations strong enough?

## Architect output review
- Did the Architect define the problem and approaches clearly?
- Did the Architect identify useful risks early?

## Implementation A review
- Which files changed?
- Did A stay in scope?
- What was A’s main strength?
- What was A’s main weakness?

## Implementation B review
- Which files changed?
- Did B stay in scope?
- What was B’s main strength?
- What was B’s main weakness?

## Test Agent review
- What did the Test Agent identify correctly?
- Which implementation had stronger validation?
- What validation weakness mattered most?

## Reviewer review
- Did the Reviewer stay focused on engineering judgment?
- Did the Reviewer clearly explain the safer choice?

## Integration Agent review
- Was integration justified or unnecessary?
- Did the Integration Agent keep the consolidation narrow?

## Reliability / Troubleshooting Agent review
- What failure type was diagnosed?
- Was the diagnosis convincing?
- Was the recovery recommendation smaller and safer than a broad rerun?

## Final decision
- Selected A / Selected B / Selected A + small part of B / Selected B + small part of A / Rejected both

## Why this decision
Briefly explain your reasoning.

## What worked
- Example: Role separation stayed clean
- Example: Validation evidence changed my initial judgment
- Example: The troubleshooting step prevented an unnecessary rerun
- Example: The final report made the whole run understandable

## What failed or felt awkward
- Example: My preliminary decision was too impression-based at first
- Example: The integration step was less useful than expected
- Example: The workflow became weak because preserved-behavior validation was too shallow

## Best insight from Day 7
What is the single most useful lesson from running the full capstone workflow?

## What still needs improvement
What part of your workflow is still weakest?

## Recommended next practice direction
What should you repeat or deepen after the capstone?
```

