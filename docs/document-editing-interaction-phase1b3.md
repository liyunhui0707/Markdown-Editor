# Phase 1B-3: restricted editing interaction contract

Base: `a574e4c2905d433b4c0a3fa84ade37a0e08064fa`.
Implementation and dated runtime evidence below use 0.19.0. Local WIP metadata
version: **0.20.0**, unreleased; this is not a new runtime acceptance result.
Developer-only synthetic documents; no real-file write authorization.

**Phase 1B-3 formal acceptance: FAIL.** The local WIP checkpoint preserves work
under explicit user approval despite the unresolved required ASAR Reload gate.
It does not authorize release, merge, publication or real-file writable access.

## Acceptance contract established before implementation

- Keep the existing source-map subset: nonempty single-line heading/paragraph
  text and simple bold text. Reject structure, cross-span and opaque-source
  edits explicitly. Never serialize the entire rich-text document to Markdown.
- Accept consecutive supported local transactions against the latest local
  source projection. Submit them in order with the last acknowledged revision.
  A normal acknowledgement must not replace editor content or reset selection.
- Bound pending edits. On a refusal/conflict, reconcile to main's snapshot and
  retain the unacknowledged draft visibly. An unknown IPC outcome locks editing
  until an authoritative snapshot is available; never silently guess success.
- Main owns bounded, per-session inverse/forward text history. Every replay is
  independently source-mapped and revision-checked. Rejected/no-op edits do not
  add entries or destroy redo. Do not enable a second Tiptap history authority.
- One acknowledged transaction is one history item. A supported composition
  commits once at composition end; intermediate preedit text stays local.
  Empty/cross-span/structural composition may be refused with draft retention.
- No content replacement during composition or ordinary acknowledgements.
  Switching/reloading is disabled while an edit/composition/history operation
  is unresolved. Session switch creates a new renderer controller and uses that
  document's main-owned history; late replies cannot update another document.
- Test actual ProseMirror transactions, real Electron IPC and keyboard input.
  CDP/preedit-event tests verify Chromium composition mechanics only. They do
  not establish macOS Simplified Pinyin candidate selection or native IME pass.

## TDD and verification plan

1. RED: undo/redo requests against the existing authorized IPC manager.
2. Controller tests: queued edits while a reply is pending, stale/refused and
   unknown outcomes, draft retention, noncollapsed selection, composition
   coalescing/cancellation and per-session disposal.
3. Actual PM schema/transactions: heading/paragraph/bold insertion, deletion and
   selection replacement; Chinese, emoji and UTF-16 boundaries; repeated source
   splices preserve BOM metadata, CRLF, Front Matter and unknown source.
4. Electron: actual keyboard bursts, caret movement, Backspace/Delete, selection
   replacement, undo/redo, session isolation, real stale-revision/refusal and
   Chromium composition. Compare main snapshots with rendered text/source.
5. Existing Document/Node/Tiptap checks, seven builds and demo reproducibility,
   source E2E and actual arm64 ASAR identity/execution. Native IME needs its own
   explicit manual result; never substitute injected Chinese for that result.

## Unchanged gates

No ordinary main/Vault save integration, arbitrary paths, unsafe save policy,
Finder files, new dependencies, version changes, commits or remote operations.
P2 cleanup races, TOCTOU, external writers, metadata/restart limits and SEC-01
remain open. The previous bundle whitespace exception is hash-specific and
does not authorize a new generated artifact or future commit automatically.

## Initial implementation evidence (2026-10-24; superseded by the P1 review below)

`document-edit-controller.mjs` validates actual PM ReplaceSteps against the
latest optimistic source projection, then serializes a queue of at most 64
edits. Each request uses the last main acknowledgement's revision. Normal
acknowledgements update status/source evidence only; they never call setContent
or reset the selection. Explicit reload, history replay and error recovery may
reconstruct the rendered view from the retained source; they do not serialize
the rendered document over the Markdown source.

On refusal the controller retains an in-memory recovery draft and restores an
authoritative snapshot. On transport loss it queries main before resuming; if
that fails it stays locked. It never blindly retries a possibly committed edit.
Malformed success and stale metadata replies are reconciled independently.
Queued typing, composition, reload, document switch and history requests have
explicit ordering; the renderer controller is disposed on a session switch.

Main's per-session history holds at most 64 inverse/forward range records and
before/after source hashes. Each replay verifies both hashes and repeats source
mapping before editing. Revisions always advance on a content-changing undo or
redo; dirty can become false without clearing persistence warnings. Refused and
no-op edits neither add history nor clear redo. Insertion and removed text are
limited to 4096 UTF-16 code units per operation. This is transaction history,
not natural word/sentence grouping or a general rich-text history engine.

Composition is staged locally through PM transactions. At composition end one
changed text span is reduced to a verified minimal splice, widening surrogate
boundaries where necessary. This gives one revision/history item per supported
commit and keeps the caret near the changed text on replay. Multiple spans,
empty-span/structural mutations and unsupported source are refused. A cancelled
supported composition is a no-op. Preedit is not a durable recovery journal.

Tests actually run:

