# Pilot acceptance evidence reconciliation — 2026-09-12

## 1. Manual QA goal

Close only the remaining A1/A3/A5/A6 evidence gaps in [the roadmap](roadmap.md).
Do not repeat settled checks, infer a product defect from missing evidence, or
equate scripted checks with native keyboard/IME/clipboard acceptance.

## 2. Test environment

- Unreleased 0.18.0 packaged candidate, ASAR SHA-256
  `32ee2581bd0ff5785d8f6882d01462d67df57bb8c47c5846cfdedf7b2591f55b`.
- Package: `/private/tmp/editor-packaging-policy.w59caT/dist/mac-arm64/markdown-vault-desktop.app`.
- All 167 files in the reviewed staging manifest still matched current source
  before this run. No application source or dependency change was made.
- Native QA app: `/private/tmp/editor-pilot-acceptance.49BaDq/Pilot-QA.app`,
  bundle ID `com.markdownvault.pilotqa.sep12`, display name
  `Pilot Acceptance QA Sep12`, copied from cached Electron 43.4.1.
- Temporary bootstrap loads the verified ASAR unchanged, sets fresh
  `userData`/`sessionData` to `/private/tmp/editor-pilot-acceptance.49BaDq/profile`
  before main initializes, blocks renderer HTTP(S), and uses only the synthetic
  `/private/tmp/editor-pilot-acceptance.49BaDq/vault`.
- `isolation.json` records PID 44955, profile paths, Electron version and exact
  ASAR URL. Native accessibility output confirmed that URL, synthetic vault and
  Tiptap WYSIWYG. This is a QA harness, not ordinary installed-app acceptance.
- Six synthetic notes: IME baseline, currency, other, raw table, unsupported YAML,
  and a 120-paragraph long note. No real notes/transcripts or sibling project used.

## 3. Changed behavior to verify

None newly implemented. The packaging follow-up and security checks have passed;
this task records acceptance evidence and attempts only unresolved native steps.

### September 12 audit and review evidence

After explicit user approval to send dependency names/versions to npm:

```text
mise exec -- npm run audit:prod -- --registry=https://registry.npmjs.org
mise exec -- npm run audit:full -- --registry=https://registry.npmjs.org
```

Both commands exited 0 and reported **found 0 vulnerabilities**. These results
supersede the September 11 network/approval block; they do not imply future
advisories cannot appear. No `npm audit fix`, dependency or lockfile edit occurred.

Focused packaging review: **accept**, scoped to that four-file follow-up, not
overall shipping approval. Packaging tests 4/4; full CI 2,375 total / 2,373 pass /
2 existing skips / 0 failures. CI log:
`/private/tmp/editor-packaging-review-ci-20260912.log`.
These completed checks were not repeated during native evidence reconciliation.

## 4. High-risk areas

IME input provenance and composition commits; note-local history/draft retention;
currency/source persistence; long-note caret and real image paste; failed Save All
retaining edits. Tool/window failures must be classified separately from defects.

### Manual IME evidence reconciliation

The historical September 10 native report identified its A7 build and reported
committed Simplified Pinyin text that was not undoable and disappeared after
switching notes. Its ASAR was
`94eee588fd9dc0804fc885db5582766945573c57d834f251a8de9aa5b3ad0f43`.
The user later reported that all manual checks passed, but did not record the
matching application path/hash, engine, input method or exact sequence.

Both historical observations remain on record. The user confirmed they do not
remember the earlier manual build/sequence. That earlier pass remains unverified.

During the guided retest, screenshots identified this task's exact synthetic vault
and Tiptap engine. The user identified **Simplified Pinyin** and reported success
for the instructed `zhongwen` → Space commit, Cmd-Z, Cmd-Shift-Z, and unsaved
Other → IME baseline switching. The user then clicked Save Note and quit only
this QA app with Cmd-Q, reporting that it closed without a dialog.

