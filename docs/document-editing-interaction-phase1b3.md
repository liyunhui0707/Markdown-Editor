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

## Multiline plain paste V1 (2026-11-02, uncommitted)

Follows the approved sequence after local checkpoint
`e8e80a0e3585ecd2984c3733f79455c0654c132b` (0.32.0). This candidate adds
ordinary paragraph paste, not original-file overwrite or another editor model.

Clipboard LF/CRLF/CR single newlines or one blank separator become ordinary
paragraph boundaries. The incoming text alone is converted; the existing source
is not serialized or normalized. At most 32 nonempty paragraphs / 4096 UTF-16
units before and after conversion, inside one plain top-level source-line
paragraph or supported empty slot. Leading/trailing blank lines, consecutive
independent empty paragraphs, formatted/soft-wrapped targets, unsafe syntax and
cross-block selections are refused in full. No HTML clipboard parsing.

A single PM Slice/ReplaceStep goes through the existing controller, source-range
projection, IPC revision/hash checks and history. Source-map reuses trusted
`paragraphSeparator` and inverse metadata for one exact reversible splice; only
main-owned history can cross the generated paragraphs. No new IPC fields or
parallel history. Composition, stale/unknown operations and readonly restrictions
remain; failed acknowledgements retain the complete local recovery text.

Evidence (synthetic data only):
- RED: nine new targeted tests, seven FAIL before implementation.
- GREEN: **158/158 Node PASS**, source-map/controller/session IPC/readonly-open/
  copy-view. Includes LF/CRLF/CR, BOM/frontmatter/opaque syntax, no final newline,
  UTF-16 boundary matrix, empty input slot, atomic refusal, one-item Undo/Redo,
  Enter/join, session isolation, stale revision and lost acknowledgement.
- **Two targeted Air Electron cases PASS** on Node 24.20.0, Electron 43.4.1 and
  Playwright 1.63.0: existing single-line paste lifecycle plus new multiline
  lifecycle. The new case verifies caret, atomic undo/redo, Enter/Backspace,
  readonly original/copy switching, source byte preservation, new-file SHA-256,
  cancellation, later edits leaving the file unchanged and fresh-process reopen.
  Four successful app processes exited 0 without watchdog/fault/remaining PID.
  Both successful Home fixtures were reclaimed after verified file hashes and
  exits; later test revisions defer fixture creation until the save step.
- Failures remain in evidence: one Air build setup error invoked native esbuild
  through Node (no app); corrected to its existing JS API. Initial new GUI case
  failed at Backspace and its unsaved quit dialog masked the error (watchdog
  exit); test now has the same explicit synthetic discard stub as the prior
  case. Two diagnostic runs reproduced the refusal; another diagnostic failed
  due to an incorrect introspection property (test only). Four failed pre-save
  Home fixtures remain retained, not claimed successful or deleted.
- Actual captured boundary: after Meta+Left the DOM caret was 0 in `Next.` while
  PM still held the paragraph-end position. Immediate Backspace produced a
  broad DOM transaction including CRLF opaque text normalization, which the
  existing gate correctly rejected. No text/revision changed. The final test
  waits for PM's actual caret and history acknowledgement, without fixed sleeps,
  increased timeouts, retries, changed expectations or guard relaxation. This
  proves the settled-caret path; rapid-key handling is a remaining limitation,
  not a claimed product fix or proof that all native interactions are correct.
- Controlled ClipboardEvent/DataTransfer and stubbed native dialogs in real
  Electron are not native clipboard/Pinyin QA. User manual acceptance of this
  new multiline behavior is pending. Historical native-IME FAIL/NOT VERIFIED
  and phase 1B-3 formal FAIL remain.
- Existing esbuild generated bundle equals independent rebuild locally and on
  Air. Local Node/code and Air 24-file snapshot fingerprints match; final test
  revision is recorded separately from the original archive.

Evidence: `/private/tmp/markdown-multiline-paste-rowg1vkr/` (Node `node-final.log`,
Air `electron.log`, `electron-v5.log`, `electron-v6.log`, `candidate-v6.json`,
`result-v6.json`, screenshot under `air-artifacts/`). Remote isolated run:
`/private/tmp/markdown-multiline-paste.UYC5T4/`. Failed retained Home fixtures on
Air: `Writing-synthetic-E2E-MeuMWR`, `Writing-synthetic-E2E-bnfNfI`,
`Writing-synthetic-E2E-O5ltLY`, `Writing-synthetic-E2E-f74kMR`; no cleanup is
claimed for them. No user files or existing preview were read/closed by the tests.

Local diff self-review found no new confirmed P0/P1. This is not an independent
second-model review. File Store, Service, IPC, main/preload, save policy,
Persistent Copy, dependencies and version are unchanged. Not saved, memory-only
recovery, APFS/destination restrictions, exclusive creation, coordination-required,
SEC-01, no original-file overwrite and all release gates remain. No new commit,
push, full suite, ASAR matrix or native IME acceptance is claimed.

### User save/reopen QA and native-caret Backspace follow-up (2026-11-02)

The user reports **Save as new file -> reopen PASS** and supplied a confirmed
revision-8 receipt plus a separate `unsupported-acl` / `not-created` refusal.
This is user manual evidence for new-file persistence/reopen; no byte/hash test
or native IME acceptance is inferred from the screenshots. Other directories
remain unsupported according to the existing ACL/home-child/APFS policy. The app
does not change permissions. The prior success is not a promise of arbitrary
Save As or original-file overwrite.

The next bounded stability fix addresses the rapid Meta+Left -> Backspace
refusal above. A 26-line native-selection helper uses public PM `posAtDOM`,
`nodeDOM` and `TextSelection` APIs before the existing Backspace keymap. It only
reconciles a collapsed browser caret at the start of the SAME paragraph, when
the paragraph DOM text matches PM and source equals the confirmed snapshot.
It changes selection, never text/history/revision. The ordinary PM command,
controller/source-map and main IPC then accept or reject the edit as before.
Readonly, invalid lifecycle, pending/history/unknown, composition, other blocks,
changed DOM text, noncollapsed selection and modified delete shortcuts are not
reconciled. No timeout, forced composition completion, editor upgrade or safety
gate relaxation. Renderer wiring is five lines (367 total); existing controller
tests 742 and shared E2E 1301 lines reuse their fixtures instead of splitting
unrelated code or introducing infrastructure.

Validation:
- New Node contract RED: 1 failed / 2 guard tests passed before helper logic.
  Final **161/161 targeted Node PASS** across the same five relevant files.
- Actual Air Electron RED used the previous runtime with the new deterministic
  same-turn DOM-caret/keydown regression: DOM offset 0 vs PM offset 5; join
  refused, source unchanged. App exited normally, no Home fixture created.
- Actual Air GREEN: **2/2 selected cases PASS** (existing Enter/empty-composition/
  middle split/Backspace/history plus multiline save/reopen). The same forced
  gap passes, followed by real Electron Meta+Right/Meta+Left/Backspace without a
  selection wait, exact Undo/Redo and caret checks. New-file bytes/hash, BOM/CRLF,
  untouched blocks/original, readonly isolation, cancellation and later edits
  remaining unexported all pass. Three processes exited code 0, no watchdog,
  fault, signal or remaining process. The one successful Home fixture was
  verified/reclaimed; the four previous failed empty fixtures were untouched.
- A test-selection regular expression initially matched zero tests; corrected
  before GUI launch. No product assertion or timeout was weakened.
- Local and Air independent bundle builds match. Air used the exact updated
  25-file snapshot with fingerprints. No native OS Pinyin or native clipboard
  claim; native file dialogs were stubbed for automation. The user's save/reopen
  PASS remains a separate source of evidence.

Evidence: `/private/tmp/markdown-caret-r9qbytkl/` (`red.log`, `node.log`,
`electron-caret-red.log`, `electron-caret-green.log`,
`candidate-caret-green.json`, `result-caret-green.json`, `air-artifacts/`).
The observed same-paragraph settled-content timing failure is fixed in this
bounded path; other selection/composition scenarios are not newly certified.
No new confirmed P0/P1 in local self-review; no second-model review performed.

Version remains 0.32.0, with the multiline candidate and this follow-up still
uncommitted. Original-file readonly, coordination-required, supported-save
directory limits, Not saved / memory-only drafts, SEC-01, historical native IME
FAIL/NOT VERIFIED and phase 1B-3 formal FAIL remain. No Git checkpoint, release
or wider save authorization is implied by this development/testing result.


## Local Draft Recovery V1 (2026-11-03, uncommitted)

Product scope: a temporary document or independently editable copy automatically
backs up **main-confirmed** Markdown. The document window exposes a separate
backup revision/status and “恢复本地草稿” list. Restoring verifies the record and
opens a new temporary session; it does not revive old session IDs, Undo/Redo,
copy receipts, permission grants or original-file save authority. Existing
Document Model/Service/source projection and new-file export are reused unchanged.

Storage is app-private plaintext under the platform app-data directory:
`~/Library/Application Support/Markdown Vault Document Drafts/` on this Mac.
The root is canonical, owned and mode 0700; records are exclusive/no-follow 0600
JSON envelopes containing exact UTF-8 bytes and SHA-256. Main batches changes
over 800 ms and flushes on close/revocation. Each successful receipt requires
identity/content/readback verification and file/directory fsync. Deterministic
immutable generation names and previous-generation fingerprints reject competing
or stale writers. Only verified obsolete snapshots are retired; newest two
verified generations normally remain. Partial/unverifiable entries are retained;
uncertain/conflicting operations stop automatic writes for that live draft.

This is **application-owned recovery storage**, not a new arbitrary-path save
permission. Renderer requests supply a draft ID only, never Markdown or a path.
Existing sender/window/main-frame checks apply. Preload refuses restoration while
composition/IPC is pending or an IPC outcome is unknown, validates temporary
identity and suppresses receipts for revoked sessions. Active drafts cannot be
restored twice in the same manager. Older corrupt-head recovery is explicit and
forks a new backup lineage, preserving the damaged evidence. An unreadable draft
or unavailable root does not replace the current document. Backup failure does
not fail an accepted in-memory edit or clear dirty/history/export receipts.

Limits: at most 32 draft IDs / 128 retained records; each bounded record is at most
768 KiB and content follows the document limits. No automatic expiration, user
removal UI or dismissal on export in V1. Capacity failure is visible and existing
records remain. Recovery restores content, not unfinished renderer input, IME
preedit, input-recovery records or old Undo history. The last unbacked portion can
be lost on sudden exit. Fsync is not proof against power failure; private-directory
checks do not promise protection from hostile same-user races or account access.
The snapshots are not encrypted or synced. Packaging and long-document performance
have not been accepted in this slice.

Validation (2026-11-03):

- **138 Node PASS**, 0 failed/skipped: `document-drafts.test.js`,
  `document-session-ipc.test.js`, `document-open-readonly.test.js`,
  `document-edit-controller.test.mjs`. Covers a fresh Node process, BOM/CRLF and
  Unicode bytes, multiple drafts, retention/capacity, symlinks/directory replacement,
  corruption, partial/sync/permission failures, stale writers, accepted revisions,
  close flush, restore identity/history, readonly authority, forged IPC and stale
  backup receipts. Main Model/Service remain the source of truth.
- **2 Pro Electron cases PASS**, using the existing isolated runtime and private
  temporary draft roots. Timer-confirmed drafts survive direct `app.exit(0)` with
  no close/revoke flush, restore in a fresh process, accept real subsequent edits
  with Undo/Redo, export via the existing utility writer and reopen read-only in
  a third process. Original bytes/hash remain exact; BOM/CRLF/opaque blocks remain;
  later editing leaves the export unchanged and Not saved. A second case shows
  explicit older-generation recovery plus backup permission failure with retained
  text/last-confirmed revision. Four clean final process exits. Inputs/dialogs are
  automated/stubbed, windows hidden: **not native IME or user manual acceptance**.
- Bundle independently rebuilt to temporary output and byte-compared successfully;
  Git whitespace check passes. Codex local diff self-review found no unresolved
  new P0/P1 in this scope; no external Reviewer was called. It is not independent
  second-model or release approval.

Evidence: `/private/tmp/markdown-drafts-v1-work/`: `node-final.log`,
`electron-verified.log` (strengthened three-process case), `electron-4.log`
(failure-state case), `electron-results-verified/` and `electron-results-4/`
(screenshots/integrity). Earlier failing runs remain. The first two harness issues
were close-dialog teardown and an unset fixture destination; a later foreground
run received extra input. A strengthened assertion exposed the test's synthetic
DOM-selection timing, resolved by continuing at the export-returned caret. These
are not counted as successful native interaction acceptance. The final existing
fixture helper reclaimed verified successful Home outputs; failed-run objects
were moved intact into `retained-home-fixtures/` with `fixture-restore-map.json`.
No old Home evidence, archived worktree, user file or actual draft library changed.

Version remains 0.33.0; no staging/commit. Original-file overwrite, generic save(),
coordination-required, unsupported/sync-directory exclusions, SEC-01, formal
phase-1B3 FAIL, native IME NOT VERIFIED and earlier Chinese manual FAIL remain.


2026-11-03 user follow-up: “应该是可以了”, with screenshots of revision-4 backup,
a one-item recovery list and restored edited content in a new revision-0 session.
**Limited manual backup/list/restore PASS**; Not saved remains visible. Revision
0 is the restored session's new baseline, not loss of the prior revision-4 body.
This is user experience evidence, not an automated hash check or proof of full
process exit. Post-restore export/reopen, native IME and wider release acceptance
are not added by these screenshots. No source/test/version change or Git commit.


### 0.34.0 local WIP checkpoint (2026-11-03)

This closeout supersedes the dated candidate version/staging notes above only.
The checkpoint includes the 16 verified feature/documentation paths and two
project version files, with the three project version fields changed from 0.33.0
to 0.34.0. No dependency, configuration, runtime or test content changes accompany
the closeout. Runtime/test/bundle fingerprints match the successful evidence;
reuse 138 focused Node PASS and the two scoped Pro Electron cases PASS. Limited
user backup/list/restore PASS remains separate from automated evidence.

This is a local WIP checkpoint, not complete acceptance or release approval.
No unresolved new P0/P1 was found in Codex local self-review; no independent
second-model review is claimed. Original overwrite and generic save() remain
blocked, coordination-required stays effective, and the draft recovery, native
IME, earlier manual FAIL, SEC-01, formal phase-1B3 FAIL, installer, hostile
same-user concurrency and power-loss limits above remain. No push, merge, tag
or release is part of this checkpoint.


## Draft Management V1 (2026-11-03, uncommitted)

User-approved next slice after the 0.34.0 checkpoint: identify drafts, explicitly
remove unneeded items from the recovery list, and explain capacity. Implemented
as reversible logical archive/return, not permanent deletion. The list shows
backup time, revision and a short stable ID. An inline confirmation names the
selected draft; Cancel has no storage effect. Archived content stays locally
recoverable by returning it to the recovery list before restoring a fresh session.

The existing store writes a new checksummed, exclusive snapshot with archive
membership and the same Markdown bytes/revision/backup time. Existing V1 records
without that field remain supported. Main checks sender/frame/window authority,
action/ID/opaque group fingerprint, inactivity and verified record identities.
Renderer cannot provide body, path or permissions. Active or partially unreadable
groups cannot be archived/returned; stale confirmations refuse. Neither original
files nor current model, revision, Undo history, export receipts or Not saved are
changed. Failed/uncertain management remains a separate operation status. Unknown
transport outcomes fence further management in that renderer, while independently
validated export of unrelated writing remains usable; there is no automatic retry.

Capacity is 32 non-archived drafts and 128 total snapshot records, including
archive and unknown/partial records. Archiving frees a draft slot, not disk space;
the 128-record ceiling can still stop backup/management. The UI explains both.
No permanent-delete, renaming or bulk cleanup UI is added. Existing verified
snapshot retention still applies; corrupt/partial records are retained. A legacy
app version does not understand archive membership; this is not a downgrade or
multiple-version profile compatibility guarantee.

Validation: **94 Node PASS** across document-drafts, document-session-ipc and
document-open-readonly tests. Covers archive/return with exact BOM/CRLF/Unicode,
legacy records, malformed archive flags, stale/competing writers, active sessions,
forged IPC, permission/partial/sync failures, both capacity limits, symlink/root
changes, composition and lost/malformed responses. **One Pro Electron case PASS**
with two fresh processes and clean exits verifies GUI cancel/confirm, same-name
identification, persisted archive membership, return/restore, active/corrupt
refusal, subsequent editing, retained Undo capability and original-file equality
through a permission denial. Original synthetic SHA-256:
`d767b1c023f9c8020644c3f2e15a06924f5aeaa468b24fd68a78853321ab224e`.
Native open selection is stubbed, input controlled and windows hidden: native IME
and user manual QA are not claimed. No actual user draft directory was accessed.

Evidence: `/private/tmp/markdown-draft-management-node-final.log` (94 PASS),
`markdown-draft-management-preload-final.log` (focused post-self-review rerun),
`markdown-draft-management-e2e-final.log` and `markdown-draft-management-e2e-final/`
(two screenshots), all under `/private/tmp`. Initial RED tests and prior runs
remain beside them. The first test-append attempt used the wrong cwd and failed
before changing files; it was corrected, not a product failure. A separate esbuild
output byte-matches the tracked bundle. All new fixtures are in OS temporary
directories, not Home; partial/error evidence is retained, no historical cleanup.

