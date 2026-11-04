# Phase 1B-2: restricted document IPC and source-range prototype

Based on `8bcaeda819edd24b5e2ea7698397cbad59d01d03`. This local checkpoint targets version 0.19.0.
This is an uncommitted developer experiment, not a production document UI.
The ordinary main/preload/renderer and legacy Vault save chain are unchanged.
Real-document write acceptance remains **FAIL**; SEC-01 is still unresolved.

## Boundary and allowed operations

`document-demo-main.js` is a separate explicit Electron entry, never imported
by ordinary main.js. It generates two fixed synthetic files under a new private
OS temporary directory and opens them with the default Document Service. It
uses no user-selected path, command-line path, environment-provided Markdown,
personal configuration, Vault or unsafeExperimentalRoot.

The main process owns documents and provisioning. `document-session-ipc.js`
binds opaque crypto.randomUUID IDs to a BrowserWindow/webContents, exact local
URL and its current main frame. Every request verifies these identities and
the window resolver; matching URL or numeric IDs alone is insufficient.
Navigation/loading, destroyed/crashed renderer and closed window revoke IDs.
There is no renderer create/open-by-path operation and no exposed fs, model,
snapshot identity, lifecycle capability, save-policy option or generic invoke.

The sole request channel is `document-demo:request`; its closed operation list:

| Operation | Input | Authority / outcome |
| --- | --- | --- |
| list | no data | Only this authorized window's main-provisioned IDs/labels |
| snapshot | sessionId | Complete in-memory source, revision, dirty, BOM/encoding/line-ending info and independent persistence state |
| edit | ID, explicit expectedRevision, PM from/to, insert | Main independently re-parses/maps/verifies a bounded text splice; no whole-file setter or serializer |
| check | ID | Check baseline; retain local text on external conflict |
| save | ID, explicit expectedRevision | Call default service policy; dirty replacement remains coordination-required |
| close | ID, explicit expectedRevision | Refuse dirty/unresolved state; otherwise revoke the ID without writing |

Unknown keys/operations, missing or invalid revisions, foreign sessions,
subframes and disappearing frames are structured refusals. Requests execute
synchronously in main; revision comparison and range edit have no await gap.
Successful content changes increment revision; no-op edits do not fabricate a
new revision. Replaying an already-applied mutation gets stale-revision.

At most eight live sessions and 128 Ki UTF-16 source code units are permitted;
an insert is limited to 4096 code units. This is not general DoS protection.
Forced window loss revokes authority while retaining dirty/unresolved models
in trusted main memory until process exit. It is not crash recovery or a
durable journal. No production discard/quit policy is supplied by this demo.

## Source-position experiment and restricted editing contract

The existing bridge retains mdast source positions during parse but does not
carry them into its PM JSON, and its full serialization normalizes source.
A small synthetic CRLF/Unicode probe confirmed this. No existing bridge was
changed or used as a whole-file save mechanism.

`document-source-map.mjs` instead parses the complete retained source using
the existing unified/remark dependencies and projects a strict subset:

- Single-source-line ATX headings and paragraphs containing verbatim text.
- Simple strong text (`**text**` or `__text__`) with one plain text child.
- Replacement/insertion/deletion wholly within one unambiguous mapped text
  span, leaving a nonempty span. PM offsets and original offsets are UTF-16.
- Raw source must exactly equal the leaf's decoded text. Escaped/entity text,
  nested/other marks or complex constructs do not get editable spans.

Every mapped change splices only the exact source leaf range, then re-parses
the proposed source and compares its projection against the expected text
change. It rejects structure/mark changes and any changed opaque block. Main
repeats this validation; a compromised renderer cannot use UI validation as an
authority grant. Source outside the selected range is never reconstructed.

The renderer accepts only a single text ReplaceStep whose proposed PM document
is schema-equivalent to the verified projection. It uses stepType, not a
bundler-dependent class name, and PM Node.eq, not JSON property order. A save
never calls remark-stringify or serializes the whole Tiptap document.

