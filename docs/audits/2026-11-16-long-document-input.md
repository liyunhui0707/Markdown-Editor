# First-key and long-document response — 0.77.4

This patch delivers improvement stage A: measured input/parse work reduction and
bounded content/history/recovery validation. Complex Markdown authoring and file/
image compatibility remain the next two approved groups. The accepted visual
baseline, runtime dependencies, native helper, file authority and queue/capacity
limits are unchanged. This is a local development candidate, not a public release.

## Changes and review

1. Prove ordinary trailing-Space spelling invalid directly from exact emphasis
   frames, avoiding an expensive failed attempt. Only the existing fallback may
   approve the edit, after complete intended-PM-document comparison.
2. Freeze relocated immutable AST objects during construction. Keep the two-entry
   cache, exact positions and independently mutable projections. A review found
   fresh custom point metadata could remain mutable; a failing regression now
   protects deep freezing, including nested arrays and own special keys.
3. Reparse bounded literal margin transitions locally: one isolated single-line
   paragraph, at most 4096 units, final exact text leaf, ASCII-space-only margin,
   no tabs or introduced/removed Markdown delimiters. Preserve old-local/global
   equality and new fragment kind/end/inline checks. Everything uncertain falls
   back to the complete parser.

The tests compare full cold ASTs across LF/CRLF/CR and complete projected documents
with exact inverse edits. Earlier red, intermediate and pre-review package results
remain private evidence; the final candidate was rebuilt and rerun after the fix.
New tests are under 300 lines; existing larger source-map/controller files are
not split during this bounded performance change.

## Measurements

Baseline: 0.77.3 (`cb5523e`). Final candidate: 0.77.4. Pure mapping measurements use
Node 24.20.0, three alternating warm trials, a 150,182-unit mixed article and 68
keys. Both versions must produce identical source and complete projections.

| Context | Baseline median | Candidate median | Reduction |
| --- | ---: | ---: | ---: |
| Plain paragraph | 3686.6 ms | 2473.9 ms | 32.9% |
| Rich prose | 2906.7 ms | 2537.8 ms | 12.7% |
| List | 2988.3 ms | 2582.1 ms | 13.6% |
| Quote | 3432.1 ms | 3006.5 ms | 12.4% |

Air uses macOS 27.2.1 / arm64, Node 24.20.0 and Electron 43.8.7, independent
dependencies and synthetic files. Each first-key case starts a fresh visible
edit-copy session. These are single paired observations from browser beforeinput
to observed idle acknowledgement; next-frame callbacks are recorded separately.
They are not physical keystroke, Chinese IME or displayed-pixel measurements.

| First key / context | Baseline ACK observation | Candidate |
| --- | ---: | ---: |
| Space, mixed prose end | 279.1 ms | 97.5 ms |
| Space, list emphasis end | 611.3 ms | 321.8 ms |
| Space, quote emphasis end | 626.6 ms | 315.8 ms |
| Space, near-capacity first paragraph | 251.0 ms | 57.6 ms |
| Space, near-capacity last paragraph | 253.3 ms | 55.8 ms |
| Letter, near-capacity last paragraph | 249.8 ms | 55.0 ms |

All ten first-key cases retain exact content, unchanged original files, verified
draft backups and normal exits. List/quote emphasis Spaces remain slower than
ordinary letters; this patch does not claim all long-document latency is solved.

For six unpaced 68-key bursts at 20 ms requested key delay in a 480,929-unit article,
baseline typing times are 5250/5120/4986/5304/5170/5002 ms; final candidate times
are 3689/3721/3585/3717/3704/3620 ms (28.2% lower median). Six final source hashes
match exactly. Both versions peak at one observed pending operation on Air:
**the historical CI queue-saturation failure was not reproduced on this host**.
No universal fixed-rate capacity claim follows from this comparison.

## Validation and boundaries

- Final full Node baseline: 3,625 passed, two existing skipped, zero failed.
- Final Air rerun: ten first-key cases plus daily article, controlled input
  lifecycle, deliberate pressure/recovery, six-cycle unpaced writing and wrapped
  list/quote workflows; normal exits, no remaining source-path test processes.
- Air input manifest: `e640d24a0889d3e05f2cb0240cdbf9e58c48a400b44f2dd2c95a752554e275f6`.
  Collected archive: `7f706d63c387ae681435068ce29d872c9d0f0098f658e2d06de3125f196ea7f4`;
  28 evidence files independently verified. Earlier baseline/comparison evidence
  remains separate; no failed observation is overwritten.
- Final App ASAR: `2c15a4138225874061e86ecad4adfa7cb4ae61d356b693539ebcbe45d07ee907`.
  All 99 packaged runtime files match local source and final Air input; production
  helper/test-hook rejection, renderer reproducibility and package exclusions pass.
- CI now separately runs first-key observations and unpaced near-capacity writing,
  alongside existing paced lifecycle and forced-pressure recovery gates. Full
  final-head CI is required before merge or daily-App replacement; a failure must
  be investigated, not hidden by slower input or a larger queue.
- Genuine 20–30-minute human writing, current physical IME/spoken VoiceOver and
  broader use remain separate acceptance. Historical passes keep their versions
  and scope. Developer ID, notarization and public distribution remain deferred.

Private logs, exact run commands, manifests, intermediate results, rollback and
installation records live in the checkout's ignored verification directory.