| Check | Result |
| --- | --- |
| New unit / actual PM + main-model integration | 21 PASS (5 history, 16 controller) |
| All Document tests, including previous contracts | 112 PASS |
| Full Node CI and count gate | 2487 total; 2485 PASS, 2 existing SKIPPED, 0 FAIL |
| Tiptap corpus / readiness | 44 PASS; READY 0 blockers |
| Seven builds / old managed resources | PASS; 90/90 byte-identical to the base |
| Independent demo build | Byte-identical to the tested new bundle |
| Full source Electron suite | 3 PASS: old Vault, old restricted demo, new interaction |
| Repeated interaction E2E | Three source and three actual-ASAR runs PASS |
| Unsigned arm64 packaging | PASS; version and Info.plist remain 0.19.0 |
| Actual ASAR identity | 13 runtime members match the tested source |
| Original restricted demo via the new ASAR | PASS |

The interaction E2E uses actual keyboard events for bursts, Arrow/Backspace/
Delete, selection replacement and Cmd-Z/Cmd-Shift-Z. It verifies retained source,
native DOM caret offsets, main snapshots and session isolation. Real stale
revision and revoked-grant IPC requests exercise refusal, draft retention and
locked unknown outcomes. The original synthetic disk files remain unchanged.

Chromium CDP composition tests observed compositionstart/update/end, two
consecutive committed Chinese strings with English between them, cancellation,
one main revision per commit, one-step composition undo/redo and no duplicate
source. **These are not real macOS Pinyin candidate-window tests.** No native
macOS IME pass or full natural writing UX is claimed.

All six repeated interaction processes completed all assertions, invalidated
both old IDs, and exited with code=0, signal=null, watchdog=false, no observed
main exception/error dialog and no observed remaining test processes. Actual
ASAR code ran under the existing matching Electron 43.4.1 runtime with
app.isPackaged=false / process.defaultApp=true. This is not Finder installation,
signing/notarization or production startup acceptance, nor proof of all timings.

The initial history tests failed before adding undo/redo. Further RED/GREEN
cases caught incorrect acknowledgement recovery, stale state rollback, reload
input races and too-wide composition replay selection. The first keyboard E2E
needed explicit focus on its own QA window. A later real keyboard run caught a
redo race caused by Tiptap's deferred focus command after undo; synchronously
focusing the PM view fixed it. Failed runs remain in private evidence.

## Native macOS Simplified Pinyin: NOT RUN / manual gate

Use only this branch's `lib/document-demo-main.js` explicit entry with the
approved matching Electron runtime. It creates two fresh synthetic documents
and a private profile; never launch ordinary main.js or select a personal file.
Record the worktree, base commit, candidate fingerprints, version 0.19.0,
Tiptap surface, macOS/Electron versions and the actual input method used.

1. Connect synthetic documents and select B. In the rendered paragraph, put the
   caret after `Original `. Select the already-installed **简体拼音** input method.
2. Physically type `ceshi`; observe the real candidate window/marked preedit.
   While composing, the main-source panel and revision must remain unchanged.
3. Select `测试` with Space. Verify exactly one committed insertion/revision,
   no Latin preedit residue, no duplicate text and a caret immediately after it.
4. Repeat a separate phrase with Enter candidate commit. Confirm it becomes
   Chinese text, not literal pinyin or an unintended new paragraph. Record Space
   and Enter results separately; typing/pasting Chinese directly is insufficient.
5. Continue with another Chinese phrase, mix English and Chinese, choose a
   nondefault candidate, then cancel a further composition with Escape. A
   cancelled composition must not alter main source/revision.
6. Cmd-Z must undo one completed composition; Cmd-Shift-Z must restore it once
   with a useful caret. Continue typing immediately after redo. Repeat in the
   heading and inside bold text without crossing its boundaries.
7. Switch A/B, edit each, undo/redo and confirm histories do not mix. Backspace,
   Delete, selection replacement and movement between supported leaves must not
   remove unrelated source. Structural/opaque edits must be visibly refused.
8. Confirm BOM/CRLF, Front Matter, relative image path and unknown source in A
   remain unchanged outside edited ranges. Request save must stay refused.

Keep a result per step plus native candidate-window evidence; leave uncertain
results unverified. Quitting loses in-memory edits by design: no save/reopen
persistence pass is possible in this deliberately write-denied harness.

## Remaining product gaps and next priorities

The initial bounded, short-document interaction subset was sent for independent
review. Review E subsequently reproduced the three P1 defects below, so those
initial passes did not establish commit readiness. Native
IME/manual caret acceptance, typing/history under all platform timings and
long-document latency/backpressure remain unverified. The 65th outstanding
edit is explicitly refused; arbitrary-rate input is not guaranteed. Drafts and
history are memory-only and cleared on process loss. Oldest history items are
discarded after 64, and English typing is not grouped into word-level undo.

Enter/new paragraphs, empty leaves, formatting toggles, multi-span/structural
edits, lists/tables/link editing, rich paste/drop and general Markdown typing
shortcuts remain unsupported. The biggest everyday-writing gap is the inability
to create/delete paragraph structure, followed by native IME acceptance.

Next, finish the exact native IME/manual sequence, then design a small TDD
experiment for empty text and paragraph boundaries with source-range proof.
Word-level history grouping, selection semantics and long-document responsiveness
should follow without enabling real files. Storage safety and SEC-01 gates stay
separate. A future authorized new-stage commit would normally propose 0.20.0;
no version change or Git commit is part of this round.

## Review E: three P1 fixes (2026-10-24, uncommitted)

The scope is limited to unresolved draft retention, reversible bold-boundary
edits and active-session identity on failed/asynchronous switches. The original
candidate and its evidence remain historical. No new Markdown syntax, structural
editing, native IME acceptance or real-file writes are authorized.

### P1-1: recovery records, not an overwriteable slot