Front Matter, images and relative paths, tables, code, HTML, math, directives,
links, lists, unknown syntax and multiline paragraphs are **read-only source
code blocks in this prototype**. They are not rich-editable or silently removed.
Markers remain hidden for supported heading/strong text, while unsupported
source is explicitly visible. This is not the final single-surface product UX.
Empty blocks, mark-boundary insertions, cross-span edits, Enter/structural
changes, formatting toggles and rich undo/redo are not implemented. Paste and
drop are refused at handleDOMEvents before default clipboard/HTML parsing;
disabling input/paste rules alone does not establish this boundary.
Broken surrogate edits and invalid Unicode inserts are refused; tests cover
Chinese, astral emoji, combining marks and ZWJ sequences without normalization.
This is UTF-16 safety, not a grapheme-segmentation or native Chinese IME claim.

One acknowledged operation is allowed at a time. While IPC is pending the UI
rejects further edits explicitly; fast typing, composition, caret restoration,
selection, accessibility and interactive latency need later product work.
The optimistic view is restored from main on rejection. The complete source
view, revision/dirty state and structured error remain visible.

## Persistence outcomes are independent of dirty

IPC forwards the service persistence state and committed tri-state unchanged,
including durabilityUncertain and replacementUnverified flags. An unchanged or
dirty=false snapshot is not interpreted as safe disk persistence. The demo
does not expose retryDurability or a way to clear those warnings.

Actual synthetic fs fault tests drive directory-sync failure (dirty=false,
durability-uncertain) and post-rename metadata failure (dirty=true,
replacement-unverified) through the real service and session boundary. No
successful save response is faked. The public harness always uses default
refusal; unsafeExperimentalRoot is used only in the explicitly private unit
fixtures that need to induce these existing service outcomes.

The P2 lstat/unlink race, check/rename TOCTOU, external concurrency, complete
ACL/xattr/flags/filesystem support and restart recovery are unchanged. A
read-only/synthetic IPC success does not pass these real-file write gates.

## Reproduction and scope of evidence

From apps/desktop with pinned Node 24.20.0 and unchanged lockfile dependencies:

```sh
node --test test/document-source-map.test.mjs test/document-session-ipc.test.js
node node_modules/esbuild/bin/esbuild lib/document-demo-entry.js --bundle --format=iife --platform=browser --outfile=lib/document-demo-bundle.js
```

Run the existing matching Electron binary with `lib/document-demo-main.js` as
the explicit entry to open the private synthetic harness. Do not substitute a
real document path. `npm run test:e2e` includes the old Vault smoke and the new
synthetic IPC/editor smoke; E2E_ELECTRON_EXECUTABLE selects the existing runtime.
The new spec can also target the actual packaged entry through the test-only
DOCUMENT_DEMO_ENTRY environment variable. Production harness code ignores it.

The demo bundle is a new generated artifact; rebuild it after its entry or
source-map changes. The seven old builds/90 managed artifacts remain separate.
Packaging already includes lib/**/*, so the actual ASAR must be checked for
all new entry/preload/map/session/HTML/bundle members and run through the same
real E2E. No dependency or normal main/preload changes are needed.

Private evidence records RED/GREEN, native startup configuration failures,
transaction class-name/property-order corrections, size/frame regressions,
full regression results, reproducibility and ASAR identity. Dated results in
older contracts remain historical, not new release acceptance.

## Initial verification: 2026-10-24 (historical failure)

At the end of the initial implementation, the final actual-ASAR demo E2E
completes its functional assertions but fails normal shutdown. Main receives
before-quit and window-close; no window-closed/will-quit is observed within the
45-second bounded measurement. The test watchdog then sends SIGKILL, and the
required exit-code-zero assertion fails. This is a confirmed integration
symptom whose cause was then unconfirmed, not evidence of a native crash or of a
failure in the ordinary application's unchanged main entry. Do not ignore it,
force-destroy windows as a workaround, or call the final E2E passed.

