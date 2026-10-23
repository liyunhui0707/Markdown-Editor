# Phase 1A: complete-file document boundary

Status: limited service-level verification passed on 2026-10-23; version remains
0.18.0. This is a local, uncommitted development slice, not a release or
replacement of the Vault UI. The legacy `load-vault-notes` / `save-note` chain
still uses title/body reconstruction and is NOT fixed by adding this service.

## Approved scope and contract

The main-process boundary owns one existing, absolute `.md` path and the entire
UTF-8 file, never a reconstructed title/body/metadata object. File name and H1
are unrelated. Original bytes, BOM, exact line endings and indentation remain
available independently of the editable Markdown string and its disk baseline.

Opening and closing perform no writes. Saving an unchanged document is a no-op.
Explicit range edits preserve every character outside the selected source span.
The service does not parse or regenerate YAML, unknown Markdown, or titles.
Invalid UTF-8, symbolic links, multiply-linked files and unsupported file types
fail closed rather than silently convert or replace a different file.

Optional parser/serializer boundaries must fail explicitly and retain both disk
and current edits. A serializer is a verification boundary, not permission to
normalize the whole file: its output must equal the current complete Markdown.
An empty fallback is not accepted for nonempty content. Real intentional deletion
is an explicit range edit, not an exception fallback. Failed conversion blocks
saving until explicit raw-source recovery or a successful verified conversion.
Rich-editor integration and source-position-preserving conversion are future
work; no existing Tiptap/remark/CM6 engine is replaced in this slice.

Saving checks the file's identity, contents and metadata against the load/save
baseline, writes an exclusively-created sibling temporary file, synchronizes it,
checks the destination again, and replaces it with rename. Errors retain edits;
pre-replace failures leave the destination untouched. Owned temporary files are
cleaned when possible, with cleanup failures explicitly reported. Only successful
replacement advances the baseline. Directory-sync failures after replacement
must report the committed-but-durability-uncertain state rather than pretend
that no write occurred.

Ordinary compare-before-rename is not a filesystem compare-and-swap. Another
process can still write between the last check and rename; document that TOCTOU
window and defer coordinated native saving to a later stage. Do not claim full
concurrency safety, universal metadata preservation, or power-loss guarantees.

## Plan review

1. Overall verdict: accept, limited to a separately testable service.
2. Strength: complete-file truth and explicit source edits avoid the old lossy
   split/recombine chain; Electron/main remains the I/O owner.
3. Main risks: concurrent external writers, file metadata, partial failures and
   conflating this service with migration of the existing UI.
4. Required tests: the six approved regressions plus BOM/CRLF/mixed endings,
   Front Matter/unknown syntax, invalid UTF-8, no-op writes, failed conversion,
   read-only/symlink/hardlink refusal and failure-injected atomic replacement.
5. TDD: add the boundary tests first; record a red run; implement only the model,
   disk snapshot/atomic writer and service; then targeted and full regressions.
6. Refinement: retain a clear distinction between pre-replace errors and errors
   after a completed replacement. Never mask an I/O error as empty Markdown.
7. Implementation guardrail: no legacy UI rewiring, dependency/version changes,
   Finder handling, multi-window work, security dependency fixes or Git commits.

## Modules and main-process API

| Module | Responsibility |
| --- | --- |
| `apps/desktop/lib/document-model.js` | Original bytes, full editable source, immutable path/identity view, UTF-8/BOM, dirty/revision and conversion failure state |
| `apps/desktop/lib/document-file-store.js` | Stable disk snapshots, baseline comparison, sibling temporary file, replacement and failure cleanup |
| `apps/desktop/lib/document-service.js` | Per-instance document capabilities, open/save/checkExternal/close, baseline advancement and save reentry guard |

`createDocumentService().open(absolutePath)` returns a document or a structured
failure. Unsupported encoding and parser failures return the retained document
for recovery, not an empty source. `document.edit({from, to, insert})` uses UTF-16
source offsets and refuses invalid ranges or split/unpaired surrogate sequences.
It is an explicit source edit, not a conversion output. `save(document)` compares
against the service's private disk baseline; `checkExternal` is an on-demand
check, not a background watcher. `close` revokes that service session without a
write or destruction of the caller's retained source.

Optional `open(path, {parse})`, `document.parse(parser)` and
`save(document, {serialize})` accept synchronous conversion functions. Parser
success alone does not establish lossless round trip. Serializer output must
equal current full source; normalization or an empty exception fallback is
blocked. Conversion reentry and source mutation during conversion are blocked.
Retry successful conversion or explicitly call `recoverSource()` to retain and
save the raw source; that cannot enable saving an unsupported encoding.

These objects are trusted main-process APIs, not IPC payloads. They do not grant
renderer access to arbitrary paths. A later integration needs authorized open
requests and opaque session IDs; it must not expose the filesystem store or the
model's service lifecycle methods to renderer callers.