AI read the synthetic file as `# IME baseline\n\nOriginal IME body.中文\n`,
reopened the exact QA bundle, and observed `Original IME body.中文` in the native
editor with zero drafts. `isolation.json` changed from PID 44955 to 58464, confirming
a fresh process with the same isolated profile and package. The ASAR hash was
rechecked unchanged. This is a **Space-path PASS** combining user-reported input/
history/switching with AI-observed disk/reopen evidence, not AI-observed composition.
For the separate Return path, the user typed `ceshi` with Simplified Pinyin and
reported that Return committed Latin `ceshi`, then confirmed Undo/Redo, unsaved
Other → IME baseline switching, Save Note and Cmd-Q all passed. AI verified disk
bytes `# IME baseline\n\nOriginal IME body.中文ceshi\n`, then reopened the same
QA app. Native accessibility showed that exact body with zero drafts; PID changed
from 58464 to 59032 and the ASAR hash remained unchanged. This is a **Return-path
PASS for Latin commit**, not evidence that Return selected a Chinese candidate.

The guided Space and Return sequences therefore pass for this identified
candidate. The historical failure was not reproduced; its cause is not explained.
No IME code change or new defect is claimed, and this is not a universal input-method
guarantee. The older unidentifiable manual pass remains historical only.

## 5. Manual QA checklist and observed results

| Case / starting state | Exact remaining steps | Expected result | Result | Notes |
| --- | --- | --- | --- | --- |
| A1: fresh synthetic IME note, Tiptap, installed Chinese input method | Record build/engine/input method; compose with actual candidate selection, commit with Space; Undo/Redo; switch away/back; save/reopen. Repeat with Return, recording whether Return commits Chinese or Latin text | Exact committed text survives switching/reopen; history reverses/restores it without dropping original content | **PASS: Space Chinese commit; Return Latin commit** | Simplified Pinyin input/history/switching user-reported; exact saved bytes and fresh-process reopen AI-verified for both. See guided retest above |
| A3: synthetic Currency note | Source: `Price $5; formula $x$.` plus trailing LF; Rich → Preview → Save; switch away/back; reopen | Price remains literal, formula preserved, exact deliberate Source text on disk/reopen | **PASS (combined AI/human evidence)** | AI observed Source/Rich/Preview/Save and exact disk bytes `# Currency\n\nPrice $5; formula $x$.\n`. After the guided fresh-process reopen, the user reported Currency → Preview → Other → Currency → Preview unchanged with no Draft; AI subsequently observed the intact Preview and zero drafts |
| A5: 120-paragraph synthetic long note with table/task | Edit/Undo near end, verify caret stays usable; paste a synthetic image from the actual clipboard; save/reopen; inspect vault-relative image and bytes | No content loss, unwanted jump or broken image | **Not run: tool-blocked** | Fixture exists; creation alone is not test evidence |
| A6: untouched non-normalized raw table | Open/switch/revisit without editing; confirm no draft and unchanged disk; clean close/reopen | No false draft or unintended rewrite | **Partial native PASS; post-restart selection tool-blocked** | AI observed Raw table → Other → Raw table, intact rendered cells and zero drafts; disk hash unchanged. Sequential retry completed clean quit and fresh-process reopen with zero drafts and unchanged raw-table disk, but selecting the table after restart was tool-blocked. No-op Save All has scripted evidence; clean close is not equivalent to invoking Save All |
| A6: synthetic unsupported YAML note | Make one body edit; native close → Save All & Quit; verify error, window remains open, unsaved body remains, disk unchanged; switch/revisit | Unsafe save refuses without lost metadata or edits | **Not run: tool-blocked** | Do not repeat the already-passing four quoted-whitespace save/rename fixtures |

### Native observations and blocker

Computer Use connected to the exact temporary QA app. Currency Source input was
entered by native paste of synthetic Markdown (appropriate here, not an IME test).
Rich accessibility output showed literal `Price $5; formula` and rendered `x`;
Preview showed `Price $5; formula $x$.`. Save showed `Saved: currency.md`.
The real save IPC observation and direct synthetic disk read agreed.

During the next raw-table navigation attempt, Computer Use reported an invalid
element, then `cgWindowNotFound`. Refresh, exact-path reconnect, and combined
accessibility/screenshot observation all failed with the same window error.
A narrowly scoped process check showed QA PID 44955 still running at the exact
temporary executable path. This does not establish whether its window was closed,
hidden or inaccessible; no crash or editor defect is inferred.

