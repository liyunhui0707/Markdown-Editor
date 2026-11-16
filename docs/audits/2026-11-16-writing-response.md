# Editing response and continuous-writing stability — 0.77.3

Date: 2026-11-16. This group continues daily-writing stabilization; it adds no
syntax, layout, framework, dependency or file authority. The baseline is 0.77.2
at `a64a4ab`; the Air candidate runtime is implementation checkpoint `e528daf`.
Later documentation/test-only commits do not change that runtime. Development
integration and installation are not public-release or physical-input acceptance.

## Findings and implementation

Fresh Air main/renderer CPU profiles identify repeated full projection and
whole-document expected-value copying during each ordinary transaction.
The controller originally reconstructed the before-document after the mapper
had already done so. It now uses that mapper's complete before-document within
the same synchronous call; both full PM equality checks remain. This proof is
not accepted from IPC, cached across edits or retained in the controller queue.

Expected-document builders copy the root content array and deep-copy only the
edited top-level block. Callers mutate that owned subtree and only read borrowed
neighbors for the unchanged complete comparison. Lists/quotes own their containing
root; text in table cells owns the table. `projectSource` still returns fresh,
independently mutable data, including metadata used by existing list planners.
Main source validation, exact inverses, acknowledgement identity, pending-input
and composition fences, history limits and file checks remain in place.

Two earlier full-projection caches were rejected: freezing broke legitimate local
planner mutation and regressed the pure benchmark; cloning preserved ownership
but regressed that benchmark by 62–78%. Neither variant ships. Their failures and
initial red tests remain private evidence; existing regression tests were retained.

## Validation and measured limits

- Final pinned-Node baseline: **3,619 tests, 3,617 pass, zero fail, two existing
  skips**. Focused controller/history/structured/Space checks pass (205 before
  the additional format-edge proof regression). Four new focused tests cover
  copy ownership, complete before-proof/result parity, forged/invalid input and
  format-edge Space fallback; LF, CRLF, CR, Chinese/emoji and table/list/quote
  contexts are included.
- The rejected frozen-cache full run also had one native Desktop-directory probe
  failure (`directory-location-unavailable`). Its cause remains unattributed;
  subsequent complete accepted-implementation runs pass. No native helper or
  timeout changed, and that earlier failure is not relabeled as a product fix.
- Three alternating pure-mapper trials with identical exact outcomes reduce
  68-input totals by **14–18% at 150,182 UTF-16 units**, across plain/rich/list/quote
  sources. At about 10k units the measured reduction is 14–18%. These are CPU/wall
  mapping measurements, not native key latency.
- Air uses external Node 24.20.0 and Electron 43.8.7 on arm64/macOS 27.2.1.
  Exact transferred input and returned artifact hashes were checked. Baseline
  and candidate have identical CPU-profile instrumentation and the same synthetic
  mixed article. The native windows are visible; no user documents are opened.

| 150,182-unit article context | Baseline 68-key total | Candidate | Reduction |
| --- | ---: | ---: | ---: |
| Opening prose | 9,508 ms | 7,923 ms | 16.7% |
| Task/list format edge | 8,594 ms | 6,937 ms | 19.3% |
| Quote format edge | 8,943 ms | 7,301 ms | 18.4% |

These are one matched profiled pair, including driver/profiler overhead, not
independent first-key, physical-input or paint measurements. Both full mixed
workflows check controlled composition commit/cancel, exact source, Source
Undo/Redo, native Save, external conflict, retained export and restart recovery.
Candidate input-lifecycle and wrapped-structure scenarios also pass.

The first PR CI run (`43789936356`, head `0156291`) passes Node, generated
assets and 23 of 24 Electron flows, including the unchanged 150k-unit mixed
workflow. At the sixth near-capacity writing cycle it reaches the 64-operation
confirmation queue and correctly preserves the first refused edit; pending
acknowledgements later drain, but the explicit pause remains. This is not an
idle timeout that a longer wait would fix. It is retained as a real throughput
limit; the evidence does not establish whether CI host load or implementation
changes account for the particular saturation timing.

The sustained-history/recovery driver now sends the same individual native keys
in bursts of eight, waiting for confirmation between bursts. It keeps all six
positions, exact source/history/restart checks, document size, timeouts and pause
assertions; it never resumes a paused editor automatically. This changes the
test's input-rate envelope, not the product. Its later elapsed time is not
comparable to the original unpaced run. The unpaced 150k mixed-flow remains
unchanged, and CI additionally runs the existing deliberate saturation workflow:
hold acknowledgement, fill exactly 64 slots, retain the refused 65th edit, refuse
further typing, and require explicit acknowledgement before recovery and history.
The product queue cap and guards are not increased or disabled. Faster continuous
typing near the document limit remains a performance target, not a passed gate.

The candidate six-cycle writing run passes on a 480,929-unit document in 42.29
seconds, with normal exits and exact restart/continued input. It is not a
20-minute soak. Collected renderer heap changes from 4,090,908 empty bytes to
13,618,992 last-closed bytes; natural last-closed sample is 13,627,832 bytes.
This is comparable to the earlier candidate, not proof that all leaks are fixed.
The returned daily-workflow screenshot was visually inspected at its actual
viewport; the accepted layout remains intact.

A separately authorized first-key probe stops at startup, before any key is sent:
its new harness used a nested cwd outside the existing `document-safe-create-*`
isolation contract. No first-key observations were collected. The process exits
with code 1, watchdog is false, and no matching test app remains. Preserve the
two-file input and failure log; do not weaken the product scope check or rerun
GUI blindly. A corrected, separately bounded first-key measurement remains work
for the next measured stability group. This is a harness/precondition gap, not
evidence that first-key latency improved or regressed.

## Delivery and remaining gates

The candidate package contains 99 matched runtime files, a reproducible renderer
and unchanged native helper. Production test hooks are rejected. Its ASAR is
`9f88af61f96c46573fdb01cabc6db3d345f38fefc9b9ad27534087c6da56527f`.
Full PR CI and exact-head review must pass before daily-App replacement; preserve
rollback material and wait for normal user exit before touching an installed App.

Git uses one short group branch and checkpoint commits, followed by reviewed PR,
main synchronization and authorized merged-branch cleanup. GitHub rejected the
first unpublished checkpoint's private-email push (GH007). The identical tree was
recommitted with this same account's verified noreply identity and pushed normally;
no privacy protection was disabled and no published history was rewritten.

Next work remains daily-use stabilization: first-key/whole-document cost and
actual writing findings, then local stable acceptance. Genuine 20–30 minute user
writing remains postponed; physical Chinese IME and spoken VoiceOver evidence
remain scoped to versions/scenarios actually tested. Paid Developer ID signing,
notarization and public distribution remain deferred. Do not expand syntax
indefinitely, add tooling gates for their own sake or call this a 1.0 release.

Private logs, rejected experiments, profiles, exact manifests and failure/recovery
records remain under `.local/verification/writing-response-20261116/`, excluded
from Git and the App. Historical evidence is not discarded or silently repaired.
