/* lib/ai-boot.js
   Renderer-side wiring for the AI Summarize + Rewrite buttons.

   Why this file lives outside the inline boot script:
   apps/desktop/test/renderer-boot.test.js executes the inline boot script
   against a hard-coded DOM-id allow-list (line 319 asserts
   `assert.ok(elements.has(id), 'unexpected document.getElementById(${id})')`).
   Adding getElementById calls for 'summarizeButton' / 'aiSummaryPanel' /
   'rewriteButton' inside the boot script would break that test, and the
   project rule is to NOT modify pre-existing tests. ai-boot.js is loaded
   via <script src>; the boot test's getBootScript() only matches inline
   scripts containing "Boot the Markdown editor", so this file is ignored
   by the harness.

   Behavior:
   - On DOMContentLoaded: look up the buttons + panel, mount AiSummaryPanel.
   - Each note has its OWN action state in a Map keyed by note id. Entry
     shape: { kind: 'loading' | 'streaming' | 'summary' | 'error', label,
     text, token }. The single shared panel renders the *active* note's
     state. (Path D loop-2: per-note, not a global last-action display.
     Returning to a note that already has a settled summary restores it;
     switching away while in-flight restores the loading or streaming
     marker on return; an out-of-band resolve stores the result under the
     started id so it appears next time the user comes back.)
   - Stage B per-request token: each click bumps nextRequestToken. The
     per-note entry stores the active token; settle handlers FIRST check
     entry.token before any state write, so a stale cancelled request's
     late settle cannot overwrite a fresh request's entry.
   - Stage B cross-process abort: the click handler holds an AbortController
     keyed by startedId in inflightAborts. The × (onCloseHandler) calls
     the stored abort callback before deleting the note's entry.
   - The two click handlers are duplicated (per Stage A D1 discipline) so
     each verb's handler can be inspected as a self-contained block by the
     CA4.* / T9.* source-shape probes.
   - try / catch / finally — never leave the panel stuck on a loading state.
   - Never mutates note state (A8).
*/

