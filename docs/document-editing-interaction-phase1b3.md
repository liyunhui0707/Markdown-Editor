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


## Document UI/UX V1 (2026-10-28, uncommitted at 0.23.0)

Presentation-only refinement of the existing Document-First read-only entry.
The native Electron window/title bar is unchanged. A 55–58px toolbar contains
Open Markdown…, a single-line ellipsized file name and a quiet read-only label.
The full name is available on hover; a native HTML details disclosure shows the
full name/directory on demand. Successful-open status stays accessible to screen
readers without occupying reading space; cancellation/errors remain visible.
The empty window has one primary open action with the same existing open flow
and Cmd+O. Opening another document resets page scroll, not document/history.

The same Tiptap surface now has a centered 780 CSS px reading measure, responsive
side margins, 18px body type (17px below 640px), 1.85 line height, separate heading
levels and system/PingFang font fallbacks. Long words wrap; unsupported syntax
keeps its existing literal representation with quieter code-block styling. No
Markdown conversion, images, links, HTML execution, theme system or new mode is
introduced. All new styles are scoped to the document entry; synthetic editing
controls and their existing state machine are retained. HTML/entry stay below
300 lines; the existing E2E file remains below its practical test-size cap.

### Current-candidate checks

- MacBook Pro: 7 read-only-boundary Node tests PASS using pinned Node 24.20.0.
  Chromium headless layout probes cover Chinese/English at 390/640/1050/1440px,
  plus reserved-scrollbar geometry. These use a mocked document API and are
  explicitly not Electron acceptance. No foreground Electron window ran on Pro.
- Air: the exact uncommitted source, bundle and spec were transferred with
  SHA-256 checks. Existing isolated Electron 43.4.1/Playwright 1.63.0 dependencies
  were cloned into a new private temporary directory. A copy of the existing
  trusted arm64 Node 24.20.0 was used there; the Air system Node was not replaced,
  no dependencies installed and no device settings changed.
- Two selected real Electron cases PASS: the original read-only open/security
  regression and one new UI case in the existing spec. The latter exercises the
  empty-state button, Cmd+O, long Chinese/English names and on-demand paths,
  A/B/A, cancellation, responsive centering and inert unsupported HTML. There
  are seven actual Electron content screenshots: empty/CJK/English at 1050px,
  CJK at 640px, English and file details at 390px, English at 1440px. Screenshots
  show renderer content, not the native OS title-bar frame.
- The first UI run exposed a test geometry error: it used innerWidth, including
  a 15px native scrollbar, as the text's containing width. The strict one-pixel
  centering assertion now uses body.clientWidth, including a deterministic
  reserved-gutter probe. Tolerance was not relaxed and product layout did not
  change to silence the assertion. Initial failure evidence is retained.
- Both final test children exit code=0, signal=null, watchdog=false, fault=false,
  remaining=false. Four synthetic CJK/English fixtures across initial/final runs
  retain their expected SHA-256 after exit. Candidate hashes are unchanged by
  testing. Demo bundle independently rebuilds byte-identically.

Only HTML/CSS, minimal presentation bindings, the generated bundle, existing E2E
and existing documentation change. Main/preload, Document Model, File Store,
service, session authorization, source map, controller and history remain
byte-identical to the base. File edits/saves stay denied. The known SEC-01,
Phase 1B-3 formal FAIL, native IME/Reload/copy P2 and file-write gates remain.
No full Node suite, ASAR, packaging or release acceptance is implied. This UI
candidate is ready for the user's visual experience check and later review,
with no version bump, Git staging or commit.


## Document Writing Entry V1 (2026-10-28, uncommitted at 0.24.0)

Previously, direct Electron launch of `lib/document-demo-main.js` exposed the
synthetic fixture editor via **Connect synthetic documents**. The actual
`--document-readonly` product window shared its HTML, bundle, controller,
source-map and IPC but globally denied editing and had no writable session
creation action. Automated writing passes did not make that window writable.