The controller now retains ordered, session-scoped records with an ID, complete
local source, confirmed source/base revision at failure and reason. A queried
main snapshot can mark a newly captured record as matching that snapshot; this
does not apply its content to Markdown. Confirmed source remains separate.
Identical draft text can reuse an existing record without overwriting it.

Records survive the Reload memory action and A/B/A controller replacement through the renderer's
session-scoped record store. The recovery panel shows all retained records in
order. Only the explicit "Discard selected recovery record" action removes one;
it sends no IPC mutation and changes no source, revision, dirty or history.
Automatic restore/reapply/merge is not implemented. A user can inspect/copy the
retained text; no recovery content is silently treated as confirmed Markdown.

After 16 retained records, further editing/history is blocked rather than
evicting old input. Explicit discard can release capacity, but does not clear a
separate unknown-sync lock. Records and this store remain memory-only: process
exit, renderer loss or crash can lose them. There is no persistent recovery.

### P1-2: inverse operations retain their verified leaf identity

An accepted map now records its block/child identity and bold status. Only
trusted main-owned history passes that identity back to the mapper on replay.
At a shared plain/bold caret boundary, this selects the original leaf instead
of guessing from a collapsed range. Current source and target source hashes,
revision checks, UTF-16 boundaries and full projection equivalence still apply.

Ordinary edit mapping continues to reject ambiguous boundary insertion. IPC
does not accept a renderer-supplied leaf/anchor. Failed undo/redo does not pop
or move history entries. Tests cover first/last Chinese and emoji deletion,
adjacent plain-text edges, invalid UTF-16, stale revision, wrong source hashes
and corrupted inverse results without altering neighboring Markdown markers.

### P1-3: a switch is not active until its latest snapshot succeeds

During a switch the active selector remains aligned with the displayed document
and editing is disabled. Each snapshot intent has a generation; older success
or failure replies cannot install a stale session or clear the latest state.
A failed switch leaves the original controller intact, restores its selector
and retains a separate navigation error across ordinary renders. Status shows
active/pending session IDs and the editing outcome separately. Dirty/revision
and main history remain owned by the original session until successful switch.

Electron regressions close real B, throw a snapshot transport error and delay
real registered IPC replies in both orders. The test-only wrapper still calls
the original manager with the genuine sender/frame; it never fabricates success
snapshots. Continued typing after failure is verified against actual A/B main
snapshots, selector values and persistent error text.

### RED/GREEN and final verification

Before production fixes, focused Node tests recorded 31 PASS / 9 FAIL and all
four P1 Electron cases failed. After fixes and additional capacity/plain-edge
checks, the same three Node files pass 43 tests. One intermediate green E2E run
needed the normal action of opening the collapsed recovery panel before using
its discard controls; the test was corrected without relaxing data assertions.

Final isolated results: Document 124 PASS; full Node 2499 total / 2497 PASS /
2 existing SKIPPED / 0 FAIL; Tiptap 44 PASS and readiness 0 blockers; seven builds,
90 unchanged baseline resources and independently matching demo bundle PASS.
The full source Electron suite passes 7 tests. Four P1 cases ran three times in
source and three times against the new actual ASAR, all passing with code=0,
signal=null, watchdog=false and no observed main error or remaining test process.
The existing interaction and original restricted-demo ASAR checks also pass.

The unsigned arm64 package remains 0.19.0; 13 runtime members match tested source.
ASAR execution still uses app.isPackaged=false and is not Finder installation
acceptance. No prior hash-specific bundle whitespace exception is carried over.

All installation/build/E2E work used a fresh real dependency directory and a
copied Electron 43.4.1 runtime inside this round's isolation directory, with no
writable symlink back to a worktree. Electron's automatic download was disabled
and the executable was explicit. The pre-existing ignored Electron dist/path.txt
in the original Phase 1B-3 worktree was inventoried, not removed or overwritten.

These results permit independent re-review of the P1 patch only. Real macOS
Simplified Pinyin, complete daily Markdown writing, real-file writable access,
existing cleanup/TOCTOU/metadata/restart gates and SEC-01 remain unaccepted.

## Remaining P1-3 lifecycle boundary (2026-10-25)

The preceding verification is historical. Independent re-review found that an
intent generation alone cannot validate a session's lifetime: a real successful
B snapshot held in transit could activate B after successful close IPC. This
follow-up changes only lifecycle handling and its direct regressions; the
reviewed recovery controller and history/source-map replay are unchanged.

Main now removes the capability before sending `document-demo:invalidated` to
its captured owning webContents on successful close or revoke. Failed close
does not invalidate. Cleanup never rereads a destroyed window's webContents;
undeliverable notifications cannot restore revoked authorization. Sender,
window, main-frame, URL, exact payload and revision checks remain unchanged.

The sandboxed preload keeps monotonic per-page tombstones, replays them to a
new lifecycle subscriber and discards late invoke results for invalid IDs. A
successful real close acknowledgement also records the tombstone **before**
its promise resolves to the renderer. Consequently notification delivery and
invoke-reply delivery need not have a particular relative order once either
authoritative invalidation has arrived. IDs are never reused; no renderer
operation can mark one valid again. This is not an additional asynchronous
snapshot check or a claim of atomic coordination with all future main events.

The renderer records invalid IDs independently of switch-intent epochs. Pending
target invalidation cancels activation and retains the previous controller,
selector, drafts and history with a sticky switch error. If the active document
is also invalid, its displayed contents remain recoverable in memory but all
editing, history and refresh/save paths stay locked; ordinary controller renders
cannot unlock it. A later explicit valid switch may replace this view. Main
authority still decides every request; renderer locks do not grant capabilities.