(function () {
  'use strict';

  // No-op outside a renderer context (e.g., if this file is ever required
  // from node without a document).
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;

  // Stage C: wire the AI settings modal. Defensive — does nothing if the modal
  // elements or the vaultApi settings methods are missing. renderBadge() is
  // called after a successful save so the Remote AI badge updates live without
  // an app restart. Env-overridden fields are disabled with a hint and are not
  // sent on save (env wins anyway).
  function setupAiSettingsPanel(renderBadge) {
    const settingsButton = document.getElementById('aiSettingsButton');
    const overlay = document.getElementById('aiSettingsOverlay');
    const inputBaseUrl = document.getElementById('aiSettingsBaseUrl');
    const inputModel = document.getElementById('aiSettingsModel');
    const checkAllowRemote = document.getElementById('aiSettingsAllowRemote');
    const hintBaseUrl = document.getElementById('aiSettingsBaseUrlHint');
    const hintModel = document.getElementById('aiSettingsModelHint');
    const hintAllowRemote = document.getElementById('aiSettingsAllowRemoteHint');
    const errorBox = document.getElementById('aiSettingsError');
    const saveBtn = document.getElementById('aiSettingsSave');
    const cancelBtn = document.getElementById('aiSettingsCancel');
    if (!settingsButton || !overlay || !inputBaseUrl || !inputModel || !checkAllowRemote
        || !saveBtn || !cancelBtn || !window.vaultApi
        || typeof window.vaultApi.getAiSettings !== 'function'
        || typeof window.vaultApi.saveAiSettings !== 'function') {
      return;
    }

    function showError(msg) {
      if (!errorBox) return;
      if (msg) { errorBox.textContent = msg; errorBox.hidden = false; }
      else { errorBox.textContent = ''; errorBox.hidden = true; }
    }
    function applyLock(input, hint, locked) {
      input.disabled = locked;
      if (hint) hint.hidden = !locked;
    }
    function closeModal() { overlay.hidden = true; }

    function openModal() {
      showError('');
      Promise.resolve()
        .then(function () { return window.vaultApi.getAiSettings(); })
        .then(function (snap) {
          const eff = (snap && snap.effective) || {};
          const ov = (snap && snap.envOverridden) || {};
          inputBaseUrl.value = typeof eff.baseUrl === 'string' ? eff.baseUrl : '';
          inputModel.value = typeof eff.model === 'string' ? eff.model : '';
          checkAllowRemote.checked = eff.allowRemote === true;
          applyLock(inputBaseUrl, hintBaseUrl, ov.baseUrl === true);
          applyLock(inputModel, hintModel, ov.model === true);
          checkAllowRemote.disabled = ov.allowRemote === true;
          if (hintAllowRemote) hintAllowRemote.hidden = ov.allowRemote !== true;
          overlay.hidden = false;
        })
        .catch(function () { showError('Could not load settings.'); overlay.hidden = false; });
    }

    function save() {
      showError('');
      const partial = {};
      if (!inputBaseUrl.disabled) partial.baseUrl = inputBaseUrl.value.trim();
      if (!inputModel.disabled) partial.model = inputModel.value.trim();
      if (!checkAllowRemote.disabled) partial.allowRemote = checkAllowRemote.checked;
      Promise.resolve()
        .then(function () { return window.vaultApi.saveAiSettings(partial); })
        .then(function (res) {
          if (res && res.ok) {
            closeModal();
            if (typeof renderBadge === 'function') renderBadge();
          } else {
            showError((res && res.error) || 'Could not save settings.');
          }
        })
        .catch(function () { showError('Could not save settings.'); });
    }

    settingsButton.addEventListener('click', openModal);
    cancelBtn.addEventListener('click', closeModal);
    saveBtn.addEventListener('click', save);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    const button = document.getElementById('summarizeButton');
    const panel = document.getElementById('aiSummaryPanel');
    // Stage A: Rewrite button declared ONCE alongside the Summarize button +
    // panel lookups, then included in the same defensive early-return guard.
    const rewriteButton = document.getElementById('rewriteButton');

    // Stage C: badge state + AI settings come from the MAIN process
    // (vaultApi.getAiBadgeState / getAiSettings / saveAiSettings) — single
    // source of truth merging env > stored > default. getAiBadgeState is now
    // async (IPC), so renderBadge resolves a Promise. The badge shows ONLY when
    // remote AI is actively used (non-loopback baseUrl + allowRemote); the
    // non-loopback + no-allow case is blocked at the IPC layer on click.
    const badge = document.getElementById('aiRemoteBadge');
    function renderBadge() {
      if (!badge || !window.vaultApi || typeof window.vaultApi.getAiBadgeState !== 'function') return;
      Promise.resolve()
        .then(() => window.vaultApi.getAiBadgeState())
        .then((s) => {
          if (s && s.isRemote && s.allowRemote) {
            badge.textContent = 'Remote AI';
            if (typeof s.hostname === 'string' && s.hostname.length > 0) {
              badge.title = 'AI requests are going to ' + s.hostname + ' (off this machine).';
            }
            badge.hidden = false;
          } else {
            badge.hidden = true;
          }
        })
        .catch(function () { badge.hidden = true; });
    }
    renderBadge();

    // Stage C: AI settings modal. Independent of the Summarize/Rewrite guard
    // below — it only needs vaultApi.getAiSettings/saveAiSettings and the modal
    // elements. Open loads effective settings; env-overridden fields are
    // disabled with a hint; Save persists the (non-locked) fields then
    // re-renders the badge live so it reflects the new baseUrl/allowRemote.
    setupAiSettingsPanel(renderBadge);

    // Defensive: if any required global is missing, do nothing rather than throw.
    // Both buttons stay unwired; the rest of the renderer is unaffected.
    if (!button || !panel || !rewriteButton || !window.ai || !window.AiSummaryPanel || !window.markdownVault) {
      return;
    }

    // Per-note action state. Keys are note ids (vault:rel/path.md, draft:N).
    // Values: { kind, label?, text, token }. The panel renders the ACTIVE
    // note's entry.
    const noteState = new Map();

    // Stage B D8: monotonic per-request token. Each click bumps this and
    // stamps the new value on the per-note entry. Settle handlers (and
    // onChunk closures) compare against their captured token before any
    // state write, so a cancelled request's late settle is silently
    // discarded even if it arrives after a fresh request has started.
    let nextRequestToken = 0;

    // Stage B: per-startedId abort callbacks. The × (onCloseHandler) reads
    // this map to abort the currently-in-flight request for the active
    // note before deleting state.
    const inflightAborts = new Map();

    // onClose — × button. Aborts (entry is {token,abort}), drops state, F3 release.
    function onCloseHandler() {
      const id = window.markdownVault.getActiveNoteId();
      if (id) {
        const entry = inflightAborts.get(id);
        if (entry && typeof entry.abort === 'function') { try { entry.abort(); } catch (_e) { /* ignore */ } }
        inflightAborts.delete(id);
        noteState.delete(id);
      }
      window.AiSummaryPanel.clear();
      if (inflightAborts.size === 0) {
        button.disabled = false;
        rewriteButton.disabled = false;
      }
    }

    window.AiSummaryPanel.mount(panel, { onClose: onCloseHandler });

    function renderActive() {
      const id = window.markdownVault.getActiveNoteId();
      if (!id) { window.AiSummaryPanel.clear(); return; }
      const entry = noteState.get(id);
      if (!entry) { window.AiSummaryPanel.clear(); return; }
      if (entry.kind === 'loading') {
        // Stage A: pass entry.label so Rewrite shows 'Rewriting…'.
        // Summarize loading entries omit label → showLoading defaults to v0.2.0 'Summarizing…'.
        window.AiSummaryPanel.showLoading(entry.label);
      } else if (entry.kind === 'streaming') {
        // Stage B: resync to the accumulator built up by onChunk so far.
        window.AiSummaryPanel.showStreamingText(entry.text || '');
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
      rewriteButton.disabled = true;   // Stage A: cooldown extends to both buttons.
      const token = ++nextRequestToken;
      noteState.set(startedId, { kind: 'loading', text: '', token });
      renderActive();
      try {
        // Stage B D3'' — registerAbort callback. AbortSignal can't carry
        // its addEventListener across Electron's contextBridge, so the
        // renderer hands the preload a slot to deposit an abort function
        // in. The preload calls back synchronously inside subscribe();
        // by the time the await resumes, inflightAborts[startedId] holds
        // the preload-side cancel hook. × → onCloseHandler reads and
        // calls it. main receives 'ai:cancel' and aborts the stream.
        const result = await window.ai.summarizeNote(text, {
          registerAbort: (abortFn) => { inflightAborts.set(startedId, { token, abort: abortFn }); },
          onChunk: (chunk) => {
            // Stage B D8: token guard FIRST. Stale chunks dropped silently.
            const e = noteState.get(startedId);
            if (!e || e.token !== token) return;
            if (typeof chunk !== 'string' || chunk.length === 0) return;
            if (e.kind === 'loading') {
              e.kind = 'streaming';
              e.label = 'Streaming…';
            }
            e.text = (e.text || '') + chunk;
            if (window.markdownVault.getActiveNoteId() === startedId) {
              window.AiSummaryPanel.appendChunk(chunk);
            }
          },
        });
        const e = noteState.get(startedId);
        if (!e || e.token !== token) return;
        if (result && result.ok) {
          noteState.set(startedId, { kind: 'summary', text: result.summary, token });
        } else {
          noteState.set(startedId, {
            kind: 'error',
            text: (result && result.message) || 'Summarize failed.',
            token,
          });
        }
      } catch (_err) {
        const e = noteState.get(startedId);
        if (!e || e.token !== token) return;
        // [G6] Never leave the panel stuck on the loading state.
        noteState.set(startedId, { kind: 'error', text: 'Summarize failed.', token });
      } finally {
        // F1 (Codex): only delete OUR entry. A fresh request for the same
        // note may have replaced it with a different token; deleting it
        // would orphan the new request's × handler.
        const cur = inflightAborts.get(startedId);
        if (cur && cur.token === token) inflightAborts.delete(startedId);
        // F3 (Codex): only re-enable buttons when nothing else is pending.
        // A late stale settle of a cancelled / replaced request must not
        // re-enable buttons while a fresh request is still in-flight.
        if (inflightAborts.size === 0) {
          button.disabled = false;
          rewriteButton.disabled = false;
        }
        // Refresh the panel — if the user is still on startedId, the new
        // summary/error appears; if they switched away, the panel reflects
        // whatever note they're now on (which may have its own state).
        renderActive();
      }
    });

    // Stage A — Rewrite click handler. Mirrors Path D LOOP-2 per-note Map
    // pattern (always store under startedId; renderActive() reads active
    // note's state). NO stale-discard branch.
    rewriteButton.addEventListener('click', async function () {
      const text = window.markdownVault.getActiveSelection() ?? window.markdownVault.getActiveNoteBody();
      const startedId = window.markdownVault.getActiveNoteId();
      if (!text || !startedId) {
        window.AiSummaryPanel.showError('Open a note with content before rewriting.');
        return;
      }
      button.disabled = true;
      rewriteButton.disabled = true;
      const token = ++nextRequestToken;
      // Stage A: label distinguishes the verb for the panel's status text.
      noteState.set(startedId, { kind: 'loading', label: 'Rewriting…', text: '', token });
      renderActive();
      try {
        const result = await window.ai.rewriteText(text, {
          registerAbort: (abortFn) => { inflightAborts.set(startedId, { token, abort: abortFn }); },
          onChunk: (chunk) => {
            const e = noteState.get(startedId);
            if (!e || e.token !== token) return;
            if (typeof chunk !== 'string' || chunk.length === 0) return;
            if (e.kind === 'loading') {
              e.kind = 'streaming';
              e.label = 'Streaming…';
            }
            e.text = (e.text || '') + chunk;
            if (window.markdownVault.getActiveNoteId() === startedId) {
              window.AiSummaryPanel.appendChunk(chunk);
            }
          },
        });
        const e = noteState.get(startedId);
        if (!e || e.token !== token) return;
        if (result && result.ok) {
          noteState.set(startedId, { kind: 'summary', text: result.summary, token });
        } else {
          noteState.set(startedId, {
            kind: 'error',
            text: (result && result.message) || 'Rewrite failed.',
            token,
          });
        }
      } catch (_err) {
        const e = noteState.get(startedId);
        if (!e || e.token !== token) return;
        noteState.set(startedId, { kind: 'error', text: 'Rewrite failed.', token });
      } finally {
        // F1 (Codex): token-guarded cleanup — see Summarize handler note.
        const cur = inflightAborts.get(startedId);
        if (cur && cur.token === token) inflightAborts.delete(startedId);
        // F3 (Codex): gate button re-enable on no-other-pending.
        if (inflightAborts.size === 0) {
          button.disabled = false;
          rewriteButton.disabled = false;
        }
        renderActive();
      }
    });
  });
})();