The approved window now offers **New temporary document**, on the same Tiptap
surface. Main alone creates a private, empty synthetic seed file (0600, inside
the isolated 0700 demo directory), opens it through the existing service, and
provisions an opaque `temporary: true` capability. Only the empty seed touches
disk; writing stays in the main Document Model and renderer's existing pending
queue/recovery records. A no-argument IPC operation cannot select a file, supply
source text, promote a real session, or change save policy. Save always returns
`temporary-not-persistable`, including an unchanged empty document. Existing
real-file capabilities continue to deny edits/history/save/check in main.

The renderer enables typing only for an explicit temporary capability in this
entry. The existing paragraph/UTF-16/revision/hash/history mechanisms are reused
unchanged. Document selection retains temporary sessions and recovery records;
newly opened files remain read-only. Navigation is unavailable during pending
edits, composition or history operations. Session tombstones remain authoritative.
The existing maximum of eight active sessions applies; no silent eviction or
automatic draft discard was added. This is an in-process view of content, not
crash recovery or durable storage.

A visible **Not saved** notice explains copying, closing/refresh/crash loss, and
restricted paragraphs. A main-owned native close/Quit confirmation defaults to
Cancel whenever a temporary document has been created, even after session
revocation or while a different read-only file is visible. This intentionally
conservative warning covers renderer-only drafts that main cannot inspect.
Normal read-only-only windows still close without that warning. Existing copy
and recovery panels are accessible when relevant; native preedit may be missing.
No second editor, persistence service, history stack or Markdown mode is added.
The entry is just over 300 lines because presentation and shared lifecycle
bindings stay together; splitting the existing controller/IPC is not necessary
for this bounded integration. The E2E addition stays in the existing test file.

Verification and limits: 2 new creation/policy tests first failed against the
old IPC (RED); the 7 original read-only cases remained passing. The five related
Node/ProseMirror/IPC files then passed 102/102. Current-code Air Electron results are recorded below. There is no version/dependency change,
real-file write enablement, full packaging or Finder acceptance. SEC-01, native
IME, historical Reload uncertainty, copy-click P2, composition unlock limitations,
complex structures and Phase 1B-3 formal **FAIL** remain unchanged.


Current-candidate Air checks: 3/3 selected Electron cases PASS (Node 24.20.0,
Electron 43.4.1, Playwright 1.63.0). These cover the new actual keyboard entry,
old read-only/security flow and approved responsive UI. The new case checks
empty input, two paragraphs, Chinese/emoji via synthetic text insertion, cursor,
join/Undo/Redo, separate temporary histories, read-only IPC/keyboard rejection,
cancel retention, actual stale-revision draft retention and native close guard
cancellation. Dialog decisions are controlled; the real main lifecycle, IPC,
service and editor are used. This is not native-dialog manual QA or real IME.
All three children: code=0, signal=null, watchdog=false, fault=false, no remaining
owned test process. After exit, five read-only synthetic files are byte-identical
and two temporary seed files are empty. Current source hashes are unchanged by
execution; the transferred demo bundle independently rebuilds byte-identically.

No Electron GUI ran on Pro. Air used a fresh private temporary directory with
copied (not writable symlinked) existing dependencies/runtime, an explicit
21-file current-source manifest and SHA-256 verification. Preparation stopped
before GUI twice: native esbuild was initially invoked as JS, and an anchored
Playwright selector matched zero tests. Correcting only those temporary runner
commands passed the same build/collection gates. Post-exit checking initially
expected JSON body attachments from the list reporter; using the exact synthetic
fixture literals completed that check. No product assertion was relaxed.

The runtime changes are document-demo main/preload/entry/HTML/bundle and the
session IPC's temporary provisioning gate. Tests change only the existing
read-only unit file and P1 Electron spec; README, this contract, stage history
and manual checklist record the user entry. No parallel editor or history
state machine was introduced. Suitable for a bounded independent review, not
formal Phase 1B-3 acceptance, native IME sign-off or permission to write files.


