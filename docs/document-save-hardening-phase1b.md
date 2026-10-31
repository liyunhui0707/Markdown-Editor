# Phase 1B-1: save-service hardening

Status: local uncommitted development; version 0.18.0. Based on the Phase 1A
checkpoint `7843f0522e1f15155554d4ad30bd8a150e9cac13`. No Vault UI/IPC,
Finder, multi-window, editor bridge, dependency or security-bundle migration.

Independent review rejected the previous local-checkpoint candidate for a P1
post-replacement POSIX validation defect and an unresolved P2 cleanup race.
The P1-only follow-up below is pending independent re-review, not commit or
real-file acceptance. Earlier test passes are historical, not review approval.

## Threat model and default policy

The service must not silently treat unchecked replacement as safe. A Node
snapshot/hash/stat followed by rename is **not** a conditional filesystem CAS.
External applications may write or replace the target at any time, including
after the final comparison. Rechecking the temporary file or verifying after
rename cannot undo an overwritten external version safely.

Consequently the default service opens/edits/checks source, but a dirty save
returns `coordination-required` before creating or replacing a file. Unmodified
save remains a no-write operation. This default applies only to the NEW service;
the old Vault UI is still unchanged and must not be assumed safe or disabled.

An explicitly named `unsafeExperimentalRoot` permits experiments only inside
one canonical private directory immediately beneath the OS temp directory.
The directory must remain current-user-owned and mode 0700 with the same
identity; files must be direct children on the same observed filesystem/device.
This is confinement, not proof that contents are synthetic. Only the trusted
test caller may assert that; never expose this construction option through IPC.
It is not a production filesystem allowlist.

Experimental results include `safety: experimental-uncoordinated` and
`realFileSafe: false`, including after OS sync and successful readback. Same-UID
adversaries, non-cooperating external writers and the final rename race remain
outside the guarantee. No experimental pass authorizes real user files.

## Lifecycle and input boundary

`DocumentModel` no longer exposes `acceptSaved()`. The internal creator returns
a separate capability retained only in the service's private session WeakMap.
No API retrieves a capability for an existing document. The service advances
its baseline and the model's saved text only from its own positively verified
replacement snapshot. The factory/capability pair must never cross IPC.

`edit` validates ordinary data records and refuses null, arrays, wrong types,
accessors, Proxies, unknown keys, invalid ranges and broken Unicode boundaries.
Session open/save options are validated likewise; invalid documents or states
return structured errors. Trusted service construction is a programming API:
invalid construction options throw TypeError, not an IPC error contract.

Optional `expectedRevision` is supported on `edit` and `save`. Wrong types return
`invalid-revision`; mismatch returns `stale-revision` without applying an edit or
write. Omission means no caller-supplied revision check. This is NOT a complete
IPC request/session/replay protocol. Unknown `revision` fields are not ignored.

## Persistence states

`getSaveState(document)` exposes a frozen view of the last stable persistence
outcome, independently of `dirty`. Confirming a saved baseline does not mean
newer edits are saved. Individual result `committed` describes that attempt;
the state view retains the last persistence outcome and unresolved flags.

| State | Meaning and permitted transition |
| --- | --- |
| `not-submitted` | Loaded baseline or policy refusal; no replacement confirmation |
| `failed-unchanged` | Pre-replacement failure, or failed rename with original baseline and owned source positively observed; retry allowed |
| `conflict` | External change detected; do not overwrite; retain edits and any pending uncertainty |
| `durability-uncertain` | Replacement and bytes/metadata verified, but synchronization/close did not confirm durability; ordinary Save and close stay blocked |
| `saved-confirmed` | Experimental replacement/readback and ordinary OS sync succeeded, or explicit durability retry succeeded; not a CAS/power-loss guarantee |
| `replacement-unverified` | Replacement returned but readback/metadata failed, or rename outcome cannot be established; further Save/close blocked |

`committed` is tri-state: `false` means no replacement by this attempt was
established (and, after a rename error, unchanged is positively checked);
`true` means replacement completed; `null` means its outcome is unknown. Do not
coerce null into "original file untouched". External actors can still mutate
files independently of any of these observations.

Pending durability survives unchanged Save, new edits, failed retries, external
conflicts and close attempts. Only `retryDurability(document)` can clear it:
recheck the exact saved baseline, synchronize the opened file and directory,
verify metadata and recheck baseline again. It never writes newer edits. A
failed retry leaves uncertainty intact. Unverified replacement cannot use this
shortcut because there is no validated version to confirm.

State is in-memory per live session, not a persistent crash-recovery journal.
Ordinary unchanged results provide no new sync evidence, even on a fresh open.
Future UI must consume the state and uncertainty flags, not infer safety from
`ok`, `dirty` or file existence alone.

## Replacement and concurrency checks