Two new real Electron regressions first failed against the old implementation:
they hold a genuine successful main snapshot, close through real IPC, then
release it. They cover preserving A's recovery/history and continued typing,
normal A/B/A, delaying invalidation notices past close acknowledgements, and
both A/B invalidation with read-only fallback. Existing P1 tests additionally
assert read-only state after actual main-owned revoke. Preload ordering units
supplement these real IPC tests, including failed close and notification-only
invalidation. Final execution results are recorded in this round's private
verification report; synthetic composition is not native macOS IME acceptance.

This follow-up's executed results: Document 128 PASS; full Node 2503 total /
2501 PASS / 2 existing SKIPPED / 0 FAIL; Tiptap 44 PASS, readiness 0 blockers;
seven builds, 90 unchanged baseline resources and independent demo rebuild
PASS. The final complete source E2E run passes 9 tests. Six P1 cases pass three
source rounds and three actual-ASAR rounds (36 observed child exits, all code=0,
signal=null, watchdog=false, no observed main fault or remaining owned process).
Original demo and interaction ASAR tests also pass. The unsigned arm64 package
and both Info.plist version fields remain 0.19.0; 13 runtime members match source.
ASAR loading uses app.isPackaged=false, not Finder installation acceptance.

Intermediate failures remain evidence: the old interaction E2E expected typing
after revoke and `sync-unknown`; its directly affected assertions now require
immediate `session-invalidated` lock and unchanged source/recovery instead.
Separately, one full run timed out on the original demo's disabled Reload button.
A diagnostic run and the final full run passed without changing that demo test;
the timeout's cause remains unconfirmed, and subsequent passes do not resolve it.
It must be disclosed to independent review, not counted as clean sign-off of
all interaction timing or local-commit readiness. An evidence-driver filename
collision also stopped one attempt; fresh log names preserved previous results.

Deferred P2: the recovery-limit lock after 16 records still needs a clearer
explanation. Recovery remains memory-only. Native Simplified Pinyin, Enter,
empty/complex blocks, word-level undo grouping, long-document performance,
real-file write coordination, temporary cleanup races, TOCTOU, metadata,
cross-restart recovery and SEC-01 remain outside this repair and unaccepted.

## Close-in-flight P1 follow-up (2026-10-25)

Independent review found a further gap in the preceding repair: main may have
closed B while both the successful close acknowledgement and invalidation
notice are delayed. Waiting for either message leaves an activation window.
The preload now records `close-pending` synchronously **before** invoking close
IPC. A lifecycle subscription immediately protects the displayed active or
pending target. Incoming replies for blocked IDs and new operations on them
are fenced; ordinary snapshots cannot reopen the ID. No main authorization,
revision/hash, source-map, recovery-controller or history implementation changes
are involved in this follow-up.

| Preload state | Activation and operations | Next state |
|---|---|---|
| Open (no record) | Still require actual main authorization | Close request first records pending |
| `close-pending` | No activation, edits, history, save, check or snapshot publication for that ID | Strict successful close / main notice → invalidated; refusal, malformed reply or transport error → unknown |
| `close-outcome-unknown` | Remains locked; refusal snapshots are not exposed as proof to unlock | Main invalidation notice → invalidated |
| `invalidated` | Permanently denied for this page and opaque ID | Never downgraded by later replies |

A legitimate refusal establishes what main observed when processing that
request, not a durable lease against subsequent closes. This restricted demo
therefore deliberately does **not** implement automatic reopening of a refused
or uncertain ID. Resuming would require a newly provisioned, main-owned session
and an explicit recovery/adoption contract, outside this repair. Current text
and recovery records remain in memory; they are not durable across process
exit. Starting a fresh synthetic demo is not a claim of persisted recovery.
Other session IDs remain independently usable, with normal switching and main
revision validation. The renderer keeps a failed target identity so later
pending/unknown/invalid transitions update the same sticky switch error without
changing the trusted active document.

Page reload creates a fresh preload, but **does not** create fresh authority:
the existing main `did-start-loading` revoke removes all old capabilities, no
new grant/ready event is issued, and old invoke replies belong to the destroyed
renderer context. A real reload regression holds both replies through reload,
then releases them and verifies main rejects the old IDs and the page has no
editable document. This relies on that existing main lifecycle contract, not
on carrying a renderer Map across reload.

Four new cases in the existing Electron suite cover the exact two-message
delay, real dirty-document close refusal, real close followed by a response
exception, and page reload while replies are pending. Actual manager results
and post-close snapshots are checked before delaying transport; successful
responses are not fabricated. Keyboard tests confirm blocked B cannot receive
input and A stays independently editable. Unit tests additionally cover
malformed responses, duplicate requests, replay to late subscribers and
invalidation-before-failure ordering.

The existing original demo E2E now retains bounded, source-free IPC and UI
diagnostics **only on failure**, including reload disabled, pending, composing,
locked, history/loading flags and focus. No timeouts, sleeps or original
functional assertions were relaxed. The earlier unexplained Reload timeout
remains a P2 diagnostic gap until reproduced with evidence; diagnostics alone
do not resolve it. The P1 regression file exceeds the usual 300-line guideline
because these cases reuse its existing launch/exit and transport gate helpers;
it is kept together to avoid introducing another test framework or duplicate
process-lifecycle harness.

Executed results and intermediate harness corrections for this follow-up are
recorded separately in private local evidence. All prior real-file, native IME,
complex-structure, recovery-capacity, filesystem and SEC-01 gates remain in force.