### Local WIP checkpoint and native Quit QA (2026-10-28)

The user reports Session E's limited independent review accepted this candidate:
temporary writing, read-only authorization, document/draft/history isolation,
ordinary close and actual `app.quit()` passed, with no newly confirmed P0/P1.
That review result is distinct from the development-side Air evidence above.

Native **Cmd+Q: user-reported manual PASS**, separately from `app.quit()`:
after creating a temporary document and typing two paragraphs, Cmd+Q displayed
the unsaved-content warning; Cancel preserved the text and allowed continued
editing; a second Cmd+Q followed by confirmation exited normally. This is the
user's current-candidate QA feedback, not an automated shortcut result or a
claim that all OS shutdown/crash paths have been validated.

This local WIP checkpoint raises only project version fields to 0.25.0 under
the minor-feature rule. The runtime, tests and bundle remain the reviewed
0.24.0 candidate; this note supplements the dated evidence without recasting
old tests as a full 0.25.0 release pass. Temporary writing is still **Not saved**,
with no recovery across exit; refresh/crash can lose memory contents. Actual
Markdown files remain read-only and all real-file writing stays prohibited.
Phase 1B-3 formal **FAIL**, SEC-01, native Chinese IME acceptance, historical
Reload uncertainty, copy-click P2 and the existing storage safety limitations
remain open. This checkpoint is not release, merge or GitHub push approval.


## Existing Document Editing V1 — independent editable copies (2026-10-30)

Implemented/tested on 0.28.0; preserved as a limited local WIP at 0.29.0,
without full feature, merge or release acceptance. In the existing
Document-First window, open a UTF-8 `.md`, then choose **编辑副本 · Edit a copy**.
The original stays read-only and remains selectable. A different main-owned
session, labelled `Copy N of …`, starts at revision 0 with independent history
and recovery records and a **Not saved** badge. It copies the already-opened
snapshot, not an unsolicited reread of later external file changes.

The exact IPC allowlist adds `edit-copy` with only session ID, expected revision
and byte SHA-256. Main verifies sender/window/frame/URL, read-only source identity,
revision and the hash including BOM, then passes its own `bytesForSave()` to the
existing trusted temporary factory. Renderer paths, Markdown bodies and policy
options are rejected. Main checks the returned model is independent, clean and
byte-identical before provisioning. The existing private `wx`/0600 seed mechanism
now accepts trusted initial bytes; no original file is written. This seed may
remain in the private test directory, but subsequent edits and recovery records
are memory-only; it is not a persistent export or cross-restart recovery feature.

Preload refuses creation during composition, in-flight IPC, unknown outcomes,
or invalidation/close-pending. A malformed/lost response does not activate a
copy or permit an automatic repeat. Renderer validates source, BOM, independent
identity, revision and projection before switching; it keeps the original on
failure. Existing source-map, controller, Model, Service, writer and save policies
are unchanged. Unsupported source ranges remain refused; no whole-file serializer
is used. BOM, CRLF/LF, final-newline presence and untouched opaque syntax are
preserved by the existing byte model and verified source edits.

With the existing `--persistent` development launcher, an editable copy can use
**Create persistent test copy…**. Only the already-supported dedicated empty
local APFS home-directory test folder is accepted. Cancel, existing targets and
unverified/partial/unknown outcomes retain the source and existing failure
semantics. A successful receipt does not advance the model baseline, clear dirty
or reset history. Later edits do not update the created file. Original sessions
continue to reject edit/save/history/copy-write operations. General save remains
`coordination-required`; temporary IPC save remains `temporary-not-persistable`.

