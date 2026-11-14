# Product direction and next delivery groups — 2026-11-14

Review baseline: main `92a1857382cff0b7e77c8341307019decb6d43d7`, installed
Document runtime 0.67.0. The user approved recording this review and continuing
the next complete workflow group. This is an engineering assessment, not release
acceptance or evidence that a particular user's private store is full.

The direction remains a simple, attractive, independent local Mac Markdown
editor. Keep the accepted workspace and Document architecture. Do not restart
Vault/AI/plugin work or replace the editor framework.

## Findings and corrections

1. **Persistence lifecycle is the immediate priority.** Original-file saving
   refuses another transaction at 128 recovery directories. Draft storage has
   32 active groups and 128 generation records; existing logical archiving writes
   another generation and cannot proceed at the record ceiling. Neither limit
   has a sustainable user-facing offload workflow. Preserve uncertain records,
   retain recovery material, and make explicit, recoverable archiving possible.
   Raising limits or silently deleting history would not solve the lifecycle.
2. **Memory stability is not established.** The latest 22.37-minute controlled
   writing/restart run passed exact content/history/recovery checks. Closed,
   forced-GC JS heap was 11.28–12.08 MiB, while process working set rose from
   356.12 to 500.20 MiB and embedder usage from 4.18 to 15.10 MiB. A fixed-draft
   eight-cycle restore/close loop held DOM nodes at 1,227 and listeners at 224.
   These observations do not prove a leak or its elimination. Attribute growth
   before changing product code; never add forced GC to the product.
3. **Everyday file use still has friction.** Originals open read-only before
   making an editable copy; conflicts require explicit continuation. Saving is
   limited to verified ordinary local APFS locations beneath Home. External
   volumes require a native staging/recovery design, not relaxed path checks.
4. **Compatibility remains bounded.** Nested inline combinations, formatted
   multiline/hard-break structures and arbitrary image workflows can require
   Source mode. Managed PNG/JPEG support is not general clipboard/drop/relative
   image support.
5. **Acceptance and distribution remain separate.** Historical basic genuine
   input and VoiceOver passes retain their original build/scope. The user
   postponed longer real writing and heading/table spoken-feedback checks.
   Automation does not close them. Paid Developer ID/notarization is deferred.

Prior work sometimes divided stages too finely and emphasized test/version
progress more than complete product outcomes. Use complete workflow groups and
clear exit criteria. Main is clean and synchronized; keep short branches in the
existing Worktree and preserve the recovery checkout. No long-lived develop
branch or new Worktree is needed.

## Ordered delivery groups

| Group | Observable completion |
| --- | --- |
| Sustained-use reliability — next | Capacity is visible; verified inactive records can be recoverably offloaded and inspected/restored without deleting Markdown files or moving uncertain/live records. Ceiling/fault/restart tests protect continued writing. Memory conclusions remain tied to evidence. |
| Everyday file operations | Reduce open/edit/save/conflict friction; extend locations only with verified native staging and recovery. |
| Common article compatibility | Improve real unsupported Markdown/image workflows together with history, source, save and recovery. |
| Local stable candidate | Finish affected human acceptance, documentation, update/rollback and repeated real writing. Public distribution follows when prerequisites are available. |

The product is a usable development candidate, not a fully complete or publicly
accepted 1.0. Test counts and minor version numbers are not completion measures.

Evidence: PR #152 and CI run `43568161082`; private run
`.local/verification/daily-acceptance-20261114/` in the recovery checkout.