Other evidence in this round: 81 focused document tests PASS (62 existing plus
19 new); full Node 2456 tests / 2454 PASS / zero FAIL / two existing skips;
Tiptap 44 PASS; seven old builds and 90 baseline artifacts PASS; new demo bundle
rebuild byte comparison PASS; earlier complete source E2E run 2 PASS, including
normal exit; unsigned arm64 package and twelve ASAR runtime-member identities
PASS. The final packaged-entry E2E is 1 FAIL at shutdown. Early test timeouts
must not be assigned to a proven startup/sandbox bug: bounded cleanup exposed
the actual transaction refusals, which were subsequently corrected.

The harness confines userData, sessionData and crashDumps to its private temp
profile. Its E2E includes a real unauthorized second window and early paste/drop
refusal. Lifecycle observations and the exit-zero assertion are retained for
independent investigation. Native IME composition and production editing UX
were not accepted or newly verified here.

## Approved shutdown fix and verification: 2026-10-24

Independent review D subsequently confirmed an application defect: the closed
window handler called revoke(win), which read win.webContents after destruction.
Electron's destroyed-object getter threw before cleanup completed, opening a
native JavaScript error dialog and blocking normal exit. This supersedes the
initial cause uncertainty above; the failure was not merely a harness timeout.

The production fix changes only binding removal in document-session-ipc.js:
find the saved binding by binding.win === win and remove its webContents key.
Revoke no longer reads a destroyed native property. Session disposal/retention,
sender/window/main-frame/URL checks and the operation allowlist are unchanged.
Repeated revoke is idempotent; unresolved models stay in trusted main memory,
which still provides no persistence across process exit.

Ten formal regressions first failed with Object has been destroyed on the old
implementation, then passed with the fix (19 session IPC tests total). They
cover direct closed, reload/destroyed/closed permutations, repeated cleanup,
cross-window isolation and clean/dirty/durability-uncertain/replacement-unverified
closure. Synthetic service failures preserve the existing unresolved-state
refusals and retained text/state; they are not production save authorization.

The E2E now observes the actual Electron child from its parent process. Passing
requires all functional assertions, invalidation of both synthetic session IDs,
child close with code=0 and signal=null, no watchdog, no observed main exception
or native error dialog, and no remaining observed children/process group. The
exception monitor and error-dialog wrapper preserve normal exception handling
and display; no error is suppressed. The existing 45-second failure watchdog
is unchanged, and forced cleanup cannot pass. A test-created DOM selection now
dispatches selectionchange before text injection; an initial full-suite run
failed because the second insertion used the old caret. That failed run is
retained as evidence, not counted as a successful repetition.

Final measured results: 91 Document tests PASS; full Node 2466 total / 2464 PASS /
zero FAIL / two existing skips; Tiptap 44 PASS and readiness zero blockers;
seven builds and all 90 baseline generated resources unchanged; demo bundle
unchanged. The full source E2E suite passed both tests. Three independent source
demo runs and three actual-ASAR demo runs each completed all assertions and
exited with code=0, signal=null, watchdog=false, zero observed exceptions/error
dialogs, both IDs revoked and no observed remaining test processes. These
repetitions do not prove every possible concurrent event order safe.

An unsigned macOS arm64 app was rebuilt at unchanged version 0.18.1; all twelve
checked Document/demo ASAR runtime members match the tested source by SHA-256.
ASAR runs used the matching existing Electron 43.4.1 runtime and the actual
app.asar/lib/document-demo-main.js entry. Runtime reported app.isPackaged=false
and process.defaultApp=true; neither flag was overridden. This is real ASAR
code execution, not Finder installation, signing/notarization or packaged-app
startup acceptance.

The shutdown blocker is resolved within these measured checks. The complete
Phase 1B-2 patch still awaits independent code re-review. Real-file writes remain
refused by the new service policy; the unchanged legacy Vault save path is not
covered by that statement. P2 cleanup races, TOCTOU/external writes, unsupported
metadata/filesystems, restart recovery, SEC-01, native IME and production UX
remain outside this fix. No dependency, version or Git commit change was made.

Under the project's new-stage policy, this local checkpoint uses minor version
0.19.0 with synchronized root manifest/lock fields. The earlier 0.18.1 results
above remain historical; the 0.19.0 candidate requires isolated tests and package
version/member verification. This is an unreleased developer checkpoint, not
authorization to publish or enable real-file writes.