Local self-review: accept within this bounded WIP scope; no unresolved new P0/P1
found. The one corrected failure-path coupling is documented above and tested.
No second-model review, native manual acceptance, performance/installer or release
sign-off is implied. Existing original overwrite prohibition, coordination-required,
SEC-01, formal phase-1B3 FAIL, native IME NOT VERIFIED/prior manual FAIL, plaintext
local storage, unbacked-input and old-Undo limits, hostile same-user concurrency
and power-loss exclusions remain. Version 0.34.0; no staging, commit or push.


## Writing UI V2 — uncommitted candidate (2026-11-03)

The Document-First window now has one compact Chinese action bar: 新建 / 打开,
centered document title with the existing session switcher, 编辑副本 or 另存新文件,
草稿 and 详情. The body follows a short readonly/unsaved and local-backup status
line; reading width is capped at 800 CSS px, with a two-row header on narrow windows.
Draft recovery/archive/return is in an on-demand modal side panel, refreshed on
opening. Save limits, full receipts, revision/hash and backup details are in a
separate panel. Essential failed/unknown creation and input/backup warnings remain
on the writing surface. A later failure does not erase the last successful receipt.

A small presentation-only shell reuses existing controllers and UI nodes. Opening
panels/title disclosure is fenced while input is composing or operations are busy;
no composition flag is force-cleared. Native dialog focus/Escape is used. Escape
on export confirmation delegates to the existing Cancel handler only while enabled;
it cannot dismiss an in-flight create request. Restore/switch closes panels and
preserves the existing main-owned session/revision/history boundaries. No File
Store, save policy, permission or storage format changes belong to this UI slice.
The prior uncommitted Draft Management V1 implementation remains preserved.

Validation: **100 focused Node PASS** (drafts, IPC, copy view and writing shell),
**3 Pro Electron cases PASS**, 4 clean process exits, no watchdog/fault/remnants.
Coverage: empty/read/edit layouts at 390/640/1050/1440 px, Chinese/English long
names, panel keyboard close/focus, controlled composition blocking, independent
original/copy switching and Undo/Redo, real exclusive creation through stubbed
native selection, reopen and byte/hash equality, later failure retaining receipts,
plus archive/cancel/return/restore and permission failure retention across restart.
Export SHA-256: `968738615447c8b334727842d2e0c3686c97bf7b229600081a8983fa874d0129`.
Evidence: `/private/tmp/markdown-writing-ui-node-final.log`,
`/private/tmp/markdown-writing-ui-e2e-4.log` and `markdown-writing-ui-e2e-4/` screenshots.
The generated bundle was independently rebuilt and byte-compared.

Early runs exposed outdated UI selectors, a noncanonical test draft root, an Undo
expectation that incorrectly assumed grouped typing, and resized hidden-window
capture stalls. These test adaptations are retained in earlier logs. Screenshots
now briefly show only the synthetic window without activating it, wait for painted
frames and hide it again. The final tests take about 9 seconds. A stale draft list
on panel opening was corrected by invoking the existing refresh operation.
Successful Home export fixture was verified/reclaimed after exit. The first failed
setup's empty fixture is recoverably retained at
`/private/tmp/markdown-writing-ui-e2e-1/retained-fixture/` with `mapping.json`.
Other failure/partial evidence stays in OS temporary directories. No user documents,
actual draft library, prior archives or historical Home fixtures were touched.

At the user's request Air was attempted: `air-mac` did not resolve; no Air entry
was found in the current SSH aliases or named Tailscale peers. **Air NOT RUN**;
this is not proof that the device is offline. No remote settings were changed.
Pro evidence is controlled Electron interaction, not native macOS IME or native
Save Dialog acceptance. New UI/manual acceptance remains pending. Prior user
backup/restore and save successes are not invalidated, but native IME NOT VERIFIED,
historical manual FAIL/formal 1B-3 FAIL, SEC-01 and release restrictions remain.
Original overwrite remains prohibited; coordination-required, restricted new-file
destinations, plaintext local drafts and backup/Undo limitations are unchanged.
Local diff self-review: no new unresolved P0/P1 found in the UI slice; this is not
an independent second-model review. No DeepSeek, version bump, staging or commit.
The existing renderer entry and E2E spec exceed size guidelines; this stage adds a
small shell module and reuses the single synthetic harness instead of splitting
unrelated controller/test history. Version remains 0.34.0 on the same branch/HEAD.


## Writing V3 — quiet input and basic formatting candidate (2026-11-04)

Normal composition in the Document-First window now occupies only the fixed-height
backup status line (`输入中…`). Export/format/switch guards remain active; invalid
composition and actual backup/create failures remain visible. No input completion
is invented and no safety timer was added. Main labels/default names are Chinese.
The session badge is `本地草稿`, with separate `已备份` / `当前内容已导出` /
`后续修改尚未导出` facts. This does not grant saved-file binding or overwrite rights.

The format bar reuses the same source map, Document Model, session IPC/controller
and main-owned Undo/Redo. It supports single-line headings 1–3, selected-text bold,
and flat tight lists of up to 32 one-line items. Plain list items support Enter,
last-empty-item exit and Backspace joins. Formatting on an empty paragraph,
cross-line/cross-leaf selections, partial removal of bold, marked-item splitting,
and nested/task/loose/complex lists remain refused. Unsupported blocks remain
opaque and readonly. The renderer sends only an allowlisted command, PM range,
session and revision; the main process independently maps and reparses the patch.
It accepts no arbitrary Markdown, path or history patch through that operation.
Main-owned format history verifies full-source hashes before and after replay.
BOM/newlines and unrelated source slices remain exact; export still uses the
existing exclusive-create flow and retains dirty/Undo state.

Validation: **210 focused Node PASS**, **4 distinct Pro Electron cases PASS** with
five clean successful app exits. Cases cover responsive empty/readonly layouts
(390/640/1050/1440 CSS px), Chinese native Edit menu retaining the Paste role,
existing panels/error receipts, and the new edit/format/Undo/Redo/switch/export/
fresh-process-reopen chain. The new case checks compositionstart/end from CDP
browser IME, stable editor position while composing, denied readonly format IPC,
opaque blocks, exact BOM/CRLF export, hash and unchanged original bytes.
Original SHA-256: `ea329bc430210f2d3fcaf03fcd37b323e0fc922784823bdad7df5cc26156d100`.
Export SHA-256: `ce7ff10b6b89898be70a81bfdd8b59d14d4b460328bebece07c21b91b94d9f80`.
Evidence: `/private/tmp/markdown-writing-v3-node-final.log`,
`markdown-writing-v3-e2e-final.log`, `markdown-writing-v3-e2e-layout-final.log`,
and the corresponding temporary screenshot directories. An early composition
capture changed focus mid-input; the harness now shows the synthetic window before
composition. A later layout test expected the old English cancel text; corrected
Chinese assertions passed. These failed runs remain recorded, not acceptance.
Successful Home export fixtures were verified and reclaimed by the existing helper;
all other synthetic diagnostics remain under OS temporary storage. No user files,
actual draft library or historical archives were touched.

Air was attempted once: `air-mac` could not resolve. Air NOT RUN; no device changes
or further environment investigation. Pro uses controlled browser input and stubbed
native file selection: **native macOS Chinese IME NOT VERIFIED**, prior manual
FAIL/formal 1B-3 FAIL and SEC-01 remain unresolved at their existing scope. New
manual experience acceptance remains pending. This is Codex local self-review,
not an independent model review; no new confirmed P0/P1 found in this slice.
Existing save destinations, coordination-required, plaintext draft/backup limits
and original-overwrite prohibition remain. Existing Draft Management/UI V2 work
is preserved. Version stays 0.34.0, no staging/commit/publication. The renderer
entry (377 lines) and shared E2E spec (1682 lines) exceed guidance; three bounded
format helpers (114/56/38 lines) isolate new logic while the existing harness and
ownership stay intact. Controller tests are 806 lines within the test guideline.


## Approved prototype integration — first real-app batch (2026-11-04)

The accepted visual prototype is connected to the existing Document-First window:
real session sidebar and name filter, collapsible desktop/overlay narrow layout,
document and formatting bars, welcome page, 680px body column, warm paper/green
styling and compact footer. Draft/details/export controls remain real existing
controls, moved rather than duplicated. No sample documents or inactive feature
buttons are used to imply working capabilities. Outline, themes and settings are
later batches; the standalone prototype itself is unchanged.

The shell resolves IDs against existing approved select options and invokes the
same load handler. It highlights only the controller's confirmed identity; pending,
revoked, removed or composition-blocked sessions cannot navigate through the new
rows. Failed snapshot IPC retains content/history/highlight and can recover through
the existing switch path. Rows stay stable during frequent edit/status updates.
No main/preload/service, source mapping, editor authority or save policy changes
were made in this batch. CSS is local and CSP adds style-src self only; external
scripts/network restrictions remain. Earlier uncommitted candidate work is retained.

Evidence:

- Node: 83 PASS in `/private/tmp/markdown-shell-integration-node.log` (shell,
  edit-controller and copy-view tests). Three new sidebar unit cases and one
  isolated Electron interaction case extend existing tests.
- Pro: four distinct cases PASS across `markdown-shell-integration-e2e.log`
  (three PASS plus one initial test-only Undo assertion failure) and
  `markdown-shell-sidebar-final.log` (corrected one-character Undo case PASS),
  under `/private/tmp/`. Corresponding screenshot directories are
  `markdown-shell-integration-e2e/` and `markdown-shell-sidebar-final/`.
  The initial failure remains retained, not counted as acceptance. Five successful
  app exits were clean. Existing verified export fixtures were reclaimed by the
  owned-fixture helper after successful tests and process quiescence.
- Air: `ssh mac-panmiaomiao` resolves to the user-confirmed Air. Two cases PASS in
  18.4 seconds, two clean exits, no watchdog/fault/process remainder. Tests cover
  empty/Chinese/English layouts and sidebar switching/history/filter/collapse,
  controlled composition and failed IPC. The source and artifacts are confined to
  `/private/tmp/markdown-shell-v1.obnGTp/`; this run creates no Home fixture.
  Existing dependencies/runtime from the prior multiline-paste fixture were reused
  read-only. No installation, SSH, permission or system configuration was changed.
- Air source: 33 files match the local candidate before and after execution.
  Dependency lock entries match (root package version excluded); Node 24.20.0,
  Electron 43.4.1, Playwright 1.63.0. Source archive SHA-256:
  `e3575bb2dd42af5dca460203314ea8aafa691c79b94626d0efeabfbeab38c5df`.
  Returned evidence archive SHA-256:
  `c2ecd1788479d71a323a01dda37f89a7df3f6b585122c9f6e4c1d25127ab4610`.
  Local verified logs/screenshots/manifest: `/private/tmp/markdown-shell-air-transfer/results/`.
- Sidebar fixture original unchanged, SHA-256:
  `53bb2c8e3f99a14a2b224c0530ba324d7f4998a1de3ab1c5e084504b4e288e3f`.
  Independent renderer build matches the candidate bundle exactly. Git whitespace
  checks pass. Baseline copies/hashes of 31 prior candidate files remain at
  `/private/tmp/markdown-shell-integration-baseline/`.

This is controlled automated evidence and Codex local diff self-review, not native
system Pinyin, new user manual acceptance or independent second-model review.
No new unresolved P0/P1 was identified in this bounded presentation slice. Original
overwrite, coordination-required, restricted destinations, plaintext draft limits,
historical IME NOT VERIFIED/manual FAIL, formal 1B-3 FAIL and SEC-01 remain.
Version stays 0.34.0; no staging, commit, Reviewer call or publication. The entry
(377 lines) and shared E2E (1750) retain their existing controller/harness structure;
new shell/style remain separate (132/179 lines), unit tests 102 lines. No unrelated
file split was introduced for this visual integration batch.


## Approved prototype integration — second real-app batch (2026-11-04)

The existing editor now has a right heading outline, scroll-only navigation and a
reading/settings dialog with theme (light/dark/system), body font, size, width and
line spacing. Settings survive document switches within this window, not restart.
Only current top-level rendered heading nodes appear; code/opaque syntax is excluded.
Positions are bound to both the confirmed session and immutable editor document.
Pending/history/composition/invalid states refuse navigation; stale rows cannot
jump into a new session. Display changes do not rebuild the editor or write source,
revision, history, IPC or files. Existing main/preload/service/save protections are
unchanged from the prior candidate. The standalone prototype is unchanged.

Evidence and limits:

- 11 Node PASS in `/private/tmp/markdown-reading-node-final.log`: six new reading
  cases and five existing shell cases. An initial fixture incorrectly passed a BOM
  directly to the projector instead of through the service's BOM split; corrected
  test input passed. The first log remains, not counted as a product PASS.
- Three Air Electron cases PASS in 21.9s, three clean exits, no remaining process,
  watchdog or fault. Includes responsive layout/sidebar regression and a new real
  outline/theme/settings/heading-edit/Undo/Redo case. Original bytes and SHA-256
  unchanged: `99da66ae940c39c8bf3d6672c8445548079f104a4402297033694a839c1d3c94`.
  The same editor DOM persists through display changes; revisions change only for
  edits/Undo/Redo. Dark desktop/narrow screenshots were visually checked.
- Air snapshot: `/private/tmp/markdown-reading-v1.JCsJSN/`, 35 files verified before
  and after, matching dependency entries; existing Node 24.20.0 / Electron 43.4.1 /
  Playwright 1.63.0 reused. Source archive SHA-256:
  `531f9940be5d2765f1e04424f4e20a1ff024a092a1d2f97b10fdede6ce55f687`.
  Returned evidence SHA-256:
  `c958d0a5c82edd1dd8c8252aa282edda3df95b1376210e43bafb6f480201d899`.
  Local logs/screenshots/manifest: `/private/tmp/markdown-reading-air-transfer/results/`.
  All new synthetic profiles/documents remain under that Air run's `tmp/`; no Home
  fixture, user file, archive or real draft library was touched. No installation or
  system configuration changes. No Pro GUI run was needed for this batch.
- Independent bundle rebuild matches; Git whitespace checks pass. Bounded Codex
  self-review accepts this presentation slice with no blocking finding; it is not
  an independent second-model review or acceptance of all earlier candidates.
  Existing 32 candidate copies/hashes: `/private/tmp/markdown-reading-baseline/`.

Follow-system automation uses emulated media, composition uses controlled events,
and file selection is stubbed. Native IME NOT VERIFIED, historical manual/formal
1B-3 FAIL and SEC-01 remain scoped. User visual acceptance is pending. Original
overwrite remains prohibited; coordination-required and save/draft limits remain.
Version 0.34.0 unchanged, no staging/commit/Reviewer/publication. New reading files
are 153/77 lines, tests 87; entry/E2E are 379/1830 lines because the existing wiring
and isolated harness are reused rather than split during a bounded UI change.


## Approved prototype integration — third real-app batch (2026-11-04)

Drafts now use titled cards with explicit active/recoverable/uncertain badges,
separate actions, an honest empty state and collapsible capacity details. Document
details group confirmed identity, local backup, last confirmed file and latest
operation. Save confirmation follows the same styling; existing handlers still
freeze edits and validate the approved revision. Closing a draft confirmation
cancels the local selection; pending management cannot be dismissed or duplicated.
No main/preload/service, filesystem policy, source/edit/history or prototype change.
Prior 35 candidates were verified and copied to `/private/tmp/markdown-panels-baseline/`.

- Node: **55 PASS**, `/private/tmp/markdown-panels-node.log` (draft view/store,
  writing shell and copy view); six new presentation/guard regressions.
- Air: **two distinct cases PASS**, three app processes in the successful runs
  exited cleanly. Export/edit/switch/reopen and archive/restart/return/restore cover
  the changed panels. Original bytes remain exact; draft fixture original SHA-256
  `d767b1c023f9c8020644c3f2e15a06924f5aeaa468b24fd68a78853321ab224e`;
  export SHA-256 `968738615447c8b334727842d2e0c3686c97bf7b229600081a8983fa874d0129`.
  Light/dark, save confirmation, empty/cards and narrow details screenshots inspected.
- Initial Air root `/private/tmp/markdown-panels-v1.a3WeIB/`: export case PASS,
  archive case failed at its final screenshot because its callback omitted `app`.
  Fixed only that callback and reran archive in `/private/tmp/markdown-panels-final.EHCVhB/`
  (PASS, 2.7s); no product change or repeated export test. Initial failure retained.
  Both snapshots contain 36 matching hashes before/after and matching dependencies,
  reusing Node 24.20.0 / Electron 43.4.1 / Playwright 1.63.0 without installation.
  Source archive hashes: `17ddbf52274cbbdd8542ca0c36c1303e2f78999a1e431ab590ed2ccfdcebbe1f`
  and `a182c68a461bc451e83e66aee13ce43c43a64ae57be52562602ab8ad13b7110f`.
  Returned evidence hashes: `b5f7a6c3ac9d0151b060677f27be622655ebcad52a3b4ee1fb8d6c909c72886b`
  and `0228cf68c21111e32f35b4ff348aeb1c887360a7223bc7070d89e6b4673829f2`.
  Local artifacts: `/private/tmp/markdown-panels-air-transfer/results/` and
  `/private/tmp/markdown-panels-air-retry/results/`.
- The one fresh Home export fixture `/Users/shier/Writing-synthetic-E2E-zYxx1c`
  was verified/reclaimed by the existing owned-fixture helper after clean exit;
  subsequent absence confirmed. All other synthetic/partial/failure evidence remains
  under those Air roots' `tmp/`. No historical artifacts or user drafts were touched.
- Independent bundle rebuild and Git diff checks PASS. Bounded Codex local review
  found no new blocker in this presentation slice; not independent second-model
  review or approval of all prior candidates. New CSS/view tests are 69/59 lines;
  draft view/shell remain 141/149. E2E stays 1856 lines to reuse the established harness.

