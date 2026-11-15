# Local stable-candidate writing review — 2026-11-15

Baseline: main `fef57809ebdc0a19da498f668e721c3eda738dd6`, installed 0.77.0.
This group prepares patch 0.77.1 for a reproduced daily-writing defect and current
user documentation. It does not establish 1.0 or public-release acceptance.

## Confirmed input defect and correction

A 150,143-unit mixed article contains headings, combined marks, links, wrapped
tasks and quotes. At a bold word's end, a controlled 68-key sequence at 20 ms driver
delay loses four separating Spaces; following letters concatenate. The exact
baseline failure is retained. The native transaction inherits emphasis over a
trailing Space that cannot be represented by that raw Markdown delimiter pair.

Ordinary valid typing keeps its original path. Only an otherwise refused Space
at an emphasis boundary can use source-derived outer marks. Native beforeinput
checks DOM/PM/browser target agreement; the resulting single edit is still proven
by controller and main against the complete projected document, with exact inverses.
Composition/read-only/unknown/recovery/capacity guards are retained.

If a directly adjacent soft newline prevents visible whitespace, only that token
becomes its visible Space. A two-space hard break can use backslash spelling so
an added Space is not absorbed into its marker. Visible text and hard-break nodes
must remain exactly as intended. Undo restores the original prefix/newline bytes.
Other delimiters, link titles, paragraphs and line endings are not serialized.

## Evidence and limits

- Focused source/controller tests cover paragraph/heading/list/task/quote/table,
  nested emphasis, link labels, interior/code behavior, main-owned history, exact
  inverse and continued typing, IME/readonly/native-target refusals.
- A same-rate browser probe preserves all planned Spaces and words. A 150k-unit
  article still took about 9.8 s for 68 plain-paragraph keystrokes and 21–22 s in
  wrapped structured content, at 20 ms driver delay. This is total automation time,
  not a measured per-key rendering latency percentile. Performance is not signed
  off; it remains a concrete next investigation target.
- The first combined GUI attempt observed an unplanned `?` in a heading before
  its intended input, while another visible test was running. Cause is unconfirmed;
  preserve this failed run as inconclusive input provenance, not a product fix/pass.
  Subsequent GUI cases must run sequentially with explicit editor focus, exact
  caret/initial-source proof and completed composition/queue state before history.
- Full Node checks pass: 3,596 passed, two existing skips, zero failures.
  The source/controller additions contribute 17 regression tests.
- Visible sustained writing passes 20.46 minutes on a 480,929-unit document:
  six cycles, 10,744 typed units, exact history/source/backup checks, unchanged
  original and exact restart plus continued writing. Thirty-nine native-visible
  samples have distinct frame timestamps. Closed, explicitly collected JS heap
  samples are 12,067,492 and 13,623,752 bytes; corresponding renderer working sets
  span 256,608–330,160 API kilobytes. Natural and collected samples remain separate.
  Runtime modules/bundle were frozen; patch-version metadata changed after launch.
  This is developer-load automation, not isolated latency or leak-elimination proof.
- The complete 150,182-unit mixed-article workflow passes locally: three controlled
  composition commit/cancel contexts, all separating Spaces, Source application
  and exact Undo/Redo, BOM-preserving native Save, external conflict comparison,
  retained export, exact restart and continued writing. Accessibility/input-lifecycle
  regression scenarios also pass. Hidden-window functional checks are explicitly
  excluded from resource acceptance; CI uses its normal visible window.
- An intermediate Source-driver mismatch used Meta+End and multiline CDP insertion;
  it differed by one LF. An isolated probe and final full scenario use explicit
  macOS document-end plus two Enter keystrokes, preserving the original exact
  source/Undo/Redo oracle. No product change or expectation relaxation was used.
- Final CI outcomes are recorded with the exact candidate in the private
  verification directory below. A bounded pass does not prove global filesystem support.

## CI investigation retained

The first PR CI run passed all Node/generated checks and 23 Electron scenarios,
but the new mixed article timed out waiting for the input queue after its second
typing context. The assertion failed after 10 seconds; no queue/status artifact
was retained by that workflow, so backlog, lock state and attribution are unknown.
A sequential local native-visible run subsequently passed the exact complete flow.
Add bounded queue/revision/lock observations to the failing assertion and print
its failure state; retain identical input cadence, timeout and exact content oracle.
This diagnostic run is not a claimed product fix or a blind green-only retry.
Full successful CI remains required for integration; human/release gates stay separate.

## Current acceptance decisions

The user chose to postpone genuine 20–30 minute writing in this group. Current
physical input, spoken heading/table VoiceOver and human sustained writing remain
untested; earlier input-method/basic-VoiceOver reports retain their own version
and scope. Controlled CDP input and AX semantics cannot close these gates.

Preserve the historical intermittent sustained-test idle timeout as unconfirmed
unless a new failure is reproduced and attributed. Do not increase timeouts, lower
input rate, add retries, force product GC or raise safety caps to manufacture a pass.
Resource observations require native visibility and two distinct frame timestamps;
keep natural/collected samples and byte/kilobyte API units separate. Control-node
development work may run concurrently; do not call these isolated-device latency
or allocation-attribution measurements.

Keep the accepted appearance and Document architecture. Prioritize measured
long-article response and actual writing findings before adding more syntax/UI.
Paid Developer ID, notarization and public distribution remain user-deferred.
Current README/install instructions describe the installed product flow; older
Vault/version notes remain in a marked history archive rather than the user entry.

Private evidence: recovery checkout `.local/verification/stable-candidate-20261115/`.
See `observed-input-bug.json`, baseline/fixed browser logs, focused/full Node logs,
soak and complete daily-workflow evidence, package/source checks and final verification.