The experimental writer retains an O_NOFOLLOW, exclusively created sibling
descriptor through replacement. It verifies its full bytes, length, inode,
link count, POSIX metadata and accepted extended metadata before rename.
Partial writes are retried; zero progress fails. Unverified or substituted
temporary paths are not blindly deleted. Cleanup failures retain a recovery
candidate and explicit error.

Known P2 remains: cleanup performs `lstat` followed by pathname `unlink`.
Another process can substitute that name between the two calls, causing the
cleanup to delete the substituted file. Identity checking before deletion is
not an atomic conditional unlink. Existing substitution tests only cover an
intruder present before the check; they do not close this race. The P1 fix does
not modify cleanup. Before real-file enablement, this needs a separately reviewed
safe cleanup/quarantine or conservative no-delete strategy and race tests;
neither a private directory nor default refusal proves this window eliminated.

Target baseline checks and native metadata checks precede replacement. Returned
bytes and metadata are verified afterward before issuing a saved snapshot.
Post-replacement failure does not claim the original remained unchanged. A
rename exception is treated as unknown unless both original baseline and owned
temporary source are still observed; no automatic rollback is attempted.

Process-local locks cover canonical path plus device/inode across service
instances, including reentry through fault-injected callbacks. Stale sessions
still conflict after another session saves. These locks do not coordinate other
processes, workers, applications or filesystems.

## macOS metadata policy

Native, bounded, shell-free reads inspect ACLs, flags and xattr names. No
attribute value or tool output is logged. The only allowed xattr is automatic
`com.apple.provenance`, whose bytes are hashed locally and must match on source,
temporary file and replacement; it is not silently discarded or blindly copied.

- ACL present: refuse with `unsupported-acl`; no ACL removal or replacement.
- Other xattr: refuse with `unsupported-xattrs`; preserve the existing file.
- Nonzero flags: refuse with `unsupported-flags`, including hidden/immutable
  or other special flags; do not clear flags to make saving succeed.
- Special POSIX mode bits: refuse. Ordinary mode and uid/gid must match.
- Symlinks/hardlinks/non-regular files: retain Phase 1A refusal.
- Missing tools, unsupported platform, timeout, malformed/ambiguous output or
  unverified metadata: fail closed, never infer an empty metadata set.
- Filesystem mismatch in the experiment: refuse. Unknown/cloud/network
  production semantics are not supported merely because statfs returns a type.

This resolves metadata-loss risk by **refusal**, not general ACL/xattr/resource
fork preservation. Files with unsupported metadata cannot be edited through
this writer. True metadata-preserving real-file saves remain a separate gate.

## Verification record

Verified locally on 2026-10-23 with Node 24.20.0; packaged smoke used Electron
43.4.1 / embedded Node 24.18.1, arm64. All native metadata and fault tests use
owned synthetic files in isolated temp roots. Phase 1A source/format assertions
remain unchanged; only their fixture construction explicitly opts into the
confined unsafe experiment. There is a separate test proving defaults refuse
dirty replacement. Native macOS checks are never bypassed in positive writes.

### P1-only post-replacement POSIX follow-up

The candidate's observed mode, uid and gid must each equal the save expectation
before a snapshot is published. A mismatch returns
`replacement-posix-metadata-changed` with `committed: true` and no valid snapshot.
The existing service then retains its old baseline and dirty source, enters
`replacement-unverified`, and blocks further Save, durability retry and close.
It does not adopt the unexpected ownership/permissions or attempt rollback.

Six formal regression cases cover storage and service for each field. The mode
probe uses a real 0640-to-0666 change after rename. The gid probe uses a permitted
current group on an owned synthetic file when available, otherwise consistent
injected stat observations; uid uses injection, never privileged chown. All six
failed before the fix, reporting successful snapshot publication or
saved-confirmed/dirty=false, then passed after the four-line validation fix.
P1 follow-up verification: 62 document tests PASS (the prior 56 plus six new
regressions); full Node suite 2437 tests, 2435 PASS, zero FAIL, two existing perf
skips; Tiptap 44 PASS; seven builds and 90 generated-file comparisons PASS;
existing Electron E2E 1 PASS; unsigned arm64 packaging and actual ASAR POSIX
regressions PASS. The 56-case/2431-test counts below describe the pre-follow-up
run. P2 remains unresolved and real-file enablement remains blocked.

- Document tests: 56 PASS (34 Phase 1A + 22 hardening), 0 FAIL, 0 SKIP on macOS.
- Full `npm run test:ci`: 2431 tests, 2429 PASS, 0 FAIL, 2 existing perf skips.
- Tiptap corpus/readiness: 44 PASS, zero readiness blockers (limited scope).
- Seven individual build scripts: PASS; 90 generated files identical to Phase
  1A. The destructive aggregate regenerate script was not run.