Manual visual acceptance remains pending. Native file dialogs are stubbed and IME
events controlled; native IME NOT VERIFIED, historical manual/formal 1B-3 FAIL and
SEC-01 remain scoped. No original-file overwrite, destination expansion or draft
durability claim was added. Version remains 0.34.0; no staging/commit, DeepSeek call
or publication. Current candidates remain a WIP rather than release approval.


## Integrated appearance acceptance (2026-11-04)

The three integration batches now provide one coherent real-app surface: welcome,
session sidebar, document/format controls, writing column, outline, appearance,
draft management, details and save feedback. Prototype-only features are not
represented as implemented. This pass closes one reproduced interaction gap:
the title disclosure now dismisses with Escape/outside pointer, returns keyboard
focus when appropriate and leaves composition, pending operations and modal-owned
events untouched. No filesystem, editor, service, IPC or authorization change.

- Baseline: all 37 candidate hashes matched `/private/tmp/markdown-panels-final.json`;
  preserved in `/private/tmp/markdown-experience-baseline/`.
- **36 Node PASS**, `/private/tmp/markdown-experience-node.log`; three new shell
  regressions. Two dismissal tests reproduced the old failure before the fix.
- **3 Air Electron PASS, 22.9s**, under `/private/tmp/markdown-experience-final.jTQc1J/`:
  integrated appearance plus adjacent sidebar/reading cases. 36 runtime/test hashes
  matched before/after, dependencies match, Node 24.20.0 / Electron 43.4.1 /
  Playwright 1.63.0 reused. All three processes exited cleanly.
- Actual captures inspected: welcome, light/dark full workspace, narrow layout.
  Modal focus return, title dismissal at 390/760/1024px, 1440px outline, original/copy
  switching, history, controlled composition/IPC failure and cancelled export are
  covered. Original bytes unchanged; integrated fixture SHA-256
  `4a240408bdf1ac1e34e4544d92f8b42719520a67612a5a41b4c80fc82847a120`.
- Failed initial reproduction retained at `/private/tmp/markdown-experience-red.cvaKkP/`.
  Besides the confirmed dismissal bug, its snapshot assertion raced normal backup
  completion; corrected by awaiting `backed-up`, not by changing product behavior.
- Returned evidence: `/private/tmp/markdown-experience-final-transfer/results/`;
  archive SHA-256 `eca7e3e8d61a2eae28fa3fe4050b612fa181de8f0b6916160ca33ae25cc5ffed`.
  Failed evidence archive SHA-256
  `cd43696a0044363b098956d6e001741c55f73d3700ae86ebbb2ad9e7f3b250ba`.
  Final source archive SHA-256
  `818c19a106dd072576424110d3382580300eb1359681434fb79ea9acdb1202b4`.
- No Home/Downloads directories/files created; all new fixtures/drafts remain in
  those private Air temporary roots. No historical files or user documents touched.
  Prior export/reopen/receipt and archive results are reused, not rerun as unrelated gates.

Bounded local self-review and independent bundle reproduction found no new blocker
in this small shell fix. This does not review/approve every prior candidate. Shell
logic/test 160/160 lines; E2E 1921 lines because the existing isolated harness is
reused rather than extracted in a visual acceptance pass. A short optional visual
check is in `test-manual.md`; user acceptance remains pending. Native dialogs are
stubbed, theme system changes emulated and composition controlled. Native IME NOT
VERIFIED, historical manual/formal 1B-3 FAIL, SEC-01 and save/release restrictions
remain. Version 0.34.0; no staging/commit or Reviewer call. The integrated appearance
is a candidate baseline, not a complete daily-use editor or release sign-off.

## Visual baseline closeout and document find V1 — uncommitted (2026-11-04)

The user accepted the integrated visual baseline; future work keeps this layout.
Before this batch, all 37 candidate hashes matched the prior experience manifest.
Bounded Codex A self-review of their runtime changes and relevant tests found no
new confirmed P0/P1. This is not an independent model review. The pre-find files,
hashes and proposed checkpoint scope are preserved in
`/private/tmp/markdown-pre-find-checkpoint/`; no Git commit was created.

Find V1 adds a toolbar search button and Cmd/Ctrl+F, literal text highlights,
current/total count, case sensitivity, Enter/Shift+Enter navigation and Escape
return to the editor. It searches displayed text in the current document,
including protected blocks, across inline marks but not across block/inline-node
boundaries. Queries are limited to 256 UTF-16 units. Total counts remain exact;
at most the first 1,000 matches are highlighted/navigable, with an explicit notice.
No replacement, regex syntax, folder search or new IPC/filesystem authority.
Search state is window-local. Edits, history and session switches recompute matches;
unconfirmed/composing/locked states pause navigation and suppress stale highlights.
Search-field composition and modal-owned keys keep their normal ownership.

Validation:
- **45 focused Node PASS**, including nine new find tests; log
  `/private/tmp/markdown-find-node-final.log`.
- **Two distinct Air find E2E PASS** on the final runtime: full readonly/copy/edit/
  Undo/Redo/A-B-A chain in `final/` (17.4s), composition/modal case in `retest2/`.
  Existing integrated appearance case passed in the initial run and was not
  needlessly rerun. Each run verified 38 source/test/config hashes and the existing
  dependency lock; Node 24.20.0, Electron 43.4.1, Playwright 1.63.0. All launched
  processes exited cleanly, including failed test iterations.
- Air root: `/private/tmp/markdown-find-v1.tF519s/`; returned logs/screenshots and
  failure evidence: `/private/tmp/markdown-find-final-results/results/`.
  Evidence archive SHA-256:
  `3c43869cea74de8ebea53ddd3a6629e562befef6bab7be32995f22655f286ad0`.
  Final source archive SHA-256:
  `649c157e7a5b1cccfd5357336d95421e8390d3b29bf820454e7b3db1edd87fc2`.
- Actual light/dark/390px captures inspected. Source fixture bytes unchanged,
  SHA-256 `1e7118b4c088b963cc963e61e88b0f17fd50914309109ba9b6b593ae3b9889eb`.
  Confirmed synthetic backup also retained the exact `Zulu Alpha` insertion after
  redo. No Home/Downloads fixture or user file was created/modified.
- Air exposed readonly focus/selection return failures; fixed using tabindex and
  the current PM selection's DOM positions, without making the document editable.
  A later test expected one Undo to remove five separately typed edits; the test
  now uses one input transaction and checks actual source as well as match count.
  Failures remain in the evidence; none are reported as passes.

Find logic/test are 140/121 lines. Existing entry is 382 lines and shared E2E 2001
lines: only integration hooks/cases added; their established lifecycle harness is
retained rather than refactored in this slice. Runtime save policy, main/preload,
source mapping and controller are unchanged by Find V1. Native dialogs are stubbed
and composition events controlled in E2E. Native IME **NOT VERIFIED**, historical
manual/formal 1B-3 FAIL, SEC-01, `coordination-required`, overwrite prohibition and
release limits remain. Visual acceptance does not clear those restrictions.
Version remains 0.34.0; proposed next local WIP checkpoint version is 0.35.0.
No staging/commit, Reviewer call, push, tag or release in this batch.


## 0.35.0 local WIP checkpoint (2026-11-04)

The user approved the prepared checkpoint before the next file-workflow slice.
All 40 candidate fingerprints and the 42-file scope matched; existing test and
bundle evidence was reused. Only version metadata and these checkpoint notes
changed during closeout. This protects the accepted visual baseline and current
features; it is not a release or unrestricted daily-use approval. Native IME,
historical manual/formal FAIL, SEC-01 and all save/overwrite restrictions above
remain. No push, merge, tag or release.


## Confirmed export shortcuts V1 (2026-11-04, uncommitted)

Baseline: 0.35.0 local WIP `ddc3fab29a292641a39a53b22e7aa404eb7bf512`.
The user approved protecting that baseline and continuing with one-click reopen /
Finder location. New changes are not staged or committed; no version bump yet.

Service retains an opaque receipt ID for the latest positively confirmed export,
independently of subsequent failures. Main binds actions to the owning sender,
window, session and current draft revision; renderer supplies no target path.
Both actions re-read a bounded regular file and verify canonical path, dev/inode,
byte length and SHA-256. Readonly reopening uses the checked bytes directly,
without a second open/read race. A changed/unavailable file is refused; the draft,
Undo/Redo and previous success/failure receipts remain. The Finder operation only
requests display of the verified path; external changes after that read remain
possible, and Finder does not acknowledge visual success. No new write authority.
Composition, pending edits, recovery records and unknown IPC outcomes keep their
existing conservative fences. Receipt authority is not persisted in draft backups.
Repeated opens still count toward the existing eight-session bound.

Validation (174 distinct Node tests; repeat execution not counted twice):
- 161 service/IPC/preload/copy-view/open/integrity tests PASS:
  `/private/tmp/markdown-copy-actions-node-final.log`.
- 2 actual persistent-writer LF and BOM/CRLF cases PASS, now also validating
  follow-up read/identity and unchanged dirty state:
  `/private/tmp/markdown-copy-actions-persistent.log`.
- 21 layout/action-view cases PASS (10 already counted above):
  `/private/tmp/markdown-copy-actions-layout-node.log`.
- One final Air Electron case PASS (2.0s), 39 source hashes/dependency lock
  verified, Node 24.20.0 / Electron 43.4.1 / Playwright 1.63.0. It verifies actual
  exclusive creation, later editing, readonly reopen, draft/history retention,
  no overwrite after target-exists, buttons in viewport, light/dark/390px layout
  and clean process exit. Native dialogs and Finder are stubbed; no native IME claim.
- Initial automation failed because a redundant title click reopened its menu.
  Corrected to Escape; that functional pass's screenshots exposed a real new UI
  mount omission: buttons were outside the scrollable workspace. Fixed one shell
  mount entry, added viewport assertions and reverified. Earlier results remain
  evidence, not final UI acceptance.
- Original SHA-256: `1ad8947622bff7cda5bfb64ec4ea013b5b29f6b177703bf2890be8718e909503`.
  Export SHA-256: `15f0f6fa5638ec2bf7be60ec666d740386f2339617c7e6c66b6efa379fbfd502`.
  Both byte sequences remained unchanged through the workflow.
- Air: `/private/tmp/markdown-copy-shortcuts-v1-jhse7_gw/` (`final/` is current).
  Local logs, manifests and returned screenshots:
  `/private/tmp/markdown-copy-shortcuts-transfer-jhse7_gw/`.
  Final source archive SHA-256:
  `e9b82f801ebbd2d8b40f762be2c5f5a03bb9922068318fc71d35a08c2aed2f08`.
  Final evidence archive SHA-256:
  `72a0c9f9637dbf9bfb9cf93cad8cebe50062f9ee51b2cc661d448ed46f4af9de`.

Two local successful Home fixtures and two successful Air Home fixtures were
verified and reclaimed by the existing helper. The initial failed Air case's
synthetic fixture remains; negative/race Node artifacts and all diagnostic logs
stay in temporary evidence locations. No user documents or historical fixtures
were touched. No new cleanup framework or dependency installation.

Bounded Codex self-review found no unresolved P0/P1; it is not independent model
review. New view is 37 lines; Service/IPC are 256/298 lines. Existing entry and
shared E2E exceed the guideline but retain their lifecycle harness rather than
expanding into a refactor. Native IME NOT VERIFIED, historical manual/formal 1B-3
FAIL, SEC-01, supported-directory restrictions, `coordination-required` and
overwrite prohibition remain. No Reviewer call, push, merge, tag or release.


## 0.36.0 local WIP checkpoint (2026-11-04)

The approved short closeout preserves the confirmed-export actions before packaging.
All 20 candidate file fingerprints matched the final candidate manifest. Reused
174 distinct passing Node cases and the final Air Electron case above; no unrelated
test rerun. Bounded Codex self-review found no new blocking issue. Native Finder
and IME acceptance remain unverified; this is not release approval.

## 0.37.0 local Document app closeout (2026-11-04)

The trusted `document-app-main.js` starts the existing Document lifecycle via
`document-window-main.js`; the explicit synthetic entry remains a tiny wrapper.
Default dev and dedicated packaging now use the current Document UI. Main creates
a private cwd-bound temporary grant once before any Service/window/IPC, retaining
all existing save destination, identity, composition and no-overwrite protections.
Product test flags/MAS/non-mac modes are refused. Stable profile and single-instance
activation are separate from the existing, unchanged draft-backup location.
No File Store, Document Service, save policy or renderer edit logic changed here.

A local unsigned arm64 `Markdown.app` was installed at `~/Applications/Markdown.app`.
ASAR membership excludes the Vault/CM6/spike runtime and private/test/tool trees;
35 app files match the candidate. Shared production dependencies are still bundled.
All 528 installed entries match the build. ASAR SHA-256:
`7115e17cee6244971b0b53f2d8e201b5866f90e3831e63408f5bc65011eb10cd`.
Ordinary LaunchServices startup and the actual installed welcome window were
observed; no Terminal, Worktree-relative entry or external Electron is needed.
Source changes require a new build/install. No file-association registration,
signing, notarization, automatic updates or wider distribution is claimed.

Verification: 82 distinct focused Node cases PASS, with the 9 affected
entry/packaging cases rechecked after final config edits. Final Electron checks:
packaged exclusive export → readonly reopen → exit/recover plus single-instance
PASS; old demo stale-IPC and document export-shortcut cases 2/2 PASS; source-fixture
CRLF/LF entry cases 2/2 PASS. Original bytes/hash and verified export remain intact.
Native dialog choices/Finder invocation are controlled; these are not native IME
acceptance. An initial legacy test failed because the extracted lifecycle was not
invoked by the old direct entry. Explicit shared-module/entry separation fixed it;
the failure log is retained. A sandboxed diagnostic process could not launch and
was not counted as a product test. Historical manual/formal FAIL, SEC-01, native
IME NOT VERIFIED and release restrictions remain; no independent Reviewer ran.

Successful Home fixtures were identity-verified and reclaimed by the existing
helper. The two packaged runs' synthetic drafts were archived through the app,
not erased; original draft records were not changed. OS-temp evidence/scratch
remains. Durable small evidence:
original checkout `.local/verification/app-closeout-20261104/manifest.json`.
The unused original checkout `apps/desktop/dist` (0.18.0, 452,421,836 bytes) was
moved on the same filesystem into `.local/archives/retired-builds/20261104/dist`;
587 identities, permissions, symlink texts and file hashes match. Its sibling
`manifest.json` records the exact reverse mapping. No permanent deletion, branch
removal, worktree move, push, merge or tag. Earlier recovery archives remain intact.

Self-review is Codex local review, not an independent second-model review. New
runtime/build/test files are below 300 lines. The existing shared E2E file remains
2071 lines: only its fixture entry adapter changed, avoiding a broader test split.
This is a local WIP checkpoint, not full product or public-release acceptance.


## 0.37.1 dependency-gate repair for mainline integration (2026-11-04)

PR #138 initially failed production audit at 917f95e. This bounded follow-up
updates DOMPurify 3.4.14 → 3.4.17, KaTeX 0.16.47 → 0.19.1, Electron
43.4.1 → 43.8.7, brace-expansion within its existing 1/2/5 series and undici
within its existing 6/7 series. The existing DOMPurify override is updated; a
KaTeX `$katex` override applies the reviewed version to Mermaid and remark-math,
whose published ranges still select vulnerable 0.16.x. No editor framework,
File Store, source-map, draft, IPC or save-authorization code changes.