Validation evidence for this candidate is recorded separately from user manual
QA. Six new regressions first failed for the missing copy operation/preload API;
they then passed. Initial test harness corrections supplied the header's new
button-state inputs and used the existing PM structural coordinates (`\n\n`
command and two-position join); no source-map assertions or safeguards were
weakened. The first attempted test edit had a wrong relative cwd and changed no
files; its baseline run is not counted as RED. Final focused Pro Node evidence:
237 Document/ProseMirror/IPC/create/save tests PASS, then 61 IPC/open tests PASS
including one added invalid-factory/revocation regression. That extra test first
failed in fixture setup because it used the fixture-forbidden unbounded read;
using the same bounded read as the opening path fixed the test setup without
changing product code. Both LF with a final
newline and BOM/CRLF without one were copied through the actual child writer
and read byte-exactly by a fresh Node process. No Electron GUI ran on Pro.

The Air snapshot uses independent cloned dependencies/runtime, not writable
symlinks to another worktree. Initial GUI attempts timed out because the prepared
snapshot omitted the unchanged `editor-path-policy.js`; a single launch trace
identified `MODULE_NOT_FOUND` before UI assertions. Those failed artifacts are
retained; only the snapshot dependency list was corrected. This is not a product
regression or a passed GUI test. With that unchanged dependency included, the
three selected real Electron E2Es passed on Air (Node 24.20.0, Electron 43.4.1,
Playwright 1.63.0): the existing two-directory/hostile-content read-only case;
copy → real keyboard editing/Enter/Backspace/Undo/Redo → persistent writer →
quit → fresh Electron read-only reopen; and a lost real copy-IPC response while
preserving original identity and an existing recovery draft. Native dialog
selections were stubbed, not manually tested. Chinese/emoji insertText is not
native IME acceptance. All four app processes ended with code 0, signal null,
watchdog=false, fault=false and remaining=false; a final task-scoped process
check found no surviving Electron process. The tested 22-file snapshot remained
hash-identical and the independently rebuilt demo bundle was byte-identical.

Local evidence: `/private/tmp/existing-edit-v1-wuk3oqqv/evidence/`, including
`node-focused.log`, `green-ipc-corrected.log`, `electron-complete.log`,
`result-complete.json` and `existing-document-copy.png`. The corrected runtime
snapshot is identified by `candidate-complete.json` in the parent directory;
it includes the unchanged missing dependency added after the initial archive.
The first archive alone is not the complete successful test snapshot.

No new editing state machine, writer, framework or dependency was introduced.
The existing renderer entry remains over the approximate 300-line guideline;
this bounded integration stays in its established document-opening flow rather
than splitting lifecycle ownership during a permission-sensitive change.
Real native IME/manual interaction, installer/ASAR acceptance and arbitrary
Save As/overwrite remain outside this change. Historical Reload/copy P2,
SEC-01, filesystem limitations and phase 1B-3 formal FAIL remain. Independent
review and user manual QA of this new candidate are still required.

### Existing Document Editing V1 — manual-QA composition blockers (2026-10-30)

User manual QA of the first uncommitted candidate was **FAIL**: after replacing
Chinese text, further editing and switching to the original were blocked; the
copy panel reported `composition-active`. Persistent export/reopen was not
manually completed. The TSM/IMK/window warnings are not established causes.
The earlier automated PASS does not override this report.

Bounded synthetic Chromium/CDP tests on Air established two paths:

- Explicit composition completion works in plain and mixed Markdown. However,
  moving by mouse while a composition is active can leave PM `composing=false`
  while controller/preload still await `compositionend`, with pending=0. PM's
  mouse handler ends its own composition without supplying that DOM event.
  Both plain/mixed cases failed at this boundary. Skipping PM's mouse handler
  alone did not solve it. Requesting browser completion through blur on an
  intentional primary text click produced a browser-delivered end event and
  preserved the composed text. No controller/preload flag is forced clear.
- Opaque projection blocks were visually code-like but browser-editable. Starting
  composition inside one led to a rejected PM mutation, followed by noncomposing
  input without an end event; controller state remained invalid/composing. All
  such blocks are already unsupported source ranges. PM node decorations now
  mark them `contenteditable=false`, with a read-only explanation. The original
  PM document and source-range rejection rules are unchanged.