- Existing legacy UI E2E: 1 PASS after builds, not evidence of new UI integration.
- Unsigned arm64 directory packaging: PASS; six required module members match
  current source (five document modules plus editor path policy), tested private
  and test paths excluded. No publishing or dependency rebuild.
- Actual ASAR in an isolated Electron main process: PASS for default refusal,
  private lifecycle, invalid input, sticky sync warning/retry, exact UTF-8/BOM/
  CRLF synthetic save/reopen and native xattr refusal. Not install/Finder/IME QA.

TDD logs retain an initial 18-case run with 17 failures (one was a wrong native
tool path, not a product defect). Corrected native flags reproduction against
unmodified Phase 1A confirmed old hidden flags changed from 32768 to 0. Metadata
fixtures were corrected to exist before loading, separately from external-change
checks. Later RED/GREEN assertions covered ambiguous metadata output, stable
warning responses and Proxy inputs. No product fidelity assertion was weakened.

The hardening test file exceeds the general 300-line source guideline to keep
one shared synthetic fixture and related state/native-metadata cases together;
it remains below the project's higher practical test-file cap. Production
modules remain under 300 lines. Private logs and artifacts stay outside Git.

## Next gate

This phase must not be called real-file save acceptance. Before writable real
document IPC/editor integration: review the lifecycle capability and persistent
warning contract, choose a coordinated/version-preserving save design with a
stated non-cooperating-writer policy, address complete macOS metadata semantics,
and design crash recovery and authorized opaque session/revision messages.
Native coordination alone must not be assumed to stop arbitrary writers.

Phase 1B-2 may be separately planned for read-only or synthetic-only IPC/editor
prototypes. Never pass `unsafeExperimentalRoot` or lifecycle functions from an
untrusted renderer. UI redesign, Finder and SEC-01 remain separate tasks.