## Verification record: 2026-10-23

All write verification uses isolated synthetic files only. Node development
runtime: 24.20.0. Packaged-service smoke: Electron 43.4.1, embedded Node 24.18.1,
arm64. No dependency or version change and no commit/push.

| Approved scenario | Actual result at the new boundary |
| --- | --- |
| H1 immediately followed by body | PASS: all lines survive load/edit/save/reopen |
| Four-space code indentation | PASS: unchanged source retains indentation |
| No H1 | PASS: no generated heading; H1 edits do not rename the file |
| Unmodified open/close/Save | PASS: no write, rename or mode mutation; bytes and mtime unchanged |
| External modification | PASS: conflict, no replacement; local edits and external bytes retained |
| Parser/serializer failure | PASS: explicit blocked outcome; source retained and empty fallback refused |

Additional tests cover BOM, LF/CRLF/mixed/CR-only endings, missing final newline,
unknown Markdown/custom Front Matter, rejected real remark normalization,
invalid UTF-8/UTF-16/binary inputs, Unicode boundaries, readonly files,
symlink/hardlink refusal, partial/zero writes, write/sync/mode/rename failures,
late external edits, directory-sync uncertainty and cleanup failures.

TDD evidence: initial 31 cases RED because the new module did not yet exist;
then 31 GREEN. This is absence-of-new-boundary evidence, not a claim that the
legacy UI failed all 31 cases. Self-review added three edge tests: 32/34 passed
and two failed (parser-save reentry and unidentified temporary-file recovery).
Minimal corrections brought all 34 to GREEN. Existing tests were not weakened.

- Final focused tests: 34 PASS, 0 FAIL, 0 SKIP.
- Full `npm run test:ci`: 2409 tests, 2407 PASS, 0 FAIL, 2 existing perf skips.
- `npm run check:tiptap-readiness`: 44 PASS, readiness gate PASS.
- Seven separate build scripts: PASS; all 90 baseline generated files identical
  to the starting checkpoint. Did not run the delete/regenerate aggregate script.
- Existing Electron E2E after builds: 1 PASS, fresh process/profile save/reopen.
  This is a legacy UI regression check, NOT new-service UI integration evidence.
- Unsigned local arm64 directory packaging: PASS, no publish; three new modules
  and their path-policy dependency match the actual ASAR. Checked forbidden
  private/test paths are absent.
- Actual packaged service in an isolated Electron main process: PASS for full
  source loading, no-op save, serialization refusal, exact save/reopen and
  external conflict. No Finder, native IME, install/signing or UI acceptance claim.

Private logs are outside this worktree in a dedicated local verification
directory; they are not intended for a public Git commit. The first generated
comparison harness hit its default stdout buffer limit; comparing local Git
blob hashes instead completed all 90 comparisons. No product or generated-file
change was used to make that check pass.

## Remaining limits and next gate

1. This boundary is not wired into the existing UI/IPC. Existing Vault save
   defects remain there until a separately approved integration replaces it.
2. Whole-file Tiptap/remark normalization is deliberately not accepted as proof
   of fidelity. A small, source-position-preserving adapter experiment must
   precede rich-editor integration; unchanged blocks and unknown syntax must
   remain byte-stable or saving must be blocked.
3. Final-check-to-rename TOCTOU remains. Native coordinated saving/advisory
   cooperation is future work, not an already solved concurrency guarantee.
4. POSIX mode and uid/gid are retained or saving fails. Preservation of macOS
   ACLs, extended attributes/resource forks, special flags and all network or
   cloud filesystem behavior is NOT guaranteed. This is a release/integration
   gate; do not broadly enable replacement on user documents before addressing
   those metadata requirements. No power-loss/F_FULLFSYNC guarantee is claimed.
5. Directory-sync failure after replacement returns `committed: true` with a
   failure outcome. Caller must show uncertainty, not claim rollback or silently
   treat it as a normal successful save. Cleanup failures surface a recovery path.
6. Existing files only, UTF-8 only, no symlink/hardlink editing, no background
   conflict watcher or persistent crash recovery. Synchronous whole-file reads
   and copies need performance evaluation before UI integration for large files.
7. No new security audit was run; previous DOMPurify/Toast UI and other security
   gates remain unresolved, and public-history privacy gates remain separate.

Next: review this six-file patch first. With separate approval, plan phase 1B
as an opt-in synthetic document-editor integration, with authorized session IPC,
source-preserving editor changes and visible conflict/failure handling. Do not
combine that with Finder, multi-window, UI redesign or the SEC-01 dependency fix.

Filesystem API reference: [Node.js file system API](https://nodejs.org/docs/latest-v24.x/api/fs.html).
The pinned runtime and real fault-injected tests, not that moving documentation
version alone, determine the verification results above. Historical acceptance
evidence remains dated; see the recovery audit for the old storage defects.