The small renderer pointer handler requests completion before normal PM mouse
selection. If composition is already invalid, it retains available local/DOM
copies first; capacity refusal prevents the request rather than evicting records.
An actual end event still drives the original grouping, revision/IPC and history
logic. A visible status explains why switching/copy creation is paused. No end
arriving is NOT treated as completion: the controller and preload stay blocked,
and available invalid-input copies are retained. Native preedit outside the DOM
cannot be guaranteed captured. This is not full exceptional-IME recovery.

Final checks: **124 targeted Node tests PASS**, including four new pointer/
readonly-decoration tests (RED before their implementations). **6 real Electron
E2Es PASS on Air**, including CDP composition commit, pointer completion,
cancellation, code-block rejection followed by continued paragraph typing,
original/copy switching, undo/redo, lost IPC response/draft preservation, persistent
export and a fresh-process read-only reopen, plus the intentionally missing-end
retention/lock case. Seven Electron processes exited code=0/signal=null with no
watchdog, fault or remaining task process. Air independently rebuilt the bundle
byte-identically and verified the exact snapshot hashes. All files were synthetic;
no GUI ran on Pro. Native dialogs were stubbed; CDP composition is **not macOS
Pinyin manual acceptance**. The mixed-case intermediate run remained FAIL until
the opaque-block guard was applied; it has not been discarded from evidence.

Evidence: `/private/tmp/existing-edit-qa-ki604lgq/` (`node-final.log`,
`pointer-red.log`, `opaque-red.log`, `electron-probe2.log`, `electron-green.log`,
`electron-green2.log`, `green2.json`, `result-green2.json`). Input traces contain
bounded event/state metadata, not document bodies. The original 13-file patch is
preserved; this repair changes only its renderer entry/HTML/generated bundle,
existing IPC-unit/E2E test files and existing documentation. Version/HEAD unchanged.

These reproduced paths are consistent with the user's symptoms, but their exact
identity with the native manual failure remains unproven until user retest. They
use the historical 1B-3 composition latch; they do not establish the cause of the
historical ASAR Reload failure. True missing-end cases, cross-leaf/unsupported
edits and native IME remain limited; no arbitrary unlock is offered. Original
files remain read-only, Persistent Copy scope/receipts and `coordination-required`
are unchanged, phase 1B-3 formal FAIL and SEC-01 remain. No new manual PASS,
checkpoint, release or full IME acceptance is recorded.


### Existing Document Editing V1 — local WIP closeout (2026-10-30)

Codex A performed a bounded self-review of the actual diff and direct session,
controller, source-map and save dependencies. This is **not an independent second
model review**. No new confirmed P0/P1 was found: source and editable-copy models,
IDs/history are distinct; main retains sender/window/frame/URL, revision/hash and
lifecycle validation; renderer/preload do not grant arbitrary paths/body/policy;
unknown copy outcomes are not automatically retried. Persistent Copy retains
exclusive new-file creation and actual byte/identity/hash checks. The original
readonly session and `coordination-required` remain enforced. No product-code or
test correction was needed during this closeout.

Evidence reused with matching runtime/bundle fingerprints: 124 targeted Node
PASS and six Air Electron E2E PASS on the 0.28.0 implementation candidate. No
unrelated suite, GUI matrix, ASAR or packaging was rerun. Their scope includes
controlled composition, supported paragraph editing/history, switching, unknown
IPC/draft retention, original-byte protection and persistent new-file reopen.
These passes do **not** establish native Chinese IME acceptance.

Pro GUI follow-up used the same verified source in a private test instance.
Native ordinary key events, undo/redo and original/copy switching passed; source
bytes/hash stayed unchanged. WeType Pinyin was selected, but the attempted keys
produced ASCII and **zero composition events**. The temporary source switch to
ABC was restored. A standalone Shift action was unsupported by the GUI tool.
The completed instance exited code=0/signal=null; the earlier paused setup hit
its watchdog and is retained separately. Thus **native macOS Chinese composition
remains NOT VERIFIED**, and the user's earlier native Chinese-input QA **FAIL
has not been cleared**. No new product defect was confirmed by that attempt;
it also did not prove the historical failure solved. The existing device/IME
automation investigation is closed rather than extended.