Final follow-up results: Document 134 PASS; full Node 2509 total / 2507 PASS /
2 existing SKIPPED; Tiptap 44 PASS, readiness 0 blockers; final complete source
E2E 13 PASS. Ten P1 cases pass two source and two actual-ASAR rounds, including
the four new close-in-flight cases. Seven builds, 90 baseline generated files,
independent demo rebuild, arm64 packaging and 13 ASAR runtime members match.

The final original-demo ASAR run **did reproduce** the Reload P2 after earlier
passes. Failure-only diagnostics show `composing=true`, `editingCode` equal to
`unsafe-composition`, pending=0, loading=false, historyPending=false,
locked=false and lifecycle=open; recent IPC requests had settled. Thus the
immediate disabled condition is observed, but the missing composition completion
and its initiating sequence remain unconfirmed. No native IME defect is inferred
from this synthetic test. No composition fix, timeout extension or assertion
removal was made. Full ASAR E2E is not all green; independent review must retain
this P2 alongside the passing close-in-flight P1 evidence.

## Limited local WIP closure (2026-10-26)

The user approved a local recovery/development checkpoint, not stage acceptance.
The 0.19.0 historical results above retain their dates and scope. Changing the
project metadata to 0.20.0 does not convert an older package/test result into a
0.20.0 package acceptance or a current product pass.

| Category | Current evidence and limitation |
|---|---|
| Implemented restricted code | Supported continuous text edits, ordered revision-checked submission, retained drafts, main-owned Undo/Redo and session/close-pending protection exist in the synthetic developer demo. This is not complete daily writing. |
| Focused independent review | The three original P1 findings and close-pending fix passed their corresponding focused reviews; this does not close every product gate. |
| Historical test passes | The recorded Node, Tiptap, source E2E, P1 ASAR, build and package results apply to their stated candidates. They do not erase later failure. |
| Required ASAR Reload E2E | Historical timeout remains **FAIL / root cause unlocated**. Later passing runs do not prove it resolved. |
| Finite state-machine experiments | Eleven deterministic probes and twenty existing controller tests passed in the final bounded analysis. These characterize behavior, not product acceptance. No product fix resulted. |
| Missing composition end | Supported preedit followed by an unsafe transaction and an intentionally omitted `compositionend` can indefinitely retain `composing=true`, pending=0 and locked=false, blocking Reload. This constructed path is not proven to be the historical failure's cause. |
| Input and recovery boundary | A genuine matching end can retain accepted preedit in a recovery record and leave composing. Without end, accepted preedit remains local; there is no safe UI self-service recovery command. Memory recovery is not persistent across exit. |
| Known diagnostic defect | An invalid composition rejecting later input can report `edit-queue-full` even when pending=0. This is confirmed, unfixed, and not established as the Reload cause. |
| Native and product acceptance | Real macOS Simplified Pinyin, Enter, empty paragraphs, complex structure editing, word-level history and complete daily writing remain unaccepted. |
| File and security gates | Real Markdown file writes remain prohibited by default. Cleanup races, TOCTOU, external concurrency, metadata/restart recovery limits and SEC-01 remain unresolved. |

The latest bounded E2E diagnostics add opt-in, source-free event/transaction
tracing with `DOCUMENT_INPUT_DIAGNOSTICS=1`; diagnostic mode can export passing
traces for comparison as well as failure traces. Four finite source/ASAR
standalone/after-composition comparisons passed without reproducing the old
failure. That is neither a root-cause conclusion nor a fix. The private
deterministic probes are analysis evidence, not additional committed tests.

No composition state is forcibly cleared, Reload protection is not weakened,
and no further open-ended Reload investigation is part of this checkpoint.
The only user-approved WIP exception here concerns the identified unresolved
Reload acceptance gap; any other new unexpected failure must stop the commit.
Version, lockfile, documentation, candidate fingerprints and Git integrity
checks for this checkpoint are recorded separately. Prior security-audit
failures are not relabelled as passing.


## Phase 1B-3R: bounded composition-copy protection (2026-10-26)

This follow-up implements **layer 1 only** in the synthetic developer demo.
It does not resolve the historical ASAR Reload timeout or change the WIP's
formal acceptance: **Phase 1B-3 remains FAIL**. Implementation evidence below
was recorded at 0.20.0; the later local WIP checkpoint uses 0.21.0.

### Data and interaction contract

An invalid composition exposes a conditional warning and a “View / keep input
copies” panel. The controller retains an ordered, session-scoped record with
its complete local Markdown, the confirmed Markdown/revision at capture, and
DOM plain text when obtainable. DOM evidence is always marked potentially
incomplete, is not lossless Markdown, and may omit native preedit/candidate
text outside DOM/controller. Even when local Markdown equals confirmed source,
a DOM-only or unavailable-DOM capture can create a record. All copies remain
in process memory only; exit, page refresh or crash may lose them.

Viewing, copying and cancelling send no edit/save/snapshot/history IPC and do
not reset source, end composition or advance main revision, dirty, save state
or history. Normal genuine composition completion still follows the existing
path; interacting with a panel can naturally change focus, so this is not a
promise to freeze an operating-system candidate window. Pointer capture occurs
before the entry button's default focus change. Cancelling hides the panel
without deleting records or forcing an unlock. Repeated identical captures
reuse a record; different evidence does not overwrite old copies. At 16 records,
new captures fail explicitly without eviction or truncation, and the existing
capacity lock remains. Per-copy text limits are 131072 UTF-16 code units; an
oversized capture is refused with a visible error, never silently shortened.

