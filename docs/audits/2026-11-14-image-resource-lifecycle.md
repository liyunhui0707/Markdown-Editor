# Image resource lifecycle investigation — 2026-11-14

Baseline main `ed896a747062eed6472107d761c7e626e77c594f`, Document 0.70.0;
fix checkpoint 0.70.1. Continue the local stable-candidate group without changing
the approved workspace, editor framework, file authority or attachment budgets.

## Confirmed findings and fixes

1. One managed 1,180,588-byte PNG referenced 40 times generated 40 identical
   preview IPC responses. Coalesce only in-flight requests with the same
   session/revision/href; remove each settled entry. No lasting data-URL cache or
   new cross-revision authority. Per-node closed/stale checks remain in place.
2. Closed image articles retained detached DOM after diagnostic collection. A
   two-cycle synthetic heap snapshot showed a retaining path from the live
   Document's MediaQueryMatcher through an HTMLImageElement viewport listener
   and the image parent/sibling chain into detached article text. Removing src
   alone was insufficient. Clear the atomic NodeView's owned children on destroy
   so a retained inner image cannot keep the detached article tree alive.

The same fixed draft was restored, edited, undone, switched through Source and
closed eight times. Disk article and attachment bytes remain exact; one recovery
record remains, closed session IDs refuse access, and editing surfaces disappear.

| Controlled measurement | 0.70.0 | Final 0.70.1 |
| --- | ---: | ---: |
| First open: preview responses | 40 | 1 |
| First open: transferred data-URL bytes | 62,965,680 | 1,574,142 |
| Whole eight-cycle workflow: responses | 440 | 11 |
| Closed DOM nodes after test-only collection | 127,336 | 1,266 |

The IPC regression test failed at 40 rather than 1 before the fix. A second
close-resource test failed with the old destroy logic before subtree cleanup;
the final eight-cycle test passes a baseline-relative DOM budget. Nine Node
cases cover duplicate/distinct names, unsupported URLs, close/session/revision
ordering, failures, loading/typing guards and already-loaded reuse.

## Limits and continuation

This establishes the duplicate-transfer bug and detached image-article tree
retention in this controlled workload. It does not attribute the older no-image
22.37-minute RSS/embedder trend or establish long-term leak elimination. RSS and
per-process samples remain observations: concurrent tooling and high-water native
allocation differ. The no-image fixed-record eight-cycle control retained 1,262
DOM nodes and 232 listeners at each collected sample. Diagnostic collection is
confined to tests; product code has no forced GC, cache-clearing timer or cap raise.

Continue with bounded no-image native/GPU/process attribution and genuine writing
acceptance when the user is ready. Earlier basic IME/VoiceOver passes retain their
original scope; fresh physical clipboard/IME, longer human writing and spoken
heading/table checks are not inferred from automation. Paid Developer ID,
notarization, external-volume staging and 1.0/public release remain deferred.

Private evidence: recovery checkout `.local/verification/image-resources-20261114/`
contains baseline/red, corrected resource evidence, synthetic heap snapshot and
retainer path. Early coalescing-only package/results are superseded, preserved
and excluded from final delivery evidence.