This is an explicitly authorized **WIP recovery checkpoint**, not a full product
acceptance PASS. AGENTS.md requires a minor bump for the user-visible feature;
0.28.0 -> 0.29.0 changes only package.json version and the lockfile's two root
project version fields. Dependencies, scripts and build policy are unchanged.
The 13 reviewed paths plus these two version files form one local checkpoint.
No GitHub sync, merge, release or tag is authorized. Application resources match
the tested candidate; the version-only/documentation changes do not reclassify
historical validation as a newly packaged 0.29.0 release pass.

Remaining limits: unsupported/complex and cross-leaf editing, missing-end input
locks and incomplete IME preedit capture; memory-only drafts/later edits without
cross-exit recovery; seed snapshots retained in the private test directory; no
arbitrary Save As or original-file overwrite. Persistent copies remain confined
to the approved dedicated local APFS test-folder scope. SEC-01, historical Reload,
copy-click/cleanup P2, TOCTOU, external writers, ACL/xattrs/special filesystem and
power-loss/restart limits remain open. Phase 1B-3 formal acceptance remains FAIL.

The next proposed product slice is a controlled **in-place save/reopen** for one
app-created synthetic file in an approved private APFS test directory. Reuse the
current Model/Service/File Store and source-range edits; main must grant a separate
file-bound write capability rather than mutate a readonly session's permission.
Require trusted disk identity/byte baseline, current revision and quiescent input,
verified replacement metadata/content and accurate uncertain durability outcomes.
A last stat/hash plus rename or the cwd-pinned create writer does not coordinate
external replacement; an accepted coordination mechanism must be demonstrated
before enabling this slice. Otherwise keep `coordination-required` and refuse.
External-change, symlink/hardlink, metadata, partial-write and unknown-result
probes precede any real-file enablement. No such implementation starts here.


## Ordinary Paragraph Compatibility V1 — bounded soft-line editing (2026-11-01)

Implemented on 0.30.0 after checkpoint `2271c8e`; uncommitted, not release or
phase 1B-3 acceptance. In the existing Document window, an ordinary top-level
paragraph spanning source lines can now render as one paragraph and be edited
through **Edit a copy**. Only plain text with an exact remark/source match is
added. Bold or other inline syntax across lines, hard breaks, normalized/indented
continuations and complex structures do not gain editing permission.

A soft LF/CRLF/CR is displayed as one space in a single existing PM text node.
Each original source line owns a distinct UTF-16 span and an offset in that node;
the separator has no editable span. A supported edit splices only one source
range and must reparse to the exact expected PM projection. No full-document
serializer, source normalization, new controller/history or new IPC is introduced.
Existing trusted history identity, before/after hashes and revision checks remain.
BOM is still owned by Document Model; untouched source bytes and terminal-newline
presence remain preserved. Mixed line-ending source ranges are covered directly.

V1 deliberately refuses selection/deletion across soft breaks, emptying a whole
source-line segment, Enter within a soft-wrapped paragraph, and merging that
paragraph with its neighbor. Existing single-line Enter/Backspace behavior remains.
A visible "Edit not applied" message explains protected source line boundaries;
subsequent valid typing clears the message. A visual wrap caused by window width
is not a source-line boundary. Unsupported blocks remain non-editable.

Evidence (synthetic data only):
- Before the mapping change, the nine new focused regressions gave 1 PASS / 8
  FAIL: missing paragraph/spans prevented the supported operations. A subsequent
  test setup correction selected the replaced character before asserting the PM
  caret, matching actual selected-text input; no caret assertion was weakened.