Copy actions use the retained string, not a reserialization or rendered HTML.
Clipboard failures leave selectable, read-only text and report failure. The
read-only view uses textContent because textarea.value normalizes CRLF to LF;
CRLF remains exact in the retained and programmatically copied Markdown.
Clipboard completion from a cancelled/replaced view cannot update its status.
User text is not inserted as HTML or exported into diagnostics.

`composition-invalid` now identifies an already-invalid composition refusing
further edits; `edit-queue-full` is reserved for an actual 64-item queue. Other
lock/capacity/history/disposal reasons remain distinct. This diagnostic fix is
not a root-cause claim or a fix for historical Reload failure.

### Layer 2 remains unavailable

There is no “return to confirmed content” action, no synthetic composition-end,
no forced composing=false and no new editor context. The current DOM event/IPC
protocol cannot establish safe native IME context retirement. Controlled DOM
and Chromium composition tests cannot supply native macOS Pinyin evidence.
Without that proof, creating a replacement editable context would not satisfy
the recovery contract. The panel explicitly explains that unlock is unavailable.
Normal no-end safety blocking and session/close-pending authorization remain.

A future layer 2 must separately prove context retirement, fence all old events
and replies, drain known in-flight work, reject unknown outcomes/blocked sessions,
and verify a fresh main-owned session/revision/source baseline before activation.
It must preserve copies and main history without editing or saving Markdown.
Nothing in this follow-up authorizes that implementation or real-file writes.

### Executed focused evidence

- RED: existing controller file 20 PASS / 6 new FAIL; both new Electron cases
  fail against the old product. No original test assertions were relaxed.
- GREEN: controller + real ProseMirror/history + session IPC + source-map suite
  78 PASS, including 6 new controller cases. Normal composition, queue capacity,
  prior draft protection, metadata and boundary/history checks remain covered.
- Source Electron: 13 PASS: existing interaction test, 10 existing P1/lifecycle
  cases and 2 new copy/cancel/capacity cases. Main snapshots before/after are
  equal, including source, revision, dirty, save state and history flags; fixture
  files are unchanged. Existing interaction tests also exercise actual Undo/Redo.
- The new UI clipboard success/refusal boundary is deterministic and substituted
  inside the isolated renderer. It verifies exact strings and failure feedback;
  it does not read or replace the user's OS clipboard and is not native clipboard
  or macOS input-method acceptance.
- Demo bundle rebuilt with the existing esbuild invocation; an independent output
  is byte-identical. No other managed renderer/vendor output was regenerated.
- An unsigned arm64 directory package uses the copied Electron 43.4.1 runtime,
  skips dependency rebuild, retains version 0.20.0 and matches 13 Document runtime
  members byte-for-byte. Two focused actual-ASAR copy tests PASS. ASAR loading
  uses app.isPackaged=false and is not Finder/install/release acceptance.
- All 15 final source/ASAR test children exit code=0, signal=null, watchdog=false,
  no observed main exception/error box and no remaining owned processes.

All dependency and runtime directories are real isolated copies; internal links
resolve within that copy. Node is the project's mise-selected 24.20.0 executable.
The copied config's mise trust-state write was unavailable, so verification uses
that exact resolved executable without changing global trust configuration.
No installation, dependency/version change, new test framework or real document
access is involved. Only focused tests/build/package checks were run; this is
not a new full Node/readiness/security audit or an all-ASAR-suite pass.

Layer 1 **PASS within this synthetic scope**; safe recovery editing **not
implemented**. Real Simplified Pinyin, native clipboard behavior, complete daily
writing, restart-persistent recovery, the historical Reload failure, real-file
writes, cleanup/TOCTOU/metadata/concurrency gates and SEC-01 remain unaccepted.
The existing E2E file is kept together despite exceeding 300 lines to reuse its
actual-IPC and parent-process exit helpers rather than adding test infrastructure.


## Restricted local WIP checkpoint and next direction (2026-10-26)

Independent review E accepted layer-1 copy protection within its tested scope
and the diagnostic-code correction, with no new P0/P1 reported. It confirmed
an **unfixed P2**: during active composition, focus changes and page scrolling
can cause the first copy-button click to miss. This checkpoint preserves that
limitation; it does not repair the click behavior or open layer-2 recovery.

Version 0.21.0 is an **unreleased local WIP**, not stage acceptance or release
approval. Copies remain memory-only and native IME temporary text may be
incomplete. Safe recovery editing is unavailable. The historical ASAR Reload
failure is unexplained, **Phase 1B-3 formal acceptance remains FAIL**, and real
Markdown file writes remain prohibited. Earlier 0.20.0 source/ASAR/package
results retain their original build identity; metadata changes do not turn
those results into 0.21.0 package or Finder-install acceptance.

The next development direction prioritizes usable product capabilities while
preserving data-safety gates. Basic writing and independent-file workflows take
priority over new infrastructure. Run E2E according to the actual change risk.
Reuse development session A and review session E by default; avoid new sessions,
worktrees or complex management processes unless necessary. The next proposed
minimal product task is Enter and empty-paragraph editing with source fidelity
and Undo/Redo; it requires separate implementation approval. This commit does
not start that work, another audit, native IME recovery or real-file writes.


## Basic writing V1: Enter and one empty input slot (2026-10-26)