References: [Node filesystem API](https://nodejs.org/docs/latest-v24.x/api/fs.html),
[Apple rename semantics](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/rename.2.html).
The archived manual and API documentation inform limitations; actual pinned
runtime and synthetic native tests determine this phase's verification results.

## Safe Create V1 — isolated new-copy prototype (0.25.0, uncommitted)

This addition is a test-process capability inside the existing File Store and
Document Service. It is NOT a Save As UI, an Electron IPC operation, or permission
to write user documents. `save()` still requires coordination. The Model,
source map, renderer/controller, preload, IPC allowlist and bundles are unchanged.

### Authority and scope

- Only trusted construction with `isolatedCreateRoot` enables creation. The root
  must be a canonical, owned 0700 `document-safe-create-*` direct child of the
  canonical OS temporary directory, on the same device and verified local APFS.
  Bounded native filesystem/metadata probes fail closed on unsupported output,
  ACL, flags or xattrs (existing provenance-only exception remains).
- The dedicated synthetic test process must already have that directory as its
  cwd. The service never calls `chdir`. Named-directory, cwd and opened-directory
  descriptor identities/permissions must agree before and after creation.
  Creation uses a single-component ASCII `.md` name relative to the kernel cwd,
  not a user-supplied absolute path. A parent rename cannot redirect that relative
  open to a replacement directory; observed identity changes reject confirmation.
- A trusted `open(..., {syntheticTemporary: true})` must additionally authorize a
  private, owned, single-link seed inside the same root. Ordinary opens, including
  real read-only document sessions, never receive this capability.
- This is not an OS sandbox or protection against privileged actors, malicious
  same-UID processes continuously mutating files, native code changing cwd, or
  untrusted filesystem adapters. The harness exclusively owns the root/process.
  No arbitrary-directory, network/cloud/sync-folder or production-filesystem
  coordination guarantee is claimed. Unknown/changed scope is refused.

### Source and lifecycle contract

`createIsolatedCopy(document, {name, expectedRevision, expectedSha256, cancelled?})`
is synchronous and local to the trusted test harness. Explicit revision and
SHA-256 of `document.bytesForSave()` are required; bytes come only from the
service-owned model. No Markdown reserialization or renderer body is accepted.
Conversion errors and changed seed baselines reject creation. A per-session
single-flight guard blocks reentrant create/save/close; source revision and bytes
are rechecked afterward. There is no asynchronous selection/activation phase.

No UI/IPC creation route exists: create requests, including forged paths, stale
or invalid sessions and requests during composing/pending states, have no
allowlisted operation. Consequently this prototype does not claim to solve GUI
quiescence, IME preedit capture or asynchronous IPC-outcome handling. A future UI
connection must explicitly establish those fences before requesting creation;
the local method alone is not authorization to connect it to a renderer.

`getCopyState()` records a separate immutable copy outcome. Success describes a
copy of revision R, not a saved temporary document. It never calls `acceptSaved`,
rebinds a path, clears dirty, changes revision, edits the original seed, or changes
Undo/Redo history. Unknown/partial outcomes remain sticky across later edits,
cancel requests and ordinary save attempts; create/save/close cannot discard them.
This prototype has no automatic retry or uncertainty-resolution operation.

### Creation and failure semantics

The File Store uses `O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW`, mode 0600, without
`O_TRUNC`, rename, staging files or deletion. Partial writes are completed in a
bounded loop; zero progress or errors stop. The pinned descriptor and named file
must be the same regular single-link inode with expected mode/ownership/device.
Exact bytes, SHA-256 and stat metadata are checked before and after file and
directory `fsync`. Post-sync same-byte rewrites cannot reuse earlier sync evidence.

| Copy state | Meaning |
| --- | --- |
| `not-created` | Scope/input/cancel/pre-create refusal; no target created by this operation |
| `target-exists` | Exclusive open refused; existing file/symlink was not overwritten |
| `created-partial` | Exclusive open succeeded, but complete verified contents are not established |
| `created-unverified` | Full write or later source/identity/content/metadata checks are inconsistent |
| `durability-uncertain` | Verified bytes exist, but synchronization or descriptor closure was not confirmed |
| `create-outcome-unknown` | An attempted creation failed without a trustworthy creation outcome |
| `created-confirmed` | Exact copy verified, file/directory fsync and descriptor closure returned successfully |

`created` is false / true / null (unknown); it is independent of original-document
`dirty` and `getSaveState()`. Failure receipts preserve the expected `filePath`
and captured inode identity where available. If a directory/file was moved, the
recorded path is only a locator to investigate, not proof it still names that
inode. Nothing automatically unlinks, overwrites or retries a residual file.
An injected lost descriptor is explicitly closed by its owning test fixture.

`created-confirmed` is an observed fsync-level result, not proof against power
loss, storage-controller cache failure or subsequent external modification.
No F_FULLFSYNC, cross-restart recovery journal or durable error receipt is added.
The test directory may later be removed by the OS; it is not long-term user storage.

### Bounded verification and remaining gates

`test/document-safe-create.test.js` extends the existing Node test runner. The
initial 18 cases failed before implementation. Coverage includes exact UTF-8,
Chinese/emoji, BOM, LF/CRLF, absent EOF newline, untouched syntax, existing and
dangling-link targets, competing exclusive creation, private-root/cwd identity,
permissions/xattrs/filesystem rejection, partial/no-progress writes, file/directory
sync failure, unknown open results, close failure, revision/hash/session checks,
source drift and unchanged IPC Undo/Redo. A same-byte post-sync interference
regression separately failed before the metadata-epoch check and then passed.

A creator Node process writes two synthetic paragraphs and exits with code 0;
a fresh Node process opens the copy via the existing `open-file` native-choice
authorization flow (trusted chooser fixture), verifies read-only save refusal,
source and SHA-256, then exits with code 0. This exercises the actual Service and
session manager, not a mocked save result. It is NOT an Electron GUI/dialog or
Air run. No UI is added, so no GUI, bundle rebuild, ASAR or packaging test is needed
for this isolated layer. Final counts and private log location are reported with
the candidate fingerprint; prior phase results above remain historical. Final local
verification: 25 Safe Create cases PASS; 189 combined Document/IPC/controller/
source-map cases PASS, zero FAIL/SKIP, Node 24.20.0 on macOS arm64. No GUI run.

The File Store now slightly exceeds the ~300-line guideline. Its new local
creation function stays beside the shared read/hash/metadata helpers; existing
replacement code is left intact instead of introducing a parallel save service.
The regression file uses the existing higher test-file size allowance.

Session E must independently review the scope, exclusive-open semantics,
uncertainty receipts and tests before any further enablement. Real-file write
gates, P2 replacement cleanup race, replacement TOCTOU, external coordination,
general ACL/xattr support, SEC-01 and stage 1B-3 formal FAIL remain unchanged.


### Local WIP checkpoint review record

The preceding section records the originally uncommitted implementation candidate
and its development-version test evidence. Session E subsequently accepted this
isolated capability for a restricted local WIP checkpoint: exclusive creation,
directory/authorization boundaries, failure semantics, byte integrity and the
unchanged save/readonly gates passed. Reported independent evidence is 25 Safe
Create tests, 164 related Document regressions and two supplementary probes;
no new confirmed P0/P1 was reported. Cross-process reopening is covered by this
limited review, not GUI or production Save As acceptance.

This checkpoint is unreleased and is not merge/release approval. User-selected
directory saving remains unavailable, existing user Markdown stays read-only,
and the coordination-required gate remains in force. All failure-state,
filesystem, power-loss, concurrency, restart-recovery, SEC-01 and stage 1B-3
formal FAIL limitations above remain unchanged. Any further enablement requires
its own authorization and review.


## Save Copy UI V1 — restricted development entry (0.26.0, uncommitted)

This extension connects the reviewed isolated-copy Service to the existing unified
Document window. It does not enable ordinary Save As, user-selected creation
paths, overwrites or the old `save()` path. Safe Create's File Store, policy,
Service and Document Model are unchanged. The launcher creates an owned 0700
`document-safe-create-*` directory directly under the canonical OS temporary
directory and starts the same Electron main entry **with that cwd**. It does not
change cwd inside a running Electron process. Existing root identity, local APFS,
metadata and exclusive-create checks still decide whether creation is allowed.

From `apps/desktop`, run:

```sh
mise exec -- node tools/run-document-copy-demo.cjs
```

Choose **New temporary document**, write ordinary paragraphs, then click
**创建测试副本** and **Create new test copy**. Cancel sends no create IPC.
The receipt displays the generated filename/full path, confirmed revision and
SHA-256. Use **Open Markdown… / Cmd+O**, then **Cmd+Shift+G** in the native chooser
to select that path. It opens through the existing read-only authorization flow.
The same copy can be reopened after this application exits. The OS may clean the
test directory: these copies are not appropriate long-term storage.

### Authority and UI result contract

- Only an explicit unpackaged `--document-readonly --document-test-copy` launch
  enables main-owned temporary-session copy capability. Ordinary document startup
  and user-selected read-only files have no creation authority. Arbitrary cwd,
  unsupported filesystems or invalid metadata fail closed, not fallback to saving.
- Main supplies a random new filename and takes bytes from the existing model.
  The strict `create-test-copy` IPC accepts only session ID, expected revision and
  the hash of main's previously confirmed bytes. Renderer paths, text, names and
  policy options are rejected. Sender/window/frame/URL authorization is retained.
- Service creation is synchronous and single-flight; main checks session binding
  again before publishing a response. Preload fences pending calls, composition,
  known transport uncertainty and in-flight copy operations. Unknown outcomes
  remain blocked for this page; no retry/automatic unlock is provided.
- The UI also refuses local unconfirmed source, retained recovery records,
  invalid composition, blocked documents or history operations. Confirmation
  freezes edits and navigation until cancel or response. Native IME content that
  has not reached DOM/controller cannot be claimed captured; native Chinese IME
  acceptance remains outstanding.
- Copy receipts are separate from dirty/save state. No `acceptSaved()` or history
  reset occurs. The temporary document continues to say **Not saved**, and later
  edits never update the earlier copy. Existing memory-only drafts still require
  attention before closing or refreshing.
- Partial, uncertain and failed creation display distinct state/created/path
  evidence. A recorded path is a locator, not proof of current identity after
  external changes. There is no automatic deletion, overwrite or residual-file
  retry. A lifecycle/transport ambiguity never displays confirmed success.

### Verification and remaining limits

The existing Node test files cover capability denial, readonly/path/hash/revision
rejection, partial/sync/existing-target outcomes, reentrant operation exclusion,
revocation, preload transport/composition guards and the UI's refusal predicate.
The original Safe Create byte-fidelity and no-overwrite tests remain in use.
The existing Electron regression file adds a real keyboard/copy/reopen chain;
its only controlled native UI part is the chooser/close decision, not the Service
or IPC result. Creator and reader are separate, actually exited Electron processes.
This is source Electron verification, not a packaged application/Finder acceptance.
Current candidate fingerprints and results are kept outside Git; the accompanying
report gives actual counts, device, bundle equality and exit results.

A small presentation helper and development launcher keep copy UI out of the
Document Model/history implementation; there is no second saving service. The
existing entry remains slightly over 300 lines; only wiring was added, while the
new copy view is separate. Test additions reuse existing files and runners.
The old save coordination-required gate, P2 cleanup race, TOCTOU, concurrent
same-user interference, ACL/xattr restrictions, power-loss/restart recovery,
SEC-01, native IME gaps and stage 1B-3 formal FAIL remain. This prototype requires
session E's limited safety review before a checkpoint; no release is approved.


## Persistent Copy V1 — restricted local WIP checkpoint (0.28.0)

This extends the existing copy flow; it does not enable ordinary `save()` or
editing existing user files. The implementation was tested and independently
reviewed at 0.27.0; this local WIP checkpoint is 0.28.0, including the small P2
status-text correction described below.
Run from `apps/desktop`:

```sh
mise exec -- node tools/run-document-copy-demo.cjs --persistent
```

Create a temporary document, write ordinary paragraphs, then choose **Create
persistent test copy… → Choose location…**. Main asks for explicit test-folder
consent and shows the native save sheet. The renderer supplies only session ID,
revision and source hash, never a destination or replacement Markdown body.

The initial destination contract is deliberately narrow: an EMPTY directory
named `Markdown-Persistent-Test-*`, directly inside the current user's real home
folder, owned by that user and not writable by group/others. It must be on the
home volume's local APFS, have no symlink alias, and pass existing ACL/xattr/flags
checks. No important documents or external sync software may use it (explicit
user confirmation; arbitrary third-party sync configuration is not detectable).
The new filename uses 1–64 ASCII letters/digits/hyphens/underscores, starts with a
letter/digit, and ends in `.md`. Existing files and dangling symlinks are refused.
After a copy exists, a different name in the same now-nonempty folder is also
refused in this first version. These are temporary product-test restrictions,
not proposed permanent requirements for all macOS folders.

Main pins the selected directory identity and delegates one bounded task to
Electron `utilityProcess.fork({cwd})`. The trusted writer checks the selected
identity against `.` and reuses the existing relative `O_EXCL | O_NOFOLLOW`
File Store loop, including byte/hash/metadata checks and file/directory fsync.
No Electron-main `chdir`, system Node runtime, native addon, Fuse changes or
parallel save framework is introduced. Source authority remains the existing
isolated temporary-document capability, separate from destination authority.

Success requires a matching request/revision/hash receipt, actual utility exit
code 0, current authorization, the original directory identity and independent
parent re-reading of the same file identity/bytes/hash. Cancellation, timeout,
lost/malformed response, abnormal exit and lifecycle changes cannot become a
confirmed success. Async Service single-flight and post-operation source checks
preserve the Model baseline, dirty flag and history. The original document stays
**Not saved**; later edits never update a previous copy. Partial/unverified and
unknown files are retained; no automatic deletion, overwrite or retry is allowed.

`cwd` is an anchor, not a filesystem sandbox or full openat equivalent. A renamed
original directory may retain a partial/complete copy. The receipt path is only
last verified, not a permanent path lease. Malicious same-user interference,
power-loss durability, network/cloud filesystems and cross-restart recovery
remain outside the guarantee. General save still returns `coordination-required`.
SEC-01, native IME limitations and phase 1B-3 formal FAIL remain unresolved.

Historical automated validation for the reviewed 0.27.0 candidate:

- MacBook Pro Node 24.20.0: 85 focused Persistent Copy/Safe Create/IPC tests and
  62 existing Document/save regression tests passed. Faults use synthetic files;
  permission and I/O failures are controlled injections, not real disk failures.
- Air Electron 43.4.1: one actual UI/IPC/utility-writer E2E passed across two
  Electron processes. It verifies new creation, cancel, existing-target refusal,
  unchanged earlier copy after later typing, and read-only reopening/hash equality.
  Both application exits were 0/null; watchdog, main-process fault and leftovers
  were false. Native dialog results/consent were stubbed with synthetic selections:
  that automated run did not validate manual interaction with the native sheet
  or its no-precreation behavior. Later user manual QA is recorded separately below. The non-MAS development path explicitly disables security-scoped
  bookmarks; it does not request bookmark-driven file precreation.
- Actual source and ASAR writer compatibility passed on Air using bundled Node
  24.18.1. The final writer-only ASAR test created a CRLF Unicode copy; five ASAR
  member hashes match candidate sources. This uses `app.isPackaged=false`, not
  a signed/installed app or Finder-launch acceptance. Packaged enablement remains
  disabled. No full packaging or unrelated E2E matrix was run.
- Two additional windowless actual-ASAR utility-process probes passed: directory replacement before task delivery returned not-created, and replacement after the child receipt returned created-unverified. Both replacement directories stayed empty; no obsolete success was accepted.
- Demo bundle independently rebuilt on Air and matched exactly. Initial Air
  preparation corrected a native-esbuild invocation and an overly restrictive
  test filter before GUI execution; those were runner errors, not hidden passes.

Two small runtime modules hold the one-shot writer and its bounded parent process
handling. Existing policy, File Store, Service, session IPC, preload and copy UI
are extended in place. The File Store already exceeds the 300-line guideline;
its creation loop is intentionally retained rather than split during this change.
Session E's limited security review is PASS, as reported by the user. The user
also reported native Save Dialog manual QA PASS on MacBook Pro for the reviewed
0.27.0 candidate. This is human-reported acceptance, not an automated test result:

1. Selected the dedicated APFS persistent test directory and new filename.
2. Cancel created no file and retained the temporary writing.
3. Created the new `.md` without unexpected precreation or overwrite.
4. Receipt path, revision and SHA-256 matched the actual file.
5. Later edits did not change the earlier copy.
6. After quitting and restarting, the file reopened with the same body, read-only.
7. The temporary document continued to display **Not saved**.

P2 checkpoint correction: the information note no longer assumes a copy exists.
No confirmed receipt is described as such; confirmed success identifies the copied
revision and excludes later edits; partial/unknown outcomes say a file may exist.
This changes presentation only. Writer, Service, authorization, IPC, save policy,
Model and history behavior are unchanged from the reviewed candidate. The demo
bundle is regenerated; the note and badge are covered by targeted renderer-header
regressions. User native-dialog QA is not a claim of human re-testing this wording.

Arbitrary-directory Save As remains unavailable. Existing real Markdown files
remain read-only; general save is still gated. SEC-01, phase 1B-3 formal FAIL,
full native IME acceptance, full installed-package acceptance, malicious same-user
concurrency and power-loss durability remain unresolved. No release, merge or
real overwrite approval; this is only a recoverable local WIP checkpoint.


## Controlled In-Place Save V1 — closed preflight, BLOCKED (2026-10-30)

At baseline `2fb6eedb3d9ed7ebc39eb01e63e18e8da87ebfc8` (0.29.0), four bounded
synthetic local-APFS observations confirmed the existing boundary. Default save
refuses with `coordination-required`, retaining original bytes and dirty. A
replacement visible before saving is a conflict. In the existing explicitly
uncoordinated experimental branch, a separate process replacing the target after
the final check and before rename loses its replacement; save reports
`saved-confirmed` and clears dirty. A stable child cwd and relative rename do not
close this target-entry race. These were real synthetic filesystem operations,
with injected scheduling at the syscall boundary, not fabricated save responses.
The observation assertions passed; overwrite safety did not. No production gate
was lifted and no further random tests were run.

The current Service also advances its baseline after a positively verified
replacement even when directory synchronization is uncertain, while keeping the
`durability-uncertain` warning. A future requirement to retain dirty until all
success conditions are confirmed needs an explicit contract change; it cannot be
inferred from the existing save result. Resume in-place-save work only after an
accepted coordination mechanism covers baseline validation through replacement
and its uncertainty semantics are reviewed. Extra stat/hash checks, provenance,
private directory permissions or cwd pinning alone do not meet that condition.
No native coordination framework or File Store rewrite is started. Existing-file
overwrite and `coordination-required` stay unchanged.

## Save As New File V1 — bounded product implementation (0.29.0, uncommitted)

This supersedes only Persistent Copy V1's destination-name/empty-folder and
ASCII-filename restrictions. It reuses the same native dialog, main-owned
Service/IPC, short-lived Electron utility writer and exclusive File Store create
operation. There is no replacement permission, new save service or history model.

Run the existing development launcher with `--persistent`. Open a synthetic `.md`,
choose **Edit a copy**, edit supported ordinary paragraphs, then choose **Save as
new file… → Choose location…**. Confirm the local-folder restrictions in the
native sheet and select a new filename. A confirmed receipt reports revision,
actual path and SHA-256. The editing session remains **Not saved**; later edits
and undo/redo do not update the created file. Cmd+O can reopen it read-only,
including after the application exits. Original files remain byte-identical.

Supported scope for V1:

- A selected ordinary directory directly under the user's canonical home folder,
  on the same local APFS volume, owned by that user, writable/searchable by the
  owner and not writable by group/others. It may already contain files. The app
  does not enumerate or read those unrelated files, chmod the directory, or create
  marker files. Nested folders and other volumes are not yet supported.
- Symlink aliases, hidden folders, Desktop/Documents/Library/Applications and
  known cloud/sync folder names are rejected. Existing ACL, special flags and
  unsupported-xattr refusal remains. These are conservative V1 boundaries, not
  permanent macOS folder rules. Arbitrary third-party sync configuration cannot
  be inferred from a path: the user must confirm that the chosen folder is local
  and unsynchronized. A custom sync root disguised by an ordinary name is not
  automatically detected or claimed supported.
- A single well-formed Unicode basename ending in `.md` (case-insensitive), at
  most 255 UTF-8 bytes. Spaces, Chinese and emoji are supported. Separators,
  colons, hidden names, control/bidi-control characters and leading/trailing
  whitespace are refused. Names are not silently normalized.

Directory identity capture, child cwd identity checks, `O_EXCL | O_NOFOLLOW`,
actual file identity/bytes/hash/POSIX metadata checks, file+directory fsync,
child receipt/exit validation and parent reread remain. Existing targets,
including dangling symlinks and raced-in files, are never overwritten. A changed
directory cannot redirect the writer to its replacement. The original pinned
directory may retain a file if renamed: this remains unverified, not success.
Cancellation and pre-creation rejection retain writing. Partial, uncertain and
unknown outcomes retain their accurate receipt and block retries; no automatic
cleanup, overwrite or fallback exists. Ordinary save remains gated.

The source revision/hash, composition, pending/unknown IPC and session checks
are unchanged. No Model, Service, session IPC, preload, source-map, controller or
writer lifecycle change is needed. File Store changes only persistent basename
validation and its scope label; the replacement path is untouched. Large existing
modules are retained to avoid unrelated refactoring.

Native Chinese IME remains NOT VERIFIED; the earlier user's Chinese-input QA FAIL
has not been cleared. Controlled input events are not native IME acceptance.
SEC-01, phase 1B-3 formal FAIL, power-loss durability, malicious same-user races,
post-verification path changes and cross-restart draft recovery remain open.
No full installed-package, general Save As or original overwrite acceptance is
claimed. The limited external review and its stopping condition are recorded below; this candidate remains uncommitted.


Validation for this uncommitted Save As New candidate (MacBook Pro):

- Four new regressions were RED against the prior policy, then GREEN after the
  bounded destination/name change. Targeted Node 24.20.0 run: **119 PASS, 0 FAIL**
  across Persistent Copy, Safe Create, session IPC and read-only open tests.
  Covers nonempty ordinary folders, Unicode names, BOM/CRLF/no-final-newline,
  fresh-process reread, sequential new copies, existing/raced-in target refusal,
  directory replacement, readonly/stale/unknown authorization and retained
  partial/sync/unknown outcomes. All fixtures are synthetic and retained.
- Two selected existing Electron E2Es passed using the exact candidate snapshot
  and a physical independent dependency/runtime copy (Electron 43.4.1,
  Playwright 1.63.0). Real UI/IPC/utility writer covered temporary writing and
  opened-original -> editable-copy -> new Unicode-named file in a nonempty
  ordinary folder -> new-process readonly reopen. The original and sentinel
  bytes were unchanged; bytes/SHA-256 matched the receipt; later typing did not
  update the exported file. Cancel and same-name refusal preserved writing.
- Four application processes exited code=0/signal=null; no watchdog, monitored
  main-process fault or remaining test child. Native dialog selections/consent
  were stubbed; this is not a new manual native-save-sheet PASS or native IME
  acceptance. No random reruns, Air coordination, full suite or package matrix.
- Existing esbuild flow regenerated the demo bundle; a second build from the
  worktree matched byte-for-byte. Changed-module syntax and Git whitespace checks
  passed. Version, dependencies, Model/Service/IPC/preload/source-map/controller,
  replacement policy and replacement implementation remain unchanged.

The initial bounded Codex A self-review found no new confirmed P0/P1. A subsequent,
explicitly authorized Restricted DeepSeek review read all 11 approved source
selections and the approved diff, returned five findings, then exited on its client
budget threshold. Its result is **PARTIAL**, accepted as such by the user; no retry
was made. Codex A verified two P2 usability issues. The Downloads/Public objection
was not established as a policy violation; the group-inheritance finding was a
false positive against macOS open(2); additional invisible-character restrictions
remain an optional suggestion. No new confirmed P0/P1 was established. This is
not complete safety or release sign-off.

### Two P2 follow-ups (0.29.0 candidate, not committed)

- The Save dialog now receives only the default filename `Untitled.md`, not a
  forced home-directory destination. Both the warning and native dialog message
  tell the user to select an existing supported local APFS folder directly under
  home; home itself is not a supported destination. The native panel may remember
  a location; that does not authorize it. All existing directory/name/metadata
  checks still run, and no directory is automatically created.
- The window separately displays **Last confirmed copy** (path, revision, SHA-256)
  and **Latest operation**. A later cancellation, refusal, partial creation or
  unknown result cannot erase the last verified receipt or turn it into a claim
  that the latest operation succeeded. The per-session display record is in memory
  only; it is not a file monitor, durable receipt history, or cross-refresh recovery.
  Existing refusal/unknown-state blocking remains authoritative. Not saved, dirty,
  revision, undo/redo and original-file protection are unchanged.
- RED: the new view tests exposed eight receipt-loss failures; the selected real
  Electron case failed on the forced home-directory default. GREEN: **10/10 Node
  view tests** and **2/2 targeted Pro Electron E2Es** passed. Coverage includes
  A/B/A isolation, replacing a receipt only after a validated success, cancellation,
  existing target, partial/durability/unknown/lost or mismatched responses, and
  composition/draft refusal. The two E2Es exercised real IPC/utility creation,
  original/sentinel preservation, later edits, receipt retention across switches,
  and new-process read-only reopen. Four application exits were code=0/signal=null,
  with no watchdog, monitored main-process fault or remaining test child.
- Native dialog choices/consent were stubbed. Dialog option assertions prove the
  new guidance/configuration, not manual panel presentation or native IME. The
  earlier native Chinese QA FAIL and current NOT VERIFIED status remain.
- Demo bundle was rebuilt with the existing esbuild command and independently
  reproduced byte-for-byte. No new Service, IPC, writer, File Store, policy,
  dependency or version changes were needed for these fixes. The 119-test earlier
  safety regression evidence is retained rather than rerun without cause.

The combined user-visible feature is a candidate for an explicitly limited local
WIP checkpoint, with a proposed **0.29.0 -> 0.30.0 minor** bump at commit time.
This follow-up does not stage/commit, change the version, permit overwriting,
clear coordination-required, or change any native IME / phase 1B-3 / SEC-01 gate.