- Final focused Node 24.20.0: **126 PASS / 0 FAIL** across source-map, controller,
  session IPC and readonly-open tests. Covers source fidelity, UTF-16, actual PM
  transactions, queueing, controlled composition, stale revision, isolated
  history, Undo/Redo, rejection without history mutation, and original disk bytes.
- One new existing-harness Pro Electron E2E: **1 PASS**, open original -> editable
  copy -> keyboard edits of both source lines -> Undo/Redo -> rejected Backspace
  across soft break and Enter -> continued typing -> A/B switching -> actual
  utility-writer new-file creation -> fresh-process readonly reopen. BOM/CRLF,
  opaque blocks and no-final-newline are preserved; original SHA-256 is unchanged.
  Both app processes exited code=0/signal=null, watchdog=false, fault=false,
  remaining=false. Native file-dialog choices were stubbed; Chinese insertText
  and controlled composition are **not native macOS Pinyin acceptance**.
- Existing esbuild demo command plus a separate output rebuild produced identical
  bytes. No dependency or version change. The sole new Home fixture was reclaimed
  only after successful reopen and exit using the existing ownership helper.

Local logs, screenshot, synthetic inputs and candidate fingerprints are in
`/private/var/folders/nq/gs8zmwfs575fdrm8fmhlg12c0000gn/T/markdown-soft-paragraph-o49jmh1o/`.
Product changes are limited to source-map and two renderer status lines plus the
required generated bundle. Source-map is 179 lines; the established 360-line
renderer receives no lifecycle refactor. Existing controller tests (552 lines)
and E2E file (1113 lines) keep their shared harness rather than creating a new one.

No native IME manual PASS, general Markdown editing, overwrite permission,
packaged-app acceptance or independent reviewer PASS is claimed. Native Chinese
IME remains NOT VERIFIED, prior manual QA FAIL and phase 1B-3 formal FAIL remain.
SEC-01, composition recovery, memory-only drafts and save coordination limitations
are unchanged. Save As New File retains its existing destination policy, exclusive
creation, uncertain-outcome behavior and Not saved semantics. No Git checkpoint.


### Ordinary Paragraph Compatibility V1 — local WIP checkpoint (2026-11-02)

Version 0.31.0 preserves this bounded feature as a local development checkpoint.
Codex A reviewed the nine-file diff and direct source-map/controller/history
contracts; this is a local self-review, not independent second-model acceptance.
No new confirmed P0/P1 was found. An additional pure-memory boundary probe checked
318 accepted edits and 87 safe refusals across LF/CRLF/CR; accepted edits preserved
exact source splices and line endings and replayed Undo/Redo byte-exactly.

The 126 focused Node PASS, one real Pro Electron chain PASS and two normal process
exits above are reused against matching source/test/bundle SHA-256 fingerprints.
No functional code, tests or bundle changed at closeout. Versioning changes only
the package version and the lockfile's two project versions; dependencies, scripts
and packaging configuration are unchanged. The nine feature files and two version
files form the checkpoint. No unrelated GUI, packaging or full suite was rerun.

Soft-break crossing and multiline structural edits remain refused. Native Chinese
IME remains NOT VERIFIED and the earlier manual QA FAIL is not cleared. Phase
1B-3 formal FAIL, SEC-01, memory-only recovery, destination restrictions and
coordination-required remain. No manual, independent review, merge or release PASS
is implied. Cross-line Enter work is a separate subsequent feature.


## Plain paste and clear new-file feedback V1 (2026-11-02, uncommitted)

Addresses the user's inability to paste and to tell whether the Downloads save
attempt created a file. The existing native Edit menu now includes Paste. The
editor handles only clipboard `text/plain` before any HTML parsing, via one
ordinary PM transaction through the unchanged source-range/controller/IPC gates.
An empty clipboard never deletes the selection. A single line up to 4096 UTF-16
units is supported; multiline/control characters, files, unsafe syntax/ranges,
readonly sessions, active composition and unconfirmed operations are refused
without truncation or automatic retry. No clipboard HTML is read or rendered.

