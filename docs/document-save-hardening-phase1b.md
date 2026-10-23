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