Upstream KaTeX 0.18 changes internal CSS class names; this project does not
select those internal classes. Its bundled CSS is regenerated together with JS.
0.19 changes strict callback warnings; project renderers already use
`strict: 'ignore'`. The final version avoids the deprecated 0.18.11 package.
References: [KaTeX advisory](https://github.com/advisories/GHSA-238p-pmpm-9mq7),
[KaTeX release](https://github.com/KaTeX/KaTeX/releases/tag/v0.19.0),
[DOMPurify release](https://github.com/cure53/DOMPurify/releases/tag/3.4.17).

New regression coverage rejects inherited KaTeX trust while checking ordinary
inline/display fractions and exponents; security floors cover nested locks.
Old dependencies: three failing security checks, including an actual rendered
link enabled by inherited trust. Final candidate: 91 focused Node cases PASS.
Both unchanged audit commands pass: production zero findings; complete tree
16 moderate findings, zero high/critical. No `audit fix --force`, downgrade,
ignore-list, threshold change or independent Reviewer call.

SEC-01 is not closed: legacy Toast UI's distributed bundle still embeds
DOMPurify 2.3.3; npm's package audit does not analyze that embedded code. The
current Document app excludes the legacy renderer bundle and does not load it.
The historical Vault runtime and wider release/security acceptance remain out
of scope, as do native IME NOT VERIFIED/manual-formal FAIL and in-place overwrite.
The installed 0.37.0 app is unchanged. Final CI/GUI evidence is recorded below.

Local verification also passed four packaging/entry Node checks (95 focused
cases total) and a second fresh vendor build: all 90 generated files matched
SHA-256. The generated Mermaid template strings retain upstream trailing
whitespace; handwritten-file `git diff --check` passes, generated bytes are
kept reproducible. The first three Electron attempts did not start because
the new Electron npm package requires explicit binary installation; these are
NOT RUN product checks, not product failures. Full CI and final Electron
results remain pending at this candidate commit.

CI run 41849088233 at cc581a5 passed every existing step: 2,823 Node tests,
2,821 pass / 2 existing skips / zero failures, both audits, generated assets and
unsigned 0.37.1 packaging with Electron 43.8.7. The local official binary download
failed and its alternate release download stalled. With explicit user approval,
the existing CI adds only three affected Electron checks (dependency rendering,
read-only open, confirmed export shortcuts) using the locked runtime; no
thresholds are relaxed. Results are pending in this follow-up commit.

CI run 41849928665 passed the full Node/audit/generated checks and two Document
Electron flows on 43.8.7. The new math smoke failed because its selector expected
`.katex-mfrac`, whereas the actual 0.19.1 output uses `.katex-html .mfrac`. The
MathML fraction/exponent assertions already passed. Corrected only that test
selector, retained all layout/font/security assertions, and reran the full CI.


### Final dependency CI and mainline integration (2026-11-04)

[CI 41850357782](https://github.com/liyunhui0707/Markdown-Editor/actions/runs/41850357782)
at final head `68f3e51b0bc23f63b283e9e5740c063989a41b14` passed every step:
2,821 Node passes / 2 existing skips / zero failures, three affected Electron
43.8.7 workflows, both unchanged audit gates, generated resources and unsigned
0.37.1 packaging. [PR #138](https://github.com/liyunhui0707/Markdown-Editor/pull/138)
merged preserving history as `0ccd941e500d60c438ac271942114153e9359ab9`.
Local main was fast-forwarded; five fully contained historical local branches
were removed with `git branch -d`, with SHA mapping retained in
`/private/tmp/markdown-dependency-fix-l0tz8snn/evidence/retired-branch-refs.json`.
Recovery checkout/history and remote historical branches remain. Sole remote is
`liyunhui0707/Markdown-Editor`; no second-account repository was updated.

## Individual document close V1 — source candidate (2026-11-04)

Uncommitted `feat/document-close` uses the existing phase1b3 Worktree, from the
merged main above. No new Worktree, framework, save policy, Reviewer or installed
app update. Version remains 0.37.1; propose 0.38.0 with a future approved feature
checkpoint. This is bounded automated acceptance, not full product release QA.

Header × and Cmd+W request closure of only the current main-owned session.
Read-only originals need no confirmation/write. Temporary copies offer Cancel or
Keep draft and close. Main checks owner, revision, resolved copy/save state and
latest exact-byte/token/identity/revision backup. It revokes only on success.
Empty untouched writing needs no body backup. Dirty/history status is not changed
to Saved; closing is explicit, and the dialog explains history/export-receipt loss.
Recovery restores confirmed body in a new independent session. No draft/file is
deleted or automatically archived. Other documents and their histories remain;
closing the last returns to welcome and clears its search and outline.

Renderer/preload reject composition, pending edits, retained unconfirmed recovery
and unknown IPC outcomes. Matched refusal releases only its live close fence;
revocation wins over cancellation. Lost/mismatched outcomes keep content fenced.
A refusal also carries the latest backup snapshot, fixing stale backup display
when backup completed while the confirmation was open. If disk revalidation
fails, mark the backup unverified and stop its automatic writes; retain both live
text/history and uncertain disk records. Whole-window close/quit guards remain.

Evidence in `/private/tmp/markdown-dependency-fix-l0tz8snn/evidence/`:

- `close-final-node-v2.tap`: 146 targeted Node cases PASS (close, IPC/preload,
  backups/drafts, find/outline/shell, launch and packaging policy). Earlier red
  tests reproduced missing cancellation backup state and stale backed-up status
  after disk mutation; fixes pass without weakening identity/content checks.
- `close-final-e2e.log`: readonly open, verified export/reopen and normal close
  passed. The negative close test initially assumed multiple keystrokes were a
  single Undo unit. Changed its additional edit to one character, retaining exact
  pre-edit body and Undo/Redo checks; this was a test assumption, not a close bug.
- `close-final-e2e-v2.log`: both close scenarios PASS. Cancel retains text/history;
  confirmed close restores exact draft content, removes stale find/outline, frees
  sessions and returns to welcome. Replaced backup directory refuses close, shows
  unconfirmed backup, retains editing/Undo and original bytes. Owned processes
  exit normally, with no watchdog or remaining child processes.
- Local GUI runtime is **43.4.1**, not matching-lock 43.8.7. The previous dependency
  CI passes on 43.8.7 do not cover this uncommitted feature. Dialog choices are
  stubbed; native Chinese IME, real native close confirmation and installed-build
  acceptance remain NOT VERIFIED. Historical formal/manual FAIL stays recorded.
- Successful Home export fixture `Writing-synthetic-rDwXKf` was identity/content
  checked and reclaimed by the existing helper. New close fixtures are OS-temp
  only; failed/uncertain backup-directory pairs remain together, including
  `document-close-failure-U8Zg0O/{drafts,drafts-moved}` under this run's macOS temp
  directory. No archived history, user drafts or user files were touched.

Local diff self-review found no unresolved P0/P1 within this change. It is not an
independent model review. Existing source-map/read-only/exclusive-create and
coordination-required protections remain. Known limits: no discard-without-backup
closure for nonempty writing, no automatic resolution of unknown IPC/create
outcomes, no recovery of old Undo/export authority. New policy/view modules are
small; keep the existing 303-line session dispatcher, 427-line renderer entry and
shared E2E harness rather than expand scope into lifecycle/test-framework refactors.


### Individual close — locked-runtime delivery candidate (2026-11-04)

The initial source candidate above is unchanged in runtime and tests. Only the
two version files advance to **0.38.0**, plus current documentation/evidence.
Dependency resolutions are identical to merged 0.37.1. No commit, push, merge,
tag, release or installation occurs; installed Markdown.app remains 0.37.0.

Evidence root: `/private/tmp/markdown-close-delivery-jt0d_z0y/`.

- Reuse the prior 146 targeted Node passes: all 17 runtime/test candidate hashes
  still match `close-candidate-sha256.json`. No unrelated Node suite is repeated.
- `evidence/e2e-43.8.7.log`: **5 PASS** on the exact locked Electron 43.8.7:
  sanitized dependency rendering, readonly opening, export/reopen shortcuts,
  close/cancel/recovery/welcome, and replaced-backup-directory refusal with
  continued editing/Undo. Original/export hashes remain unchanged; owned Electron
  processes exit normally without watchdog or remaining children. Dialog choices
  and Finder calls remain controlled; these are not native interaction passes.
- Air's existing runtime was 43.4.1. A bounded runtime fetch failed without
  transferring project code or changing its installed tools. Local official
  download timed out; the complete npm-mirror archive was accepted only after its
  SHA-256 matched the locked Electron package's checksum:
  `e09665902c46a648800b998e4271052a7819bd48ad02dc22d8c1452d248bfa09`.
  No persistent mirror setting or Worktree dependency installation changed.
- `evidence/package-v2.log` / `package-verification.json`: unsigned arm64 package
  **PASS**; manifest covers 430 source files; all 36 packaged project runtime
  files match their source. Version/Info.plist are 0.38.0, bundled Electron is
  43.8.7. No unexpected project/private entries. ASAR SHA-256:
  `8c3cc529c61c532bcb875a731c4b018d85206b71ca9ff8dec6cc1439916db683`.
  The initial build correctly refused an external dependency symlink. Rebuilding
  with a real APFS-cloned dependency copy passed without relaxing package policy.
- Real native close confirmation **NOT VERIFIED**. The first isolated harness
  timed out before an action; the retry could not operate its window because the
  native GUI pipe failed to start, then timed out. Preserve both logs/results;
  neither is a functional PASS or evidence of a close implementation failure.
  No permission/environment investigation follows. No current user window was
  operated. Native IME and historical formal/manual FAIL remain unchanged.
- Ordinary packaged GUI launch **NOT RUN**: this candidate has a fixed product
  profile, so launching it could open existing user drafts. The source GUI checks
  plus package byte/runtime verification do not substitute for installed QA or
  feature CI. The candidate stays at `package-v2/mac-arm64/Markdown.app`.
- Successful Home fixture `Writing-synthetic-PmOKZU` was verified and reclaimed
  by the existing helper. Failure pair `document-close-failure-z6qjGS/{drafts,
  drafts-moved}` stays together in the run's macOS temp directory. Native probe
  files remain under this evidence root. No historical/user files were cleaned.

The source/package candidate and precise checkpoint scope are prepared. No new
confirmed P0/P1 was found by bounded local self-review; this is not independent
review. Native close confirmation is an acceptance gap, so full stage/merge or
release readiness is not claimed. The next product slice remains ordinary
cross-paragraph editing after this closeout; overwrite stays coordination-blocked.


### Individual close — installed native follow-up (2026-11-05)

The user confirmed normal quit. Installation then moved the previous 0.37.0
bundle intact to rollback and moved the verified 0.38.0 candidate to
`~/Applications/Markdown.app`. All 528 file/mode/symlink entries match; ASAR remains
`8c3cc529c61c532bcb875a731c4b018d85206b71ca9ff8dec6cc1439916db683`.
Installation did not move/change the application draft profile. Rollback and
`RESTORE.md` are under original-checkout
`.local/verification/document-close-native-nge_4fs0/installation/`.

Installed GUI observations: ordinary welcome launch; synthetic `Native close QA`
input; Cmd+W displays the real Cancel / Keep draft and close prompt; welcome and
then a matching synthetic draft restore action/window were observed. The Cancel
attempt returned a stale-window/user-changed error. Subsequent stale AX/window
errors prevented reliable verification of Cancel and exact restored content.
These are **NOT VERIFIED**, not native PASS or a confirmed close-product bug.
The installed process remained alive when its window could not be located; no
forced quit or environment-permission investigation followed. Only the synthetic
draft was operated; existing unrelated draft bodies were not inspected.

Earlier isolated native harness failures remain in `attempt1-native-close-*` and
`native-close-*`: initial noncanonical test-root setup, then GUI wait timeout.
They are not functional PASS. The accepted 146 Node / five locked-runtime E2E
results stay recorded separately. `close-baseline/` preserves all 25 candidate
files and their hashes before the next feature. No Git checkpoint was made.

### Ordinary paragraph range editing V1 (2026-11-05, source candidate)

The approved next slice reuses `paragraphReplace` (formerly paragraph-paste),
Document Service, controller and main-owned revision/history. Replace/delete or
paste over up to 32 adjacent single-source-line plain paragraphs. Each splice
must match the existing paragraph separator, preserve full projection, and have
a byte-exact inverse. Undo may restore empty selection edges using main-owned
separator metadata; IPC still rejects renderer-supplied separator/leaf fields.
4096-unit insertion/removal and 131072-unit source bounds remain (UTF-16). Original BOM, final
newline, opaque blocks and all untouched bytes remain unchanged. No File Store,
save authorization, overwrite, dependency or visual-baseline change.

First real Electron range-input test failed despite mapper/controller passes:
Chromium's DOM-derived transaction extended beyond the selected paragraph range
and reparsed the neighboring opaque CRLF code block. The controller correctly
refused it. A narrow `document-paragraph-input.mjs` adapter now handles cancelable
insertText/selection-deletion before DOM mutation, only when DOM/PM/target ranges
agree. It dispatches through the same filter/controller; it does not bypass
mapping, read-only, input-state, revision or history checks. Composition, paste,
spellchecking and other input types retain their existing handlers.

Final evidence: original-checkout
`.local/verification/document-close-native-nge_4fs0/paragraph-range/`.

- `node-final.tap`: **205 PASS**, 0 fail/skip, Node 24.20.0. Exact range/inverse
  matrix covers 225 accepted combinations across LF/CRLF/CR, Unicode boundaries,
  source gaps, protected structures, size/count bounds, one-edit history,
  continuous typing/Enter/Backspace, stale/lost IPC and composition refusal.
- `e2e-final.log`: **3 PASS**, Electron 43.8.7. Backward DOM selection + Chinese
  text replacement, further typing, split/join, selected Backspace, multiline
  paste, protected-code refusal, subsequent safe editing, original/copy switching,
  exclusive test-copy creation and reopening after creator process exit. Both
  existing close regressions also pass; four clean child-process exits.
- Original SHA-256 `6ed39ccedd4523882ffa2a878a59e76d15f56f1477e1b4645cc2ef0a1a0a845c`;
  exported SHA-256 `635f61df4c29fee513842ccebb69ffe45a555679c3f8960520c049944391d5fd`.
  Original/export bytes include preserved BOM/CRLF. New file equals the confirmed
  revision; editing remains dirty and no original-file save authority is granted.
- `e2e-1.log` and `e2e-diagnostic.log` retain the browser failure; `e2e-2.log`
  records the first fixed pass. Test expectation for full-range deletion was
  corrected because the existing whitespace cursor slot supports exact recovery.
  Initial build invocation incorrectly treated native esbuild as JS; the corrected
  locked-dependency build passed. Neither setup issue is a product failure.
- Inputs and clipboard events are controlled; native open choices are stubbed.
  **Native IME NOT VERIFIED**, earlier manual/formal FAIL and SEC-01 remain.
  Cross-paragraph composition and Enter over an existing range are not enabled.
  Soft-wrapped/formatted/protected crossings and ambiguous separators remain refused.
- No Home test directories created. All new fixtures use OS temporary directories;
  successful new files and failed fixtures remain available with paths in logs.
  Backup replacement pairs remain intact as race evidence. No historical cleanup.

Bounded Codex local self-review found no new unresolved P0/P1; this is not an
independent model review. No Reviewer call, full CI, commit, push, merge, tag or
release. Installed 0.38.0 is the pre-range close candidate; the new range code and
rebuilt bundle are source-only. Version remains 0.38.0 pending a separate approved
checkpoint; a separate user-visible range checkpoint would propose 0.39.0.


### Paragraph range — 0.39.0 WIP package/install delivery (2026-11-05)

The user requested the next delivery step. Package and lock versions advance to
0.39.0 for the new user-visible range feature; runtime and existing Node tests
remain byte-identical to the 205-pass/three-E2E candidate. Only the existing
`e2e/document-app.spec.cjs` gains a packaged backward-range replacement and exact
Undo/Redo check before its established export/reopen/recovery sequence.

Evidence: original-checkout `.local/verification/paragraph-range-delivery-prbshom1/`.

- Offline unsigned arm64 build: PASS. All 432 snapshot files and 37 packaged
  project runtime files match; no private or unexpected project entries. Bundled
  Electron is 43.8.7. ASAR SHA-256:
  `fe83fd6b4998a4c3ef1bcb1082780395507edd7f4994f5d9042daf9caf456346`.
- One packaged Electron regression PASS (three clean product-process exits plus
  a clean single-instance invocation). Range replacement/Undo/Redo, further
  typing, exclusive export, duplicate refusal, readonly reopen and exact draft
  recovery after restart pass. Original SHA-256 remains
  `3b4794c601dd176241a594cdc8839874aba0122e96a8316a65bdf2d07589ddf0`;
  confirmed export is `e109cdbd262713535c424bb26e46e8d4200f89d9f78c6831b5592ae44a3a4978`.
- Installed `~/Applications/Markdown.app`: all 528 entries (bytes/modes/link
  text) verified. Installed welcome startup/version/appPath and normal exit PASS.
  Prior 0.38.0 retained under `installation/rollback/`; `installation/RESTORE.md`
  and manifests provide the exact mapping. Installation leaves user drafts alone.
- Only this test's synthetic draft was archived through the existing app API;
  its successful one-file Home fixture was reclaimed with an explicit cleanup
  receipt in `e2e.log`. Original synthetic input remains in the OS temporary
  test directory. Historical evidence and unrelated user data were not cleaned.
- Native dialog choices were stubbed; Chinese text injection is not native IME.
  Native IME, native close Cancel and complete physical-input acceptance remain
  NOT VERIFIED. Earlier formal/manual FAIL, SEC-01, unsupported range refusals,
  limited export destinations and coordination-required overwrite block remain.

No new product defect found in this delivery check. No full CI/reviewer rerun,
commit, push, merge, tag or release. The combined candidate is 32 files, index
empty; the pre-range 25-file baseline remains available for review/split decisions.
This installs a WIP for experience, not a complete feature or release sign-off.


### 0.39.0 local WIP checkpoint authorization (2026-11-05)

User approved the proposed sequence: preserve this delivered slice before mixed
plain/bold paragraph editing. All 32 candidate fingerprints match the prior
evidence; bounded local diff/readiness review found no new blocker to retaining
a WIP. Reuse 205 Node, three isolated Electron and one packaged workflow passes;
only current documentation is corrected before commit. Version remains 0.39.0.
Native IME, native close Cancel/full physical acceptance and release restrictions
remain open. This local checkpoint is not PR/merge/release readiness, and no
remote action is authorized or performed. The 25-file pre-range baseline remains
available; the combined checkpoint preserves the already installed candidate.


### Plain/bold selection editing — 0.40.0 WIP (2026-11-05)

Checkpoint `b12e2fdda8980319db6d76d3d261439257ed1e69` preserves the approved
32-file 0.39.0 candidate on `feat/document-close`; the worktree was clean after
commit. No push/merge/tag/release. The new feature below remains uncommitted.

Scope: in one ordinary, single-source-line paragraph containing plain/bold text,
replace/delete a selection or paste a single line. Starting text marks determine
replacement marks, independent of drag direction. Collapsed boundary insertion
uses left marks, matching ProseMirror. Delete whole plain/bold leaves and continue
typing. Existing adjacent plain-paragraph ranges remain supported. Cross-heading,
list, code, soft-line and formatted-paragraph ranges, multiline mixed paste and
structural cross-mark composition remain safely refused; no generic Markdown
conversion or mixed-paragraph split/join is added.

Implementation: a 55-line inline-token source mapper creates one minimal source
patch, reparses the whole projection and stores exact inverse bytes. Main IPC
reuses the existing format-patch history path, verifying before/after SHA-256 and
revision for Undo/Redo. Inverses/leaf/sourcePatch fields are not accepted from
renderer requests. The existing native-beforeinput adapter also captures matching
same-paragraph mixed selections before Chromium mutates DOM; composition, focus,
selection and session guards remain. Original sessions, file creation, destination
policy, metadata checks and coordination-required overwrite block are unchanged.

Evidence root: original checkout `.local/verification/inline-editing-5xh4vsiv/`.

- RED: five new source-mapping tests: four failed and one refusal test passed
  before implementation. Final targeted
  Node: **216 PASS**, no skips/failures (`node-regression-2.tap`). Covers source
  matrices for both bold delimiters, surrogate/structural refusals, real PM/main
  history, stale revision/lost acknowledgment recovery, session and close guards.
  Three old refusal expectations were narrowly updated for the newly allowed
  mixed edits; protected cross-block and untrusted-payload refusals remain tested.
- Controlled source Electron: **three distinct workflows PASS**, format/ordinary
  range plus mixed-range edit/export/reopen, six successful app-process exits.
  `e2e-1.log` retains an initial mixed test failure: an endpoint inside a readonly
  code block was clamped by the browser. The corrected test selects across the
  code to an editable tail and asserts actual PM selection before attempting the
  edit; whole-operation refusal and subsequent editing PASS in `e2e-2.log`.
  Source original SHA-256 stays
  `f6a5234bf79fba3f58a41db47fe693808d2b6186a7f803c8f7e59d5137e0ec34`;
  reopened export hash is
  `46ee4f726406e0b1a5442127609121d94b522fe59ff8092b15fc4017c38c6c94`.
- **One packaged workflow PASS** (`packaged-e2e.log`, `packaged-results/`): both
  plain-paragraph and mixed-inline replacement/Undo/Redo, continued typing,
  exclusive export, existing-target refusal, read-only reopen and exact draft
  recovery after restart; three clean launches and the single-instance invocation.
  Original SHA-256 remains
  `45266ca1e3b9bf6a6dbddacea4d5ce4c7087c7f39c65d1801daf00c208b6d9ca`;
  export is `030166d7e20cc32bcadc1552d1ea6fbd62326fadd47e4a77d6f750571ff755b8`.
- Offline unsigned arm64 package, Electron 43.8.7: 434 source snapshot files and
  38 packaged project runtime files match; no unexpected/private project entries.
  ASAR SHA-256 `6783701456909c181ac9241782f182fa0a39282f2522f43b8f9edb79679cf0cf`.
  Version/package-lock/Info.plist are 0.40.0 for this user-visible feature.
- Installed `~/Applications/Markdown.app`: all 528 bundle entries verified.
  Welcome startup, installed path/version and normal exit PASS. Old 0.39.0 is
  intact under `installation/rollback/Markdown-0.39.0.app`; manifests and
  `installation/RESTORE.md` record recovery. User draft storage is not moved.
- Successful Home fixtures `Writing-synthetic-E2E-NFKPt1` (format regression)
  and `Writing-synthetic-E2E-9TxbEQ` (packaged test) were verified/reclaimed by the
  existing helper. Only the packaged test's own synthetic draft was archived via
  the existing API. OS-temp originals, source exports and initial failed-test
  evidence remain; no historical/user files were cleaned.

Bounded Codex self-review: no new confirmed unresolved P0/P1; not an independent
second-model review. Test runner/renderer input and native dialog choices were
controlled; this is not native IME or human acceptance. Native IME, native close
Cancel, complete physical-input acceptance, historical formal/manual FAIL and
SEC-01 remain scoped/open. Full CI/Air/Reviewer NOT RUN; no new remote action.
Next suggested slice is paragraph/simple-list boundaries, not overwrite saving
or a visual redesign. This delivery is a local WIP, not full feature sign-off.


### Paragraph/list boundaries — 0.41.0 WIP (2026-11-05)

The user approved the next continuous-writing slice. The prior uncommitted
0.40.0 candidate's 20 files and all baseline fingerprints were checked before
work; its snapshot remains unchanged at `.local/verification/inline-editing-5xh4vsiv/`
in the original checkout. New evidence: `.local/verification/writing-boundaries-m8g4d1zg/`.

Supported collapsed-caret actions: split/join plain/bold paragraphs and flat tight
list items; first-item Backspace lifts only that item to a paragraph; first/last
empty-item Enter exits; the format selector starts a list from an empty paragraph
when the resulting source reprojects exactly. Mid-list empty exit is refused:
blank whitespace alone parses as one loose list, not two lists plus an empty
paragraph. No hidden markers or silently altered neighboring structure are added.
Code, headings, soft lines, nested/task/loose lists and ambiguous gaps remain
protected. Cross-format composition is still paused/refused, not force-committed.

`document-boundary-edit.mjs` (114 lines) owns only these source patches. The
existing `format` command/controller/main history/revision/hash gates are reused.
Every result must match the expected full projection and exact inverse bytes;
32-item, 4096-unit patch and 131072-unit source limits remain. The source command
mapper becomes 90 lines; format keys 65; the 430-line renderer only moves native
Backspace selection synchronization before the format command dispatch. Existing
large tests retain their shared harness (controller 989, boundary 116, E2E 2374/150).

- RED: initial 13 boundary tests: 12 FAIL / one safe-refusal PASS. Final regression
  `node-regression-1.tap`: 236 PASS. One extra capacity case was then added; its
  first fixture equaled the permitted size, not an overflow. Corrected exact-limit
  success/overflow refusal checks pass in `node-limits-final.tap` (16 boundary
  tests). Total distinct tests: **237 PASS**, no final skips/failures. No runtime
  change was made for that fixture correction.
- `e2e.log`: **four source Electron workflows PASS**, eight clean app exits,
  covering new keyboard boundaries, prior formatting and both range features.
  New original SHA-256 remains
  `7560f7eea1e595105450effa80e5efef08887c9303e1681d0e20d710983dc2a7`;
  exact export/reopen SHA-256 is
  `7616cac1a63632a28b4c957cc5b8fa7c93c189fc31c6271063dc9ff2c875b90d`.
- `packaged-e2e.log`: **one actual ASAR workflow PASS**, three clean launches and
  single-instance exit. Paragraph/list Enter/Backspace, original/range Undo/Redo,
  exclusive export, existing-target refusal, readonly reopen and restart/draft
  recovery pass. Original hash remains
  `45266ca1e3b9bf6a6dbddacea4d5ce4c7087c7f39c65d1801daf00c208b6d9ca`;
  export hash `b9057e44faa080a859f20faaf3bb9a5960d8dbe10845f6640444ea13e1456012`.
- Offline unsigned arm64/Electron 43.8.7 packaging: 436 source and 39 packaged
  runtime files match; no unexpected/private project entries. ASAR SHA-256:
  `5115683609e9169c85336b47b1420c3774a27498462ad60805f00976cd2f649a`.
  Version/package-lock/Info.plist are 0.41.0. Installed startup and normal exit PASS;
  all 528 bundle entries match. Preserve 0.40.0 under `installation/rollback/`;
  `installation/RESTORE.md` and manifests record recovery, without moving drafts.
- Successful Home fixtures `Writing-synthetic-E2E-JTkQD8` and
  `Writing-synthetic-E2E-r7FgTE` were verified/reclaimed by the existing helper.
  Only the packaged test's own synthetic draft was archived via the app API.
  OS-temp inputs/exports and verification logs remain; no historical/user cleanup.

Bounded Codex self-review found no new confirmed unresolved P0/P1; this is not an
independent model review. Native dialogs were stubbed; controlled input is not
native IME. Native IME, native close Cancel/full physical QA, historical formal/
manual FAIL and SEC-01 remain scoped/open. Full CI, Air and Reviewer NOT RUN.
Original readonly/exclusive create/Not saved semantics, destination restrictions
and coordination-required overwrite protection remain unchanged. Both the 0.40
and 0.41 feature slices are uncommitted on `feat/document-close`, HEAD `b12e2fd`;
no new Git checkpoint, push, merge, tag or release.


### 0.41.0 local WIP checkpoint closeout (2026-11-05)

User approved continuing the proposed closeout/checkpoint sequence. All 25
candidate hashes match the delivered version before documentation-only status
updates; runtime, tests, generated bundle, package and lock remain unchanged.
The installed ASAR still matches the recorded 0.41.0 hash. Bounded Codex local
review found no new confirmed unresolved P0/P1; this is not independent review.
Reuse 237 distinct focused Node, four source Electron workflows, one packaged
workflow and installed startup passes. No unrelated tests or GUI runs repeated.
Version remains 0.41.0. Both writing slices form one coherent WIP checkpoint on
`feat/document-close`; exact scope and evidence mapping are in original checkout
`.local/verification/writing-checkpoint-20261105/`. Native IME, native close Cancel,
full physical/manual acceptance and historical formal failures remain open.
Original files stay read-only, new-file creation remains exclusive, and overwrite
is still blocked by `coordination-required`. No push/merge/tag/release or Reviewer.

### Single-list-item selection editing V1 (2026-11-05, 0.42.0 uncommitted)

Baseline `ca5d927` / 0.41.0 was clean. Extend the existing inline source mapper
to one projected simple-list item and preserve whole-document projection checks,
revision authorization and main-owned inverse history. Plain/bold selections can
be replaced, deleted or pasted over with one line. Unmodified list markers,
numbering, BOM, LF/CRLF/CR and surrounding blocks stay byte-exact. A rejected or
uncertain request retains the existing recovery behavior; no retry is invented.

Regression exposed stale ProseMirror bold marks after deleting all text in an
all-bold item. Clear stored marks only after a validated deletion produces an
empty list paragraph; further typing is plain and Undo restores original bytes.
Cross-item selection, multiline list paste, nested/task/loose lists and source
forms that cannot represent the requested projection remain safely refused.
For example an intraword `__` boundary is not silently rewritten to `**`.

267 focused Node tests PASS, including forward/reverse ranges, full deletion,
continued typing, Undo/Redo, Unicode, three newline styles, refusal, composition
gates and stale/lost IPC recovery. Four source Electron workflows PASS: list-item
ranges plus existing paragraph ranges, mixed ranges and boundary keys. One real
packaged-app workflow PASS covers list paste/Undo/Redo, export, target-exists
refusal, readonly reopen and restart/draft recovery. Native dialog choices and
clipboard are controlled. Installed welcome startup PASS with normal process exit;
no user document opened. 437 source files match the tested snapshot; 39 packaged
runtime files and all 528 installed entries match. Installed ASAR SHA-256:
`c8d89aac942484baf6c9dce4ac2c5b5dd67b0c800d48d28614990fc5526c999e`.
The exact old 0.41.0 app is retained in this run's `installation/rollback/`;
recovery mapping and manifests are in `installation/`. No user draft migration.

Evidence: original checkout `.local/verification/list-item-editing-d4it3xn4/`,
including source hashes, Node/Electron logs, screenshot and packaged evidence.
New source workflow original SHA-256
`b903de0176ecb63b0e802604f7751d604191fb3843f5ae62727ce798a6d60671`
remains unchanged; exported SHA-256
`4ea6389835185de7636671b415db677d2299646067e850bbc2acf7cdab97f710`
matches intended content after exit/reopen. The packaged successful Home fixture
was verified and removed by the existing fixture helper; failed/unknown historical
artifacts were not touched. Temporary evidence and isolated drafts are retained.

Codex bounded diff self-review found no new blocker; it is not independent review.
Initial sandbox GUI launch was blocked by environment; the permitted isolated run
passed. Native IME, native close Cancel/full physical QA, prior formal/manual FAIL
and SEC-01 remain open/scoped. Full CI, Air and external Reviewer NOT RUN.
Original readonly, exclusive new-file export, Not saved, destination restrictions
and coordination-required overwrite protection are unchanged. No Git checkpoint,
push, merge, tag or release in this feature task.


### Adjacent list-item selection editing V1 (2026-11-05, 0.43.0 uncommitted)

The preceding 19-file 0.42.0 candidate matched its recorded hashes; HEAD remains
`ca5d927`. Extend its existing source mapper to adjacent items in one projected
flat/tight list. A verified splice merges selected items while preserving unselected
text, marks, untouched source bytes and surrounding blocks. Exact main-owned
inverse patches retain original numbering and delimiters; no renderer source-patch
permission or File Store change. Multi-item deletion retains one empty item, using
an exact text-range transaction instead of PM's expanding deleteSelection heuristic.
Replacement at an item's end follows PM marksAcross and starts plain.

Confirmed new boundary defect: in real Electron, a selection extending into a
readonly code block had PM/DOM positions [10,46], while beforeinput targetRanges
reported [10,44]. The old mismatch path returned false, allowing Chromium's partial
replacement to continue. Now a verified PM/DOM selection with a mismatched or
unreadable target is cancelled before mutation with an explicit message. Regression
checks unchanged source/revision, no edit IPC and subsequent safe editing. No IME
state timeout/forced completion was added. This is not a native IME acceptance claim.

301 focused Node tests PASS: forward/reverse ranges, plain/bold/Unicode, three
newline styles, markers/numbering, empty edges, all-item deletion, 32-item and size
bounds, exact Undo/Redo, continued split/join, stale/lost acknowledgments and atomic
refusal. Four controlled source Electron workflows PASS on the final code, including
whole-list Backspace and Delete, clipboard refusals, protected-range refusal,
original/copy switching and export/reopen. One actual packaged workflow PASS with
cross-item replacement/Undo/Redo, exclusive create, target-exists refusal, readonly
reopen and restart/draft recovery. Native dialogs and clipboard were controlled.
Installed welcome startup PASS with normal exit and no user document opened.
438 source files and 39 packaged runtime files match the tested snapshot; all
528 installed entries verified. ASAR SHA-256:
`38016a24682070085e07cda89dc12f2c1b31fdab39ee71096d35ca2c0fe0284c`.
Exact 0.42.0 rollback and recovery mapping are in this run's `installation/`.
No new user/manual/native-IME acceptance.

Evidence: original checkout `.local/verification/list-cross-editing-x0zabrwi/`.
Original synthetic SHA-256 remains
`b903de0176ecb63b0e802604f7751d604191fb3843f5ae62727ce798a6d60671`;
new export SHA-256
`dc351e38112ede3a6563c35f41d45f8efa1d521b313fe64e2be7ff3daf41fe84`
matched content after exit/reopen. The successful packaged Home fixture
`Writing-synthetic-E2E-zB0meg` was verified and removed by the existing helper;
isolated source fixtures, failed-run evidence and the synthetic archived draft are
retained. No historical archive, protected Home fixture or user document touched.

Codex bounded self-review found no new unresolved blocker; not independent review.
Full CI, Air and external Reviewer NOT RUN. Native IME, full physical QA, native
close Cancel, SEC-01 and earlier formal/manual failures remain open/scoped.
Source originals stay readonly, export stays exclusive, editing copies stay Not
saved, and overwrite stays blocked by coordination-required. Prior work preserved;
no commit, push, merge, tag or release in this feature task.


### List selection editing local WIP closeout (2026-11-05, 0.43.0)

The user authorized a local WIP checkpoint before italic editing. All 21 candidate
files match the previous final fingerprints; reuse 301 focused Node, four source
Electron and one packaged workflow plus installed welcome PASS. No code/test or
version changes are needed for closeout. Codex readiness self-check found no new
blocker or unrelated files; this is not independent review. Native IME, full
physical QA, SEC-01, prior formal/manual failures and release acceptance remain
open/scoped. Existing-file overwrite remains coordination-required. Full CI and
Air are NOT RUN; no push, merge, tag or release is authorized by this checkpoint.


### Selected italic editing V1 (2026-11-05, 0.44.0 uncommitted)

User authorized the local 0.43.0 checkpoint followed by italic editing. Commit
`01a4d7a` contains the prior 21 verified files; worktree was clean afterward.
This candidate reuses source projection, bounded format/range/boundary mappers,
the existing toolbar and main-owned revision/history. Add `I` / Cmd+I; preserve
existing `*` or `_` delimiters, BOM, line endings and unmodified bytes. One plain
leaf may become italic; cancellation requires its entire italic leaf. Nested
bold/italic, partial unformatting, links, soft-wrapped emphasis and complex blocks
remain protected. No session/IPC authority or File Store/save path change.

A controlled PM test reproduced a cleared paragraph retaining deleted italic
stored marks, rejecting subsequent plain input. Extend the existing verified
empty-list-item reset to empty paragraphs; source is already empty when marks
are cleared. No composition state bypass, timeout or forced editable change.

RED/GREEN evidence: new format/projection tests fail on baseline; 323 focused
Node tests pass after implementation, including PM comparison, Unicode, newline
variants, inverse bytes, stale/lost formatting acknowledgments and guards.
Four controlled source Electron cases pass: new italic workflow and existing
mixed ranges, list ranges and writing boundaries. Eight clean child exits, no
watchdog/fault/remaining process. Toolbar/shortcut, typing, deletion/retyping,
paste, split/join, original/copy switching, export and fresh-process readonly
reopen pass. Original SHA-256 stays
`15b5e7dd41a589e9ae2a184fe65505d780f3278bbd6742b74eb6e332180f27cf`;
export SHA-256 is
`227aef70b7d47e64e11213ab8cc346f43fdd44a166b592a7311bbfb4434e5a28`.

Evidence: original checkout `.local/verification/italic-editing-fle6dgai/`.
Dialogs and clipboard are controlled; Chinese test strings are NOT native IME.
Codex bounded diff self-review found no new unresolved blocker; not independent
review. Native IME, full physical acceptance, native close Cancel, SEC-01 and
historical formal/manual failures remain open/scoped. Full CI, Air and external
Reviewer NOT RUN. Original readonly, exclusive new-file export, Not saved and
coordination-required stay unchanged. Source fixtures/evidence stay isolated;
no historical archive or user document cleanup. No new feature commit or remote
action beyond the explicitly authorized preceding 0.43.0 local checkpoint.


Packaged follow-up: one actual 0.44.0 ASAR workflow PASS, including italic
button/Cmd+I, Undo, exclusive export, target-exists refusal, read-only reopen,
restart/draft recovery and single-instance behavior. Installed welcome startup
PASS with clean exit. 439 app source files, 39 packaged runtime files and all 528
installed entries match. Installed ASAR SHA-256:
`aa40c47f08ce40b03a56c914f1dca108b7630f37b4f47200b6d3c612c57a7c47`.
0.43.0 rollback and recovery instructions are in this run's `installation/`.
The successful Home fixture `Writing-synthetic-E2E-oSjl5M` (one known file) was
verified and removed by the existing helper; synthetic draft archived through
the existing API. User documents/drafts and historical fixtures were not cleaned.

### Inline code editing V1 (2026-11-05, 0.45.0 uncommitted)

Add `</>` / Cmd+E using the existing format command and main-owned history. Exact
single-backtick code is projected in ordinary paragraphs, headings and flat list
items; code content stays literal. Multi-backtick, padding-normalized, multiline,
nested marks and fenced blocks remain protected. Full-span unformatting only;
operations that would change Markdown structure are refused atomically. Plain,
bold, italic and code marks remain distinct across range edits and split/join.
A small shared exact-leaf projector removes duplicate paragraph/list logic.
Original bytes, BOM/newlines and untouched regions are retained; inverse patches
restore exact bytes. No session authorization, File Store, overwrite or export
policy change. Not saved and coordination-required remain in effect.

RED/GREEN: 15 new cases fail before implementation. 340 targeted Node tests PASS,
including real PM selection comparisons, Unicode, newline styles, exact inverses,
code delimiters, protected structures, toolbar/composition/readonly guards and
lost format acknowledgements. Two source Electron workflows PASS (italic and
inline code); four clean exits, no watchdog/fault/residual. Actual 0.45.0 packaged
workflow PASS: code button/Cmd+E, Undo, export, existing-target refusal, readonly
reopen, restart/draft recovery and single-instance behavior. Only synthetic data;
dialog choices/clipboard are controlled. NOT native IME acceptance.
Original source SHA-256: 06413d186bfac95466d75ef56e1b7502f825a47350a5b9e5b335c7d9322004e7.
Export SHA-256: eaf4816e062b725a160ac4ef73064e0b2067fd2aff6f92262b44142f893fba2c.
Evidence: original checkout `.local/verification/inline-code-wdharfpn/`.
The successful Home fixture Writing-synthetic-E2E-t42w49 was identity-checked and
removed by the existing helper; only its synthetic draft was archived via app API.
Temporary source fixtures and evidence retained; no historical cleanup.

Air SSH identity and Node 24.20.0 match, but CGSSessionScreenIsLocked=Yes was
observed: GUI BLOCKED; no package sent or GUI launched there. First sandboxed Pro
launch was blocked; the scoped approved Pro launch passed. Codex limited diff
self-review finds no new unresolved blocker; this is not independent review.
DeepSeek was not invoked (no changed file-writing/authority path); full CI,
native IME/full physical QA remain NOT RUN/NOT VERIFIED. Historical manual and
formal failures, SEC-01, native close Cancel and release restrictions remain.
No commit, push, merge, tag or release. Prior 0.44.0 uncommitted work preserved.
Core helpers remain below 300 lines; controller tests 1148 and shared E2E 2554
reuse the established harness without an unrelated test-framework refactor.


Air follow-up after the user's explicit unlock: two source Electron workflows
PASS in 3.8s with Node 24.20.0 / Electron 43.8.7, macOS 26.6.2 arm64. Four exits 0,
no watchdog/fault/residual. Original/export hashes equal the Pro evidence above.
47 exact project files plus private dependency/runtime copies; 19,957 manifest
entries verified before and after. No installs, system settings or real documents.
Runtime/profile/synthetic files stay in the private run directory, not Home top
level. Input tar SHA-256:
4c9c660374e3ba0f27f2039b6f627011c26af9308ff1e678aded3710763eef11.
Retrieved evidence archive SHA-256:
050d09dff68e271b6b07733575db0f9f955f0f65ea0242785a9648c38727b16b.
Screenshots from both hosts inspected; toolbar/layout remains the visual baseline.
Remote run: ~/Library/Application Support/personal-device-ops/air-testing/runs/markdown-inline-code-wdharfpn/.

Installed 0.45.0 welcome startup PASS, clean exit; 441 source files, 40 packaged
runtime files and 528 installed bundle entries match. ASAR SHA-256:
e468e5ff0802b95dc2b4c1a9b1ea741261daead527279b1898de2cae25a36715.
Exact 0.44.0 rollback is in this run's installation/rollback with RESTORE.md.
No user drafts moved or changed during installation. Controlled dialogs and
Chinese strings remain distinct from native IME/manual acceptance.


### Existing link text V1 (2026-11-05, 0.46.0 uncommitted)

Edit the display text of existing single-line inline links in ordinary paragraphs,
ATX headings and simple flat list items. Exact source-leaf splices preserve target,
title, delimiters, BOM/newlines and untouched regions. Full-label nonempty
replacement and single-line paste are supported; exact main-owned history and
session/readonly protections are reused. No File Store, writer, IPC payload or
save authorization change; overwrite remains coordination-required.

A small shared Tiptap configuration replaces the default active link extension
with an inert span mark. URLs are data attributes, never href/event handlers;
no automatic linking, URL navigation or remote content loading. Even an existing
javascript/data target stays inert. No new URL insertion or address editing UI.
Empty/full-label deletion, cross-span operations in a link-containing paragraph
or item, link+format nesting, references/autolinks/normalized labels and
split/join of link-containing paragraphs/items remain refused. Safe text input
in other leaves/paragraphs continues after refusal. Existing block conversions
retain link syntax, with exact inverse validation.

Evidence under original checkout `.local/verification/link-text-ic_ubf51/`:
- RED: 14 new projection/source tests fail on the previous candidate.
- GREEN: 360 focused Node PASS, including actual PM-schema comparison, LF/CRLF/CR,
  Unicode boundaries, target/title byte preservation, exact inverses, controlled
  composition, IPC response loss/recovery, session and close regressions.
- Two Pro source Electron workflows PASS (existing code, new link labels), four
  clean successful exits; no watchdog/fault/residual. Initial link E2E expected
  one Undo to undo five individually typed characters; corrected the test to
  use one explicit insertion. The failed synthetic run is retained as evidence.
- Packaged Electron PASS: label editing, Undo/Redo, exclusive export, existing
  target refusal, readonly reopening, restart/draft recovery, single instance.
- Original synthetic SHA-256:
  01308780293a346d96e648e548da883b73da46ac1feb9c4f83390d411c8d0904.
  Export SHA-256:
  1d25699c0cdf82ed34229d59a0e60d12a3c0207549566e375473963b9ce03886.
  Original mode 0400 and bytes verified unchanged. Screenshot visually checked.
- Successful Home fixture Writing-synthetic-E2E-AWkrtt was identity-checked and
  removed by the existing helper; only its synthetic draft was archived by the
  application API. Temporary fixtures retained; no historical cleanup.

Codex bounded diff self-review: no new unresolved blocker found; this is not
independent model review. No DeepSeek/Air/full CI this slice. Native IME/manual
acceptance remains NOT VERIFIED; historical formal/manual FAIL, SEC-01 and release
limits are not globally cleared. No commit/push/merge/tag/release. The preceding
0.44/0.45 work is retained. Entry 432, controller test 1168, shared E2E 2610 lines
reuse current ownership/harness; the new configuration is 20 lines and source
mapping helpers remain below 300. No unrelated framework refactor.

Installed 0.46.0 welcome startup PASS with a clean exit and no user document
opened. 443 app source files, 41 packaged project runtime files and 528 installed
bundle entries match; independently rebuilt renderer bundle is byte-identical.
ASAR SHA-256:
f977c27757010de7fa9dff0b3c6c9da6d8dd9d17c2229648004fa5a542a9b106.
Exact 0.45.0 rollback and restore instructions are retained in this run's
installation/rollback and installation/RESTORE.md. Installation moved no drafts.


### Heading/list typing workflow (2026-11-05, 0.47.0 uncommitted)

User feedback exposed a core authoring gap: a bare `#` in a new draft was refused.
Deliver a coherent typing workflow instead of a separate mini-stage per format.
Bare `#`…`######`, bullet markers and numeric markers remain visible until Space.
Space uses a main-validated format command and synchronous optimistic PM update,
queued with subsequent text edits under the existing session/revision/history
owner. Exact source patch, expected projection and inverse checks remain in force;
no whole-document Markdown serializer, file-write policy or IPC payload expansion.
Heading levels 4–6 are enabled in the existing menu. Empty headings accept text,
Enter returns to a paragraph and Backspace at a heading start removes the format.
A bare marker on read-only open is displayed literally without rewriting bytes.

Evidence: original checkout `.local/verification/block-input-lrhucw93/`.
- RED: new cases reproduce prior prefix/shortcut/empty-heading failures.
- GREEN: 378 targeted Node cases pass together; final focused run passes 19
  shortcut cases including 3 added numeric boundaries (381 unique total).
- Two Pro source Electron workflows PASS: new blank-draft heading/list/continuous
  typing/Undo/Redo/export/exit/reopen, and existing link-text protection regression.
  Controlled dialogs/Chinese insertions do not establish native IME acceptance.
- Export bytes and SHA-256 match; reopened documents are read-only. Existing
  link regression verifies original bytes and mode 0400 remain unchanged.
- Package content, source hashes, version and Electron runtime checked. The
  current installed 0.46.0 process remains running; no replacement, packaged
  product GUI launch or installed-app acceptance is claimed for this candidate.
- All new GUI fixtures are isolated temporary synthetic data. No new Home
  fixture, historical cleanup, remote transfer or user-document access.

Bounded Codex self-review found no unresolved blocking finding in this slice;
not an independent model review. Native IME NOT VERIFIED; historical formal QA
FAIL, SEC-01, unrestricted saving and public-release gates remain open. Task
lists, nested lists/marks, quotes/fences and automatic inline syntax are not added.
No commit/push/merge/tag/release. Existing 0.43–0.46 candidate work is preserved.

### Link creation and address editing workflow (2026-11-05, 0.48.0 uncommitted)

The link toolbar / Cmd+K opens one panel for a plain selection/caret or an
existing simple inline link. Insert, edit label/address, Cancel/Escape and remove
link while retaining text are implemented together with main-owned Undo/Redo.
Supported hosts are plain paragraphs, headings and simple flat list items.
Cross-leaf/cross-block ranges, nested marks, references and title editing remain
outside scope. Labels are bounded to 512 UTF-16 units and addresses to 2048;
only plain single-line labels and validated http(s), mailto, relative/fragment
targets are accepted. No automatic linking, URL navigation or resource loading.

`set-link` / `remove-link` reuse the existing format command, source range,
expected projection and exact inverse. Main accepts only the additional
label/href fields for format requests and rechecks sender, session, readonly
status and revision. Source coordinates, paths and authority cannot be supplied
by this panel. Unchanged addresses, existing titles, BOM/newlines and surrounding
source retain their bytes. Explicit address edits replace only that target.
File Store/save authorization and coordination-required are unchanged.

The panel captures the current session/revision and keeps form input on refusal.
Pending/composing/recovery states block application; Escape returns focus and the
original selection when still valid. A stale main revision reconciles through
the existing controller without retrying the edit. A lost successful response is
also reconciled without replay; Undo remains owned by main.

Evidence: original checkout `.local/verification/link-panel-owz9kpw6/`.
- RED: new source tests reproduce missing create/address/remove behavior on
  the preceding candidate. GREEN: 399 focused Node cases PASS, including source
  inverses across LF/CRLF/CR, payload rejection, readonly/session/revision gates,
  dropped-response recovery and existing heading/list/inline/close regressions.
- Three Pro source Electron workflows PASS: new complete link panel plus link
  text and heading/list typing regressions. Six clean successful exits, no
  watchdog/fault/residual. Screenshot inspected against the visual baseline.
- New link workflow covers reversed selection, invalid URL refusal, controlled
  input composition, Escape, address/title preservation, remove/Undo/Redo,
  stale revision with retained form input, continued plain editing, inert links,
  exclusive export and a fresh-process readonly reopen.
- Original synthetic SHA-256:
  224525817f2f9029e153343a3e2f57852daf7858a9141e12c4c964cfd94a843a.
  Export SHA-256:
  2b7c00e6385a4d75ce7c04edafed2aee80f127a8fa4d26d031786443864994c1.
  Original bytes and mode 0400 remain unchanged.
- Fixtures are isolated temporary synthetic data; no new Home directory, user
  document access, remote transfer or historical cleanup. Logs retain paths.

Bounded Codex diff self-review found no new unresolved blocker in this slice;
this is not independent review. No DeepSeek/Air/full CI this batch. Native IME
remains NOT VERIFIED; historical manual FAIL and SEC-01/release gates remain
open. Current installed 0.46.0 is running and is not stopped/replaced; installed
and packaged-product GUI acceptance of this candidate remain pending. No Git
commit/push/merge/tag/release. The next coherent authoring package is quotes and
basic fenced code, with create/edit/exit/Undo/export/reopen as one workflow.

Unsigned candidate package verification PASS: 448 app source fingerprints,
44 packaged project runtime files and 10,357 ASAR entries checked; no private or
unexpected project entries. Renderer rebuild is byte-identical. Package/plist
version 0.48.0 and bundled arm64 Electron 43.8.7 match. ASAR SHA-256:
ddb5243a7b8116e9e5c5cbd2bdc353a15efc5baed594af980644b3a6c93d263e.
The existing installed 0.46.0 bundle and its active process were left untouched.


### Quote/code writing workflow — 0.49.0 candidate (2026-11-06)

The preceding accumulated inline work is preserved by user-authorized local commit
`dd0eef475ce92480f312235f9f0225fa79382628` (0.48.0, 42 files). No push/merge/tag.
This new batch is uncommitted. It adds quote and closed basic-code creation from
menu/natural prefixes, text editing, plain quote split/join, code Enter/Tab and
multiline paste, Cmd+Enter exit to prose, main history and export/reopen. Source
ranges retain quote markers, fences/language, BOM and existing LF/CRLF/CR bytes.
Only code display normalizes newline positions; writing patches exact raw ranges.
The existing source gate rechecks full expected projection and bounded patches.
Opaque code-shaped nodes default to noneditable; a forged editable attribute is
rejected by controller/source validation. No File Store, save authority, renderer
path or original readonly policy changes; `coordination-required` stays in force.

Evidence: original checkout `.local/verification/quote-code-gxkzlu3u/`.
- RED source tests exposed missing quote/code behavior. A real controller regression
  exposed invalid redo caret coordinates after code paste; fixed by returning PM
  selection with the exact source inverse. LF/CRLF history tests now cover it.
- 383 unique targeted Node cases PASS across mapping, format, controller, session
  and history; includes delayed commands, dropped acknowledgements without replay,
  composition guards, surrogate safety, fence escape and opaque-attribute refusal.
- Five source Electron workflows PASS: quote/code creation/history/export/reopen,
  loaded CRLF quote/code edits and rejection/continued editing, plus existing
  heading/list, link-panel and protected-block formatting regressions. Nine clean exits, no watchdog/fault/
  residual. Screenshot inspected against the accepted writing workspace.
- Synthetic original BOM/CRLF bytes and mode 0400 unchanged. Creation export hash:
  262265c1be46b7f7423be21a20c51ac23388f5c9e96ee21ecdde944de9ce1f18.
  Loaded-code export hash:
  4ad622fd7ed7a2058f456a4e1c5b345248cb83d141b8200e00e02b550cbf3d78.
  Fresh-process reopen verifies the creation export. Dialog paths are controlled
  test substitutions; clipboard and composition checks are not native IME QA.
- New quote/code fixtures live in isolated system temporary directories. The
  existing protected-block regression created one Home fixture and successfully
  reclaimed it with its identity-checked helper (Writing-synthetic-E2E-MUjG0M, one
  file). No archived/user data was touched. Logs retain exact evidence paths.

Limits: explicit single-level quote paragraphs only, no lazy/wrapped/nested quotes
or splitting marked quote text. Fences must be closed, unindented, 3–16 markers,
with optional simple language (up to 32 characters), no metadata. Mixed line endings
inside a block, cross-block selections, code execution and highlighting remain
unsupported. Code-to-prose conversion accepts one line; Cmd+Enter exits multiline
code without changing it. No general Markdown acceptance is claimed.

Bounded Codex self-review found no unresolved blocker in this batch; this is not
independent review. Air/DeepSeek/full CI/native IME were not run. Native IME remains
NOT VERIFIED, historical manual QA FAIL is not globally cleared, SEC-01 and other
release limits remain. Installed 0.46.0 is not stopped or replaced. Installed and
packaged-product GUI acceptance remain pending; no new Git commit is authorized.

The outline regression now uses the actual editor schema and recognizes supported
link headings; its old minimal schema predated link support. Find/outline 16 cases
PASS. The older opaque-code fixture now has unsupported fence metadata, preserving
its protection assertion while basic closed fences are intentionally editable.

Unsigned candidate package verification PASS: 451 app source fingerprints,
46 packaged project runtime files and 10,359 ASAR entries checked. No private or
unexpected project entries. Renderer rebuild is byte-identical; package/plist
0.49.0 and bundled arm64 Electron 43.8.7 match. ASAR SHA-256:
89bb7ebb3415d77493cbb2bad3affb98eb5e20fda97b300048f42cbef91e10b3.
The installed application is unchanged. Candidate app is retained only in the
local verification directory; it has not been installed or GUI-accepted as a package.


### Common-authoring closeout and installation — 0.49.0 (2026-11-06)

The user authorized this stage closeout and confirmed the old app had exited before
replacement. Evidence: original checkout `.local/verification/authoring-closeout-80efopr8/`.
This supersedes the earlier candidate's pending installation status; the version
stays 0.49.0 because this fixes the same uncommitted feature candidate.

The new shared mixed-writing E2E exposed four genuine integration gaps, each with
RED/GREEN evidence: a separately typed heading or mixed-paragraph space was trimmed from projection;
Enter after a linked paragraph was rejected; a bare fence before the original
terminal newline was treated as opaque; and fast structural keys were discarded
while text IPC was pending. Fixes preserve explicit source spans, insert only a
paragraph separator after a linked paragraph, retain the terminal newline, and
reuse the existing optimistic command queue. Main still checks sender/session,
revision and the complete intended projection. No writer, save policy or overwrite
permission changed. Local bounded self-review found no remaining blocker in this
closeout diff; this is Codex self-review, not independent review.

- 351 targeted Node cases PASS on the final source (`node-delivery.log`). Delayed acknowledgement, lost response,
  Undo/Redo, exact LF/CRLF/CR and untouched original bytes are covered.
- Five distinct source Electron workflows PASS: mixed writing/export/recovery,
  heading/list prefixes, loaded quote/code, paragraph/list boundaries and list
  ranges. Nine clean process exits. Evidence is in `source-e2e-queue.log`
  (three passing cases) and `boundary-e2e-final.log` (two passing cases). The final
  mixed-writing run, including per-key typing after formatted text, passes in
  `mixed-e2e-complete.log` and supersedes the earlier mixed run. The two
  earlier failures in the former log are resolved by the latter: preserve the
  specific empty-list exit hint, and update the old opaque-code fixture to use
  unsupported metadata now that ordinary closed fences intentionally are editable.
- Real product ASAR workflow PASS (`package-e2e-complete.log`): mixed authoring,
  original BOM/CRLF preservation, exclusive export, target-exists refusal, readonly
  reopen, later edits without export mutation, three starts with draft recovery,
  and a second ordinary invocation reusing the app instance. Export SHA-256:
  762cf0e3fcf76e4a4278b01be1a19b71fbf966b2dc43f2ab85937111c02a3d69.
  Tests explicitly preserve the original terminal newline and accept an absent
  optional export-receipt field after recovery; neither correction changes product
  state semantics. Dialog choices and clipboard are controlled; not native IME QA.
- Package checks: 452 source fingerprints, 46 packaged project runtime files,
  10,359 ASAR entries; no private/unexpected project entries. Electron 43.8.7 arm64,
  package/plist 0.49.0. Final ASAR SHA-256:
  e1598edee9f61cca57da7ee09bf90c2ad962381e42ca1dcaad76da367713826c.
- Installed `~/Applications/Markdown.app` matches that package. All 528 bundle
  entries (file hashes, symlink text and modes) verified. 0.46.0 retained intact at
  `installation/rollback/Markdown-0.46.0.app` under the evidence directory; mappings,
  manifests and instructions in `installation/`. The intermediate 0.49.0 bundle
  is also retained under `installation-final/rollback/`; final installation hashes
  and recovery mapping are in `installation-final/`. Installed startup to welcome
  and exit code 0 PASS (`installed-startup-final.json`); no user document opened and no user draft migration.
- Successful Home fixtures `Writing-synthetic-E2E-BcvgdU` (intermediate) and
  `Writing-synthetic-E2E-WZmcck` (final) were reclaimed by the
  existing identity-checking helper. Two empty failed-run fixtures were moved
  intact to `retained-home-fixtures/`, with inode/path mapping; no failure evidence
  was deleted. Successful synthetic product draft was archived via the app API;
  failed-run draft evidence remains retained. Other synthetic originals/exports
  remain in isolated temporary directories recorded by logs. No historical cleanup.

Remaining boundaries: complex/nested Markdown, splitting link contents, marked
quote splitting and existing-file overwrite stay restricted. `coordination-required`
is unchanged. Native IME remains NOT VERIFIED and the historical manual FAIL is
not globally cleared. Air/DeepSeek/full CI were not run; no release sign-off or
new Git commit/push/merge/tag was performed. Preserve the accepted visual baseline.
The next major direction is everyday file workflow, starting with recent documents
and a clear resume-writing entry, not another series of individual formatting stages.

### Local checkpoint preparation — 0.49.0 (2026-11-06)

User approved the proposed local checkpoint before the next file-workflow batch.
The 35 candidate files and 452 source fingerprints matched the closeout evidence;
only current documentation status changed for this checkpoint. Version remains
0.49.0. Reuse the 351 Node, five source Electron, product-package and installed
startup results above. This is a local WIP, not merge or release acceptance.
Native IME/historical QA, full CI, independent-review and overwrite limits remain.


### Recent documents and resume writing — 0.50.0 candidate (2026-11-06)

The authorized preceding checkpoint was completed as `d8a3f25e2543161a05af8dcea21762dc805611cb`
(`feat(desktop): checkpoint common Markdown authoring`), version 0.49.0, 35 files.
The tree/index were clean afterward. This new file-workflow slice is uncommitted
0.50.0; no push, merge, tag or release. The installed application remains 0.49.0.

Welcome now shows three draft entries and six recent files; the sidebar panel
shows up to 12 recent files, Refresh and Clear list. Only successful explicit
readonly opens (native selection, recent entry or verified exported-file shortcut)
enter the catalog. Temporary copies do not. Resume uses the existing draft service
and retains the body, not old Undo/Redo history or file-saving authority.

Main owns the recent ID/path mapping. Renderer submits only an ID; main reopens
through the existing bounded File Store/Service, checking original-byte SHA-256,
device and inode before provisioning a new read-only session. Missing, changed,
replaced and symlink targets are refused while the active document is preserved.
The user can explicitly select the changed file through native Open. No directory
scan, overwrite authority or Save As policy change; `coordination-required` remains.
Preload/renderer pause recent actions during pending or unconfirmed input, and
lost/malformed IPC replies retain the unknown-result fence.

A separate `Recent Documents` directory below the product's private userData uses
the existing draft-store protocol (0700 root, 0600 verified snapshots). It stores
paths/identities/hashes/times, not document bodies. At most 12 entries and two
verified generations are retained. Clear writes an empty current catalog; it does
not delete Markdown files/drafts or securely erase the previous path snapshot.
Catalog damage disables shortcuts and retains evidence without blocking native
Open. No existing user draft schema or backup writer was changed.

Evidence under control checkout `.local/verification/recent-documents-o27o05_z/`:

- `recents-node-final.log`: 147 targeted Node cases PASS across recent metadata,
  read-only open, IPC/preload, draft persistence/view, close/view, writing shell
  and launch-mode tests. `confirmed-actions-final.log`: one additional confirmed
  export-open history test PASS (148 total). The earlier differently named filter
  matched no case; `confirmed-recent-test.log` is not acceptance evidence.
- Existing hostile-markup readonly test was stale after 0.49 link support; its
  baseline failure was reproduced. Corrected only the expectation: blocked HTML
  and images stay opaque; a dangerous link renders an inert span with no href.
  No production link/navigation policy was relaxed.
- `recents-gui-final.log`: Pro source workflow PASS, three clean exits; original
  BOM/CRLF retained, restart draft recovery, readonly reopen, changed-target
  refusal and clear-list persistence. Earlier root-alias and hidden-window resize
  failures were test-fixture issues, corrected; their logs remain.
- `air-evidence/run.log` and `result.json`: same workflow PASS on Air after the
  user confirmed its desktop available. Three clean exits, no watchdog or remaining
  test processes. 54 project files plus bounded runner/manifests; copied isolated
  dependencies, no installation or shared writable profile. Node 24.20.0,
  Electron 43.8.7 arm64; source/tool hashes unchanged. Input manifest SHA-256
  `cdfa56b35e69d9a020617fa7791fb18ec9e28df6136bd5d61d4adba345acd9cb`.
  Returned archive SHA-256
  `285486da73feb5aec22662b5b238f0e2a28ed5ace9416646b56f9e0e7b0432bc`.
  Normal/narrow screenshots were visually checked. This is controlled Electron
  interaction, not native IME or physical dialog acceptance.
- `package-verification.json`: 456 source fingerprints, 48 packaged project runtime
  files, no unexpected/private project entries; package/plist 0.50.0. ASAR SHA-256
  `5ff8d5aa9035f00eb7dea3cf7a7b32dfe9adbf9eb430655a1de8999f32a2b38f`.
  `package-runtime-smoke.log` verifies actual packaged source-map projection and
  format/service/session/recent imports. Builder dependency-reference warnings
  remain in `package.log`; this bounded import check is not a full packaged GUI
  test. The new app has not replaced the user's installed 0.49.0 bundle.
- All test documents/catalogs/drafts were synthetic and isolated in temporary
  roots recorded by the evidence. No Home-top-level test directory was created.
  Air run retained at its private `air-testing/runs/markdown-recents-o27o05_z/`;
  its synthetic fixture is `/private/tmp/document-recents-e2e-1leWmS`. Failed Pro
  fixtures/logs were preserved; no historical cleanup or user-data migration.

Bounded Codex self-review found no remaining blocking issue in this slice; it is
not independent model review. New modules 62/78 lines, new tests 63/51; central
IPC327/renderer442 reuse existing paths rather than creating a second architecture.
Native IME remains NOT VERIFIED, historical manual/formal FAIL is not globally
cleared, full CI and independent review were not run. Existing-file overwrite,
complex Markdown and release limits remain. Next direction: draft naming and
export-name continuity, after accepting this candidate; no new slice started here.


### Draft naming and export-name continuity — 0.51.0 candidate (2026-11-06)

Continues the approved everyday file-workflow direction on `feat/document-close`,
HEAD `d8a3f25`. The previous 22-file 0.50.0 candidate is preserved. Source/package
version is now 0.51.0; installed app remains 0.49.0. No commit, push, merge, tag,
release, user-data migration or change to existing-file overwrite protection.

The title menu opens a bounded naming form for independent drafts. Main accepts
only label metadata, a session ID, expected revision and expected previous label;
no renderer path or body. Sender/session checks and pending/unknown input fences
remain. A verified write through the existing draft store updates the live name.
Failure keeps the prior name/body; unknown backup results stop retry. A failed
pending body backup does not cause an automatic second write during rename.
Recovery now uses the stored name unchanged; pre-existing labels are not migrated.
Named empty drafts get a backup. Original files, content revisions, Undo/Redo and
previous export receipts are unchanged. Save As supplies a main-owned filename
suggestion only; native destination validation and exclusive create are unchanged.

Evidence: control checkout `.local/verification/draft-names-g_gbqjlq/`:

- `names-red.log` records the initial missing-feature test failure.
  `names-node-final.log`: 130 targeted cases PASS across draft names, draft store,
  session/preload, close and save-directory metadata. This is bounded regression,
  not a full CI claim.
- `pro-e2e-051.log` and `pro-e2e-051/`: final candidate workflow PASS, two clean
  process exits. Checks cancel/invalid names, controlled composition, exact source/
  revision/history preservation, suggested filename, new-file SHA-256, existing
  target refusal, unchanged original/export, and named restart recovery. Normal
  and narrow screenshots inspected. Native dialog selections were controlled;
  native Chinese IME remains NOT VERIFIED.
- Earlier Pro harness failures remain recorded: the first launch supplied the
  wrong isolated-create root prefix and was correctly refused before writing;
  the second checked cancellation on a persistent receipt instead of the separate
  operation status. Both test defects were corrected without relaxing protections.
  Their Home fixtures were retained by the existing conservative cleanup helper:
  `Writing-synthetic-E2E-hSyrWq` is empty; the other retained fixture and its one
  synthetic export are mapped by `pro-e2e-2/*/fixture-cleanup.json`. Successful
  Pro runs reclaimed only their verified fresh fixture/file after both processes
  exited (`pro-e2e-final/` and `pro-e2e-051/`). No historical artifacts were touched.
- Air: preflight initially confirmed the desktop, Node24.20.0 and target identity.
  After explicit approval, 57 project files plus runner/manifests were transferred
  to `air-testing/runs/markdown-draft-names-g_gbqjlq/`. Input manifest SHA-256:
  `0adc9fc0f53e18a46a69296810215e962d9f4c762f0f54f390569023c4c10810`.
  The runner verified input and copied tool hashes (Electron43.8.7), then detected
  a locked screen before launching Playwright/Electron. **BLOCKED**, zero GUI tests;
  no blind retry, privacy changes or new Home fixture. `air-console.log` preserves
  the failure, `air-final-state.json` confirms lock. Its sole process-text match is
  the short-lived read-only inspection command itself, not a test application.
  Transferred input/tool copies remain in that private run directory.
- `package-verification.json`: 50 packaged project runtime files match source,
  version/plist 0.51.0, no unexpected/private project entries. ASAR SHA-256:
  `a32ff946980c0cd55c3f203e38e61130360b8542e520001daced9330b59f2709`.
  `package-runtime-smoke.log` confirms actual packaged names, source projection,
  format/session/draft/service/recent imports with Electron43.8.7. Builder dependency
  reference warnings remain in `package.log`; this does not claim full packaged GUI
  or installed acceptance. The user's installed app/profile were not replaced.

Bounded Codex self-review found no remaining blocking finding in this slice; this
is not independent model review. The existing storage format/writer and save
policy are reused. Historical manual/formal FAIL, native IME, full CI, independent
review and release gates remain distinct. Next: review and close the combined
file-workflow candidate, then safely update the installed app when authorized.


### File-workflow local checkpoint and installation — 0.51.0 (2026-11-06)

User accepted the proposed closeout: preserve the combined recent-documents and
draft-naming batch as one local WIP and safely update the app. The exact 29-file
candidate and all 501 source fingerprints matched prior evidence. No product or
test implementation changed during closeout; only current documentation status
changed. Version stays 0.51.0 (feature SemVer already applied in package and lock).
Codex local self-review found no new blocking issue; no independent review was run.
The changed-file credential scan found no high-confidence secret pattern. This is
local commit readiness, not merge/publication or complete user acceptance.

Evidence: control checkout `.local/verification/file-workflow-closeout-20261106/`.
Reuse the prior 130 Node and Pro naming/export/recovery workflow with matching
0.51.0 fingerprints, and retain the separate 0.50.0 Pro/Air and 148 Node results
as dated slice evidence. `recents-051.log` adds five passing recent-file cases on
the combined candidate: readonly identity, changed/replaced/symlinked targets,
catalog protection, clear-list semantics and unaffected files.

`candidate-gui.json`: actual packaged 0.51.0 startup, recent panel, empty scratch
draft name validation/cancel PASS; exact source/revision/label/history unchanged.
`installed-gui.json`: installed 0.51.0 startup and recent panel PASS. Both processes
exited normally (code 0). No user document was opened, no valid name was committed
and no Markdown was exported by these two checks. Existing draft/catalog record
identities, hashes and modes matched before/after. The runtime's blank scratch
and session directories remain only in its usual private temporary roots; no new
Home-top-level fixture was made. The naming screenshot was visually inspected.
These are bounded product-entry checks, not a full packaged writing/recovery or
native-dialog test. Prior synthetic source E2E supplies the persistence coverage.

`bundle-rebuild.json`: independent rebuild from the original snapshot root is
byte-identical. Building from the live Worktree instead changes esbuild dependency
location labels because the snapshot links its node_modules; exact replacement
of that one relative prefix accounts for the entire difference. No runtime drift
or source/bundle change was needed; location-independent output is not claimed.
The installed ASAR remains
`a32ff946980c0cd55c3f203e38e61130360b8542e520001daced9330b59f2709`.

`installation/result.json` verifies 528 entries in both the new and old bundles
(file hashes, modes/ownership and link targets). The exited 0.49.0 bundle was moved
unchanged to `installation/rollback/Markdown-0.49.0.app`; new 0.51.0 is installed at
`~/Applications/Markdown.app`. Recovery paths and instructions are in
`installation/recovery.json`. No deletion or user-profile migration occurred.

Only the 29 approved candidate paths enter the local WIP commit; manifests,
screenshots, packages and recovery material stay ignored under `.local/` in the
control checkout. No remote operation, push, merge, tag or release. Native IME
remains NOT VERIFIED; historical manual/formal FAIL, SEC-01, full CI and human
workflow acceptance are not cleared. Air naming GUI remains BLOCKED by its prior
lock check. Original overwrite remains prohibited by `coordination-required`;
new-file export restrictions and uncertain-write fencing remain unchanged.


## Structured writing — tasks and nested lists (2026-11-06, source candidate)

Approved scope: one task/nested-list workflow after installed 0.51.0 preflight.
The preflight's name/edit/export/readonly-reopen/recovery check passed on Pro;
the script's first attempt had an outdated restored-name assertion, corrected
without changing the product. Installed app/ASAR remains 0.51.0. Synthetic preflight
drafts are retained as recovery evidence; no user document was opened.

The candidate recursively projects tight, one-line-per-item lists (six levels,
32 total items) and retains original source offsets/markers. New task controls,
`- [ ] ` shortcut, Enter continuation (new tasks unchecked), Tab subtree indent,
Shift+Tab lift, nested empty-task lift, first/last top-level exit and same-parent
leaf-range replacement/deletion/single-line paste use the existing controller,
main revision validation and exact source history. Ordered sublists start at 1
where Markdown requires it. Full projection equality gates each structural edit.
No new persistence system, file target authority or overwrite capability is added.

A GUI-reproduced list Enter issue used the stale PM caret after native line-end
movement. The existing native-selection helper now reconciles list structural
keys only for a collapsed caret in an unchanged list paragraph owned by the
current PM view, outside pending or composed input. This covers both native
line-end moves and clicking from another paragraph before selectionchange.
The latter was reproduced by the final nested-export test; its deterministic
Node regression failed before the fix and passed afterwards; the final GUI
workflow also passed.

Verification: 396 relevant Node tests PASS; three Pro Electron workflows PASS
(task/nested lists, previous same-level range editing, mixed authoring closeout).
Original BOM/CRLF bytes, readonly controls, export SHA-256, reopen and restart
recovery are verified. Dialog choices and clipboard/composition are controlled;
native IME remains NOT VERIFIED. Historical manual/formal FAIL and SEC-01 remain.
Air, full CI and independent second-model review were not run. Codex self-review
used strict diff criteria; no unresolved confirmed P0/P1 was found in this scope.
Checkbox alignment was inspected and corrected without changing the visual baseline.

Known boundaries: loose/multiline items, mixed/ambiguous source boundaries,
subtree/cross-parent selections, multiline list paste, splitting/joining link-bearing
items and whole structured-list conversion remain refused. An empty ordinary
nested bullet may be ambiguous with a Setext underline/non-interrupting list; type content before indenting it. This
is a bounded writing candidate, not complete Markdown or release acceptance.

Local evidence: control checkout `.local/verification/structured-lists-czq6fioh/`
contains baseline hashes, installed-workflow record, Node output, final GUI
screenshots/evidence and candidate file hashes. Failed diagnostic fixture
`Writing-synthetic-E2E-WPotzs` (outdated test assertion) and
`Writing-synthetic-E2E-6e8xUE` (test did not wait for draft backup) are retained,
without treating failed test completion as safe cleanup. Successful Home fixtures
are reclaimed by the existing ownership/hash mechanism; all other evidence remains
in local/temp verification areas. No historical archives/fixtures were touched.

The active branch remains `feat/document-close`, based on `755c751` (0.51.0).
Version is unchanged; propose minor 0.52.0 when a local checkpoint is authorized.
No commit, installation replacement, push, merge, tag or release in this batch.


## 0.52.0 structured-list local delivery (2026-11-06)

The user approved continuing the proposed candidate-build/install step. This
closeout preserves all 29 prior candidate files at their verified baseline before
version/documentation updates; functional source, tests and bundle are unchanged.
Package and lock use 0.52.0 (feature minor). AGENTS/current docs describe the
installed bounded task/nested-list behavior. No Git commit was requested or made.

Evidence: control checkout `.local/verification/structured-lists-delivery-mkv6frr2/`.
- The preceding 396 focused Node / three Pro source workflows are reused with
  matching source hashes. Nine entry/packaging policy checks additionally PASS.
- Independent renderer rebuild is byte-identical: SHA-256
  `89953920234634153842be04261f2ce02ef798e7f54d2aac7cf8a4cf1c0a66f4`.
- Offline unsigned arm64 package uses the existing config and cached Electron
  43.8.7. All 505 snapshot files and 52 packaged project runtime files match;
  private/unexpected project entries are absent. ASAR SHA-256:
  `dc8dd87293299682a273a360c5a656415bdf978cdb16d1c2db111370be656d3d`.
- Actual packaged-product GUI PASS: task creation, nested child, checkbox history,
  exclusive export/hash and restart/recovery with checked/nested state retained.
  Two clean exits; no existing user file opened. Native dialog choices are
  controlled; this is not native IME or human interaction acceptance.
- Installed 0.52.0 startup and recent-panel checks PASS. Existing draft/catalog
  record identities, modes and hashes remain unchanged. The candidate test adds
  one explicitly synthetic draft; its Home export fixture is safely reclaimed.
  Recent history is unchanged. No historical fixture or evidence is removed.
- Installation manifests verify 528 entries for both old/new bundles. Old
  0.51.0 is retained at `installation/rollback/Markdown-0.51.0.app`;
  `installation/recovery.json` maps its safe restoration. No profile migration.

Git remains `feat/document-close` at `755c751`; local main is not ahead of this
branch (six local commits ahead, without a remote fetch). Targeted diff/credential
checks found no extra files or high-confidence secret pattern. Final acceptance
and commit readiness still require the focused list interaction confirmation;
this installation is a local candidate, not final feature or public-release PASS.
Native IME NOT VERIFIED, historical manual/formal FAIL, SEC-01 and original-file
overwrite prohibition remain. No Air, new Reviewer, full CI, push, merge, tag or
release in this closeout. Next product batch: basic GFM table authoring after
this list candidate's acceptance, using the existing model and source patch path.


## 0.53.0 basic GFM tables — coherent candidate batch (2026-11-06)

User authorized the next table workflow from the preserved 0.52.0 list candidate;
no Git checkpoint or inferred manual PASS was introduced. New source projection,
source patch commands, rendering-only PM nodes and a contextual toolbar implement
creation, plain-cell edit/one-line paste, navigation, rows/columns, Undo/Redo and
export/recovery. Main still validates session/sender/revision and computes source
ranges itself. Renderer cannot provide save paths or source patches. The existing
native caret reconciliation also accepts unchanged table-cell paragraphs before
structural keys. No file store, save permission or dependency policy changed.

Limits: rectangular outer-pipe tables, 8 columns and 32 rows including the header;
delimiter cells have at least three hyphens. Source padding is editable literal
cell text; untouched alignment, cell spelling and line endings remain exact.
Rich/escaped/ragged/multiline cells, cross-cell range replacement, spreadsheet
paste, merged cells and formulas are refused. Header/final-column deletion is
refused; other deletion is undoable. Table Enter/Tab append a row when necessary,
starting in its first cell; Cmd+Enter returns to a following supported paragraph
or creates an empty prose slot. Structure changes stay fenced during composition.

Verification in control checkout `.local/verification/basic-tables-5xbh2pfl/`:
- TDD: seven initial feature tests failed before implementation; all now pass.
- 421 focused Node checks PASS, including 15 new table mapping/controller cases:
  all row/column positions, LF/CRLF/CR inverses, capacity/range limits, protected
  syntax, surrogate boundaries, read-only/revision fences, queued typing, main
  history, controlled composition and acknowledgement mismatch recovery.
- Two Pro source Electron workflows PASS: the full table workflow and existing
  task/nested-list regression. BOM/CRLF original unchanged; new-file SHA-256,
  readonly reopening and two-start draft recovery verified. Screenshots inspected.
- Actual unsigned 0.53.0 arm64 package PASS: cell typing, row creation, Undo/Redo,
  exclusive export/hash and restart recovery. Prior private draft records and
  recent catalog unchanged; one clearly named synthetic table draft is retained.
- Installed 0.53.0 startup/recent-panel check PASS; prior draft/catalog identity,
  mode and hashes unchanged, normal exit. First automation attempt ended with
  `Resulting promise was garbage collected`; the window-ready recheck passed.
  Both attempts are retained; no product source was changed to bypass the check.
- Installation verified 528 entries for each bundle. Previous 0.52.0 is retained
  at `installation/rollback/Markdown-0.52.0.app`; `installation/recovery.json`
  records restoration. ASAR SHA-256 is
  `ab0bba2991ce9d898e9527618101496e34cb7880c218eba829ead4b8c3c4ab7c`.
  No user document opened or profile migration performed.
- Package verified: 512 source files / 56 runtime project entries, no private or
  unexpected project entries, existing Electron 43.8.7. No dependency installation.
- Successful Home export fixtures `Writing-synthetic-E2E-cZk7ts`,
  `Writing-synthetic-E2E-3KYETb` and `Writing-synthetic-E2E-YhWWQH` reclaimed by the
  existing identity/hash cleanup after all processes exited. No failed Home
  fixture this batch; old fixtures/evidence remain untouched. Other synthetic
  inputs/recovery data remain in local or temporary verification directories.

Codex strict Diff self-review found no unresolved confirmed P0/P1 in this scope;
this is not an independent review. Native dialogs are controlled; IME NOT VERIFIED,
prior manual/formal FAIL, pending human list/table acceptance, SEC-01 and release
limits remain. No Air, Reviewer, full CI, commit/push/merge/tag/release claim.
Version/package-lock advance to 0.53.0 for the feature candidate. Exact added and
modified file fingerprints and the preceding 505-file baseline are retained locally.


## Structured-writing mixed-document closeout (2026-11-06)

One additional regression in `e2e/document-tables.spec.cjs` reuses the existing
mixed-authoring helper and isolated draft/fixture mechanisms. It covers heading,
bold/italic/code/link authoring, list-to-quote-to-fence transitions, task nesting,
table text/Unicode paste/column history, real sidebar switching and 860×740 layout.
Exact new-file content/SHA-256 is checked; later edits leave that file unchanged.
Fresh-process recovery keeps the later edits with no old Undo or export authority.
Backup acknowledgement must match the current revision before restart.

Evidence: control checkout `.local/verification/structured-closeout-fmq44aa1/`.
The final Pro run `gui-final.log` PASS has two normal exits and zero page errors;
its screenshot was inspected. The preceding corrected workflow also passed, not
a distinct second test. Earlier attempts failed at mixed-edit timing, hidden
legacy controls or screenshot capture of a resized hidden window. The last two
are confirmed harness issues. A local preload probe proves that polling snapshot
IPC can block concurrent format requests; it does not prove the cause of every
earlier timing failure. The final test passively observes the renderer's confirmed
source during typing, uses the visible sidebar/task controls and shows only its
isolated synthetic window for capture. No safety gate was changed. Temporary
controller diagnostics were removed; restored controller and rebuilt bundle
match the previous candidate exactly. No new product defect was confirmed.

Both successful synthetic Home exports (`Writing-synthetic-E2E-vbsj8B` and
`Writing-synthetic-E2E-M2LQd8`) were reclaimed only after clean process exit and
identity/content verification. Earlier failures occurred before export and
created no Home fixture; isolated temporary profiles/drafts and diagnostic logs
remain evidence. No user document, installed app or real private catalog changed.

All 512 baseline source fingerprints matched before this work. Previous 421
focused Node / source and package evidence is reused for unchanged runtime;
no unrelated Node, full CI, Air, Reviewer or native-dialog/IME pass is claimed.
This is Codex local Diff self-review, not independent review. Version stays
0.53.0 because only tests/docs changed. The table E2E remains under 150 lines.
Human table/list QA and native IME NOT VERIFIED, historical manual/formal FAIL,
SEC-01, original readonly and `coordination-required` remain. No commit/push/
merge/tag/release; the next gate is bounded human experience and an explicitly
authorized local checkpoint.


## Image-reference authoring — 0.54.0 source candidate (2026-11-06)

The user authorized continuing development from the 0.53.0 candidate, not a Git
checkpoint or a human-acceptance PASS. The bounded image slice adds standalone
`![description](address)` cards, insert/edit/remove, Enter back to prose, history,
export/reopen and draft recovery. Existing titles, untouched bytes and line endings
are preserved. Cards contain DOM text only and state “未加载预览”; `img-src 'none'`
and `connect-src 'none'` are unchanged. No image file read, fetch, import, copy or
new persistence authority is introduced. Relative addresses remain literal and
may need adjustment when exporting to a different folder. Inline/reference-style,
nested and complex image syntax remains protected. This is not full image support.

Verification lives under the control checkout's
`.local/verification/image-references-8_6dxh3h/`:

- `node-red.log` preserves initial missing-feature failures; `node-final.log`
  records 316 PASS / 0 FAIL, including image mapping, IPC/history, stale/revoked
  contexts, composition, failed transport and prior source/list/table checks.
- `e2e-images-final.log` and its `evidence.json` record the Pro GUI image workflow:
  cancel/invalid inputs, edit/remove/history, prose continuation, exact exported
  source/SHA-256, readonly reopen and fresh-start draft recovery. Two clean exits;
  zero observed HTTP requests. Light/dark/narrow screenshots reviewed.
- `e2e-mixed-regression.log` records the existing mixed-authoring workflow PASS
  on the image candidate, with two clean exits. No prior pass is reclassified as
  native IME acceptance. Dialog choices and composition are controlled.
- The renderer rebuild matches SHA-256
  `a32a9d621f14dd288f927835f6b4035b94479ab1af7710b3a3ca082689600dc4`.
  Self-review checked only this batch and necessary dependencies; it is not an
  independent second-model review. No new confirmed P0/P1 was found.
- Three successful GUI runs (first image pass, theme follow-up, mixed regression)
  created one synthetic Home export each; all three were reclaimed after process
  exit and identity/content confirmation. Temp-only synthetic inputs, isolated
  drafts and verification outputs remain as evidence. No user file was opened.

Version/lock 0.54.0 is an uncommitted source candidate. Installed Markdown stays
0.53.0; this batch does not claim packaging/installed acceptance, Air testing,
DeepSeek review, full CI, native IME or human acceptance. Original overwrite stays
blocked by `coordination-required`; unknown outcomes retain drafts and are not
retried. Historical formal/manual FAIL, SEC-01 and release limits remain open.


## Structured-document delivery — 0.54.0 installed (2026-11-06)

This closeout changes documentation only. It reuses the prior 316 focused Node
and two source Electron results after matching all 519 candidate fingerprints;
version remains 0.54.0 and runtime code/tests are unchanged. Evidence root in the
control checkout: `.local/verification/structured-delivery-054-tcd63dai/`.

- `package-verification.json`: 519 source fingerprints and 60 packaged project
  runtime files match; arm64 Electron 43.8.7, version 0.54.0 and Document entry
  confirmed. No unexpected project or private-data entries in the ASAR. The
  existing builder dependency-location warnings are retained in `package.log`;
  actual package/runtime checks below passed. No new dependency install was used.
- `candidate-gui.json`: actual package, combined headings/tasks/nesting/table/
  image-reference creation and history, prose continuation, exclusive new-file
  export/SHA-256, later draft edits isolated from that export, and restart recovery
  PASS; two normal exits. Native dialog selections are controlled. No existing
  user document was opened. This does not repeat native IME or human acceptance.
- `installed-gui.json`: actual installed 0.54.0 startup and recent-panel PASS;
  one normal exit. ASAR SHA-256 for package and installed bundle is
  `f02cfa89a1848c6c9d30a83132f7f1123816d8dc43db3eb4ed382d2ea78cfdf6`.
- Before/after comparisons preserve all existing draft/catalog record identities,
  permissions and hashes. One named `Synthetic structured 0.54 …` recovery draft
  remains as test evidence. The one Home export fixture was reclaimed after
  process exit, exact identity/content confirmation and successful verification.
- `installation/result.json`, `candidate-manifest.json`, `rollback-manifest.json`
  and `recovery.json` retain installation checks and restore mapping. The old
  0.53.0 bundle is under `installation/rollback/Markdown-0.53.0.app`; no permanent
  deletion or profile migration occurred. To recover, exit the app, retain the
  current bundle at an unused location, then restore the old bundle to
  `~/Applications/Markdown.app` and verify its manifest. Never overwrite a bundle
  or delete/migrate private profiles during recovery.

Image preview/import/attachment copying remains unimplemented. Original-file
saving is still blocked by `coordination-required`. Native IME NOT VERIFIED,
historical manual/formal FAIL, focused human list/table/image QA, SEC-01 and
release gates remain open. No new Air, independent Reviewer, full CI or public
release pass is claimed. No Git commit, push, merge, tag or release was performed.


## Structured-authoring local WIP checkpoint — 0.54.0 (2026-11-06)

The user accepted the proposed next step of closing out the installed candidate
as a local checkpoint. Scope is the same 47 files: 25 runtime files (including the
required generated renderer), 14 test files, six documents and two version files.
The source version already reflects the three feature slices, from checkpoint
0.51.0 to candidate 0.54.0; no extra bump is warranted for preservation.

All 519 source fingerprints match `structured-delivery-054-tcd63dai` before the
checkpoint wording updates. The generated renderer matches the previously rebuilt
artifact byte-for-byte. Reused evidence: 316 focused Node checks; image and mixed
source Electron workflows; 60 actual-package runtime matches; package structured
writing/history/exclusive export/restart recovery; installed startup/recent-panel
checks. No tests or GUI were repeated, and no new fixtures were created.

Bounded local self-review covered the changed source mappers, editor integration,
selection/composition/history guards, inert DOM rendering and existing main-owned
command boundary. No new confirmed P0/P1 was found. The bounded credential scan's
only hit is an intentional fake credential-bearing URL rejection fixture, not a
credential. No dependency change beyond package/lock version fields. Handwritten
diff whitespace checks pass; the unchanged generated bundle retains the previously
recorded third-party whitespace diagnostics. No independent reviewer was invoked.

This is a WIP preservation commit, not acceptance or release. Focused human
list/table/image QA, native IME NOT VERIFIED, historical formal/manual FAIL, SEC-01
and full-CI/release gates remain open. No image preview/import/attachment copying,
original overwrite, save-policy expansion, push, merge or tag. Installed App,
rollback bundle and private drafts/catalog are untouched. Exact scope, before/after
hashes and Git result: control checkout `.local/verification/structured-checkpoint-054-x3cww68z/`.
