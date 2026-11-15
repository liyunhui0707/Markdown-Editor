# Mixed long-article input performance — 2026-11-15

Scope: 0.77.2 development patch over main `68b26124`. Continue the accepted
local-stable-candidate phase; no new editor framework, visual design, serializer,
file authority, native helper, dependencies or expanded input limits.

## Problem and change

Typing in long articles with explicit links, wrapped lists and quotes repeatedly
cold-parsed the entire article. Reuse only the changed block after proving the
old local fragment equals its original global subtree. Require safe inline nodes,
unchanged block kind/container flags, outer blank gaps, trailing margin and exact
physical newline-token sequence. Container edits stay inside one text/code leaf.
Unknown syntax/context uses the cold parser. All document projection/main guards,
exact history, immutable two-revision cache and queue capacity remain in force.
Columns shift only on the physical edited line; all later offsets shift exactly.

Initial new bounded-work tests failed before implementation. The first full suite
caught an existing standalone-format optimization wrongly excluded by the new
container ownership guard. Restrict that guard to containers and retain the old
test unchanged. One added reviewer follow-up test initially over-asserted fallback
for a lazy quote whose cold AST was identical; remove that unrelated performance
expectation, retain existing lazy-context cold-AST checks. Failed logs remain.

## Independent static review

DeepSeek completed one approved five-file/29,346-byte static review. Snapshot and
model verification passed; terminal report and non-stale explicit checkpoint were
read. Its P2 adjacency hypothesis assumes the guard permits a one-break gap; the
actual `blankGap` requires two, so direct no-blank-gap differential/full-fallback
cases do not reproduce it. Its P3 newline concern is covered by the existing
no-newline edit/token checks and additional bare-CR/LF cases. All 24 focused
parser tests pass. No runtime change was needed from these two hypotheses.
No successful Read was observed for the original parser test; the parent executed
it. Review excludes dependencies and mapping/main integration. Client cost is an
estimate; provider bill/request count are unknown. No automatic second attempt.

## Controlled measurements

Pure `mapTextEdit` comparisons use identical 150,182-UTF-16-unit sources and 68
ASCII inputs per context, three alternating warm trials; every final source and
projected document must match. This measures mapping work, not browser/physical
input or visible paint. Final-source results (milliseconds, before / fixed):

| Context | Median time | Reduction |
| --- | --- | --- |
| Opening paragraph. | 4532 / 4694 ms | -3.6% |
| rich | 10918 / 3945 ms | 63.9% |
| word0 | 11119 / 3976 ms | 64.2% |
| quote0 | 11697 / 4456 ms | 61.9% |

These control-node observations overlap background verification/packaging work;
small differences in the plain control are not interpreted as a gain or regression.
Raw trials and exact final source hashes are retained in the private evidence.

One native-visible Air pair (macOS 27.2.1 arm64, Node 24.20.0, Electron 43.8.7)
uses the same 20ms driver cadence, actual full source/main/backup/save flow and a
private read-only beforeinput/status/frame observer on both versions:

| Context | 68-key elapsed before / fixed | ACK observation p50 before / fixed | Next-frame callback p50 before / fixed |
| --- | --- | --- | --- |
| Plain paragraph control | 9,270 / 9,206 ms | 110 / 109 ms | 66 / 65 ms |
| Wrapped task/list | 20,959 / 8,153 ms | 294 / 108 ms | 152 / 64 ms |
| Wrapped quote | 21,420 / 8,684 ms | 302 / 116 ms | 156 / 68 ms |

Each context observes all 68 inputs and exactly 68 confirmed revisions. ACK values
are upper bounds observed through status mutation; requestAnimationFrame callbacks
are not actual pixel presentation or physical keyboard latency. One pair cannot
establish general speed or tail-latency guarantees; first-key maxima remain about
0.57–0.58 seconds in fixed list/quote observations. Plain control is unchanged.

Both versions pass exact text, controlled composition commit/cancel, history,
source editing, native Save, external conflict, retained export and restart
recovery. The fixed build also passes six repeated 480,929-unit writing/close
cycles and restart/continued writing (49.9 seconds; **not a timed human soak**).
All selected processes exit cleanly, no watchdog/leftover test PIDs. Input and
returned-evidence hashes match. Screenshot inspected: accepted layout retained.

Air preparation first stopped before any GUI because system Python lacks the
`tarfile` filter argument. The corrected unpacker validates the exact archive hash
and permits only relative regular files/directories under `input`, rejecting
links/traversal before extraction. The authorized GUI tests each ran once.

## Integration and acceptance boundary

Full Node: 3,615 tests / 3,613 pass / zero fail / two existing skips. Both candidate
and installed 0.77.2 App startup/recent-panel checks pass without opening documents
or changing prior draft/save/recent records. Package matches 98 selected runtime
files and reproducible renderer output; production helper is unchanged and rejects
test hooks. Old/candidate bundles are retained and unregistered; one installed
Markdown handler remains and the existing `.md` default is preserved.

Final package and CI evidence are tied to the reviewed final candidate
in `.local/verification/mixed-input-performance-20261115/`; private test timing
probes, raw reviewer records and archives are excluded from Git and the App.
No physical IME, spoken VoiceOver or genuine 20–30 minute writing pass is invented.
Prior human feedback stays scoped to its tested version; the user postponed the
remaining writing check. This group improves measured paths, not all latency or
historical intermittent timeouts. Paid signing/notarization/public distribution
stay deferred. Next use remaining measured bottlenecks and actual writing findings
to decide local stable sign-off, rather than unbounded feature expansion.