This limited, uncommitted implementation starts from f19efa5 at version 0.21.0.
It enables ordinary top-level **single-line, unformatted paragraphs** to split
at a collapsed caret using ProseMirror's existing splitBlock transaction. The
same revision queue and main-owned history apply a verified source splice;
Backspace uses joinBackward at an adjacent supported paragraph boundary.
No new document state machine, session capability, serializer or dependency is
introduced. Heading/marked paragraph/list/quote/code structure editing remains
refused, while their existing supported text edits are unchanged.

### Markdown representation and limits

Two populated paragraphs are separated by two existing-style newline tokens
(LF or CRLF; new delimiters use the document's first newline style). Source
outside the exact splice remains unchanged, including front matter, unsupported
blocks, relative paths and all other line endings. The document model preserves
BOM separately; synthetic disk fixtures remain byte-identical because no save
is enabled. Plain paragraph margin spaces are retained in text spans so a
mid-word-boundary split does not silently trim either half.

CommonMark does not encode independent empty paragraph nodes. The restricted
projection therefore exposes **at most one whitespace cursor slot per gap**:
leading/trailing runs of at least two newline tokens, or an internal run of at
least four, can provide one empty paragraph input position. Its empty source
range is anchored inside the existing whitespace. Typing fills that range;
remark then sees an ordinary populated paragraph. The slot is an editing
projection of whitespace, not a CommonMark semantic node or a private file
format. No nonbreaking-space, HTML, JSON or invisible placeholder is inserted.
Reopening through this projection follows the same rule; other Markdown tools
can ignore those blank lines and need not show the same empty visual paragraph.

A second consecutive Enter in an empty slot is refused. Multiple independent
empty paragraphs are **not** supported or claimed to persist losslessly. Blank-
only documents containing multiple newline tokens remain non-editable; an empty
file or a single terminator can accept text. Multiline source paragraphs and
cross-block selections remain outside V1. Mixed/noncanonical separators are
refused whenever the inverse cannot restore their exact bytes. This deliberate
boundary avoids adding a parallel transient-layout/history protocol.

Every split/join must match the complete before/after projected document and
prove that its inverse restores the exact original source before acceptance.
Main stores the mapped inverse for CRLF-safe history and still checks revision,
authority, source hashes, source ranges and history identity. Failed inverse
mapping cannot advance or consume history. Queue acknowledgements do not reset
forward-edit caret positions.

### Actual UI input and evidence

The first actual Electron writing case failed: during active Chromium IME,
Enter generated beforeinput insertParagraph with isComposing=false. The browser
then produced a structural transaction, invalidating composition under the
existing guard. Captured events/transactions establish this specific sequence;
it is not an attribution of the historical Reload failure.

The demo's existing beforeinput handler now suppresses only insertParagraph's
structural default while event/view/controller indicates composition. It does
not intercept the candidate key, force compositionend, clear composing, unlock
or drop preedit. The permanent regression confirms that commit still works.
An older copy-protection helper now explicitly invokes the same refused real PM
split command rather than relying on that unintended candidate-Enter default;
its draft and main-state assertions remain intact. The old generic unsupported-
Enter check now targets a heading, since plain paragraphs are intentionally new.

- RED: original controller 26 PASS / 6 new FAIL before implementation.
- Final focused Node/real PM/source-map/main-IPC/history: **88 PASS**, including
  LF/CRLF, BOM/disk preservation, empty input, middle split/margin spaces,
  Backspace, Undo/Redo, queued input/caret, Unicode boundaries, composition,
  session isolation and unsupported edits. Actual remark parsing verifies that
  the whitespace slot does not invent a semantic Markdown empty paragraph.
- Final source Electron: **14 PASS**, including one new real keyboard chain
  that writes two paragraphs, composes Chinese in the empty slot, exercises
  candidate Enter, English/emoji/caret, splits and joins, undoes/redoes, rejects
  repeated empty Enter and heading structure, switches A/B and verifies save
  refusal plus unchanged synthetic files. All 14 observed children exit code=0,
  signal=null, watchdog=false, no observed main fault or remaining owned process.
- Demo bundle built with the existing esbuild invocation and independently
  rebuilt byte-identically. No package/ASAR, full Node suite, security audit or
  historical Reload E2E rerun was required for this bounded feature verification.

Native macOS Simplified Pinyin remains **not manually accepted**; CDP composition
is not native IME evidence. Existing copy-click P2, memory-only recovery, safe
IME retirement, file-save coordination/metadata/concurrency and SEC-01 remain.
Real user file writes stay denied; Phase 1B-3 formal acceptance remains **FAIL**.
This is ready for a limited functional review, not commit or release approval.


### V1 P1 follow-up: CRLF join with no final newline (2026-10-26)

Independent review E correctly rejected the V1 candidate: exact source
`first\r\n\r\nsecond` failed real PM joinBackward and keyboard Backspace.
The join removed every newline; inverse preflight then inferred LF from the
joined text and could not restore CRLF. This was a product defect, not an
unresolved cursor-timing hypothesis.

The minimal repair captures the actual separator from the pre-operation source
and carries it in the existing mapped structural result and main-owned history
entry. Inverse preflight and actual Undo/Redo receive the same trusted value;
they do not guess the deleted separator from a newline-free result. Only known
newline pairs are accepted, and renderer IPC cannot supply this internal field.
Projection equality, exact source hashes, source ranges, revisions, queue and
session authorization remain enforced. A corrupted internal separator still
fails history verification without consuming the stack. No CRLF-to-LF rewrite
or terminal-newline insertion occurs. No new structural history system or
controller runtime change is needed.

RED: the exact real-PM case fails; source Electron observes two paragraphs
remaining after CRLF Backspace, while the LF control passes. Final focused
source-map/controller/history/IPC tests are **93 PASS**, including the existing
88 plus five new cases and explicit metadata-injection rejection. Three source
Electron cases PASS: CRLF/LF Backspace with exact Undo/Redo and final caret,
and the existing Enter/empty-input/middle-split/composition/history chain. All
three children exit code=0, signal=null, watchdog=false, no observed main fault
or remaining owned process. Synthetic fixtures retain their original bytes.

The two fixture-specific source E2Es reuse the existing harness. A private
launcher compiles the unchanged real main implementation with only the b.md
literal fixture replaced before provisioning; it does not fabricate IPC replies
or modify the normal main file. These fixture tests are source-only evidence,
not ASAR/install acceptance. Demo bundle is rebuilt through the existing esbuild
flow and independently byte-identical. No unrelated full Node, package or ASAR
runs were performed. Version remains 0.21.0, with no Git staging or commit.

The review's single delayed-IPC caret-offset discrepancy remains unconfirmed
and recorded only; no separate investigation was started. Historical Reload,
first-copy P2, native IME recovery, all real-file write gates and Phase 1B-3
formal FAIL remain unchanged. This repair is suitable for targeted re-review,
not broader product or release sign-off.


## Document-First Open V1 read-only (2026-10-26)

Development scope at 0.22.0: `mise exec -- npm run dev -- --document-readonly`
from `apps/desktop` enters a single-document viewer through the existing main
entry, before Vault/AI initialization. The default launch is unchanged. This
mode reuses the restricted Document main/preload/Tiptap surface, with no Vault,
synthetic-editing controls, save action or Source/Write/Preview switch. Open
Markdown… and the File menu/Cmd+O select a file through the macOS native dialog.
A successful open replaces the visible document and closes the old read-only
session. File name, directory and read-only status are visible. Cancel/read/
validation failure retains the current document with a specific message.

### Capability and rendering boundary

- The main process owns the chooser. IPC `open-file` accepts no renderer path,
  policy or filesystem capability. The existing exact sender, window, main
  frame, URL and opaque session checks apply before the dialog and again after
  it resolves. Only one dialog is in flight per binding. Revocation/navigation
  prevents late selection from being read. The window regains focus when the
  native sheet returns.
- Native-selected sessions are marked read-only in main. Edit, Undo, Redo, Save
  and disk recheck are rejected before the service executes them. Tiptap is
  non-editable and rejects changing transactions as a second layer. Closing a
  session does not save. No selected file is rewritten or reconstructed.
- Reuse the File Store's canonical path, non-symlink, regular/single-link file,
  no-follow descriptor and identity checks. A bounded read accepts at most
  524,288 bytes, with a further existing 131,072 UTF-16 source limit. UTF-8 only;
  unsupported encoding, file identity changes or size/type failures are refused.
  Reserved session-library paths and protected secrets/config paths remain
  excluded. The optional bound does not change existing unbounded service calls
  or any save policy.
- Use the existing restricted `projectSource` JSON projection, not the legacy
  HTML/Toast UI/Mermaid bridge. Headings, paragraphs and bold are formatted;
  unsupported constructs (including HTML, images, links, lists, tables, math,
  front matter and unknown syntax) fall back to literal code-block text. No
  raw HTML is inserted or relative/remote resources loaded. CSP, network,
  new-window and navigation restrictions remain. This is a safe limited view,
  not full Markdown rendering or a SEC-01 remediation.

### Bounded verification

- New main-boundary tests: RED 2 PASS / 5 FAIL before implementation; final
  7 PASS. Actual service/store/session code covers two directories, byte
  preservation, write denial, cancel/missing/permission/encoding failures,
  hostile literal markup, read limits, sender/frame/URL isolation and late
  dialog results after revoke/navigation. Permission failure is injected at
  the file-open boundary, without operating on user documents.
- Relevant Document/source-map/controller/history tests: **162 PASS**. Focused
  legacy Vault/save/image tests: **33 PASS**. No unrelated full test suite was required.
- Existing source Electron harness: **4 PASS** (new read-only integration,
  basic paragraph writing, CRLF and LF join/history). A final single read-only
  test after focus restoration also passes. Native chooser results are
  controlled in this automated case; file read, parsing, IPC, Tiptap and
  permissions are real. Parent observations show code=0, signal=null, no
  watchdog, observed main fault or remaining test process.
- Separate actual macOS native-dialog check opened synthetic ProjectA/x.md,
  then Notes/Y.md via Cmd+O, and canceled another open. File identity, directory,
  rendered heading/bold/Unicode and cancel retention were observed in the
  window. After closing it, both files' SHA-256 values match their originals;
  the viewer exited code 0. An initial native observation showed a stale body
  while the title updated; explicitly returning focus after the sheet passed
  the final bounded check. This does not establish all possible focus timings.
- Demo bundle was built and independently rebuilt byte-identically through the
  existing esbuild flow. Other managed generated assets and dependency/version
  files remain unchanged. No ASAR, Finder install/open-file integration or full
  packaging matrix was exercised for this source-only change.

The feature does not enable editing, save, multiple user-document windows,
filesystem watching or Finder association. The current document is a read-time
snapshot, not a claim about subsequent external changes. Existing true-file
write blockers, native IME, copy-click P2, historical Reload uncertainty and
Phase 1B-3 formal **FAIL** remain. Suitable for a limited independent feature
review; no commit, release or publication approval is implied.
