# Document workflow consolidation

Approved 2026-11-17. Baseline: main `26b6520`, runtime 0.80.1, clean checkout.
The previous PR passed; its subsequent main CI failed the unpaced near-capacity
writing gate. That failure remains open until reproduced and resolved; a clean
Git checkpoint is not a stability sign-off.

## Product contract

1. New creates an unnamed draft without replacing other writing. Save opens one
   native destination panel when unbound; otherwise it saves the current bound
   file. Save As creates a new file and makes it the current target, updating its
   name/status. Export Copy creates a Markdown/attachment copy without rebinding.
   Existing targets are never silently overwritten by the new-file writer.
2. Source Cmd-S applies validated source and then saves the same document. Apply
   and Return remains an explicitly separate buffer-only action. Failed or unknown
   application must never proceed to a file write.
3. Clean verified files and empty new drafts close quietly. Unsaved documents
   offer Save, Keep Draft and Close, or Cancel. Whole-window closing follows the
   same per-document lifecycle; pending source, IME and unknown outcomes cannot
   be silently discarded. Backup and file-save status stay distinct.
4. Ordinary short edit acknowledgements do not make the entire workspace flash
   disabled. A bounded action intent waits for exact settled input; native IME
   candidates remain under the input method's control. Long operations show a
   clear busy state. Unknown writes/conflicts still stop automatic retries.
5. Retain the accepted visual baseline. Tighten hierarchy, menus, status and
   contextual feedback; avoid routine warning walls. Provider-specific recovery
   disclosure remains visible before a provider write. No native write proof,
   ownership, metadata, queue limit, source inverse or conflict guard is relaxed.

## Delivery sequence

Work through three coherent checkpoints: document lifecycle; input coordination
and measured long-writing repair; visual polish and end-to-end acceptance. Keep
the dependent work on one short branch until the existing main failure is fixed
and the complete candidate passes CI. Candidate version: 0.81.0. No intermediate
daily-App replacement, release tag, paid signing or public release is implied.

Tests first cover Save As/export binding and history, clean/dirty/empty close,
save cancellation/failure, source apply-then-save and pending-action identity.
Retain all failure evidence. Run the complete Node suite and affected native
Electron flows, unpaced near-capacity writing, generated/package checks, then
review the final diff. Air GUI work needs a current idle window and a bounded
snapshot. Physical IME/VoiceOver results remain human evidence, never inferred
from synthetic input. Install only after checks pass and the user has exited.

The plan review accepts the existing architecture with these boundaries: export
cannot change a binding; close cannot grant a renderer path/write policy; action
waiting cannot replay after session/revision failure; performance must improve
under the existing rate test rather than pacing it or enlarging its queue.
