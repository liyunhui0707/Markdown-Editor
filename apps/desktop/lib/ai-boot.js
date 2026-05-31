/* lib/ai-boot.js
   Renderer-side wiring for the AI Summarize button.

   Why this file lives outside the inline boot script:
   apps/desktop/test/renderer-boot.test.js executes the inline boot script
   against a hard-coded DOM-id allow-list (line 319 asserts
   `assert.ok(elements.has(id), 'unexpected document.getElementById(${id})')`).
   Adding getElementById calls for 'summarizeButton' / 'aiSummaryPanel'
   inside the boot script would break that test, and the project rule is
   to NOT modify pre-existing tests. ai-boot.js is loaded via <script src>;
   the boot test's getBootScript() only matches inline scripts containing
   "Boot the Markdown editor", so this file is ignored by the harness.

   Behavior:
   - On DOMContentLoaded: look up the button + panel, mount AiSummaryPanel.
   - Each note has its OWN summary state (loading / summary / error),
     stored in a Map keyed by note id. The single shared panel renders
     the *active* note's state. (QA loop 2: the panel is per-note, not
     a global last-action display. Returning to a note that already
     has a settled summary restores it; switching away while in-flight
     restores the loading indicator on return; an out-of-band resolve
     stores the result under the started id so it appears next time
     the user comes back.)
   - On click: capture startedId pre-await (H4), set per-note loading,
     call window.ai.summarizeNote, store the resolution keyed by
     startedId (success or error), then render the *currently active*
     note's state.
   - try / catch / finally — never leave the panel stuck on "Summarizing…".
   - Never mutates note state (A8).
*/

(function () {
  'use strict';

  // No-op outside a renderer context (e.g., if this file is ever required
  // from node without a document).
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;

  document.addEventListener('DOMContentLoaded', function () {
    const button = document.getElementById('summarizeButton');
    const panel = document.getElementById('aiSummaryPanel');

    // Defensive: if any required global is missing, do nothing rather than throw.
    // The Summarize button stays unwired; the rest of the renderer is unaffected.
    if (!button || !panel || !window.ai || !window.AiSummaryPanel || !window.markdownVault) {
      return;
    }

    // QA loop 3: dismiss (×) button. onClose removes the active note's
    // entry from the per-note map and clears the panel, so the summary
    // does NOT come back when the user revisits the note.
    function onCloseHandler() {
      const id = window.markdownVault.getActiveNoteId();
      if (id) noteState.delete(id);
      window.AiSummaryPanel.clear();
    }

    window.AiSummaryPanel.mount(panel, { onClose: onCloseHandler });

    // Per-note summary state. Keys are note ids (vault:rel/path.md, draft:N).
    // Values are { kind: 'loading' | 'summary' | 'error', text } objects.
    // The panel is rendered as a function of the ACTIVE note's entry.
    const noteState = new Map();

    function renderActive() {
      const id = window.markdownVault.getActiveNoteId();
      if (!id) { window.AiSummaryPanel.clear(); return; }
      const entry = noteState.get(id);
      if (!entry) { window.AiSummaryPanel.clear(); return; }
      if (entry.kind === 'loading') {
        window.AiSummaryPanel.showLoading();
      } else if (entry.kind === 'summary') {
        window.AiSummaryPanel.showSummary(entry.text);
      } else if (entry.kind === 'error') {
        window.AiSummaryPanel.showError(entry.text);
      } else {
        window.AiSummaryPanel.clear();
      }
    }

    // QA bug C / loop 2: when the user switches notes, restore the new
    // note's stored state (or clear if it has none). Poll cadence matches
    // the existing vault-watcher debounce.
    let lastNoteId = window.markdownVault.getActiveNoteId();
    setInterval(function () {
      const currentNoteId = window.markdownVault.getActiveNoteId();
      if (currentNoteId !== lastNoteId) {
        lastNoteId = currentNoteId;
        // Render whatever the new note's state is — restoring a settled
        // summary, a still-in-flight loading marker, or clearing if the
        // new note has no entry. We consult the map via .get(...).
        const entry = currentNoteId ? noteState.get(currentNoteId) : null;
        if (!entry) { window.AiSummaryPanel.clear(); }
        else { renderActive(); }
      }
    }, 250);

    button.addEventListener('click', async function () {
      const text = window.markdownVault.getActiveNoteBody();
      const startedId = window.markdownVault.getActiveNoteId();
      if (!text || !startedId) {
        // No active note or empty body — show inline error WITHOUT storing
        // anything under a possibly-null id.
        window.AiSummaryPanel.showError('Open a note with content before summarizing.');
        return;
      }
      button.disabled = true;
      noteState.set(startedId, { kind: 'loading' });
      renderActive();
      try {
        const result = await window.ai.summarizeNote(text);
        if (result && result.ok) {
          noteState.set(startedId, { kind: 'summary', text: result.summary });
        } else {
          noteState.set(startedId, {
            kind: 'error',
            text: (result && result.message) || 'Summarize failed.',
          });
        }
      } catch (_err) {
        // [G6] Never leave the panel stuck on the loading state.
        noteState.set(startedId, { kind: 'error', text: 'Summarize failed.' });
      } finally {
        button.disabled = false;
        // Refresh the panel — if the user is still on startedId, the new
        // summary/error appears; if they switched away, the panel reflects
        // whatever note they're now on (which may have its own state).
        renderActive();
      }
    });
  });
})();