Native work stopped rather than using another app or claiming unobserved passes.
Evidence retained in the temporary root: `isolation.json`, synthetic vault,
`save-observations.jsonl`, and the bootstrap inside `Pilot-QA.app`. The QA process
was not forcibly terminated and no synthetic edits were discarded by this task.

### AI-operated continuation after guided manual checks

The user authorized AI to perform the remaining checks. The exact QA app was
reconnected; `isolation.json` identified PID 59032 and the same synthetic profile,
vault and ASAR URL. The package hash remained unchanged. Currency acceptance above
combines the user's explicit navigation/Preview pass with the preceding AI save
and fresh-process verification; it is not presented as entirely AI-operated.

Native output showed Other's original body, then Raw table with cells A/B/x/y,
`Ready`, and `Drafts 0 note(s)`. The raw-table file's SHA-256 before and after was
`6157548ef0ad7faed3da2dba6dde5747e288a1476a968bb37eaf6e1939ffa7a8`.
The unsupported and long-note fixtures also remained unchanged during this attempt.

Opening the long-note row did not produce an observable navigation result. A
screenshot-based coordinate attempt returned `noWindowsAvailable`. Exact-path
reconnection recovered the raw-table window, but the next exposed Raise/select
attempt returned an invalid-element error. Native input stopped under the existing
stop condition. No long-note edit, real image paste, unsupported-metadata close
dialog, or clean close/reopen was verified in this continuation. These are tool-
blocked coverage gaps, not demonstrated product failures. No code fix is proposed.

### Sequential retry requested by the user

Only the uniquely identified QA app was targeted, with no parallel test actions.
The ASAR and all three remaining synthetic fixtures still matched their recorded
hashes. Native application-menu Quit eventually returned `App quit`; reopening
the exact QA bundle changed `isolation.json` from PID 59032 to 60909, retained the
same profile/vault/ASAR, and showed the saved IME body with zero drafts. The raw-
table disk hash remained `6157548ef0ad7faed3da2dba6dde5747e288a1476a968bb37eaf6e1939ffa7a8`.

Raw-table selection after restart did not visibly change the note. A coordinate
click returned `noWindowsAvailable`; reconnecting by the unique QA bundle ID
restored the observed window, but a fresh accessibility-node click returned an
invalid-element error. Therefore clean quit/relaunch is verified, while post-
restart table rendering, A5 and failed Save All remain incomplete. These errors
recurred during sequential operation; concurrent tests are not an established
root cause. No fixture edits, settings changes or product fixes were made.

## 6. Regression checklist

Prior plain Undo/Redo, cross-note isolation, two-dirty-note Cancel/Save All/restart,
quoted-whitespace refusal, packaging membership, default/Tiptap packaged-runtime
smoke and automated coverage remain separate evidence. They were not rerun merely
to increase the number of passes. Their historical reports remain unchanged.

## 7. Edge cases and stop conditions

- Native access failure: stop interaction until the identified QA window is
  observable again. Do not attach to the ordinary editor or change permissions.
- Unknown manual build/sequence: retain conflict; request provenance or repeat
  that exact sequence on a known isolated candidate.
- Actual failure: record/reproduce using synthetic data before proposing product
  TDD. Do not preselect an IME or persistence fix.
- Ordinary installed launch and clean-checkout CI are still separate gates;
  no Git authorization or release-level acceptance is implied here.

## 8. Pass/fail recording template

`Case | app path + ASAR hash | engine/input method | exact actions + commit key |
native / human / scripted | expected/actual body and disk | PASS/FAIL/BLOCKED |
evidence path`

For the historical manual IME pass, an unknown field should be recorded as
unknown, not reconstructed by assumption.

## 9. Final acceptance decision

**Audit gate: PASS. Packaging follow-up review: ACCEPT. Pilot closure: BLOCKED.**
The guided A1 Space/Return paths and combined A3 evidence pass on the identified
candidate. A6 untouched navigation and clean quit/relaunch passed; selecting the
raw table after restart remains tool-blocked despite unchanged disk contents.
A5 long-note/image acceptance and A6 failed Save All remain tool-blocked.
Ordinary installed launch and final clean-checkout CI also remain open.
No new product defect confirmed; no features,
application-code changes, versions, commits or pushes.