Save feedback is now concise and separated: the last confirmed file retains its
path/revision/SHA-256, later edits are explicitly not exported, and a later
failure cannot replace that success. A definite `created:false` refusal says no
file was created; partial, unverified, durability-uncertain and unknown outcomes
retain their distinct meanings and keep further attempts blocked. Folder
restrictions and detailed receipts are expandable. ACL refusal explains why
Downloads may be unsupported and suggests an ordinary home-child folder without
changing permissions or creating a directory. Not saved remains visible.

Evidence from synthetic data only:
- RED: the six new view regressions failed before implementation (ten existing
  cases passed). Two actual Electron cases reproduced rejected plain paste and
  the absent native Paste role. Earlier command setup failures launched no app.
- GREEN: **147/147 Node PASS** across source-map, controller, session IPC,
  readonly-open and copy-view tests. A test-fixture selection length was corrected
  from three to four selected characters; its exact-source assertion was retained.
- **3/3 Pro Electron PASS**, including the existing persistent-copy case and two
  new paste/menu cases. Actual PM editing, Undo/Redo, Enter/Backspace, readonly
  session rejection, original byte preservation, exclusive new-file creation,
  independent failure feedback and fresh-process readonly reopen were checked.
  BOM/CRLF/no-final-newline and SHA-256 matched; subsequent edits did not change
  the created file. Five child processes exited code 0, no signal/watchdog/fault
  and no remaining process. The two owned Home fixtures were reclaimed by the
  existing helper only after verified success and process exit.
- Paste events used controlled ClipboardEvent/DataTransfer in real Electron;
  menu inspection proves the native Paste role is installed. It does **not**
  prove OS-clipboard Cmd+V in the Go To Folder dialog. Native dialog choices were
  stubbed. The user's clipboard was neither read nor changed; native Chinese IME
  was not exercised. The running user preview was not restarted or closed.
- The existing esbuild command regenerated the demo bundle; a separate output
  rebuild matches byte-for-byte. No version or dependency change.

Local evidence: `/private/var/folders/nq/gs8zmwfs575fdrm8fmhlg12c0000gn/T/markdown-paste-save-df3spwc7/`
(`node-final.log`, `electron-green.log`, screenshot under `electron-green/`).
The 31-line paste helper keeps input policy separate; the existing 362-line
renderer receives only the wiring. Controller tests are 624 lines; the existing
E2E file is 1202 lines. Shared test setup is retained rather than introducing a
new framework or unrelated file split in this bounded change.

Local diff review found no new confirmed P0/P1. File Store, Document Service,
IPC, preload, source-map and controller runtime are unchanged. No native-dialog
manual PASS, native IME PASS, independent review, packaged acceptance or release
approval is claimed. Prior native-IME QA FAIL/NOT VERIFIED, phase 1B-3 formal FAIL,
SEC-01, source-line crossing restrictions, memory-only recovery, directory policy
and coordination-required remain. No original-file overwrite or Git checkpoint.


### Plain paste / new-file feedback — 0.32.0 local checkpoint (2026-11-02)

User feedback: "粘贴的测试已经通过了。" Recorded as user manual paste QA PASS;
the feedback does not identify every native dialog/clipboard path, and does not
extend to native IME or clear the prior Chinese-input QA FAIL. Codex A local
readiness review matched all 13 candidate SHA-256 values against the 147 Node /
3 Pro Electron / five clean-exit evidence and identical independent bundle.
No unrelated changes or new confirmed P0/P1 were found. No second-model review,
new GUI run or full packaging matrix was required for this local checkpoint.

The approved 15-path commit adds only the two version files to that scope.
0.31.0 -> 0.32.0 follows the user-visible feature minor rule; only the three
project version fields change, with dependencies and scripts unchanged. This is
a restricted local WIP, not merge/release approval. All memory-only draft,
multiline-paste, original-file overwrite, destination, native IME, SEC-01 and
phase 1B-3 formal FAIL limitations above remain at this checkpoint.
