/* Renderer boot wiring tests for index.html.
   Run: node --test test/renderer-boot.test.js

   These tests execute the real inline boot script against a small fake
   renderer environment. They pin Step 4 behavior: the production CM6 adapter
   is the default Write-mode engine, while HybridWriteView is reachable only
   when the write engine resolver explicitly selects 'hybrid' (via
   ?writeEngine=hybrid or localStorage markdownVault.writeEngine='hybrid'). */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');
const vm       = require('node:vm');

const WriteEngine = require('../lib/write-engine');
const FileName    = require('../lib/file-name');
const ScrollSync  = require('../lib/scroll-sync');
const DocStats    = require('../lib/doc-stats');
const NoteRow     = require('../lib/note-row');
const DirtyState  = require('../lib/dirty-state');

function readIndexHtml() {
  return fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
}

function getBootScript(html) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  const boot = scripts
    .map((match) => match[1])
    .find((content) => content.includes('Boot the Markdown editor'));
  assert.ok(boot, 'expected to find the inline renderer boot script');
  return boot;
}

function makeClassList(element) {
  const set = new Set();
  return {
    add(...names) {
      names.forEach((name) => set.add(name));
      element.className = [...set].join(' ');
    },
    remove(...names) {
      names.forEach((name) => set.delete(name));
      element.className = [...set].join(' ');
    },
    contains(name) {
      return set.has(name);
    },
    toggle(name) {
      if (set.has(name)) {
        set.delete(name);
        element.className = [...set].join(' ');
        return false;
      }
      set.add(name);
      element.className = [...set].join(' ');
      return true;
    },
  };
}

function makeStyle() {
  // Stage 13: real-DOM CSSStyleDeclaration supports both direct property
  // access (`el.style.fontSize = 'x'`) AND method access
  // (`el.style.setProperty('--editor-font-size', 'x')` /
  // `.getPropertyValue('--editor-font-size')`). The fake style mirrors both
  // by keeping the values on the same backing object, so production code can
  // use whichever form it prefers.
  const style = {};
  Object.defineProperty(style, 'setProperty', {
    enumerable: false,
    value(name, value) { this[name] = value; },
  });
  Object.defineProperty(style, 'getPropertyValue', {
    enumerable: false,
    value(name) {
      const v = this[name];
      return v == null ? '' : String(v);
    },
  });
  return style;
}

function makeElement(tag = 'div', id = '') {
  const el = {
    tagName: tag.toUpperCase(),
    id,
    className: '',
    _innerHTML: '',
    textContent: '',
    value: '',
    style: makeStyle(),
    children: [],
    attributes: {},
    handlers: {},
    classList: null,
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    offsetTop: 0,
    offsetHeight: 0,
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    addEventListener(type, handler) {
      (this.handlers[type] = this.handlers[type] || []).push(handler);
    },
    fire(type, event = {}) {
      const payload = {
        type,
        target: this,
        stopPropagation() {},
        ...event,
      };
      (this.handlers[type] || []).forEach((handler) => handler(payload));
    },
    async fireAsync(type, event = {}) {
      const payload = {
        type,
        target: this,
        stopPropagation() {},
        ...event,
      };
      await Promise.all((this.handlers[type] || []).map((handler) => handler(payload)));
    },
    focus() {},
    select() {},
    contains(node) {
      if (this === node) return true;
      for (const child of this.children) {
        if (child === node) return true;
        if (child && typeof child.contains === 'function' && child.contains(node)) return true;
      }
      return false;
    },
    getBoundingClientRect() {
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    },
  };

  Object.defineProperty(el, 'innerHTML', {
    get() {
      return this._innerHTML;
    },
    set(value) {
      this._innerHTML = String(value);
      if (this._innerHTML === '') {
        this.children = [];
      }
    },
  });

  return el;
}

function makeRendererHarness({
  search = '',
  storageValue = null,
  // Stage 13: arbitrary localStorage key seeding. `storageValue` remains the
  // shorthand for `markdownVault.writeEngine` (existing tests). When both are
  // provided, an explicit `storageEntries` entry for the same key OVERRIDES
  // the shorthand seeded value.
  storageEntries = null,
  vaultNotes = [],
  // Stage 6.2: when true, the harness's VaultActions.chooseVaultFolder
  // simulates the user dismissing the OS folder picker — it leaves the
  // vault path unset and the notes array unchanged. Used to test the
  // Save-without-vault cancellation branch.
  chooseVaultCanceled = false,
} = {}) {
  const ids = [
    'titleInput',
    'liveEditorContainer',
    'searchInput',
    'searchMeta',
    'ingestBanner',
    'statusText',
    'vaultPathText',
    'docWords',
    'docChars',
    'docLines',
    'docEngine',
    'chooseVaultButton',
    'newNoteButton',
    'saveNoteButton',
    'deleteNoteButton',
    'loadVaultButton',
    'sidebarToggle',
    'sidebarPanel',
    'noteList',
    'mainLayout',
    'filterAll',
    'filterAi',
    'filterDrafts',
    'filterVault',
    'filterAllMeta',
    'filterAiMeta',
    'filterDraftsMeta',
    'filterVaultMeta',
    'hybridWritePane',
    'toastPreviewMount',
    'writeModeButton',
    'previewModeButton',
  ];

  const elements = new Map();
  for (const id of ids) {
    const element = makeElement(id === 'titleInput' ? 'textarea' : id === 'searchInput' ? 'input' : 'div', id);
    element.classList = makeClassList(element);
    elements.set(id, element);
  }

  // Bug #2 scroll-sync: production code finds the Preview scroller via
  // toastPreviewMount.querySelector('.toastui-editor-md-preview'). The harness
  // simulates that lookup by attaching a stand-in scroll element and a
  // minimal querySelector that returns it for the known selector.
  //
  // Toast UI's real DOM contains a nested .toastui-editor-contents element
  // INSIDE .toastui-editor-md-preview that ends up being the visible
  // scroller in our embedding. The harness mirrors that nesting: the outer
  // stand-in exposes querySelector('.toastui-editor-contents') so the
  // production code can find and write the ratio to both surfaces.
  const _previewContentsEl = makeElement('div');
  _previewContentsEl.classList = makeClassList(_previewContentsEl);
  _previewContentsEl.scrollTop = 0;
  _previewContentsEl.scrollHeight = 0;
  _previewContentsEl.clientHeight = 0;

  const _previewScrollEl = makeElement('div');
  _previewScrollEl.classList = makeClassList(_previewScrollEl);
  _previewScrollEl.scrollTop = 0;
  _previewScrollEl.scrollHeight = 0;
  _previewScrollEl.clientHeight = 0;
  _previewScrollEl._previewContentsEl = _previewContentsEl;
  _previewScrollEl.querySelector = function (selector) {
    return selector === '.toastui-editor-contents' ? _previewContentsEl : null;
  };
  // #23-C: also attach the nested contents as a real child so the harness's
  // recursive contains() matches real-DOM Node.contains semantics. Tests can
  // still reach the nested node via the _previewContentsEl alias above.
  _previewScrollEl.appendChild(_previewContentsEl);

  const _toastPreviewMount = elements.get('toastPreviewMount');
  _toastPreviewMount.scrollTop = 0;
  _toastPreviewMount.scrollHeight = 0;
  _toastPreviewMount.clientHeight = 0;
  _toastPreviewMount._previewScrollEl = _previewScrollEl;
  _toastPreviewMount.querySelector = function (selector) {
    return selector === '.toastui-editor-md-preview' ? _previewScrollEl : null;
  };
  // #23-C: also attach the preview scroller as a real child so the harness's
  // recursive contains() matches real-DOM Node.contains semantics.
  _toastPreviewMount.appendChild(_previewScrollEl);
  // hybridWritePane is the Write-side scroll container for both Hybrid and
  // CM6 (the CM6 view mounts inside it via Cm6WriteView's `parent: parent`,
  // and its outer pane's `overflow: auto` handles scrolling).
  const _hybridWritePane = elements.get('hybridWritePane');
  _hybridWritePane.scrollTop = 0;
  _hybridWritePane.scrollHeight = 0;
  _hybridWritePane.clientHeight = 0;

  const documentHandlers = {};
  // Stage 13: production code calls
  // `document.documentElement.style.setProperty('--editor-font-size', ...)`
  // to set the CSS variable on `:root`. Tests inspect via
  // `harness.document.documentElement.style.getPropertyValue('--editor-font-size')`.
  const _documentElement = makeElement('html', 'documentElement');
  const document = {
    activeElement: null,
    documentElement: _documentElement,
    getElementById(id) {
      assert.ok(elements.has(id), `unexpected document.getElementById(${id})`);
      return elements.get(id);
    },
    createElement(tag) {
      const element = makeElement(tag);
      element.classList = makeClassList(element);
      return element;
    },
    addEventListener(type, handler) {
      (documentHandlers[type] = documentHandlers[type] || []).push(handler);
    },
  };

  const calls = {
    resolvedEngines: [],
    consoleDebug: [],
    toastConstructed: 0,
    toastSetMarkdown: [],
    toastEmits: [],
    hybridConstructed: 0,
    hybridSetText: [],
    hybridGetText: 0,
    hybridExitWriteMode: 0,
    hybridOnChange: null,
    hybridAdapter: null,
    cm6Constructed: 0,
    cm6Parent: null,
    cm6Options: null,
    cm6SetText: [],
    cm6GetText: 0,
    cm6ExitWriteMode: 0,
    cm6OnChange: null,
    cm6Adapter: null,
    cm6GetState: 0,
    cm6SetState: [],
    cm6HybridConstructed: 0,
    cm6HybridParent: null,
    cm6HybridOptions: null,
    cm6HybridSetText: [],
    cm6HybridGetText: 0,
    cm6HybridOnChange: null,
    cm6HybridAdapter: null,
    cm6HybridGetState: 0,
    cm6HybridSetState: [],
    loadVaultNotesPayloads: [],
    saveNotePayloads: [],
    watchVaultFolderPayloads: [],
    unwatchVaultFolder: 0,
    vaultChangedCallback: null,
    rafQueue: [],
    // Captures the most recently constructed Toast UI instance so tests can
    // poke its scrollSync methods directly. Used by the "Toast UI scroll-sync
    // is neutralized after boot" test.
    toastInstance: null,
    // Spy counters for Toast UI's internal scroll-sync methods. The mock's
    // scrollSync object initially points its methods at these spies; the
    // production code replaces them with no-ops immediately after the editor
    // is constructed. Tests invoke the (now-replaced) methods on
    // calls.toastInstance.scrollSync and assert the spy counters do NOT
    // increment — proving the override actually ran.
    toastNativeSyncPreview: 0,
    toastNativeSyncEditor: 0,
    // Bug #2 follow-up: opt-in flag that simulates Toast UI's own
    // scroll-after-setMarkdown by enqueueing a "scroll preview to bottom"
    // rAF on the harness queue. Tests that prove our apply runs LAST
    // (double-rAF) flip this to true.
    toastAutoScrollOnSetMarkdown: false,
    // Bug #2 timing follow-up: opt-in flag that simulates Toast UI's
    // ScrollSync2.addScrollSyncEvent (lib/toastui-bundle.js:32882-32889),
    // which schedules `syncPreviewScrollTop(true)` on a 200 ms setTimeout
    // off `afterPreviewRender`. That timer scrolls the preview to the
    // (hidden) MD editor's cursor — typically end-of-document — and stomps
    // any earlier scroll write. Tests that exercise the bounded-retry
    // helper flip this to true and drain via `flushTimers()`.
    toastDelayedScrollOnSetMarkdown: false,
    // Queue-aware setTimeout substitute. Each entry is { cb, delay }.
    // flushTimers() drains rAF and setTimeout queues alternately until
    // both stabilize, processing setTimeouts in delay order so that
    // simulated Toast UI's 200 ms timer fires before our 250 ms tier-3.
    setTimeoutQueue: [],
    // Stage 6.3A: captured callback the renderer registers via
    // vaultApi.onCloseRequest. Tests invoke it with a respond spy to
    // observe the dirty-summary the renderer reports back to main.
    closeRequestHandler: null,
    // Stage 6.3B: captured callback the renderer registers via
    // vaultApi.onSaveAllRequest. Tests invoke it with a respond spy
    // and await the result that saveAllDirtyNotes computes.
    saveAllRequestHandler: null,
  };

  // Stage 13: multi-key localStorage shim with setItem recording.
  //   - Seed `markdownVault.writeEngine` from `storageValue` shorthand first.
  //   - Then apply explicit `storageEntries` so they OVERRIDE the shorthand
  //     for the same key.
  //   - `getItem` returns the seeded value or null (no key-name assertion;
  //     production now reads multiple keys: writeEngine, editorFontSize, ...).
  //   - `setItem` mutates the map AND pushes [key, value] to `setItemCalls`
  //     so tests can assert persistence behavior.
  const _storageMap = {};
  if (storageValue != null) {
    _storageMap[WriteEngine.STORAGE_KEY] = storageValue;
  }
  if (storageEntries && typeof storageEntries === 'object') {
    for (const k of Object.keys(storageEntries)) {
      _storageMap[k] = storageEntries[k];
    }
  }
  const setItemCalls = [];
  const storage = {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(_storageMap, key)
        ? _storageMap[key]
        : null;
    },
    setItem(key, value) {
      _storageMap[key] = String(value);
      setItemCalls.push([key, String(value)]);
    },
  };

  function ToastuiEditor(config) {
    calls.toastConstructed += 1;
    this.config = config;
    this.eventEmitter = {
      emit(name) {
        calls.toastEmits.push(name);
      },
    };
    // Mirror Toast UI's real shape: ScrollSync2 is exposed on the editor as
    // `this.scrollSync`. The production code overrides these two methods
    // with no-ops right after construction, so subsequent calls become a
    // no-op. Tests invoke them on calls.toastInstance to verify the
    // override took effect.
    this.scrollSync = {
      syncPreviewScrollTop: function () { calls.toastNativeSyncPreview += 1; },
      syncEditorScrollTop:  function () { calls.toastNativeSyncEditor  += 1; },
    };
    calls.toastInstance = this;
    this.setMarkdown = (text) => {
      calls.toastSetMarkdown.push(text);
      // Optional simulation: real Toast UI scrolls its preview after a
      // setMarkdown re-render (cursor-tracking) in a TWO-frame schedule.
      // The first rAF stub fires; its body enqueues the actual scroll for
      // the NEXT flushRaf pass. With single-rAF apply, our apply runs in
      // pass 1 alongside the stub, then the actual scroll lands in pass 2
      // and overrides — that is the reported bug. With double-rAF apply,
      // our inner apply runs in pass 2 AFTER the actual scroll (FIFO) and
      // wins. This is what makes the bug-1 test fail-first under single
      // rAF and pass under double rAF.
      if (calls.toastAutoScrollOnSetMarkdown) {
        calls.rafQueue.push(function toastAutoScrollFirstFrameStub() {
          calls.rafQueue.push(function toastAutoScrollSecondFrameScroll() {
            const max = (_previewScrollEl.scrollHeight || 0) - (_previewScrollEl.clientHeight || 0);
            if (max > 0) _previewScrollEl.scrollTop = max;
          });
        });
      }
      // Realistic simulation: Toast UI's ScrollSync2 schedules its preview
      // scroll on a 200 ms setTimeout off `afterPreviewRender` (its
      // syncPreviewScrollTop reads the hidden MD editor's cursor and writes
      // the preview's scrollTop). Tests use flushTimers() to drain.
      if (calls.toastDelayedScrollOnSetMarkdown) {
        calls.setTimeoutQueue.push({
          cb: function toastDelayedAfterPreviewRender() {
            const max = (_previewScrollEl.scrollHeight || 0) - (_previewScrollEl.clientHeight || 0);
            if (max > 0) _previewScrollEl.scrollTop = max;
          },
          delay: 200,
        });
      }
    };
  }

  function HybridWriteView(parent, opts) {
    calls.hybridConstructed += 1;
    this.parent = parent;
    this.opts = opts || {};
    calls.hybridOnChange = this.opts.onChange;
    this.text = '';
    this.getText = () => {
      calls.hybridGetText += 1;
      return this.text;
    };
    this.setText = (text) => {
      const value = text == null ? '' : String(text);
      calls.hybridSetText.push(value);
      this.text = value;
    };
    this.exitWriteMode = () => {
      calls.hybridExitWriteMode += 1;
    };
    calls.hybridAdapter = this;
  }

  const CM6Production = { _kind: 'CM6Production' };

  const Cm6WriteView = {
    createCm6WriteView(parent, opts) {
      calls.cm6Constructed += 1;
      calls.cm6Parent = parent;
      calls.cm6Options = opts || {};
      calls.cm6OnChange = calls.cm6Options.onChange;
      const initialDoc = calls.cm6Options.initialDoc || '';
      const adapter = {
        text: initialDoc,
        // _state mimics the opaque CM6 EditorState: an object whose `doc`
        // matches the current text. setText creates a fresh state object
        // (mirroring `view.setState(buildState(...))` in the real adapter);
        // setState replaces it with whatever the caller hands back.
        _state: { doc: initialDoc, _kind: 'fresh' },
        getText() {
          calls.cm6GetText += 1;
          return this.text;
        },
        setText(text) {
          const value = text == null ? '' : String(text);
          calls.cm6SetText.push(value);
          this.text = value;
          this._state = { doc: value, _kind: 'fresh' };
        },
        getState() {
          calls.cm6GetState += 1;
          // Snapshot current text into the state's doc on read. Real CM6
          // state.doc always reflects the current document; tests that
          // simulate user typing by setting `adapter.text` directly would
          // otherwise leave _state.doc stale and break the host's
          // doc-vs-body cache mismatch guard.
          this._state = { ...this._state, doc: this.text };
          return this._state;
        },
        setState(state) {
          calls.cm6SetState.push(state);
          this._state = state;
          this.text = state && typeof state.doc === 'string' ? state.doc : '';
        },
        exitWriteMode() {
          calls.cm6ExitWriteMode += 1;
        },
      };
      calls.cm6Adapter = adapter;
      return adapter;
    },
  };

  // Stage 11.2: mock for the hybrid-cm6 adapter
  const Cm6HybridView = {
    createCm6HybridView(parent, opts) {
      calls.cm6HybridConstructed += 1;
      calls.cm6HybridParent  = parent;
      calls.cm6HybridOptions = opts || {};
      calls.cm6HybridOnChange = calls.cm6HybridOptions.onChange;
      const initialDoc = calls.cm6HybridOptions.initialDoc || '';
      const adapter = {
        text: initialDoc,
        _state: { doc: initialDoc, _kind: 'fresh' },
        getText() {
          calls.cm6HybridGetText += 1;
          return this.text;
        },
        setText(text) {
          const value = text == null ? '' : String(text);
          calls.cm6HybridSetText.push(value);
          this.text  = value;
          this._state = { doc: value, _kind: 'fresh' };
        },
        getState() {
          calls.cm6HybridGetState += 1;
          this._state = { ...this._state, doc: this.text };
          return this._state;
        },
        setState(state) {
          calls.cm6HybridSetState.push(state);
          this._state = state;
          this.text = state && typeof state.doc === 'string' ? state.doc : '';
        },
        exitWriteMode() {},
      };
      calls.cm6HybridAdapter = adapter;
      return adapter;
    },
  };

  let nextSavedFileId = 1;
  // Auto-default loadedTitle = title so vaultNotes config doesn't have to set
  // it explicitly. parseMarkdownFile in main.js does the same on real disk
  // loads — the harness mirrors that contract here.
  const persistedVaultNotes = vaultNotes.map((note) => ({
    frontmatter: { tags: [], source: '', ...(note.frontmatter || {}) },
    aiImported: false,
    fileName: '',
    relativePath: '',
    source: 'vault',
    meta: 'File note',
    ...note,
    loadedTitle: note.loadedTitle != null ? note.loadedTitle : note.title,
  }));

  const vaultApi = {
    async loadVaultNotes(payload) {
      calls.loadVaultNotesPayloads.push(payload);
      return {
        ok: true,
        // Reload semantics: loadedTitle on the returned notes is the disk
        // title at refresh time, matching real parseMarkdownFile behavior.
        notes: persistedVaultNotes.map((note) => ({
          ...note,
          loadedTitle: note.title,
          frontmatter: { ...(note.frontmatter || {}) },
        })),
      };
    },
    async saveNote(payload) {
      calls.saveNotePayloads.push(payload);

      // Decide whether this is a rename. Mirrors the real performSaveNote:
      //   rename only when source==='vault' && relativePath && titleChanged
      //   && derived target differs case-insensitively from current path.
      let relativePath = payload.note.relativePath || `saved-${nextSavedFileId}.md`;
      let renamed = false;
      let oldRelativePath;

      const isVaultBacked = payload.note.source === 'vault' && payload.note.relativePath;
      if (isVaultBacked) {
        const loaded = payload.note.loadedTitle != null ? payload.note.loadedTitle : payload.note.title;
        if (payload.note.title !== loaded) {
          const derived = FileName.deriveRenameRelativePath(payload.note.relativePath, payload.note.title);
          if (derived.toLowerCase() !== String(payload.note.relativePath).toLowerCase()) {
            const collidesOnDisk = persistedVaultNotes.some((n) =>
              String(n.relativePath).toLowerCase() === derived.toLowerCase()
              && n.relativePath !== payload.note.relativePath
            );
            if (collidesOnDisk) {
              return {
                ok: false,
                conflict: true,
                relativePath: derived,
                error: `A note named "${derived}" already exists in this vault. Rename your note to save without overwriting.`,
              };
            }
            oldRelativePath = payload.note.relativePath;
            relativePath = derived;
            renamed = true;
          }
        }
      } else if (!payload.note.relativePath) {
        nextSavedFileId += 1;
      }

      const fileName = payload.note.fileName || relativePath.split('/').pop();
      const savedNote = {
        id: `vault:${relativePath}`,
        title: payload.note.title,
        loadedTitle: payload.note.title,
        body: payload.note.body,
        fileName,
        relativePath,
        source: 'vault',
        aiImported: false,
        meta: 'File note',
        frontmatter: { ...(payload.note.frontmatter || {}) },
      };

      if (renamed) {
        // Remove the old persisted entry to mirror disk-side unlink.
        const oldIndex = persistedVaultNotes.findIndex((n) => n.relativePath === oldRelativePath);
        if (oldIndex >= 0) persistedVaultNotes.splice(oldIndex, 1);
      }

      const existingIndex = persistedVaultNotes.findIndex((note) => note.relativePath === relativePath);
      if (existingIndex >= 0) {
        persistedVaultNotes[existingIndex] = savedNote;
      } else {
        persistedVaultNotes.push(savedNote);
      }
      return {
        ok: true,
        fileName,
        relativePath,
        ...(renamed ? { renamed: true, oldRelativePath } : {}),
      };
    },
    async watchVaultFolder(payload) {
      calls.watchVaultFolderPayloads.push(payload);
      return { ok: true };
    },
    onVaultChanged(callback) {
      calls.vaultChangedCallback = callback;
      return () => {
        if (calls.vaultChangedCallback === callback) {
          calls.vaultChangedCallback = null;
        }
      };
    },
    // Stage 6.3A: the renderer registers one callback that, when
    // invoked by main at close time, computes the current dirty
    // summary and calls back via `respond`. Tests drive this directly.
    onCloseRequest(handler) {
      calls.closeRequestHandler = handler;
      return () => {
        if (calls.closeRequestHandler === handler) {
          calls.closeRequestHandler = null;
        }
      };
    },
    // Stage 6.3B: parallel registration channel for Save All & Quit.
    // Main asks the renderer to save every dirty note; the handler
    // calls saveAllDirtyNotes() and reports a single ok/error result.
    onSaveAllRequest(handler) {
      calls.saveAllRequestHandler = handler;
      return () => {
        if (calls.saveAllRequestHandler === handler) {
          calls.saveAllRequestHandler = null;
        }
      };
    },
    async unwatchVaultFolder() {
      calls.unwatchVaultFolder += 1;
      return { ok: true };
    },
    async deleteNoteFile(payload) {
      calls.deleteNoteFilePayloads = calls.deleteNoteFilePayloads || [];
      calls.deleteNoteFilePayloads.push(payload);
      const idx = persistedVaultNotes.findIndex((n) => n.relativePath === payload.relativePath);
      if (idx >= 0) persistedVaultNotes.splice(idx, 1);
      return {
        ok: true,
        fileName: String(payload.relativePath || '').split('/').pop(),
        relativePath: payload.relativePath,
      };
    },
  };

  const VaultActions = {
    async chooseVaultFolder({
      vaultApi: _vaultApi,
      setCurrentVaultPath,
      stopWatching,
      startWatching,
      refreshVaultNotes,
      updateDisplay,
      setStatus,
    }) {
      assert.equal(_vaultApi, vaultApi);
      // Stage 6.2: simulated user cancellation of the OS folder picker.
      // Match the production behavior in lib/vault-actions.js: leave the
      // vault path unset and emit the canceled status message.
      if (chooseVaultCanceled) {
        setStatus('ready', 'Vault selection canceled');
        return;
      }
      await stopWatching();
      setCurrentVaultPath('/fake-vault');
      updateDisplay();
      await startWatching();
      // Stage 6.2: pass updateStatus=true so refreshVaultNotes itself
      // emits the post-load message via its derived helper (which keeps
      // Draft visible for a preserved dirty draft). The harness used to
      // emit its own 'Vault loaded' here imperatively — that would now
      // shadow Draft.
      await refreshVaultNotes('', true);
    },
  };

  const window = {
    location: { search },
    localStorage: storage,
    console: {
      debug(...args) {
        calls.consoleDebug.push(args);
      },
    },
    addEventListener() {},
    ToastuiEditor,
    HybridWriteView,
    Cm6WriteView,
    Cm6HybridView,
    CM6Production,
    WriteEngine: {
      ...WriteEngine,
      resolveWriteEngine(opts) {
        const engine = WriteEngine.resolveWriteEngine(opts);
        calls.resolvedEngines.push(engine);
        return engine;
      },
    },
    FileName,
    ScrollSync,
    DocStats,
    NoteRow,
    DirtyState,
    makeEditorConfig(el) {
      return { el, initialValue: '' };
    },
    confirm() {
      return false;
    },
    vaultApi,
    VaultActions,
  };

  const context = {
    window,
    VaultActions,
    document,
    console: window.console,
    // Queue-aware setTimeout / clearTimeout. flushTimers() in the return
    // value drains both rAF and setTimeout queues — this lets tests
    // simulate Toast UI's 200 ms afterPreviewRender setTimeout and verify
    // the apply-with-retries helper still wins via its 250 ms tier.
    setTimeout(cb, delay) {
      const handle = { cb, delay: Number(delay) || 0 };
      calls.setTimeoutQueue.push(handle);
      return handle;
    },
    clearTimeout(handle) {
      const idx = calls.setTimeoutQueue.indexOf(handle);
      if (idx >= 0) calls.setTimeoutQueue.splice(idx, 1);
    },
    // Bug #2 scroll-sync defers the apply step to the next animation frame.
    // The harness queues callbacks; tests flush them via flushRaf() to drive
    // the deferred apply synchronously.
    requestAnimationFrame(cb) {
      calls.rafQueue.push(cb);
      return calls.rafQueue.length;
    },
  };
  context.globalThis = context;

  // Simulate note-list layout so scroll tests reflect the real browser situation.
  //
  // In production, #noteList has overflow:auto but no position set. Its children's
  // offsetTop is therefore relative to the body (the nearest positioned ancestor),
  // not to #noteList. We simulate this by adding a _SIDEBAR_OFFSET so that
  // child.offsetTop != child's position within noteList — tests using the wrong
  // formula (scrollTop = offsetTop) will compute incorrect scrollTop values.
  //
  // child.getBoundingClientRect().top is computed correctly (viewport-relative,
  // accounting for noteList.scrollTop) so the production formula
  //   noteList.scrollTop += item.getBoundingClientRect().top - noteList.getBoundingClientRect().top
  // works correctly.
  //
  // noteList.getBoundingClientRect().top = 0 (stable reference at viewport top).
  // child at index n: getBoundingClientRect().top = n*50 - noteList.scrollTop.
  const _noteListEl = elements.get('noteList');
  const _NOTE_ITEM_HEIGHT = 50;
  const _SIDEBAR_OFFSET = 200; // simulates body-relative offsetTop mismatch
  const _noteListOrigAppend = _noteListEl.appendChild.bind(_noteListEl);
  _noteListEl.getBoundingClientRect = function() {
    return { top: 0, bottom: this.clientHeight, left: 0, right: 0, width: 0, height: this.clientHeight };
  };
  _noteListEl.appendChild = function(child) {
    const indexTop = this.children.length * _NOTE_ITEM_HEIGHT;
    child.offsetTop = _SIDEBAR_OFFSET + indexTop; // body-relative, intentionally wrong for scrollTop formula
    child.offsetHeight = _NOTE_ITEM_HEIGHT;
    child.getBoundingClientRect = (function(capturedIndexTop) {
      return function() {
        return { top: capturedIndexTop - _noteListEl.scrollTop };
      };
    }(indexTop));
    const result = _noteListOrigAppend(child);
    this.scrollHeight = this.children.length * _NOTE_ITEM_HEIGHT;
    return result;
  };

  vm.createContext(context);

  const html = readIndexHtml();
  const bootScript = getBootScript(html);
  new vm.Script(bootScript, { filename: 'index.html:inline-boot.js' }).runInContext(context);

  // Drain in a loop because the production code may schedule a second rAF
  // from inside the first (double-rAF pattern). Each pass empties the queue;
  // any callbacks enqueued during that pass run in the next pass. The loop
  // exits cleanly once the queue stays empty.
  function flushRaf() {
    let passes = 0;
    while (calls.rafQueue.length > 0) {
      const queued = calls.rafQueue.splice(0);
      queued.forEach((cb) => cb());
      passes += 1;
      if (passes > 16) {
        throw new Error('flushRaf: rAF queue did not stabilize after 16 passes');
      }
    }
  }

  // Drain BOTH rAF and setTimeout queues until both stabilize. rAFs drain
  // first (mirrors browser ordering: rAF callbacks run before paint, while
  // setTimeouts are macrotasks). When rAFs are empty, the next-earliest
  // setTimeout (by delay) fires; rAFs may be re-queued by it; loop again.
  // This matches what the production renderer needs for the bounded-retry
  // Preview-restore helper (rAF + double-rAF + setTimeout(250ms)).
  function flushTimers() {
    let passes = 0;
    while (calls.rafQueue.length > 0 || calls.setTimeoutQueue.length > 0) {
      // Drain all pending rAFs first.
      while (calls.rafQueue.length > 0) {
        const queued = calls.rafQueue.splice(0);
        queued.forEach((cb) => cb());
      }
      // Then fire the next-earliest setTimeout (if any).
      if (calls.setTimeoutQueue.length > 0) {
        calls.setTimeoutQueue.sort((a, b) => a.delay - b.delay);
        const next = calls.setTimeoutQueue.shift();
        next.cb();
      }
      passes += 1;
      if (passes > 32) {
        throw new Error('flushTimers: queues did not stabilize after 32 passes');
      }
    }
  }

  return { calls, elements, window, documentHandlers, flushRaf, flushTimers, document, setItemCalls };
}

test('index.html loads CM6 scripts before write-engine and before the inline boot script', () => {
  const html = readIndexHtml();
  const cm6BundleTag = '<script src="./lib/cm6-bundle.js"></script>';
  const cm6WriteViewTag = '<script src="./lib/cm6-write-view.js"></script>';
  const writeEngineTag = '<script src="./lib/write-engine.js"></script>';
  const bootMarker = 'Boot the Markdown editor';

  assert.ok(html.includes(cm6BundleTag), 'CM6 bundle script tag should be present');
  assert.ok(html.includes(cm6WriteViewTag), 'CM6 write-view script tag should be present');
  assert.ok(html.includes(writeEngineTag), 'write-engine script tag should be present');
  assert.ok(
    html.indexOf(cm6BundleTag) < html.indexOf(cm6WriteViewTag),
    'CM6 bundle should load before the CM6 write-view adapter'
  );
  assert.ok(
    html.indexOf(cm6WriteViewTag) < html.indexOf(writeEngineTag),
    'CM6 write-view adapter should load before write-engine'
  );
  assert.ok(
    html.indexOf(writeEngineTag) < html.indexOf(bootMarker),
    'write-engine should load before the inline boot script'
  );
});

// ── Stage 10.2: toolbar simplification ─────────────────────────────────────
//
// These tests describe the post-simplification state. They FAIL before
// implementation and pass once index.html is updated.

test('Stage 10.2: templateSelect is not present in the toolbar DOM', () => {
  const html = readIndexHtml();
  assert.ok(!html.includes('id="templateSelect"'), 'templateSelect must be removed from the toolbar');
});

test('Stage 10.2: moreButton and moreMenu are not present in the DOM', () => {
  const html = readIndexHtml();
  assert.ok(!html.includes('id="moreButton"'), 'moreButton must be removed');
  assert.ok(!html.includes('id="moreMenu"'),   'moreMenu must be removed');
});

test('Stage 10.2: seedDemoVaultButton is not present in the toolbar DOM', () => {
  const html = readIndexHtml();
  assert.ok(!html.includes('id="seedDemoVaultButton"'), 'seedDemoVaultButton must be removed from the toolbar');
});

test('Stage 10.2: chooseVaultButton, loadVaultButton, and deleteNoteButton are directly in the toolbar', () => {
  const html = readIndexHtml();
  assert.ok(html.includes('id="chooseVaultButton"'), 'chooseVaultButton must be present');
  assert.ok(html.includes('id="loadVaultButton"'),   'loadVaultButton must be present');
  assert.ok(html.includes('id="deleteNoteButton"'),  'deleteNoteButton must be present');
  assert.ok(!html.includes('id="moreMenu"'), 'no moreMenu should wrap any button');
});

test('Stage 10.2: New Note creates a draft with empty title and empty body', () => {
  const { elements } = makeRendererHarness();

  elements.get('newNoteButton').fire('click');

  const titleInput = elements.get('titleInput');
  assert.equal(titleInput.value, '', 'new note title must be empty string');

  const row = elements.get('noteList').children[0];
  assert.ok(row, 'new draft must appear in the note list');
  assert.ok(row.innerHTML.includes('note-badge note-badge-draft'), 'new draft row must carry the Draft badge');
});

test('Stage 10.2: empty-title draft is not dirty when untouched', () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=cm6' });

  elements.get('newNoteButton').fire('click');
  // Title is '' and body is '' — untouched blank draft must not be dirty.

  let received = 'unset';
  calls.closeRequestHandler((summary) => { received = summary; });

  assert.deepEqual(
    received,
    { count: 0, hasDraft: false, hasDirtyVault: false },
    'untouched empty-title draft must not count as unsaved work'
  );
});

test('Stage 10.2: saving an empty-title draft is blocked with "Enter a title" message', async () => {
  const { calls, elements } = makeRendererHarness();

  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('newNoteButton').fire('click');
  // Title remains '' — do not set any title before saving.

  const payloadsBefore = calls.saveNotePayloads.length;
  await elements.get('saveNoteButton').fireAsync('click');

  assert.equal(
    calls.saveNotePayloads.length,
    payloadsBefore,
    'empty-title save must NOT invoke the save IPC'
  );
  assert.match(
    elements.get('statusText').className,
    /status-error/,
    'empty-title save must surface an error status'
  );
  assert.match(
    elements.get('statusText').textContent,
    /enter a title/i,
    'error message must tell the user to enter a title'
  );
});

test('Stage 10.2: saving a titled draft still succeeds', async () => {
  const { calls, elements } = makeRendererHarness();

  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('newNoteButton').fire('click');
  setDraftTitle(elements, 'My Stage 10 Note');

  await elements.get('saveNoteButton').fireAsync('click');

  assert.equal(calls.saveNotePayloads.length, 1, 'titled draft must be saved successfully');
});

test('default renderer boot resolves cm6, constructs CM6 adapter, and does not construct HybridWriteView', () => {
  const { calls } = makeRendererHarness();

  assert.deepEqual(calls.resolvedEngines, ['cm6']);
  assert.deepEqual(calls.consoleDebug, [['[write-engine]', 'cm6']]);
  assert.equal(calls.toastConstructed, 1);
  assert.equal(calls.hybridConstructed, 0);
  assert.equal(calls.cm6Constructed, 1);
});

test('renderer boot with ?writeEngine=hybrid constructs HybridWriteView and not CM6', () => {
  const { calls } = makeRendererHarness({ search: '?writeEngine=hybrid' });

  assert.deepEqual(calls.resolvedEngines, ['hybrid']);
  assert.deepEqual(calls.consoleDebug, [['[write-engine]', 'hybrid']]);
  assert.equal(calls.hybridConstructed, 1);
  assert.equal(calls.cm6Constructed, 0);
});

test('renderer boot with ?writeEngine=cm6 constructs CM6 and not HybridWriteView', () => {
  const { calls, elements, window } = makeRendererHarness({ search: '?writeEngine=cm6' });

  assert.deepEqual(calls.resolvedEngines, ['cm6']);
  assert.deepEqual(calls.consoleDebug, [['[write-engine]', 'cm6']]);
  assert.equal(calls.hybridConstructed, 0);
  assert.equal(calls.cm6Constructed, 1);
  assert.equal(calls.cm6Parent, elements.get('hybridWritePane'));
  assert.equal(calls.cm6Options.cm6, window.CM6Production);
  assert.equal(typeof calls.cm6Options.onChange, 'function');
  assert.equal(Object.prototype.hasOwnProperty.call(calls.cm6Options, 'initialDoc'), false);
});

test('renderer boot with localStorage writeEngine=cm6 constructs CM6 when no query is present', () => {
  const { calls } = makeRendererHarness({ storageValue: 'cm6' });

  assert.deepEqual(calls.resolvedEngines, ['cm6']);
  assert.equal(calls.hybridConstructed, 0);
  assert.equal(calls.cm6Constructed, 1);
});

test('hybrid-backed adapter still uses setText, getText, and exitWriteMode for boot and Preview', async () => {
  // Stage 6.2: empty initial state means we must load a note explicitly
  // (via vaultNotes + chooseVault) to exercise the boot-load path.
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=hybrid',
    vaultNotes: [{
      id: 'vault:a',
      title: 'Vault A',
      body: '# Vault A\n\nbody',
      fileName: 'a.md',
      relativePath: 'a.md',
    }],
  });

  // Initial render loads the empty no-selection doc through setText.
  assert.equal(calls.hybridSetText[0], '', 'no-selection boot loads empty text via setText');

  await elements.get('chooseVaultButton').fireAsync('click');

  // Vault load triggers another setText with the selected note's body.
  // Hybrid's setText calls exitWriteMode internally, so 2 setText calls
  // (boot empty + vault load) → 2 exitWriteMode calls before Preview.
  assert.match(calls.hybridSetText.at(-1), /^# Vault A/);
  assert.equal(calls.hybridExitWriteMode, 2, 'adapter.setText exits write mode before loading text');
  assert.equal(calls.toastSetMarkdown.at(-1), calls.hybridSetText.at(-1));

  elements.get('previewModeButton').fire('click');

  assert.equal(calls.hybridGetText, 1, 'Preview reads from the hybrid adapter');
  assert.equal(calls.hybridExitWriteMode, 3, 'Preview flushes the hybrid adapter before rendering');
  assert.equal(calls.toastSetMarkdown.at(-1), calls.hybridSetText.at(-1));
  assert.ok(calls.toastEmits.includes('changePreviewTabPreview'));
});

test('CM6-backed adapter uses setText, getText, and exitWriteMode for boot and Preview', async () => {
  // Stage 6.2: empty initial state — load a note via vaultNotes + chooseVault
  // to exercise the boot-load path through setText.
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [{
      id: 'vault:a',
      title: 'Vault A',
      body: '# Vault A\n\nbody',
      fileName: 'a.md',
      relativePath: 'a.md',
    }],
  });

  assert.equal(calls.cm6SetText[0], '', 'no-selection boot loads empty text via setText');
  assert.equal(calls.cm6ExitWriteMode, 0, 'CM6 construction starts empty and loads through setText');

  await elements.get('chooseVaultButton').fireAsync('click');

  assert.match(calls.cm6SetText.at(-1), /^# Vault A/);
  assert.equal(calls.toastSetMarkdown.at(-1), calls.cm6SetText.at(-1));

  elements.get('previewModeButton').fire('click');

  assert.equal(calls.cm6GetText, 1, 'Preview reads from the liveEditorInstance CM6 adapter');
  assert.equal(calls.cm6ExitWriteMode, 1, 'Preview flushes through the liveEditorInstance adapter');
  assert.equal(calls.toastSetMarkdown.at(-1), calls.cm6SetText.at(-1));
  assert.ok(calls.toastEmits.includes('changePreviewTabPreview'));
});

test('CM6 onChange uses the same preview sync, note body, note list, and draft status behavior', () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=cm6' });
  // Stage 6.2: create a draft so cm6OnChange has a selectedNote to update.
  elements.get('newNoteButton').fire('click');
  const edited = '# Edited from CM6\n\nUniqueCm6SearchToken';

  calls.cm6OnChange(edited);

  assert.equal(calls.toastSetMarkdown.at(-1), edited);
  assert.equal(elements.get('statusText').textContent, 'Draft');
  assert.equal(elements.get('statusText').className, 'topbar-status status-draft');

  elements.get('searchInput').value = 'UniqueCm6SearchToken';
  elements.get('searchInput').fire('input');

  assert.equal(elements.get('searchMeta').textContent, 'Found 1 result(s) for "UniqueCm6SearchToken" in the current filter.');
});

test('CM6 save click sends raw Markdown from liveEditorInstance.getText()', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [{
      id: 'vault:a',
      title: 'Vault A',
      body: '# Vault A',
      fileName: 'a.md',
      relativePath: 'a.md',
    }],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  calls.cm6Adapter.text = '# Raw Markdown\n\n**bold**\n\n<div>literal html source</div>';

  await elements.get('saveNoteButton').fireAsync('click');

  assert.equal(calls.saveNotePayloads.length, 1);
  assert.equal(calls.cm6ExitWriteMode, 1, 'save should flush through the liveEditorInstance adapter');
  assert.equal(calls.cm6GetText, 1, 'save should read through liveEditorInstance.getText()');
  assert.equal(
    calls.saveNotePayloads[0].note.body,
    '# Raw Markdown\n\n**bold**\n\n<div>literal html source</div>'
  );
  assert.ok(!calls.saveNotePayloads[0].note.body.includes('<h1>'), 'save must not send rendered HTML');
  assert.ok(!calls.saveNotePayloads[0].note.body.includes('<strong>'), 'save must not send rendered HTML');
});

test('CM6 note switch preserves outgoing edits and loads the next note through setText', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      {
        id: 'vault:a',
        title: 'Vault A',
        body: '# Note A',
        fileName: 'a.md',
        relativePath: 'a.md',
      },
      {
        id: 'vault:b',
        title: 'Vault B',
        body: '# Note B',
        fileName: 'b.md',
        relativePath: 'b.md',
      },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  assert.equal(calls.cm6SetText.at(-1), '# Note A');

  calls.cm6Adapter.text = '# Edited Note A\n\nEditedSwitchToken';
  elements.get('noteList').children[1].fire('click');

  assert.equal(calls.cm6ExitWriteMode, 1, 'note switch should flush the outgoing adapter');
  assert.equal(calls.cm6GetText, 1, 'note switch should read outgoing text through liveEditorInstance');
  assert.equal(calls.cm6SetText.at(-1), '# Note B', 'note switch should load the next note through setText');

  elements.get('searchInput').value = 'EditedSwitchToken';
  elements.get('searchInput').fire('input');
  assert.equal(elements.get('searchMeta').textContent, 'Found 1 result(s) for "EditedSwitchToken" in the current filter.');
});

test('CM6 blank note loads empty text and records typed raw text through onChange', () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=cm6' });

  elements.get('newNoteButton').fire('click');

  assert.equal(calls.cm6SetText.at(-1), '', 'blank note should load empty source through setText');

  calls.cm6OnChange('hello');

  assert.equal(calls.toastSetMarkdown.at(-1), 'hello');
  assert.equal(elements.get('statusText').textContent, 'Draft');
  assert.equal(elements.get('statusText').className, 'topbar-status status-draft');

  elements.get('searchInput').value = 'hello';
  elements.get('searchInput').fire('input');
  assert.equal(elements.get('searchMeta').textContent, 'Found 1 result(s) for "hello" in the current filter.');
});

async function assertSavingOneUnsavedDraftPreservesAnother({ search = '', engineName }) {
  const { calls, elements } = makeRendererHarness({ search });
  const adapter = engineName === 'cm6' ? calls.cm6Adapter : calls.hybridAdapter;
  const onChange = engineName === 'cm6' ? calls.cm6OnChange : calls.hybridOnChange;
  const setTextCalls = engineName === 'cm6' ? calls.cm6SetText : calls.hybridSetText;

  await elements.get('chooseVaultButton').fireAsync('click');

  // Distinct titles so the new duplicate-name guard does not block the save
  // (every draft created by newNote would otherwise default to 'Untitled note',
  // which derives to the same untitled-note.md). The test's intent is the
  // *body* preservation across save, not duplicate-name behavior.
  elements.get('newNoteButton').fire('click');
  setDraftTitle(elements, `Draft A ${engineName}`);
  adapter.text = `Body A unique ${engineName}`;
  onChange(`Body A unique ${engineName}`);

  elements.get('newNoteButton').fire('click');
  setDraftTitle(elements, `Draft B ${engineName}`);
  adapter.text = `Body B unique ${engineName}`;
  onChange(`Body B unique ${engineName}`);

  elements.get('noteList').children[1].fire('click');
  // Assert visible result rather than the path: post-fix, CM6 returns to a
  // cached note via setState (not setText). Hybrid still uses setText. Both
  // end with the adapter showing A's body — that is the user-visible contract.
  assert.equal(adapter.text, `Body A unique ${engineName}`);

  await elements.get('saveNoteButton').fireAsync('click');
  assert.equal(calls.loadVaultNotesPayloads.length, 2, 'save should refresh from disk once');

  assert.equal(typeof calls.vaultChangedCallback, 'function', 'vault watcher should be active after choosing a vault');
  await calls.vaultChangedCallback({ fileName: 'saved-1.md' });
  assert.equal(calls.loadVaultNotesPayloads.length, 3, 'watcher should cause the real second refresh after save');

  assert.equal(elements.get('noteList').children.length, 1, 'only the remaining unsaved draft should stay visible in Drafts');
  assert.ok(elements.get('noteList').children[0].className.includes('active'), 'remaining draft should be selected');
  if (engineName === 'hybrid') {
    // Hybrid has no EditorState cache; B is loaded via setText with its
    // preserved body. CM6 restores via setState (cache hit) — covered by the
    // CM6 cache-preservation tests near the bottom of this file. Both engines
    // satisfy the user-visible contract checked on the next line.
    assert.equal(setTextCalls.at(-1), `Body B unique ${engineName}`);
  }
  assert.equal(adapter.text, `Body B unique ${engineName}`, 'editor should show the remaining draft body');

  elements.get('searchInput').value = `Body B unique ${engineName}`;
  elements.get('searchInput').fire('input');
  assert.equal(
    elements.get('searchMeta').textContent,
    `Found 1 result(s) for "Body B unique ${engineName}" in the current filter.`
  );

  elements.get('noteList').children[0].fire('click');
  assert.equal(adapter.text, `Body B unique ${engineName}`);

  await elements.get('saveNoteButton').fireAsync('click');

  assert.equal(calls.saveNotePayloads.length, 2);
  assert.equal(calls.saveNotePayloads[0].note.body, `Body A unique ${engineName}`);
  assert.equal(calls.saveNotePayloads[1].note.body, `Body B unique ${engineName}`);
  assert.notEqual(calls.saveNotePayloads[1].note.body, `Body A unique ${engineName}`);
}

test('saving one unsaved draft preserves other unsaved drafts for later saving (hybrid)', async () => {
  await assertSavingOneUnsavedDraftPreservesAnother({ search: '?writeEngine=hybrid', engineName: 'hybrid' });
});

test('saving one unsaved draft preserves other unsaved drafts for later saving (CM6)', async () => {
  await assertSavingOneUnsavedDraftPreservesAnother({ search: '?writeEngine=cm6', engineName: 'cm6' });
});

// ── Note-local undo: host caches CM6 EditorState across A → B → A switches ──
// These tests pin the host wiring that makes Cmd+Z note-local for CM6 after
// switching away and back. The fake CM6 adapter exposes getState/setState
// so we can detect when the host restores via setState instead of setText.

test('CM6: switching back to a previously-edited note restores via setState (not setText)', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# Note A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b', title: 'Vault B', body: '# Note B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  // Initial load brings A in via setText (uncached).
  assert.equal(calls.cm6SetText.at(-1), '# Note A');

  // Simulate the user typing in A (so A's state diverges from default).
  calls.cm6Adapter.text = '# Note A edited';
  calls.cm6Adapter._state = { doc: '# Note A edited', _kind: 'A-after-edit' };
  calls.cm6OnChange('# Note A edited');

  const setStateBeforeSwitchToB = calls.cm6SetState.length;
  const setTextBeforeSwitchToB = calls.cm6SetText.length;

  // Switch to B (uncached) → goes through setText, no setState.
  elements.get('noteList').children[1].fire('click');
  assert.equal(calls.cm6SetText.length, setTextBeforeSwitchToB + 1, 'B uncached → setText');
  assert.equal(calls.cm6SetText.at(-1), '# Note B');
  assert.equal(calls.cm6SetState.length, setStateBeforeSwitchToB, 'B uncached → no setState');

  const setStateBeforeReturn = calls.cm6SetState.length;
  const setTextBeforeReturn = calls.cm6SetText.length;

  // Switch back to A. Cached state's doc ('# Note A edited') matches
  // note.body → host must restore via setState, not setText.
  elements.get('noteList').children[0].fire('click');

  assert.equal(
    calls.cm6SetState.length,
    setStateBeforeReturn + 1,
    'returning to a cached note must restore via setState'
  );
  assert.equal(
    calls.cm6SetText.length,
    setTextBeforeReturn,
    'returning to a cached note must NOT call setText'
  );
  assert.equal(
    calls.cm6Adapter.text,
    '# Note A edited',
    'editor must show A’s edited body after restore'
  );
  assert.equal(
    calls.cm6Adapter._state._kind,
    'A-after-edit',
    'restored state must be the exact instance that was cached on switch-out'
  );
});

test('CM6: first visit to an uncached note uses setText (no setState)', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# Note A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b', title: 'Vault B', body: '# Note B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  // Switch from A (current) to B (never visited): must use setText.
  const setStateBefore = calls.cm6SetState.length;
  elements.get('noteList').children[1].fire('click');

  assert.equal(calls.cm6SetText.at(-1), '# Note B', 'first visit to B uses setText');
  assert.equal(calls.cm6SetState.length, setStateBefore, 'first visit to B must not call setState');
});

test('CM6: watcher refresh preserves cached editor states for unrelated notes (body preserved)', async () => {
  // The watcher only knows that one file changed. Unrelated notes' bodies
  // are preserved by the overlay; their cached EditorStates must also be
  // preserved so note-local undo/redo survives. The previous bulk-clear was
  // too broad: it kept the body but wiped undo history.
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# Note A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b', title: 'Vault B', body: '# Note B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Edit A then switch to B so A's state is cached.
  calls.cm6Adapter.text = '# Note A edited';
  calls.cm6Adapter._state = { doc: '# Note A edited', _kind: 'A-cached' };
  calls.cm6OnChange('# Note A edited');
  elements.get('noteList').children[1].fire('click');
  assert.equal(calls.cm6SetText.at(-1), '# Note B');

  // Trigger a vault watcher refresh that reports b.md as changed. A is
  // unrelated → its body is preserved by the overlay AND its cached
  // EditorState must also be preserved (no bulk clear on watcher refresh).
  assert.equal(typeof calls.vaultChangedCallback, 'function');
  await calls.vaultChangedCallback({ fileName: 'b.md' });

  const setStateBeforeReturn = calls.cm6SetState.length;
  const setTextBeforeReturn = calls.cm6SetText.length;

  // Switch back to A. Cache hit (cache.doc === note.body) → must restore via
  // setState, NOT setText. This is what preserves note-local undo/redo.
  elements.get('noteList').children[0].fire('click');

  assert.equal(
    calls.cm6SetState.length,
    setStateBeforeReturn + 1,
    'after watcher refresh, returning to A must restore via setState (cache preserved)'
  );
  assert.equal(
    calls.cm6SetText.length,
    setTextBeforeReturn,
    'after watcher refresh, returning to A must NOT call setText'
  );
  assert.equal(
    calls.cm6Adapter._state._kind,
    'A-cached',
    'restored state must be the exact instance cached on switch-out from A'
  );
});

test('Hybrid: note switching continues to use setText (note-local undo intentionally deferred)', async () => {
  // Hybrid has no model-level undo (per-textarea browser-native only) so we
  // do not expose getState/setState on the HybridWriteView. The host must
  // detect their absence and fall back to setText. This pins Hybrid as
  // intentionally deferred, not accidentally broken.
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=hybrid',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# Note A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b', title: 'Vault B', body: '# Note B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Confirm the Hybrid adapter does not expose getState/setState.
  assert.equal(typeof calls.hybridAdapter.getState, 'undefined');
  assert.equal(typeof calls.hybridAdapter.setState, 'undefined');

  // Edit A, switch to B, switch back. All three transitions must go through setText.
  calls.hybridAdapter.text = '# Note A edited';
  calls.hybridOnChange('# Note A edited');

  elements.get('noteList').children[1].fire('click');
  assert.equal(calls.hybridSetText.at(-1), '# Note B');

  elements.get('noteList').children[0].fire('click');
  assert.equal(calls.hybridSetText.at(-1), '# Note A edited',
    'returning to A in Hybrid must reload via setText (no cached state)');
});

// ── Save-flow preserves dirty in-memory edits in unrelated vault notes ──────
// Bug: saving Note A used to revert any unsaved in-memory edits in other
// vault-backed notes, because refreshVaultNotes replaced the entire `notes`
// array with disk truth and the prior preservation logic only covered drafts.
// The fix snapshots in-memory state for unrelated vault notes and overlays
// it onto the disk-loaded notes (by relativePath) before render.

async function assertSavePreservesUnrelatedDirtyVaultNotes({ search = '', engineName }) {
  const { calls, elements } = makeRendererHarness({
    search,
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A disk', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B disk', fileName: 'b.md', relativePath: 'b.md' },
      { id: 'vault:c.md', title: 'C', body: '# C disk', fileName: 'c.md', relativePath: 'c.md' },
    ],
  });
  const adapter  = engineName === 'cm6' ? calls.cm6Adapter   : calls.hybridAdapter;
  const onChange = engineName === 'cm6' ? calls.cm6OnChange  : calls.hybridOnChange;

  await elements.get('chooseVaultButton').fireAsync('click');
  // After choosing the vault, A is selected. children: [A, B, C].

  // Edit A in memory.
  adapter.text = '# A edited';
  onChange('# A edited');

  // Switch to B and edit.
  elements.get('noteList').children[1].fire('click');
  adapter.text = '# B edited';
  onChange('# B edited');

  // Switch to C and edit.
  elements.get('noteList').children[2].fire('click');
  adapter.text = '# C edited';
  onChange('# C edited');

  // Return to A. (Sanity: A's edited body must already survive the round trip.)
  elements.get('noteList').children[0].fire('click');
  assert.equal(adapter.text, '# A edited',
    `${engineName}: A's edited body must survive switch-out and switch-back`);

  // Save A.
  await elements.get('saveNoteButton').fireAsync('click');

  // A was saved with its edited body, not the disk body.
  assert.equal(calls.saveNotePayloads.length, 1);
  assert.equal(calls.saveNotePayloads[0].note.body, '# A edited');
  assert.equal(calls.saveNotePayloads[0].note.relativePath, 'a.md');

  // The just-saved note remains selected after refresh.
  assert.ok(
    elements.get('noteList').children[0].className.includes('active'),
    `${engineName}: A remains selected (active) after save+refresh`,
  );

  // Switch to B — its edited body must have survived A's save+refresh.
  elements.get('noteList').children[1].fire('click');
  assert.equal(adapter.text, '# B edited',
    `${engineName}: B's edited body must survive saving A`);

  // Save B and confirm the payload is B's edited body, not the stale disk body
  // and not A's body. This pins that B is still a vault note at b.md.
  await elements.get('saveNoteButton').fireAsync('click');
  assert.equal(calls.saveNotePayloads.length, 2);
  assert.equal(calls.saveNotePayloads[1].note.body, '# B edited');
  assert.equal(calls.saveNotePayloads[1].note.relativePath, 'b.md');
  assert.notEqual(calls.saveNotePayloads[1].note.body, '# B disk');
  assert.notEqual(calls.saveNotePayloads[1].note.body, '# A edited');

  // C's edited body must also survive both saves.
  elements.get('noteList').children[2].fire('click');
  assert.equal(adapter.text, '# C edited',
    `${engineName}: C's edited body must survive saving both A and B`);
}

test('save preserves unrelated dirty vault-backed notes (hybrid)', async () => {
  await assertSavePreservesUnrelatedDirtyVaultNotes({ search: '?writeEngine=hybrid', engineName: 'hybrid' });
});

test('save preserves unrelated dirty vault-backed notes (cm6)', async () => {
  await assertSavePreservesUnrelatedDirtyVaultNotes({
    search: '?writeEngine=cm6',
    engineName: 'cm6',
  });
});

test('save preserves both dirty vault notes AND unsaved drafts in the same flow (hybrid)', async () => {
  // Mixed scenario: a vault note and a draft both have unsaved edits when
  // another vault note is saved. Both must survive the refresh.
  // Pinned to hybrid because the test pokes hybridAdapter directly; the CM6
  // path is covered by the cache-preservation suite below.
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=hybrid',
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A disk', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B disk', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Edit A.
  calls.hybridAdapter.text = '# A edited';
  calls.hybridOnChange('# A edited');

  // Switch to B and edit.
  elements.get('noteList').children[1].fire('click');
  calls.hybridAdapter.text = '# B edited';
  calls.hybridOnChange('# B edited');

  // Create a new draft D and edit it. This sets currentFilter='drafts' and
  // unshifts D into `notes`.
  elements.get('newNoteButton').fire('click');
  calls.hybridAdapter.text = '# D edited';
  calls.hybridOnChange('# D edited');

  // Show all notes and return to A. With currentFilter='all' and
  // notes=[D, A, B], children = [D, A, B]; A is at index 1.
  elements.get('filterAll').fire('click');
  elements.get('noteList').children[1].fire('click');
  assert.equal(calls.hybridAdapter.text, '# A edited');

  // Save A.
  await elements.get('saveNoteButton').fireAsync('click');
  assert.equal(calls.saveNotePayloads.length, 1);
  assert.equal(calls.saveNotePayloads[0].note.body, '# A edited');
  assert.equal(calls.saveNotePayloads[0].note.relativePath, 'a.md');

  // After refresh, vault notes come first then preserved drafts: [A, B, D].
  // Switch to B — its edited body must have survived.
  elements.get('noteList').children[1].fire('click');
  assert.equal(calls.hybridAdapter.text, '# B edited',
    "B's edited body must survive saving A");

  // Save B and confirm B is still a vault note at b.md.
  await elements.get('saveNoteButton').fireAsync('click');
  assert.equal(calls.saveNotePayloads.length, 2);
  assert.equal(calls.saveNotePayloads[1].note.body, '# B edited');
  assert.equal(calls.saveNotePayloads[1].note.relativePath, 'b.md');

  // D (draft) still exists with its edited body.
  elements.get('filterDrafts').fire('click');
  assert.equal(elements.get('noteList').children.length, 1,
    'only the surviving draft D should remain in the Drafts filter');
  // ensureSelectionMatchesVisibleResults retargets selection to D when the
  // current selection (B) is not in the Drafts view; the editor reloads via
  // setText with D's preserved body.
  assert.equal(calls.hybridAdapter.text, '# D edited',
    "D's edited body must survive saving A");
});

test('after save, the saved note remains selected and shows the saved body (hybrid)', async () => {
  // Selection-and-canonicality regression: after a save+refresh the just-saved
  // note must remain the selected one and `notes[i].body` for that note must
  // equal what was sent to saveNote (the disk truth). This pins the behavior
  // in the presence of the new overlay logic — the saved note must NOT be
  // routed through the in-memory overlay. Pinned to hybrid because it pokes
  // hybridAdapter directly.
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=hybrid',
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A disk', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B disk', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  calls.hybridAdapter.text = '# A new content';
  calls.hybridOnChange('# A new content');

  await elements.get('saveNoteButton').fireAsync('click');

  // Saved note's body equals the body the renderer sent to saveNote.
  assert.equal(calls.saveNotePayloads[0].note.body, '# A new content');
  assert.equal(calls.saveNotePayloads[0].note.relativePath, 'a.md');

  // Selection canonicalism: the active item is still A.
  assert.ok(
    elements.get('noteList').children[0].className.includes('active'),
    'saved note (A) remains the active selection after refresh',
  );

  // Re-loading A via setText must show the saved body (proving notes[A].body
  // was set from the disk-saved value, not from any leftover overlay).
  elements.get('noteList').children[1].fire('click'); // switch to B
  elements.get('noteList').children[0].fire('click'); // back to A
  assert.equal(calls.hybridAdapter.text, '# A new content',
    "the saved note's in-memory body matches the saved/disk version");
});

test('watcher refresh uses disk truth for the changed file but preserves edits in unrelated notes (hybrid)', async () => {
  // The watcher only knows that ONE specific file changed. Disk truth is the
  // right answer for that file (whether the change came from our save or an
  // external editor), but every other vault-backed note is unchanged on disk
  // and its in-memory edits must NOT be silently reverted. Drafts continue to
  // be auto-preserved by refreshVaultNotes. Pinned to hybrid because it pokes
  // hybridAdapter directly; CM6 watcher behavior is covered by the cache
  // preservation tests below.
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=hybrid',
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A disk', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B disk', fileName: 'b.md', relativePath: 'b.md' },
      { id: 'vault:c.md', title: 'C', body: '# C disk', fileName: 'c.md', relativePath: 'c.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Edit A in memory but do not save.
  calls.hybridAdapter.text = '# A edited';
  calls.hybridOnChange('# A edited');

  // Switch to B and edit it too (unsaved).
  elements.get('noteList').children[1].fire('click');
  calls.hybridAdapter.text = '# B edited';
  calls.hybridOnChange('# B edited');

  // Trigger a watcher refresh that reports A as the changed file.
  assert.equal(typeof calls.vaultChangedCallback, 'function');
  await calls.vaultChangedCallback({ fileName: 'a.md' });

  // The changed file (A) picks up disk truth — its in-memory edit is replaced.
  elements.get('noteList').children[0].fire('click');
  assert.equal(calls.hybridAdapter.text, '# A disk',
    'the changed file must come from disk truth on watcher refresh');

  // The unrelated dirty file (B) keeps its in-memory edit.
  elements.get('noteList').children[1].fire('click');
  assert.equal(calls.hybridAdapter.text, '# B edited',
    "an unrelated dirty vault note's in-memory edit must survive a watcher refresh");

  // C was not touched in memory — it must reflect disk truth (no spurious overlay).
  elements.get('noteList').children[2].fire('click');
  assert.equal(calls.hybridAdapter.text, '# C disk',
    'an untouched vault note must still match disk truth after watcher refresh');
});

// ── Save-flow + watcher: dirty unrelated notes survive BOTH refreshes ────────
// Regression: saving Note A causes (1) an immediate save-driven refresh and
// (2) a vault-watcher refresh shortly after (because the OS reports that a.md
// changed on disk). Both must preserve unrelated dirty vault notes; the prior
// fix only covered (1), so dirty Note B/C could still be reverted by (2).

async function assertSaveAndWatcherPreserveOtherDirtyVaultNotes({ search = '', engineName }) {
  const { calls, elements } = makeRendererHarness({
    search,
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A disk', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B disk', fileName: 'b.md', relativePath: 'b.md' },
      { id: 'vault:c.md', title: 'C', body: '# C disk', fileName: 'c.md', relativePath: 'c.md' },
    ],
  });
  const adapter  = engineName === 'cm6' ? calls.cm6Adapter   : calls.hybridAdapter;
  const onChange = engineName === 'cm6' ? calls.cm6OnChange  : calls.hybridOnChange;

  await elements.get('chooseVaultButton').fireAsync('click');

  // Edit A.
  adapter.text = '# A edited';
  onChange('# A edited');

  // Edit B.
  elements.get('noteList').children[1].fire('click');
  adapter.text = '# B edited';
  onChange('# B edited');

  // Edit C.
  elements.get('noteList').children[2].fire('click');
  adapter.text = '# C edited';
  onChange('# C edited');

  // Return to A and save it.
  elements.get('noteList').children[0].fire('click');
  await elements.get('saveNoteButton').fireAsync('click');
  assert.equal(calls.saveNotePayloads.length, 1);
  assert.equal(calls.saveNotePayloads[0].note.body, '# A edited');
  assert.equal(calls.saveNotePayloads[0].note.relativePath, 'a.md');

  // The save-driven refresh already preserves B and C (covered by the
  // previous test). Now simulate the post-save watcher firing for a.md —
  // this used to revert B and C to disk truth.
  assert.equal(typeof calls.vaultChangedCallback, 'function');
  await calls.vaultChangedCallback({ fileName: 'a.md' });

  // After the watcher fires, B's edit must still be intact and savable.
  elements.get('noteList').children[1].fire('click');
  assert.equal(adapter.text, '# B edited',
    `${engineName}: B's edited body must survive the save+watcher sequence`);
  await elements.get('saveNoteButton').fireAsync('click');
  assert.equal(calls.saveNotePayloads.length, 2);
  assert.equal(calls.saveNotePayloads[1].note.body, '# B edited',
    `${engineName}: saving B after the watcher fires must persist its edited body`);
  assert.equal(calls.saveNotePayloads[1].note.relativePath, 'b.md');

  // C's edit must also still be intact after both saves and both watcher events.
  await calls.vaultChangedCallback({ fileName: 'b.md' });
  elements.get('noteList').children[2].fire('click');
  assert.equal(adapter.text, '# C edited',
    `${engineName}: C's edited body must survive multiple save+watcher rounds`);
}

test('save + post-save watcher both preserve unrelated dirty vault notes (hybrid)', async () => {
  await assertSaveAndWatcherPreserveOtherDirtyVaultNotes({ search: '?writeEngine=hybrid', engineName: 'hybrid' });
});

test('save + post-save watcher both preserve unrelated dirty vault notes (cm6)', async () => {
  await assertSaveAndWatcherPreserveOtherDirtyVaultNotes({
    search: '?writeEngine=cm6',
    engineName: 'cm6',
  });
});

test('save + watcher preserve both a dirty vault note AND an unsaved draft (hybrid)', async () => {
  // Mixed regression: when another note is saved, both the unrelated dirty
  // saved note and an unsaved draft must survive (1) the save refresh and
  // (2) the watcher refresh that fires for the saved file.
  // Pinned to hybrid because it pokes hybridAdapter directly; the CM6 mixed
  // case is covered by the cache-preservation suite below.
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=hybrid',
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A disk', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B disk', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Edit A.
  calls.hybridAdapter.text = '# A edited';
  calls.hybridOnChange('# A edited');

  // Edit B.
  elements.get('noteList').children[1].fire('click');
  calls.hybridAdapter.text = '# B edited';
  calls.hybridOnChange('# B edited');

  // Create an unsaved draft D and edit it.
  elements.get('newNoteButton').fire('click');
  calls.hybridAdapter.text = '# D edited';
  calls.hybridOnChange('# D edited');

  // Show all notes and return to A. notes order: [D, A, B] → A is at index 1.
  elements.get('filterAll').fire('click');
  elements.get('noteList').children[1].fire('click');
  assert.equal(calls.hybridAdapter.text, '# A edited');

  // Save A.
  await elements.get('saveNoteButton').fireAsync('click');
  assert.equal(calls.saveNotePayloads.length, 1);
  assert.equal(calls.saveNotePayloads[0].note.body, '# A edited');

  // Fire the post-save watcher event for the file A was written to.
  assert.equal(typeof calls.vaultChangedCallback, 'function');
  await calls.vaultChangedCallback({ fileName: 'a.md' });

  // After save+refresh+watcher: notes order is [A, B, D].
  // B (dirty vault) must survive both refreshes and be savable.
  elements.get('noteList').children[1].fire('click');
  assert.equal(calls.hybridAdapter.text, '# B edited',
    "B's edited body must survive saving A and the post-save watcher");
  await elements.get('saveNoteButton').fireAsync('click');
  assert.equal(calls.saveNotePayloads.length, 2);
  assert.equal(calls.saveNotePayloads[1].note.body, '# B edited');
  assert.equal(calls.saveNotePayloads[1].note.relativePath, 'b.md');

  // D (unsaved draft) must also survive — the Drafts filter still has it.
  elements.get('filterDrafts').fire('click');
  assert.equal(elements.get('noteList').children.length, 1,
    "D should remain in the Drafts filter after save + watcher");
  assert.equal(calls.hybridAdapter.text, '# D edited',
    "D's edited body must survive the save + watcher sequence");
});

// ── Save/watcher refresh preserves CM6 cached EditorStates ──────────────────
// Bug: saving Note A wiped the entire CM6 EditorState cache via
// noteEditorStates.clear() inside refreshVaultNotes(). Bodies for other notes
// were preserved by the overlay but undo/redo history was lost. The fix gates
// the bulk clear: save and watcher refreshes opt in to preserveCachedEditorStates.
// The existing per-entry doc-mismatch guard inside renderEditor() still drops
// any entry whose body did change, so stale states cannot be restored.

test('CM6: saving one vault note preserves cached editor states for other dirty vault notes', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A disk', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B disk', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Edit A.
  calls.cm6Adapter.text = '# A edited';
  calls.cm6Adapter._state = { doc: '# A edited', _kind: 'A-edited' };
  calls.cm6OnChange('# A edited');

  // Switch to B → A's state cached (doc='# A edited').
  elements.get('noteList').children[1].fire('click');
  calls.cm6Adapter.text = '# B edited';
  calls.cm6Adapter._state = { doc: '# B edited', _kind: 'B-edited' };
  calls.cm6OnChange('# B edited');

  // Switch back to A → cache hit (sanity).
  elements.get('noteList').children[0].fire('click');
  assert.equal(calls.cm6Adapter._state._kind, 'A-edited',
    "sanity: returning to A before save must restore the cached state");

  // Save A. With the bug, the save-driven refresh wiped the entire cache and
  // B's cached state was lost. With the fix, the cache is preserved.
  await elements.get('saveNoteButton').fireAsync('click');

  // Switch to B → must restore via setState (cache hit), NOT setText.
  const setStateBefore = calls.cm6SetState.length;
  const setTextBefore  = calls.cm6SetText.length;
  elements.get('noteList').children[1].fire('click');

  assert.equal(calls.cm6SetState.length, setStateBefore + 1,
    "B's cached state must be restored after saving A — undo history must survive");
  assert.equal(calls.cm6SetText.length, setTextBefore,
    "B must NOT be reloaded via setText after saving A");
  assert.equal(calls.cm6Adapter._state._kind, 'B-edited',
    "the restored state must be the exact instance cached on switch-out from B");
});

test('CM6: saving one draft preserves cached editor states for other unsaved drafts', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Create draft D1, give it a distinct title (so the duplicate-name guard
  // does not block saving — defaults would all collapse to untitled-note.md),
  // edit body.
  elements.get('newNoteButton').fire('click');
  setDraftTitle(elements, 'Draft D1');
  calls.cm6Adapter.text = '# D1 edited';
  calls.cm6Adapter._state = { doc: '# D1 edited', _kind: 'D1-edited' };
  calls.cm6OnChange('# D1 edited');

  // Create draft D2, distinct title, edit body. Switch-out D1 → cache[D1] populated.
  elements.get('newNoteButton').fire('click');
  setDraftTitle(elements, 'Draft D2');
  calls.cm6Adapter.text = '# D2 edited';
  calls.cm6Adapter._state = { doc: '# D2 edited', _kind: 'D2-edited' };
  calls.cm6OnChange('# D2 edited');

  // Switch to D1 (children[1]; D2 is at children[0] as the newest draft).
  // Switch-out D2 → cache[D2] populated.
  elements.get('noteList').children[1].fire('click');
  assert.equal(calls.cm6Adapter._state._kind, 'D1-edited',
    'sanity: returning to D1 must restore the cached state');

  // Switch to filter 'all' BEFORE save so the freshly-saved vault note
  // remains visible and the post-save renderApp doesn't retarget selection
  // (which would consume the cache-hit assertion below).
  elements.get('filterAll').fire('click');

  // Save D1 — D1 transitions to vault. With the bug, this wiped the entire
  // cache and D2 lost its undo history. With the fix, cache[D2] survives.
  await elements.get('saveNoteButton').fireAsync('click');

  // After save, layout under 'all' is [vault:D1-saved, draft:D2].
  // children[0] = saved D1, children[1] = D2.
  const setStateBefore = calls.cm6SetState.length;
  const setTextBefore  = calls.cm6SetText.length;
  elements.get('noteList').children[1].fire('click');

  assert.equal(calls.cm6SetState.length, setStateBefore + 1,
    "D2's cached state must be restored after saving D1 — undo history must survive");
  assert.equal(calls.cm6SetText.length, setTextBefore,
    "D2 must NOT be reloaded via setText after saving D1");
  assert.equal(calls.cm6Adapter._state._kind, 'D2-edited',
    "the restored state must be the exact instance cached on switch-out from D2");
});

test('CM6: post-save watcher refresh preserves cached editor states for unrelated notes', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A disk', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B disk', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Edit A.
  calls.cm6Adapter.text = '# A edited';
  calls.cm6Adapter._state = { doc: '# A edited', _kind: 'A-edited' };
  calls.cm6OnChange('# A edited');

  // Switch to B → A's state cached.
  elements.get('noteList').children[1].fire('click');
  calls.cm6Adapter.text = '# B edited';
  calls.cm6Adapter._state = { doc: '# B edited', _kind: 'B-edited' };
  calls.cm6OnChange('# B edited');

  // Switch back to A and save it.
  elements.get('noteList').children[0].fire('click');
  await elements.get('saveNoteButton').fireAsync('click');

  // The post-save vault watcher fires for the saved file. Without the fix,
  // this second refresh wiped the cache that the save refresh had spared.
  assert.equal(typeof calls.vaultChangedCallback, 'function');
  await calls.vaultChangedCallback({ fileName: 'a.md' });

  // Switch to B → cache hit → setState (NOT setText).
  const setStateBefore = calls.cm6SetState.length;
  const setTextBefore  = calls.cm6SetText.length;
  elements.get('noteList').children[1].fire('click');

  assert.equal(calls.cm6SetState.length, setStateBefore + 1,
    "B's cached state must be restored after save + post-save watcher");
  assert.equal(calls.cm6SetText.length, setTextBefore,
    "B must NOT be reloaded via setText after save + post-save watcher");
  assert.equal(calls.cm6Adapter._state._kind, 'B-edited',
    "the restored state must be the exact instance cached on switch-out from B");
});

test('CM6: save + watcher preserve cached states for both a dirty vault note and an unsaved draft', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A disk', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B disk', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Edit A.
  calls.cm6Adapter.text = '# A edited';
  calls.cm6Adapter._state = { doc: '# A edited', _kind: 'A-edited' };
  calls.cm6OnChange('# A edited');

  // Edit B.
  elements.get('noteList').children[1].fire('click');
  calls.cm6Adapter.text = '# B edited';
  calls.cm6Adapter._state = { doc: '# B edited', _kind: 'B-edited' };
  calls.cm6OnChange('# B edited');

  // Create a draft D and edit it. Switch-out B → cache[B] populated.
  elements.get('newNoteButton').fire('click');
  calls.cm6Adapter.text = '# D edited';
  calls.cm6Adapter._state = { doc: '# D edited', _kind: 'D-edited' };
  calls.cm6OnChange('# D edited');

  // Show all notes and return to A. notes order is [D, A, B] → A at index 1.
  // Switch-out D → cache[D] populated.
  elements.get('filterAll').fire('click');
  elements.get('noteList').children[1].fire('click');
  assert.equal(calls.cm6Adapter._state._kind, 'A-edited',
    'sanity: returning to A must restore the cached state');

  // Save A.
  await elements.get('saveNoteButton').fireAsync('click');

  // Post-save watcher fires for a.md.
  await calls.vaultChangedCallback({ fileName: 'a.md' });

  // After save+watcher: notes = [A (vault, just saved), B (overlay-preserved),
  // D (preserved draft)]. B at children[1], D at children[2].
  const stateBeforeB = calls.cm6SetState.length;
  const textBeforeB  = calls.cm6SetText.length;
  elements.get('noteList').children[1].fire('click');
  assert.equal(calls.cm6SetState.length, stateBeforeB + 1,
    "B's cached state must survive save + post-save watcher");
  assert.equal(calls.cm6SetText.length, textBeforeB,
    "B must not be reloaded via setText after save + watcher");
  assert.equal(calls.cm6Adapter._state._kind, 'B-edited');

  const stateBeforeD = calls.cm6SetState.length;
  const textBeforeD  = calls.cm6SetText.length;
  elements.get('noteList').children[2].fire('click');
  assert.equal(calls.cm6SetState.length, stateBeforeD + 1,
    "D's cached state must survive save + post-save watcher");
  assert.equal(calls.cm6SetText.length, textBeforeD,
    "D must not be reloaded via setText after save + watcher");
  assert.equal(calls.cm6Adapter._state._kind, 'D-edited');
});

test('CM6: manual Load Vault still clears cached editor states (external/manual reload may invalidate)', async () => {
  // Complementary test: the bulk clear is only gated for save and watcher
  // refreshes. Manual / external / vault-switch refreshes still wipe the
  // cache by design — the product rule allows external reload to invalidate
  // editor state. This test pins that residual behavior so a future change
  // does not silently turn manual reload into a state-preserving path.
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A body', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B body', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Switch to B so A's state is cached (cache.doc = '# A body', the unchanged
  // body — which equals what's on disk so the per-entry mismatch guard alone
  // would NOT drop this entry; only a bulk clear can).
  elements.get('noteList').children[1].fire('click');

  const setStateBefore = calls.cm6SetState.length;
  const setTextBefore  = calls.cm6SetText.length;

  // Manual reload resets selection to notes[0] (A) and triggers a B → A
  // switch. With bulk clear, cache miss for A → setText. Without bulk clear,
  // cache.doc would still equal note.body and A would restore via setState —
  // that is the regression this test guards against.
  await elements.get('loadVaultButton').fireAsync('click');

  assert.equal(calls.cm6SetState.length, setStateBefore,
    'manual Load Vault must wipe cached states — no setState restore on reload');
  assert.ok(calls.cm6SetText.length > setTextBefore,
    'manual Load Vault must force a fresh setText for the re-selected note');
  assert.equal(calls.cm6SetText.at(-1), '# A body');
});

// ── Duplicate filename / silent-overwrite guard ─────────────────────────────
// Bug: saving a draft whose title sanitized to the same filename as an
// existing vault note silently overwrote the existing file. The renderer now
// runs an in-memory pre-check using the shared FileName helper before
// invoking the save IPC; main.js still has the authoritative existence
// check. These tests pin the renderer-side behavior.

test('index.html loads file-name lib before the inline boot script', () => {
  const html = readIndexHtml();
  const fileNameTag = '<script src="./lib/file-name.js"></script>';
  const bootMarker = 'Boot the Markdown editor';
  assert.ok(html.includes(fileNameTag), 'file-name.js script tag should be present');
  assert.ok(
    html.indexOf(fileNameTag) < html.indexOf(bootMarker),
    'file-name.js must load before the inline boot script'
  );
});

function setDraftTitle(elements, title) {
  // The renderer wires titleInput.addEventListener('input', handleEdit), and
  // handleEdit flushes titleInput.value into selectedNote.title. Mirroring
  // that in tests means setting .value then firing 'input'.
  const titleInput = elements.get('titleInput');
  titleInput.value = title;
  titleInput.fire('input');
}

async function assertSaveBlockedWithConflict({ elements, calls, expectedFileName }) {
  const payloadsBefore = calls.saveNotePayloads.length;
  const refreshesBefore = calls.loadVaultNotesPayloads.length;

  await elements.get('saveNoteButton').fireAsync('click');

  assert.equal(
    calls.saveNotePayloads.length,
    payloadsBefore,
    'blocked save must NOT invoke the save IPC'
  );
  assert.equal(
    calls.loadVaultNotesPayloads.length,
    refreshesBefore,
    'blocked save must NOT trigger a refresh — the editor stays as-is'
  );
  const status = elements.get('statusText');
  assert.match(
    status.className,
    /status-error/,
    'blocked save must surface an error status'
  );
  assert.match(
    status.textContent,
    new RegExp(expectedFileName.replace(/\./g, '\\.'), 'i'),
    `error message must mention the conflicting filename "${expectedFileName}"`
  );
  assert.match(
    status.textContent,
    /already exists/i,
    'error message must say the name already exists'
  );
}

test('save is blocked: draft title exactly matches an existing vault note filename', async () => {
  const { calls, elements } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:note.md', title: 'Note', body: '# Note disk', fileName: 'note.md', relativePath: 'note.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Create a fresh draft. After newNote, the new draft is selected.
  elements.get('newNoteButton').fire('click');
  setDraftTitle(elements, 'Note');

  await assertSaveBlockedWithConflict({ elements, calls, expectedFileName: 'note.md' });
});

test('save is blocked: case difference between draft and existing vault note', async () => {
  // macOS APFS / Windows NTFS treat "Welcome.md" and "welcome.md" as the
  // SAME on-disk file, so writing the lowercase name would silently
  // overwrite the title-cased file. The renderer must catch this before
  // touching IPC.
  const { calls, elements } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:Welcome.md', title: 'Welcome', body: '# Welcome', fileName: 'Welcome.md', relativePath: 'Welcome.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('newNoteButton').fire('click');
  setDraftTitle(elements, 'WELCOME');

  await assertSaveBlockedWithConflict({ elements, calls, expectedFileName: 'welcome.md' });
});

test('save is blocked: whitespace differences collapse to the same kebab filename', async () => {
  const { calls, elements } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:my-note.md', title: 'My Note', body: '# My Note', fileName: 'my-note.md', relativePath: 'my-note.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('newNoteButton').fire('click');
  setDraftTitle(elements, '  My   Note  ');

  await assertSaveBlockedWithConflict({ elements, calls, expectedFileName: 'my-note.md' });
});

test('save is blocked: empty-title draft is blocked before filename derivation (Stage 10.2)', async () => {
  // Stage 10.2: the empty-title guard fires before the duplicate-name check.
  // Even when untitled-note.md exists on disk, the user sees "Enter a title"
  // rather than a conflict error — the block is earlier and clearer.
  const { calls, elements } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:untitled-note.md', title: 'Untitled note', body: '#', fileName: 'untitled-note.md', relativePath: 'untitled-note.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('newNoteButton').fire('click');
  // Title is already '' after Stage 10.2; explicitly clear to be safe.
  setDraftTitle(elements, '');

  const payloadsBefore = calls.saveNotePayloads.length;
  await elements.get('saveNoteButton').fireAsync('click');

  assert.equal(calls.saveNotePayloads.length, payloadsBefore, 'empty-title save must not call save IPC');
  assert.match(elements.get('statusText').className, /status-error/);
  assert.match(elements.get('statusText').textContent, /enter a title/i,
    'error message must prompt for a title, not mention a conflicting filename');
});

test('save is blocked: draft title collides with another unsaved draft', async () => {
  // Both drafts have empty relativePath but their derived candidates collide.
  // The save of the SECOND draft must be blocked even though no file exists
  // on disk yet — the user clearly meant two distinct notes.
  const { calls, elements } = makeRendererHarness({});

  await elements.get('chooseVaultButton').fireAsync('click');

  elements.get('newNoteButton').fire('click');
  setDraftTitle(elements, 'Plan');
  // First draft "Plan" has not been saved yet. Its derived path is plan.md.

  elements.get('newNoteButton').fire('click');
  setDraftTitle(elements, 'Plan');
  // Second draft also titled "Plan" — selection is on this new draft.

  await assertSaveBlockedWithConflict({ elements, calls, expectedFileName: 'plan.md' });
});

test('save succeeds: re-saving an existing vault note targets its own file (hybrid)', async () => {
  // Even though notes[A].relativePath = 'note.md' equals the candidate for a
  // hypothetical draft titled "Note", saving the vault note A itself is the
  // legitimate update flow and must NOT be blocked. Pinned to hybrid because
  // it pokes hybridAdapter directly; the CM6 path is covered by save-flow
  // tests above.
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=hybrid',
    vaultNotes: [
      { id: 'vault:note.md', title: 'Note', body: '# Note disk', fileName: 'note.md', relativePath: 'note.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  // A is already selected after choose-vault.

  // Edit body so we have something to save.
  calls.hybridAdapter.text = '# Note edited';
  calls.hybridOnChange('# Note edited');

  await elements.get('saveNoteButton').fireAsync('click');

  assert.equal(calls.saveNotePayloads.length, 1, 'vault re-save must reach the IPC');
  assert.equal(calls.saveNotePayloads[0].note.relativePath, 'note.md');
  assert.equal(calls.saveNotePayloads[0].note.body, '# Note edited');
});

// Engine parity: vault conflict + draft-vs-draft conflict for both engines.
async function assertVaultConflictBlocksSave({ search, engineName }) {
  const { calls, elements } = makeRendererHarness({
    search,
    vaultNotes: [
      { id: 'vault:note.md', title: 'Note', body: '# Note disk', fileName: 'note.md', relativePath: 'note.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('newNoteButton').fire('click');
  setDraftTitle(elements, 'Note');
  await assertSaveBlockedWithConflict({ elements, calls, expectedFileName: 'note.md' });
}

async function assertDraftConflictBlocksSave({ search, engineName }) {
  const { calls, elements } = makeRendererHarness({ search });
  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('newNoteButton').fire('click');
  setDraftTitle(elements, 'Plan');
  elements.get('newNoteButton').fire('click');
  setDraftTitle(elements, 'Plan');
  await assertSaveBlockedWithConflict({ elements, calls, expectedFileName: 'plan.md' });
}

test('engine parity: vault conflict blocks save (hybrid)', async () => {
  await assertVaultConflictBlocksSave({ search: '?writeEngine=hybrid', engineName: 'hybrid' });
});

test('engine parity: vault conflict blocks save (cm6)', async () => {
  await assertVaultConflictBlocksSave({ search: '?writeEngine=cm6', engineName: 'cm6' });
});

test('engine parity: draft-vs-draft conflict blocks save (hybrid)', async () => {
  await assertDraftConflictBlocksSave({ search: '?writeEngine=hybrid', engineName: 'hybrid' });
});

test('engine parity: draft-vs-draft conflict blocks save (cm6)', async () => {
  await assertDraftConflictBlocksSave({ search: '?writeEngine=cm6', engineName: 'cm6' });
});

// ── Title-change rename: gated on intentional title change ─────────────────
// Bug: changing the title of an existing vault note and saving updated the
// title inside the file but did NOT rename the file on disk. The fix renames
// the disk file when (and only when) the user has changed the title since
// the note was loaded AND the derived target differs from the current
// relativePath. Pre-existing title/filename mismatches stay put on a save
// where the user did not touch the title.

test('rename: existing vault note with mismatched title/filename and no title change saves in place (hybrid)', async () => {
  // Note seeded with a deliberate disk-vs-title mismatch (title "Beautiful
  // Title", relativePath "note-x.md"). User clicks Save without touching
  // the titleInput → no rename, save in place at the original path. Pinned
  // to hybrid because it pokes hybridAdapter directly.
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=hybrid',
    vaultNotes: [
      { id: 'vault:note-x.md', title: 'Beautiful Title', body: '# Beautiful Title body',
        fileName: 'note-x.md', relativePath: 'note-x.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Edit body so we have a meaningful save.
  calls.hybridAdapter.text = '# Beautiful Title body edited';
  calls.hybridOnChange('# Beautiful Title body edited');

  await elements.get('saveNoteButton').fireAsync('click');

  assert.equal(calls.saveNotePayloads.length, 1);
  assert.equal(calls.saveNotePayloads[0].note.relativePath, 'note-x.md',
    'relativePath in IPC payload must be the original (no rename)');
  assert.equal(calls.saveNotePayloads[0].note.title, 'Beautiful Title');
  // After save+refresh, the in-memory selected note still lives at note-x.md.
  // (Children[0] should be the only note.)
  const list = elements.get('noteList').children;
  assert.ok(list[0].className.includes('active'));
});

test('rename: title change to a free target renames the file on disk', async () => {
  const { calls, elements } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Change title from A → "Hello world".
  setDraftTitle(elements, 'Hello world');

  await elements.get('saveNoteButton').fireAsync('click');

  assert.equal(calls.saveNotePayloads.length, 1, 'save must reach IPC');
  assert.equal(calls.saveNotePayloads[0].note.title, 'Hello world');
  assert.equal(calls.saveNotePayloads[0].note.loadedTitle, 'A',
    'IPC payload must include loadedTitle so main can detect intentional change');

  // After refresh, the note's relativePath is the new derived path.
  // The harness' saveNote mock simulates rename: persistedVaultNotes now has
  // hello-world.md instead of a.md, and the renderer reloads it.
  const list = elements.get('noteList').children;
  assert.equal(list.length, 1);
  assert.ok(list[0].className.includes('active'));
});

test('rename: title change conflicting with another vault note is blocked before IPC', async () => {
  // Vault has both a.md and b.md. Loading a.md and renaming its title to
  // "B" must block before IPC because b.md already exists.
  const { calls, elements } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  // A is selected after choose-vault.
  setDraftTitle(elements, 'B');

  await assertSaveBlockedWithConflict({ elements, calls, expectedFileName: 'b.md' });
});

test('rename: title change conflicting with an unsaved draft is blocked before IPC (NEW)', async () => {
  // Vault has a.md. An unsaved draft titled "B" exists (its derived path is
  // b.md). User loads a.md, changes title to "B" → derived path collides
  // with the draft. Save must block BEFORE the IPC. Both notes must remain
  // intact in memory.
  const { calls, elements } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Create the unsaved draft B.
  elements.get('newNoteButton').fire('click');
  setDraftTitle(elements, 'B');
  // After newNote → notes=[draft (B), vault:a.md] under 'drafts' filter.
  // Switch back to A so we can rename A's title.
  elements.get('filterAll').fire('click');
  // Under 'all' filter: notes=[draft, a.md]; A is at index 1.
  elements.get('noteList').children[1].fire('click');

  // Sanity: A is the active note.
  const initialList = elements.get('noteList').children;
  assert.ok(initialList[1].className.includes('active'));

  // Rename A's title to "B" → derived path 'b.md' collides with the draft.
  setDraftTitle(elements, 'B');

  await assertSaveBlockedWithConflict({ elements, calls, expectedFileName: 'b.md' });

  // Both notes must remain intact:
  //   - vault:a.md still at a.md
  //   - draft still has empty relativePath and title "B"
  // (The blocked save did not touch IPC, so the harness's persistedVaultNotes
  // is unchanged and the in-memory notes array is also unchanged.)
  const aNote = elements.get('noteList').children[1];
  assert.ok(aNote, 'A must still be in the list');
});

test('rename: case-only title change does not trigger rename (no IPC conflict)', async () => {
  const { calls, elements } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:Welcome.md', title: 'Welcome', body: '# Welcome',
        fileName: 'Welcome.md', relativePath: 'Welcome.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Change "Welcome" → "welcome" (case-only).
  setDraftTitle(elements, 'welcome');

  await elements.get('saveNoteButton').fireAsync('click');

  assert.equal(calls.saveNotePayloads.length, 1, 'save must reach IPC');
  assert.equal(calls.saveNotePayloads[0].note.relativePath, 'Welcome.md',
    'IPC payload preserves the original path; case-only retitle is not a rename');
});

// ── CM6 active-rename behavior: assert observable behavior, no private locals ──
test('CM6: title-change rename keeps the renamed note selected and preserves CM6 EditorState', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a.md',     title: 'A',     body: '# A',     fileName: 'a.md',     relativePath: 'a.md' },
      { id: 'vault:other.md', title: 'Other', body: '# Other', fileName: 'other.md', relativePath: 'other.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  // A is selected. Edit so the live CM6 state carries an identifying tag.
  calls.cm6Adapter.text = '# A edited';
  calls.cm6Adapter._state = { doc: '# A edited', _kind: 'A-rename-marker' };
  calls.cm6OnChange('# A edited');

  // Rename A's title to a free target.
  setDraftTitle(elements, 'Hello');

  const setTextBefore = calls.cm6SetText.length;
  await elements.get('saveNoteButton').fireAsync('click');

  // Behavior 1: the renamed note remains the active selection.
  // After rename + refresh: vault has [hello.md, other.md] (alphabetical).
  // The renamed note "hello" must be the active item.
  const listAfter = elements.get('noteList').children;
  const activeIndex = [...listAfter].findIndex((c) => c.className.includes('active'));
  assert.notEqual(activeIndex, -1, 'some note must be active after rename');
  // The active item is the renamed one — verified by clicking it being a noop
  // (already selected) and by the CM6 marker still showing.

  // Behavior 2: setText was NOT called during the active-note rename refresh.
  // The save+refresh must not have torn down and rebuilt the live editor.
  assert.equal(calls.cm6SetText.length, setTextBefore,
    'active rename must not call setText — CM6 state is preserved in-place');

  // Behavior 3: the live CM6 state marker survived.
  assert.equal(calls.cm6Adapter._state._kind, 'A-rename-marker',
    'live CM6 state with marker must survive rename');

  // Behavior 4: switching away and back returns via setState (cache hit) with
  // the same marker, proving the migrated cache key works.
  // Find the OTHER note's index (the one without 'active').
  const otherIndex = activeIndex === 0 ? 1 : 0;
  elements.get('noteList').children[otherIndex].fire('click');

  const setStateBefore = calls.cm6SetState.length;
  const setTextBefore2 = calls.cm6SetText.length;
  // Switch back to the renamed note.
  elements.get('noteList').children[activeIndex].fire('click');

  assert.ok(calls.cm6SetState.length > setStateBefore,
    'returning to renamed note must restore via setState (cache hit under new id)');
  assert.equal(calls.cm6SetText.length, setTextBefore2,
    'returning to renamed note must NOT call setText');
  assert.equal(calls.cm6Adapter._state._kind, 'A-rename-marker',
    'restored state marker must equal the pre-rename marker');
});

test('rename: dirty unrelated vault note + draft survive a rename save and the post-save watcher (hybrid)', async () => {
  // Pinned to hybrid because it pokes hybridAdapter directly.
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=hybrid',
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Edit A's body in memory.
  calls.hybridAdapter.text = '# A edited';
  calls.hybridOnChange('# A edited');

  // Switch to B, edit B's body (unsaved).
  elements.get('noteList').children[1].fire('click');
  calls.hybridAdapter.text = '# B edited';
  calls.hybridOnChange('# B edited');

  // Create draft D, edit body.
  elements.get('newNoteButton').fire('click');
  setDraftTitle(elements, 'Draft D rename');
  calls.hybridAdapter.text = '# D edited';
  calls.hybridOnChange('# D edited');

  // Show all and switch back to A.
  elements.get('filterAll').fire('click');
  // notes=[D, A, B] → A at index 1.
  elements.get('noteList').children[1].fire('click');

  // Rename A's title to "Hello".
  setDraftTitle(elements, 'Hello');
  await elements.get('saveNoteButton').fireAsync('click');

  // Fire post-save watcher for the new path.
  await calls.vaultChangedCallback({ fileName: 'hello.md' });

  // After rename, the disk-side splice removes a.md and pushes hello.md to
  // the end of the persisted list, so notes order becomes
  // [b.md, hello.md, D]. children[0]=B, children[1]=renamed (hello.md, the
  // selected one), children[2]=D.
  elements.get('noteList').children[0].fire('click');
  assert.equal(calls.hybridAdapter.text, '# B edited',
    "B's in-memory edited body must survive rename + watcher");

  elements.get('noteList').children[2].fire('click');
  assert.equal(calls.hybridAdapter.text, '# D edited',
    "D's in-memory edited body must survive rename + watcher");
});

test('rename: empty title vault retitle attempts rename to untitled-note.md', async () => {
  const { calls, elements } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  setDraftTitle(elements, '');

  // No untitled-note.md on disk → rename succeeds.
  await elements.get('saveNoteButton').fireAsync('click');
  assert.equal(calls.saveNotePayloads.length, 1, 'save must reach IPC');
  assert.equal(calls.saveNotePayloads[0].note.title, '');
  assert.equal(calls.saveNotePayloads[0].note.loadedTitle, 'A');
});

// Engine parity: same rename path for Hybrid and CM6.
async function assertVaultRenameWorks({ search, engineName }) {
  const { calls, elements } = makeRendererHarness({
    search,
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  setDraftTitle(elements, 'Renamed');
  await elements.get('saveNoteButton').fireAsync('click');

  assert.equal(calls.saveNotePayloads.length, 1);
  assert.equal(calls.saveNotePayloads[0].note.title, 'Renamed');
  assert.equal(calls.saveNotePayloads[0].note.loadedTitle, 'A');
  // After successful rename: list shows the renamed note as active.
  const list = elements.get('noteList').children;
  assert.equal(list.length, 1);
  assert.ok(list[0].className.includes('active'));
}

test('rename engine parity: vault rename works (hybrid)', async () => {
  await assertVaultRenameWorks({ search: '?writeEngine=hybrid', engineName: 'hybrid' });
});

test('rename engine parity: vault rename works (cm6)', async () => {
  await assertVaultRenameWorks({ search: '?writeEngine=cm6', engineName: 'cm6' });
});

// ── Bug #2 behavior: scroll-position sync between Write and Preview ─────────
// The wiring tests in editor-config.test.js are source-regex assertions; the
// tests below drive the actual mode-toggle lifecycle, flush the deferred
// apply via the harness's rAF queue, and assert on observed scrollTop. They
// exercise the same code path the production click handlers run.

test('scroll sync: Write → Preview applies the captured ratio to .toastui-editor-md-preview', async () => {
  const { elements, flushRaf } = makeRendererHarness();
  await elements.get('chooseVaultButton').fireAsync('click');

  // Set up Write pane at 40% scrolled. Max scrollTop = 1000 - 400 = 600.
  // 240 / 600 = 0.4. The capture happens BEFORE setMarkdown runs, so even
  // though setMarkdown is invoked during showPreviewMode, the captured
  // ratio reflects the user's pre-toggle position.
  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 1000;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 240;

  // Preview target with intentionally different dimensions to prove the sync
  // is ratio-based, not pixel-based. Max scrollTop = 2100 - 400 = 1700.
  const previewEl = elements.get('toastPreviewMount')._previewScrollEl;
  previewEl.scrollHeight = 2100;
  previewEl.clientHeight = 400;
  previewEl.scrollTop    = 0;

  elements.get('previewModeButton').fire('click');

  // The apply runs only after the rAF tick — before that, scrollTop is untouched.
  assert.equal(previewEl.scrollTop, 0,
    'apply must be deferred — scrollTop should still be 0 before flushRaf');

  flushRaf();

  // 0.4 * (2100 - 400) = 0.4 * 1700 = 680.
  assert.equal(previewEl.scrollTop, 680,
    'preview scrollTop must reflect the captured ratio mapped onto the preview surface');
});

test('scroll sync: Preview → Write applies the captured ratio to hybridWritePane', async () => {
  const { elements, flushRaf } = makeRendererHarness();
  await elements.get('chooseVaultButton').fireAsync('click');

  // Enter Preview mode first — the per-note view-state model uses
  // currentMode as the single source of truth, so clicking Write while
  // already in Write is now a no-op. Clicking Preview here flips
  // currentMode to 'preview', after which the Write button click does
  // the capture-then-apply we want to verify.
  elements.get('previewModeButton').fire('click');
  flushRaf();

  // Preview at 70% scrolled. Max scrollTop = 800 - 400 = 400. 280 / 400 = 0.7.
  const previewEl = elements.get('toastPreviewMount')._previewScrollEl;
  previewEl.scrollHeight = 800;
  previewEl.clientHeight = 400;
  previewEl.scrollTop    = 280;

  // Write target with different dimensions. Max scrollTop = 2400 - 400 = 2000.
  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 2400;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 0;

  elements.get('writeModeButton').fire('click');

  assert.equal(writePane.scrollTop, 0,
    'apply must be deferred — scrollTop should still be 0 before flushRaf');

  flushRaf();

  // 0.7 * (2400 - 400) = 0.7 * 2000 = 1400.
  assert.equal(writePane.scrollTop, 1400,
    'write scrollTop must reflect the captured ratio mapped onto the Write surface');
});

test('scroll sync: round-trip Write → Preview → Write returns to the same write scrollTop when surface heights are stable', async () => {
  const { elements, flushRaf } = makeRendererHarness();
  await elements.get('chooseVaultButton').fireAsync('click');

  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 1000;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 240; // 40%

  const previewEl = elements.get('toastPreviewMount')._previewScrollEl;
  previewEl.scrollHeight = 1000;
  previewEl.clientHeight = 400;
  previewEl.scrollTop    = 0;

  elements.get('previewModeButton').fire('click');
  flushRaf();
  assert.equal(previewEl.scrollTop, 240,
    'preview should land at the same pixel position when both surfaces have identical dimensions');

  // Going back: writePane.scrollTop currently still reads 240 (browsers
  // preserve scrollTop across display:none/block; the harness mirrors that
  // by leaving it untouched). Reset it to 0 so the test proves the
  // round-trip apply, not the latent value.
  writePane.scrollTop = 0;

  elements.get('writeModeButton').fire('click');
  flushRaf();
  assert.equal(writePane.scrollTop, 240,
    'returning to Write must land at the captured ratio applied to the Write surface');
});

test('scroll sync: short document is a no-op (no scrollable range, no jump)', async () => {
  const { elements, flushRaf } = makeRendererHarness();
  await elements.get('chooseVaultButton').fireAsync('click');

  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 200;
  writePane.clientHeight = 400; // doc shorter than viewport
  writePane.scrollTop    = 0;

  const previewEl = elements.get('toastPreviewMount')._previewScrollEl;
  previewEl.scrollHeight = 250;
  previewEl.clientHeight = 400;
  previewEl.scrollTop    = 7; // arbitrary pre-existing value

  elements.get('previewModeButton').fire('click');
  flushRaf();

  assert.equal(previewEl.scrollTop, 7,
    'short Preview surface must not be touched — no scrollable range exists');
});

test('scroll sync: apply gracefully no-ops when the Preview scroll element is missing', async () => {
  const { elements, flushRaf } = makeRendererHarness();
  await elements.get('chooseVaultButton').fireAsync('click');

  // Drop the harness's stand-in by overriding querySelector to return null
  // (simulates Toast UI not yet having mounted its preview pane).
  const mount = elements.get('toastPreviewMount');
  mount.querySelector = () => null;

  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 1000;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 240;

  // Should not throw.
  elements.get('previewModeButton').fire('click');
  flushRaf();
});

// ── CM6 verification: hybridWritePane is the effective Write scroll container ──
test('CM6: createCm6WriteView mounts inside hybridWritePane (the same scroll container Hybrid uses)', async () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=cm6' });
  await elements.get('chooseVaultButton').fireAsync('click');

  // Production passes hybridWritePane as the parent (index.html showed
  // `createCm6WriteView(hybridWritePane, ...)`). Pin it here so any future
  // change to "scroll a nested element instead" is caught.
  assert.equal(calls.cm6Parent, elements.get('hybridWritePane'),
    'CM6 must mount inside hybridWritePane so the outer pane handles scrolling');
});

test('scroll sync: CM6 engine uses hybridWritePane as the Write scroll target', async () => {
  const { elements, flushRaf } = makeRendererHarness({ search: '?writeEngine=cm6' });
  await elements.get('chooseVaultButton').fireAsync('click');

  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 1000;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 240; // 40%

  const previewEl = elements.get('toastPreviewMount')._previewScrollEl;
  previewEl.scrollHeight = 2100;
  previewEl.clientHeight = 400;
  previewEl.scrollTop    = 0;

  elements.get('previewModeButton').fire('click');
  flushRaf();

  // Same expectation as the Hybrid case: the Write→Preview ratio applies
  // identically because hybridWritePane is the Write scroller for both engines.
  assert.equal(previewEl.scrollTop, 680);

  // Now Preview → Write under CM6.
  previewEl.scrollHeight = 800;
  previewEl.clientHeight = 400;
  previewEl.scrollTop    = 280; // 70%
  writePane.scrollTop    = 0;

  elements.get('writeModeButton').fire('click');
  flushRaf();

  // 0.7 * (1000 - 400) = 0.7 * 600 = 420.
  assert.equal(writePane.scrollTop, 420);
});

// ── Bug #2 follow-up: per-note view state + double-rAF apply ───────────────
// Three intertwined defects:
//   1. Write → Preview still jumps to bottom (Toast UI's own auto-scroll
//      after setMarkdown runs AFTER our applyScrollRatio in single-rAF).
//   2. Mode bleeds across notes (no per-note mode tracking).
//   3. Scroll position bleeds across notes (no per-note scroll tracking).
//
// The fix introduces a renderer-only Map<note.id, { mode, scrollRatio }> that
// is captured on note-leave and restored on note-arrive, plus a double-rAF
// apply step so the apply runs AFTER Toast UI's two-step scroll-sync.

// Helper: simulate a two-frame Toast UI auto-scroll. The first scheduled rAF
// fires our auto-scroll stub, which enqueues a SECOND rAF that scrolls the
// preview to the bottom. With single-rAF apply, our apply runs in the same
// pass as the stub and gets stomped by the second-frame scroll. With
// double-rAF apply, our inner apply runs in the same pass as the
// second-frame scroll BUT after it (FIFO), and wins.

test('bug #2: Write → Preview wins against simulated Toast UI auto-scroll-after-setMarkdown', async () => {
  const { calls, elements, flushRaf } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 1000;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 240; // 40%

  const previewEl = elements.get('toastPreviewMount')._previewScrollEl;
  previewEl.scrollHeight = 2100;
  previewEl.clientHeight = 400;
  previewEl.scrollTop    = 0;

  // Enable the harness's two-frame Toast UI scroll-after-setMarkdown sim.
  // Single-rAF apply produces the bottom (FAIL); double-rAF wins (PASS).
  calls.toastAutoScrollOnSetMarkdown = true;

  elements.get('previewModeButton').fire('click');
  flushRaf();

  // 0.4 * (2100-400) = 680. NOT 1700 (the simulated bottom).
  assert.equal(previewEl.scrollTop, 680,
    'apply must land AFTER Toast UI auto-scroll — final scrollTop must be the captured ratio');
});

test('bug #2: each note remembers its own Write/Preview mode', async () => {
  const { elements, flushRaf } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
      { id: 'vault:c.md', title: 'C', body: '# C', fileName: 'c.md', relativePath: 'c.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  const writeBtn   = elements.get('writeModeButton');
  const previewBtn = elements.get('previewModeButton');

  // A → Preview.
  elements.get('previewModeButton').fire('click');
  flushRaf();
  assert.ok(previewBtn.className.includes('mode-button-active'), 'A is now in Preview');

  // Switch to B (default Write).
  elements.get('noteList').children[1].fire('click');
  flushRaf();
  assert.ok(writeBtn.className.includes('mode-button-active'), 'B opens in default Write');

  // C (default Write), then C → Preview.
  elements.get('noteList').children[2].fire('click');
  flushRaf();
  assert.ok(writeBtn.className.includes('mode-button-active'), 'C opens in default Write');
  elements.get('previewModeButton').fire('click');
  flushRaf();
  assert.ok(previewBtn.className.includes('mode-button-active'), 'C is now in Preview');

  // Now rotate among them; each must restore its own mode.
  elements.get('noteList').children[0].fire('click'); // A
  flushRaf();
  assert.ok(previewBtn.className.includes('mode-button-active'),
    'A restored to its saved Preview mode');

  elements.get('noteList').children[1].fire('click'); // B
  flushRaf();
  assert.ok(writeBtn.className.includes('mode-button-active'),
    'B restored to its saved Write mode');

  elements.get('noteList').children[2].fire('click'); // C
  flushRaf();
  assert.ok(previewBtn.className.includes('mode-button-active'),
    'C restored to its saved Preview mode');
});

test('bug #2: each note remembers its own Write scroll position', async () => {
  const { elements, flushRaf } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 1000;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 240; // A at 40%

  // Switch to B → never visited → opens at top.
  elements.get('noteList').children[1].fire('click');
  flushRaf();
  assert.equal(writePane.scrollTop, 0,
    'never-visited note opens at default scrollTop');

  // Back to A → restores 40%.
  elements.get('noteList').children[0].fire('click');
  flushRaf();
  assert.equal(writePane.scrollTop, 240,
    "A's saved Write scroll position must be restored");
});

test('bug #2: each note remembers its own Preview scroll position', async () => {
  const { calls, elements, flushRaf } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 1000;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 0;

  const previewEl = elements.get('toastPreviewMount')._previewScrollEl;
  previewEl.scrollHeight = 1000;
  previewEl.clientHeight = 400;

  // Enable the auto-scroll simulation so this test also exercises double-rAF.
  calls.toastAutoScrollOnSetMarkdown = true;

  // A → Preview, then user scrolls to 30%.
  elements.get('previewModeButton').fire('click');
  flushRaf();
  previewEl.scrollTop = 180; // 30% of (1000-400) = 0.3*600 = 180.

  // Switch to B (default Write).
  elements.get('noteList').children[1].fire('click');
  flushRaf();

  // B → Preview, scroll to 70%.
  elements.get('previewModeButton').fire('click');
  flushRaf();
  previewEl.scrollTop = 420;

  // Switch back to A — A restores Preview at 30%.
  elements.get('noteList').children[0].fire('click');
  flushRaf();
  assert.equal(previewEl.scrollTop, 180,
    "A's saved Preview scroll position must be restored");

  // Back to B — B restores Preview at 70%.
  elements.get('noteList').children[1].fire('click');
  flushRaf();
  assert.equal(previewEl.scrollTop, 420,
    "B's saved Preview scroll position must be restored");
});

test('bug #2: never-visited note opens in Write mode at top, ignoring previous note state', async () => {
  const { elements, flushRaf } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  // A → Preview at 50% (so B should NOT inherit).
  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 1000;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 300; // 50% in Write

  elements.get('previewModeButton').fire('click');
  flushRaf();
  const previewEl = elements.get('toastPreviewMount')._previewScrollEl;
  previewEl.scrollHeight = 1000;
  previewEl.clientHeight = 400;
  previewEl.scrollTop = 300;

  // First visit to B.
  elements.get('noteList').children[1].fire('click');
  flushRaf();

  assert.ok(elements.get('writeModeButton').className.includes('mode-button-active'),
    'never-visited note opens in default Write mode');
  assert.equal(writePane.scrollTop, 0,
    'never-visited note opens at scrollTop 0');
});

test('bug #2: vault re-save preserves the note view state across the post-save refresh (hybrid)', async () => {
  // Pinned to hybrid because it pokes hybridAdapter directly.
  const { calls, elements, flushRaf } = makeRendererHarness({
    search: '?writeEngine=hybrid',
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  // Drain the initial restoreNoteViewState's deferred apply (which would
  // otherwise override the manual scrollTop assignment below).
  flushRaf();

  // Edit so the IPC has something to send.
  calls.hybridAdapter.text = '# A edited';
  calls.hybridOnChange('# A edited');

  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 1000;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 240;

  await elements.get('saveNoteButton').fireAsync('click');
  flushRaf();

  // Same id, same path — DOM-natural scroll preservation. View state intact.
  assert.ok(elements.get('writeModeButton').className.includes('mode-button-active'));
  assert.equal(writePane.scrollTop, 240,
    'vault re-save must NOT reset the view position');
});

test('bug #2: rename migrates the per-note view state to the new id', async () => {
  const { calls, elements, flushRaf } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:c.md', title: 'C', body: '# C', fileName: 'c.md', relativePath: 'c.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 1000;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 240;

  // Switch to C and back so A's entry is captured under its OLD id (vault:a.md).
  elements.get('noteList').children[1].fire('click');
  flushRaf();
  elements.get('noteList').children[0].fire('click');
  flushRaf();
  assert.equal(writePane.scrollTop, 240, 'sanity: A restored to 40%');

  // Rename A → "Hello". After save, harness's persistedVaultNotes splice
  // out a.md and push hello.md, so order becomes [c.md, hello.md].
  setDraftTitle(elements, 'Hello');
  await elements.get('saveNoteButton').fireAsync('click');
  flushRaf();

  // Sanity: renamed note is still at 40% (DOM-natural; renderEditor branch
  // didn't fire because liveEditorLastNoteId was realigned to the new id).
  assert.equal(writePane.scrollTop, 240, 'sanity: post-rename the renamed note holds 40%');

  // Now switch to C (children[0]) and back to renamed (children[1]).
  // If migration worked, the renamed note's NEW id has the saved entry and
  // restoreNoteViewState applies 40%. Without migration, the new id has
  // no entry and restore would reset to top.
  elements.get('noteList').children[0].fire('click');
  flushRaf();
  elements.get('noteList').children[1].fire('click');
  flushRaf();
  assert.equal(writePane.scrollTop, 240,
    'rename must migrate the view state — renamed note must restore the saved 40%');
});

test('bug #2: draft → vault save migrates the per-note view state to the new vault id (hybrid)', async () => {
  // Pinned to hybrid because it pokes hybridAdapter directly.
  const { calls, elements, flushRaf } = makeRendererHarness({
    search: '?writeEngine=hybrid',
    vaultNotes: [
      { id: 'vault:other.md', title: 'Other', body: '# Other', fileName: 'other.md', relativePath: 'other.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  flushRaf();

  // Create a Plan draft.
  elements.get('newNoteButton').fire('click');
  setDraftTitle(elements, 'Plan');
  calls.hybridAdapter.text = '# Plan';
  calls.hybridOnChange('# Plan');
  flushRaf();

  // Show all so we have a known second note (Other) to switch to.
  // notes after newNote: [draft:2 (Plan), vault:other.md].
  // children[0] = Plan (selected), children[1] = Other.
  elements.get('filterAll').fire('click');
  flushRaf();

  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 1000;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 240; // 40%

  // Switch to Other and back so Plan's view state is captured under its DRAFT id.
  elements.get('noteList').children[1].fire('click');
  flushRaf();
  elements.get('noteList').children[0].fire('click');
  flushRaf();
  assert.equal(writePane.scrollTop, 240, 'sanity: Plan restored to 40%');

  // Save Plan → becomes vault:plan.md. id changes from draft:2 to vault:plan.md;
  // view state must migrate.
  await elements.get('saveNoteButton').fireAsync('click');
  flushRaf();
  assert.equal(writePane.scrollTop, 240,
    'sanity: post-save the saved-as-vault note still holds 40% (DOM-natural)');

  // After save: persistedVaultNotes order = [Other, plan.md] (push at end of
  // existing list). children = [Other, plan.md] under 'all'.
  // Switch to Other then back to (saved) Plan; the migrated entry must
  // restore 40% under the new vault id.
  elements.get('noteList').children[0].fire('click'); // → Other
  flushRaf();
  elements.get('noteList').children[1].fire('click'); // → renamed Plan
  flushRaf();
  assert.equal(writePane.scrollTop, 240,
    'draft → vault save must migrate the view state to the new vault id');
});

// ── Bug #2 timing follow-up: bounded-retry Preview restore ─────────────────
// The previous double-rAF-only fix wins against rAF-based Toast UI scroll
// stomps but loses against Toast UI's actual mechanism — a 200 ms setTimeout
// scheduled off `afterPreviewRender` (lib/toastui-bundle.js:32886). The
// bounded-retry helper applies the ratio at multiple checkpoints, the last
// of which is past 200 ms, so it wins regardless of which timer model real
// Toast UI uses on a given platform.

test('bug #2: same-note Write → Preview wins against Toast UI 200ms afterPreviewRender setTimeout', async () => {
  const { calls, elements, flushTimers } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  flushTimers();

  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 1000;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 240; // 40%

  const previewEl = elements.get('toastPreviewMount')._previewScrollEl;
  previewEl.scrollHeight = 2100;
  previewEl.clientHeight = 400;
  previewEl.scrollTop    = 0;

  // Realistic simulation: setMarkdown enqueues a 200 ms setTimeout that
  // scrolls the preview to the bottom (Toast UI's syncPreviewScrollTop with
  // isBottomPos === true). Our double-rAF apply (~32 ms) loses; the
  // bounded-retry tier-3 setTimeout(250 ms) wins.
  calls.toastDelayedScrollOnSetMarkdown = true;

  elements.get('previewModeButton').fire('click');
  flushTimers();

  // 0.4 * (2100-400) = 680. NOT 1700 (the simulated bottom).
  assert.equal(previewEl.scrollTop, 680,
    'Preview must end at the captured ratio after Toast UI 200ms scroll fires');
});

test('bug #2: cross-note Preview restore wins against Toast UI 200ms afterPreviewRender setTimeout', async () => {
  const { calls, elements, flushTimers } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  flushTimers();

  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 1000;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 0;

  const previewEl = elements.get('toastPreviewMount')._previewScrollEl;
  previewEl.scrollHeight = 1000;
  previewEl.clientHeight = 400;

  // Capture A in Preview at 30% (180 / 600 = 0.3).
  elements.get('previewModeButton').fire('click');
  flushTimers();
  previewEl.scrollTop = 180;

  // Switch to B (captures A's view state under id vault:a.md as
  // { mode: 'preview', scrollRatio: 0.3 }).
  elements.get('noteList').children[1].fire('click');
  flushTimers();

  // Enable the realistic 200 ms scroll-to-bottom AFTER the capture so
  // it only fires for the next setMarkdown (the upcoming switch back).
  calls.toastDelayedScrollOnSetMarkdown = true;

  // Switch back to A. Restore should fire applyPreviewScrollRatioWithRetries
  // with ratio 0.3. Toast UI's 200 ms timer fires between our rAF tiers and
  // our 250 ms tier; the 250 ms tier wins.
  elements.get('noteList').children[0].fire('click');
  flushTimers();

  // 0.3 * (1000 - 400) = 180. NOT 600 (the simulated bottom).
  assert.equal(previewEl.scrollTop, 180,
    "A's saved Preview scroll position must be restored after the Toast UI 200ms scroll fires");
});

test('bug #2: Preview restore writes the ratio to BOTH .toastui-editor-md-preview AND .toastui-editor-contents', async () => {
  // Manual QA showed the visible Preview scroller in the real Electron app
  // is `.toastui-editor-contents` (nested inside `.toastui-editor-md-preview`)
  // — not always the outer element Toast UI's own ScrollSync2 writes to.
  // Since which element actually scrolls is environment-dependent, the
  // helper writes the ratio to BOTH; applyScrollRatio is short-target safe
  // so writes to a non-scrollable element are harmless no-ops.
  const { calls, elements, flushTimers } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  flushTimers();

  // Write at 40% (240 / 600).
  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 1000;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 240;

  // Outer Preview surface: distinct dimensions from the inner. Max=600.
  const outerPreview = elements.get('toastPreviewMount')._previewScrollEl;
  outerPreview.scrollHeight = 1000;
  outerPreview.clientHeight = 400;
  outerPreview.scrollTop    = 0;

  // Inner Preview contents: different dimensions to prove BOTH receive a
  // ratio-correct write (not the same pixel value as the outer). Max=400.
  const innerContents = outerPreview._previewContentsEl;
  innerContents.scrollHeight = 800;
  innerContents.clientHeight = 400;
  innerContents.scrollTop    = 0;

  elements.get('previewModeButton').fire('click');
  flushTimers();

  // Outer: 0.4 * (1000 - 400) = 240.
  assert.equal(outerPreview.scrollTop, 240,
    '.toastui-editor-md-preview must receive ratio applied against its own scrollable range');
  // Inner: 0.4 * (800 - 400) = 160. Different pixel value, same ratio.
  assert.equal(innerContents.scrollTop, 160,
    '.toastui-editor-contents must receive the SAME ratio applied against its own scrollable range');
});

test('bug #2: Toast UI internal scroll-sync is disabled after _toastuiInstance is constructed', async () => {
  // Toast UI's ScrollSync2 (lib/toastui-bundle.js) runs an animated scrollTop
  // write loop driven by `setTimeout(step, 1)` over `ANIMATION_TIME = 100 ms`,
  // started 200 ms after every `afterPreviewRender` event. No bounded retry
  // can reliably win that race. The fix replaces both inner methods with
  // no-ops immediately after the editor is constructed. This test asserts
  // the override actually ran by invoking the method via the public
  // `scrollSync` property and verifying the harness's spy counters do NOT
  // increment — proving the production code replaced them.
  const { calls, elements } = makeRendererHarness();
  await elements.get('chooseVaultButton').fireAsync('click');

  assert.ok(calls.toastInstance, 'Toast UI instance must be constructed at boot');
  assert.ok(calls.toastInstance.scrollSync,
    'mocked Toast UI instance must expose .scrollSync (mirroring real shape)');

  const previewBefore = calls.toastNativeSyncPreview;
  const editorBefore  = calls.toastNativeSyncEditor;

  // Invoke the methods exactly as Toast UI itself would after the
  // afterPreviewRender 200 ms timer fires. With the production override,
  // both calls return without touching scrollTop.
  calls.toastInstance.scrollSync.syncPreviewScrollTop();
  calls.toastInstance.scrollSync.syncEditorScrollTop();

  assert.equal(calls.toastNativeSyncPreview, previewBefore,
    'Toast UI scrollSync.syncPreviewScrollTop must be replaced with a no-op');
  assert.equal(calls.toastNativeSyncEditor, editorBefore,
    'Toast UI scrollSync.syncEditorScrollTop must be replaced with a no-op');
});

test('bug #2: stale Preview tier-3 timer does not stomp the pane after the user has left Preview', async () => {
  // Codex follow-up: the bounded-retry helper's tier-3 setTimeout(250) can
  // still be pending after the user toggles to Write (or switches to a
  // Write-mode note). Without the stale-timer guard, the delayed apply
  // re-queries previewScrollEl() and writes the OLD ratio onto the
  // (now-hidden) preview pane. The guard makes the apply no-op when:
  //   - currentMode is no longer 'preview', OR
  //   - a newer applyPreviewScrollRatioWithRetries has bumped the generation.
  const { calls, elements, flushRaf, flushTimers } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  flushTimers();

  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 1000;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 240; // 40%

  const previewEl = elements.get('toastPreviewMount')._previewScrollEl;
  previewEl.scrollHeight = 1000;
  previewEl.clientHeight = 400;
  previewEl.scrollTop    = 0;

  // Click Preview → applyPreviewScrollRatioWithRetries(0.4) schedules
  // tier-1 + tier-2 + tier-3. Then immediately click Write → showWriteMode
  // sets currentMode='write' and schedules its own apply.
  elements.get('previewModeButton').fire('click');
  elements.get('writeModeButton').fire('click');

  // Drain rAFs only — tier-1 + tier-2 of the preview helper fire (apply
  // 0.4 to previewEl), and the Write apply fires. The tier-3 setTimeout
  // for Preview is still pending in the timer queue.
  flushRaf();

  // Sentinel value: anything that is NOT 0.4 * 600 = 240. Without the
  // stale-timer guard, the pending tier-3 will overwrite this with 240.
  previewEl.scrollTop = 999;

  // Drain remaining timers — the stale tier-3 fires here.
  flushTimers();

  // With the guard: tier-3 sees currentMode === 'write' and noops; the
  // sentinel 999 is preserved. Without the guard: tier-3 applies 0.4 to
  // previewEl, overwriting 999 with 240.
  assert.equal(
    previewEl.scrollTop, 999,
    'stale Preview tier-3 must not overwrite the pane after the user has toggled to Write'
  );
});

test('bug #2: deleted note id does not leak its view state into a recreated note with the same id (hybrid)', async () => {
  // Codex follow-up: after delete, renderApp/refreshVaultNotes can fire
  // renderEditor while liveEditorLastNoteId still points at the deleted
  // note. Without the captureNoteViewState guard, the deleted id would get
  // re-captured into noteViewStates, then leak into any future note that
  // takes the same id (e.g. a file recreated at the same relativePath).
  // Pinned to hybrid because it pokes hybridAdapter directly.
  const { calls, elements, flushRaf, window } = makeRendererHarness({
    search: '?writeEngine=hybrid',
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  flushRaf();

  // Auto-confirm the delete prompt that deleteFileBackedNote() raises.
  window.confirm = function () { return true; };

  // Give A a non-default mode AND a non-default scroll. To get the entry
  // recorded under A's id, we must leave A — capture happens on note-switch.
  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 1000;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 240; // 40% in Write

  // A → Preview, scroll preview to 40% so both axes diverge from default.
  elements.get('previewModeButton').fire('click');
  flushRaf();
  const previewEl = elements.get('toastPreviewMount')._previewScrollEl;
  previewEl.scrollHeight = 1000;
  previewEl.clientHeight = 400;
  previewEl.scrollTop    = 240;

  // Switch to B → captures A's view state under id 'vault:a.md'
  // as { mode: 'preview', scrollRatio: 0.4 }.
  elements.get('noteList').children[1].fire('click');
  flushRaf();
  // Switch back to A so the "deleted while selected" code path runs.
  elements.get('noteList').children[0].fire('click');
  flushRaf();

  // Delete A. With the guard, the post-delete renderEditor pass will see
  // that A is no longer in `notes` and skip captureNoteViewState — so
  // noteViewStates['vault:a.md'] stays deleted.
  await elements.get('deleteNoteButton').fireAsync('click');
  flushRaf();

  // Sanity: A really is gone from disk + memory.
  assert.equal(calls.deleteNoteFilePayloads.length, 1);
  assert.equal(calls.deleteNoteFilePayloads[0].relativePath, 'a.md');

  // Recreate a note at the same path: new draft → save with title 'A'.
  // The harness's saveNote mock assigns relativePath='a.md' and
  // id='vault:a.md', i.e. the SAME id the deleted note used.
  elements.get('newNoteButton').fire('click');
  setDraftTitle(elements, 'A');
  calls.hybridAdapter.text = '# A new';
  calls.hybridOnChange('# A new');
  await elements.get('saveNoteButton').fireAsync('click');
  flushRaf();

  // Show all so we have deterministic indexing for the next switch.
  // After delete + recreate: persistedVaultNotes order is [b.md, a.md]
  // (push at end). children[0]=B, children[1]=recreated A.
  elements.get('filterAll').fire('click');
  flushRaf();

  // Switch to B then back to the recreated A. This forces renderEditor's
  // switch branch to fire with note.id='vault:a.md' and run
  // restoreNoteViewState. With the leaked entry: A would open in Preview
  // at 40%. With the guard: no entry exists → default { write, 0 } →
  // Write mode at top.
  elements.get('noteList').children[0].fire('click'); // → B
  flushRaf();
  elements.get('noteList').children[1].fire('click'); // → recreated A
  flushRaf();

  assert.ok(
    elements.get('writeModeButton').className.includes('mode-button-active'),
    'recreated note must open in default Write mode, not the deleted note\'s Preview'
  );
  assert.equal(
    writePane.scrollTop, 0,
    'recreated note must open at default scrollTop, not the deleted note\'s 40%'
  );
});

test('CM6 parity: per-note Write scroll persists across switches', async () => {
  const { elements, flushRaf } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 1000;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 240;

  elements.get('noteList').children[1].fire('click');
  flushRaf();
  assert.equal(writePane.scrollTop, 0);

  elements.get('noteList').children[0].fire('click');
  flushRaf();
  assert.equal(writePane.scrollTop, 240,
    'CM6: per-note Write scroll must persist across switches');
});

test('CM6 parity: same-note Write↔Preview round-trip preserves position with auto-scroll sim', async () => {
  const { calls, elements, flushRaf } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  const writePane = elements.get('hybridWritePane');
  writePane.scrollHeight = 1000;
  writePane.clientHeight = 400;
  writePane.scrollTop    = 240;

  const previewEl = elements.get('toastPreviewMount')._previewScrollEl;
  previewEl.scrollHeight = 1000;
  previewEl.clientHeight = 400;
  previewEl.scrollTop    = 0;

  calls.toastAutoScrollOnSetMarkdown = true;

  elements.get('previewModeButton').fire('click');
  flushRaf();
  assert.equal(previewEl.scrollTop, 240, 'CM6: Write→Preview lands at 40% (wins auto-scroll)');

  writePane.scrollTop = 0;
  elements.get('writeModeButton').fire('click');
  flushRaf();
  assert.equal(writePane.scrollTop, 240, 'CM6: Preview→Write returns to 40%');
});

test('renderer source keeps save and note-switch reads on liveEditorInstance.getText()', () => {
  const html = readIndexHtml();

  assert.match(
    html,
    /const\s+savedBody\s*=\s*liveEditorInstance\.getText\(\)[\s\S]*?body:\s*savedBody/,
    'save should read raw Markdown through liveEditorInstance.getText()'
  );
  assert.match(
    html,
    /outgoingNote\.body\s*=\s*liveEditorInstance\.getText\(\)/,
    'note switching should flush outgoing raw Markdown through liveEditorInstance.getText()'
  );
  assert.match(
    html,
    /_toastuiInstance\.setMarkdown\(\s*getCurrentEditorText\(\)\s*\)/,
    'Preview should mirror through the current liveEditorInstance adapter'
  );
});

// ── Stage 5.2: status-bar readouts (renderer-level wiring) ──────────────
//
// The pure helpers (countWords / countChars / countLines / formatNumber) are
// covered by test/doc-stats.test.js. These tests cover the renderer wiring:
// element population on boot, onChange-driven updates, blank-doc state, and
// the engine label for both selection paths. They use the real DocStats
// module (loaded into window.DocStats by the harness above) so any future
// drift between the helpers and the renderer is caught here.

function expectedReadout(text, kind) {
  const fn = kind === 'words' ? DocStats.countWords
           : kind === 'chars' ? DocStats.countChars
           : DocStats.countLines;
  return DocStats.formatNumber(fn(text)) + ' ' + kind;
}

test('Stage 5.2: initial CM6 boot — engine label is "CM6" and readouts reflect the seeded note text', () => {
  const { calls, elements } = makeRendererHarness();

  assert.equal(elements.get('docEngine').textContent, 'CM6');

  // The seeded note is loaded through CM6's setText; readouts should match
  // DocStats applied to that exact text.
  const seeded = calls.cm6SetText[0];
  assert.equal(typeof seeded, 'string');
  assert.equal(elements.get('docWords').textContent, expectedReadout(seeded, 'words'));
  assert.equal(elements.get('docChars').textContent, expectedReadout(seeded, 'chars'));
  assert.equal(elements.get('docLines').textContent, expectedReadout(seeded, 'lines'));
});

test('Stage 5.2: blank doc (CM6 onChange with "") shows 0 / 0 / 0 readouts', () => {
  const { calls, elements } = makeRendererHarness();

  calls.cm6OnChange('');

  assert.equal(elements.get('docWords').textContent, '0 words');
  assert.equal(elements.get('docChars').textContent, '0 chars');
  assert.equal(elements.get('docLines').textContent, '0 lines');
});

test('Stage 5.2: typing via CM6 onChange updates words / chars / lines readouts', () => {
  const { calls, elements } = makeRendererHarness();
  // Stage 6.2: cm6OnChange in the no-selection state is a no-op; create a
  // draft first so handleWriteChange can attach the text to a real note.
  elements.get('newNoteButton').fire('click');

  calls.cm6OnChange('hello world');
  assert.equal(elements.get('docWords').textContent, '2 words');
  assert.equal(elements.get('docChars').textContent, '11 chars');
  assert.equal(elements.get('docLines').textContent, '1 lines');

  // CJK summed with latin per the Stage 5.2 word rule, plus a newline that
  // bumps the line count.
  calls.cm6OnChange('hello 世界\n第二行');
  assert.equal(elements.get('docWords').textContent, '6 words');   // 1 latin + 5 CJK
  assert.equal(elements.get('docChars').textContent, '12 chars');  // includes the \n
  assert.equal(elements.get('docLines').textContent, '2 lines');
});

test('Stage 5.2: New Note (note switch to a blank-body draft) resets readouts to 0 / 0 / 0', () => {
  const { calls, elements } = makeRendererHarness();

  // Stage 6.2: empty initial state. Create a draft with content first so
  // we can prove the switch resets to 0.
  elements.get('newNoteButton').fire('click');
  calls.cm6OnChange('temporary text');
  assert.equal(elements.get('docWords').textContent, '2 words',
    'after typing, readouts reflect the typed text');

  // Switching to ANOTHER new blank draft routes through renderApp and
  // should refresh readouts to the new note's body — which is empty.
  elements.get('newNoteButton').fire('click');
  assert.equal(elements.get('docWords').textContent, '0 words');
  assert.equal(elements.get('docChars').textContent, '0 chars');
  assert.equal(elements.get('docLines').textContent, '0 lines');
});

test('Stage 5.2: ?writeEngine=hybrid shows engine label "Hybrid" and readouts reflect Hybrid onChange', () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=hybrid' });

  assert.equal(elements.get('docEngine').textContent, 'Hybrid');

  // Stage 6.2: create a draft so handleWriteChange has a selectedNote.
  elements.get('newNoteButton').fire('click');

  // Hybrid commits text through the same onChange-style hook the host wired
  // in; verify the readouts update on that path too.
  calls.hybridOnChange('one two three\nfour');
  assert.equal(elements.get('docWords').textContent, '4 words');
  assert.equal(elements.get('docChars').textContent, '18 chars');
  assert.equal(elements.get('docLines').textContent, '2 lines');
});

// ── Stage 5.3: note-list row redesign (renderer-level wiring) ─────────────
//
// The pure helpers (computeNoteBadge / computeNoteTags) are covered by
// test/note-row.test.js. These tests exercise the renderer wiring: the new
// row markup must contain the right badge / tag chips / overflow chip,
// the meta line must not duplicate the tags shown as chips, and rows for
// plain vault notes must contain neither badge nor chips.

test('Stage 5.3: draft row renders the Draft badge for a new blank draft', () => {
  const { elements } = makeRendererHarness();

  // Stage 10.2: new notes start with empty title and body (no templates).
  elements.get('newNoteButton').fire('click');

  const row = elements.get('noteList').children[0];
  assert.ok(row, 'expected at least one row in the note list');
  const html = row.innerHTML;

  assert.ok(html.includes('note-badge note-badge-draft'), 'draft row should render the Draft badge');
  assert.ok(html.includes('>Draft<'), 'Draft badge label should appear in the markup');
  assert.ok(!html.includes('note-badge-ai'), 'draft row should not render the AI badge');
  assert.ok(!html.includes('class="note-tag"'), 'blank new draft has no tags — no tag chips expected');
});

test('Stage 5.3: blank new draft meta line has no tag segment', () => {
  const { elements } = makeRendererHarness();

  // Stage 10.2: new notes have no tags (templates removed).
  elements.get('newNoteButton').fire('click');

  const row = elements.get('noteList').children[0];
  const html = row.innerHTML;

  assert.ok(!html.includes('tags:'), 'blank new draft should not show a tags segment in the meta line');
});

test('Stage 5.3: plain vault note (no aiImported, no tags) renders no badge and no tag chips', async () => {
  const { elements } = makeRendererHarness({
    vaultNotes: [{
      title: 'Plain vault note',
      body: '# Plain vault note\n\nbody',
      relativePath: 'plain.md',
      fileName: 'plain.md',
      frontmatter: { tags: [], source: '' },
    }],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  const rows = elements.get('noteList').children;
  // Find the vault row by className-agnostic substring (titles are unique).
  const vaultRow = Array.from(rows).find((r) => r.innerHTML.includes('Plain vault note'));
  assert.ok(vaultRow, 'vault row should be present after Choose Vault');

  const html = vaultRow.innerHTML;
  assert.ok(!html.includes('note-badge'),    'vault note should not render any type badge');
  assert.ok(!html.includes('class="note-tag">'), 'vault note with no tags should not render tag chips');
  assert.ok(!html.includes('note-tag-overflow'), 'vault note with no tags should not render overflow chip');
});

test('Stage 5.3: AI-imported vault note renders the AI badge and overflow chip when tags > 3', async () => {
  const { elements } = makeRendererHarness({
    vaultNotes: [{
      title: 'Imported essay',
      body: '# Imported',
      relativePath: 'imported.md',
      fileName: 'imported.md',
      aiImported: true,
      frontmatter: { tags: ['ai', 'practice', 'long-form', 'archive', 'idea'], source: 'mcp' },
    }],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  const rows = elements.get('noteList').children;
  const aiRow = Array.from(rows).find((r) => r.innerHTML.includes('Imported essay'));
  assert.ok(aiRow, 'AI-imported row should be present after Choose Vault');

  const html = aiRow.innerHTML;
  assert.ok(html.includes('note-badge note-badge-ai'), 'AI-imported row should render the AI badge');
  assert.ok(html.includes('>AI<'), 'AI badge label should appear in the markup');
  assert.ok(!html.includes('note-badge-draft'), 'AI-imported row should not render the Draft badge');

  // First 3 of 5 tags visible; remaining 2 collapse into the +N overflow chip.
  assert.ok(html.includes('class="note-tag">#ai<'),        'first tag visible');
  assert.ok(html.includes('class="note-tag">#practice<'),  'second tag visible');
  assert.ok(html.includes('class="note-tag">#long-form<'), 'third tag visible');
  assert.ok(!html.includes('class="note-tag">#archive<'),  'fourth tag should be hidden behind overflow');
  assert.ok(!html.includes('class="note-tag">#idea<'),     'fifth tag should be hidden behind overflow');
  assert.ok(html.includes('class="note-tag-overflow">+2<'), 'overflow chip should read +2');
});

// ── Stage 6.1: dirty saved-note tracking (renderer-level wiring) ───────────
//
// Bug #2: a vault note that was edited but not saved must continue to read
// as Draft after the user navigates away and comes back. These tests
// exercise the navigation-survival behavior end-to-end via the harness:
// the status pill, Drafts filter membership, and the Draft badge must all
// derive from the dirty primitive (lib/dirty-state) rather than from the
// last imperatively-set status.

test('Stage 6.1: editing vault A → switching to B → back to A keeps A as Draft', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b', title: 'Vault B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Initial state on the freshly loaded vault: A is selected, no dirty
  // signal (status pill uses the ready className; the post-load text is
  // the "Vault loaded: N note(s)" success message).
  assert.equal(elements.get('statusText').className, 'topbar-status status-ready');

  // Simulate editing A: the adapter's getText() will return the edited body
  // when the click handler flushes the outgoing note before switching to B.
  calls.cm6Adapter.text = '# A edited\n\nUniqueEditAToken';
  elements.get('noteList').children[1].fire('click');   // switch to B

  // While selected note is B (clean), status should be Ready.
  assert.equal(elements.get('statusText').textContent, 'Ready');
  assert.equal(elements.get('statusText').className, 'topbar-status status-ready');

  // Switch back to A. A's body diverges from loadedBody → dirty → Draft.
  elements.get('noteList').children[0].fire('click');
  assert.equal(elements.get('statusText').textContent,  'Draft',
    'returning to a dirty saved note must show Draft, not Ready');
  assert.equal(elements.get('statusText').className, 'topbar-status status-draft');
});

test('Stage 6.1: dirty saved note appears in Drafts filter and shows the Draft badge', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b', title: 'Vault B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Edit A and switch to B so A's edited body is flushed into the note model.
  calls.cm6Adapter.text = '# A edited';
  elements.get('noteList').children[1].fire('click');

  // Drafts filter should now include A even though source==='vault'.
  elements.get('filterDrafts').fire('click');
  const rows = elements.get('noteList').children;
  const titles = Array.from(rows).map((row) => row.innerHTML);
  assert.ok(titles.some((html) => html.includes('Vault A')),
    'dirty vault note should be visible in the Drafts filter');

  // The dirty vault row should render the Draft badge (same kind as drafts).
  const draftRow = Array.from(rows).find((row) => row.innerHTML.includes('Vault A'));
  assert.ok(draftRow, 'dirty Vault A row should be present in Drafts filter');
  assert.ok(draftRow.innerHTML.includes('note-badge note-badge-draft'),
    'dirty saved note should render the Draft badge');
});

test('Stage 6.1: AI badge takes precedence over Draft for a dirty AI-imported vault note', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      {
        id: 'vault:imported',
        title: 'Imported essay',
        body: '# Imported',
        fileName: 'imported.md',
        relativePath: 'imported.md',
        aiImported: true,
      },
      { id: 'vault:b', title: 'Vault B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Edit the AI-imported note and flush by switching away.
  calls.cm6Adapter.text = '# Imported edited';
  elements.get('noteList').children[1].fire('click');

  // The AI-imported row is dirty AND aiImported — AI badge must win.
  const rows = elements.get('noteList').children;
  const aiRow = Array.from(rows).find((row) => row.innerHTML.includes('Imported essay'));
  assert.ok(aiRow, 'AI-imported row should be present');
  assert.ok(aiRow.innerHTML.includes('note-badge note-badge-ai'),
    'AI badge must win over Draft for a dirty AI-imported note');
  assert.ok(!aiRow.innerHTML.includes('note-badge note-badge-draft'),
    'AI-imported dirty row should NOT also render the Draft badge');
});

test('Stage 6.1: pristine vault note is NOT Draft and shows no Draft badge', async () => {
  const { elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Post-load text reads "Vault loaded: 1 note(s)"; the ready className
  // is the load-bearing dirty-signal assertion here.
  assert.equal(elements.get('statusText').className, 'topbar-status status-ready');

  const row = elements.get('noteList').children[0];
  assert.ok(!row.innerHTML.includes('note-badge'),
    'pristine vault note should render no badge at all');
});

test('Stage 6.1: non-empty draft is dirty (Draft status, in Drafts filter, Draft badge)', async () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=cm6' });

  // Stage 10.2: new notes start blank (no templates). Create the draft,
  // then type body content to make it non-empty → dirty.
  elements.get('newNoteButton').fire('click');
  calls.cm6OnChange('some real content typed by the user');
  // handleWriteChange → setStatusFromSelectedNote → body non-empty → dirty.
  assert.equal(elements.get('statusText').className, 'topbar-status status-draft');

  // The new draft's row carries the Draft badge (source==='draft').
  const draftRow = elements.get('noteList').children[0];
  assert.ok(draftRow.innerHTML.includes('note-badge note-badge-draft'));

  // Type more — derivation runs through handleWriteChange → still Draft.
  calls.cm6OnChange('expanded body');
  assert.equal(elements.get('statusText').textContent, 'Draft');
  assert.equal(elements.get('statusText').className, 'topbar-status status-draft');
});

test('Stage 6.1: saving a dirty vault note clears dirty (status → Ready, no Draft badge)', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Dirty A by typing.
  calls.cm6Adapter.text = '# A edited body';
  calls.cm6OnChange('# A edited body');
  assert.equal(elements.get('statusText').textContent, 'Draft',
    'editing a vault note must show Draft');

  // Save. Save success → refreshVaultNotes re-loads disk (which now matches
  // the body we just wrote) → loadedBody === body → no longer dirty.
  await elements.get('saveNoteButton').fireAsync('click');

  // Status reflects the save-success message; the underlying note is clean,
  // so future navigation will show Ready (not Draft).
  const row = elements.get('noteList').children[0];
  assert.ok(!row.innerHTML.includes('note-badge note-badge-draft'),
    'saved (no-longer-dirty) vault note should not render the Draft badge');

  // Switching to itself (no-op selection) and back via setStatusFromSelectedNote
  // would yield Ready. Verify directly: clicking the row triggers the click
  // handler which derives status from the selected note.
  elements.get('noteList').children[0].fire('click');
  assert.equal(elements.get('statusText').textContent, 'Ready',
    'after save + reselect, status must derive to Ready');
});

// ── Stage 6.1 (revision): contextual ready messages must not silently shadow
// a dirty selected note. The filter/search/watcher flows previously forced
// 'ready' with a contextual message regardless of the selection's dirty
// state, hiding the unsaved-edit signal. The fix routes them through
// setStatusFromSelectedNote(messageIfClean) — Draft wins over the message.

test('Stage 6.1: dirty selected note remains Draft after changing filters', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b', title: 'Vault B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Dirty A by typing — status pill becomes Draft.
  calls.cm6OnChange('# A edited');
  assert.equal(elements.get('statusText').textContent, 'Draft');

  // Click each filter; Draft must persist for the dirty selected note.
  elements.get('filterAll').fire('click');
  assert.equal(elements.get('statusText').textContent, 'Draft',
    'switching to All filter must not shadow Draft for a dirty selected note');

  elements.get('filterDrafts').fire('click');
  assert.equal(elements.get('statusText').textContent, 'Draft',
    'switching to Drafts filter must not shadow Draft for a dirty selected note');

  elements.get('filterVault').fire('click');
  assert.equal(elements.get('statusText').textContent, 'Draft',
    'switching to Vault filter must not shadow Draft for a dirty selected note');
});

test('Stage 6.1: filter change DOES show its contextual message when the selected note is clean', async () => {
  const { elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Selected note (vault A) is pristine → contextual message wins.
  elements.get('filterAll').fire('click');
  assert.equal(elements.get('statusText').textContent, 'Filter: all');
  assert.equal(elements.get('statusText').className, 'topbar-status status-ready');
});

test('Stage 6.1: dirty selected note remains Draft after search input changes', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  calls.cm6OnChange('# A edited body');
  assert.equal(elements.get('statusText').textContent, 'Draft');

  // Type into search → handleSearchInput's "Search: …" message must NOT
  // override Draft.
  elements.get('searchInput').value = 'edited';
  elements.get('searchInput').fire('input');
  assert.equal(elements.get('statusText').textContent, 'Draft',
    'search input must not shadow Draft for a dirty selected note');

  // Clear search → "Search cleared" message must also not override Draft.
  elements.get('searchInput').value = '';
  elements.get('searchInput').fire('input');
  assert.equal(elements.get('statusText').textContent, 'Draft',
    'clearing search must not shadow Draft for a dirty selected note');
});

test('Stage 6.1: dirty selected note remains Draft after watcher refresh', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b', title: 'Vault B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Select and dirty A.
  calls.cm6OnChange('# A edited');
  assert.equal(elements.get('statusText').textContent, 'Draft');

  // Trigger a watcher event for an unrelated file (b.md). The overlay
  // preservation keeps A's edited body; loadedBody captured from disk
  // remains '# A', so isNoteDirty(A) stays true and status stays Draft.
  assert.equal(typeof calls.vaultChangedCallback, 'function');
  await calls.vaultChangedCallback({ fileName: 'b.md' });

  assert.equal(elements.get('statusText').textContent, 'Draft',
    'watcher refresh must not shadow Draft for a dirty selected note');
});

test('Stage 6.1: watcher refresh keeps an unrelated dirty vault note dirty (loadedBody = disk truth)', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b', title: 'Vault B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Edit A and switch to B so A's edit is flushed into the model and B is
  // selected. A is now an unrelated dirty vault note.
  calls.cm6Adapter.text = '# A edited';
  elements.get('noteList').children[1].fire('click');
  assert.equal(elements.get('statusText').textContent, 'Ready',
    'while clean B is selected, status reads Ready');

  // Trigger a watcher event for B (the changed file). Overlay preserves A's
  // edited body; loadedBody for A remains the on-disk '# A' value so A
  // continues to read as dirty in the Drafts filter and its row badge.
  await calls.vaultChangedCallback({ fileName: 'b.md' });

  // Switch to Drafts filter — A should still be present.
  elements.get('filterDrafts').fire('click');
  const rows = elements.get('noteList').children;
  const draftRow = Array.from(rows).find((row) => row.innerHTML.includes('Vault A'));
  assert.ok(draftRow,
    'unrelated dirty vault note must remain in the Drafts filter after watcher refresh');
  assert.ok(draftRow.innerHTML.includes('note-badge note-badge-draft'),
    'unrelated dirty vault note must keep its Draft badge after watcher refresh');
});

test('Stage 6.1: Drafts count in the sidebar nav includes dirty vault notes', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b', title: 'Vault B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');

  // Initially: zero drafts (the seeded draft was wiped on chooseVault load).
  assert.equal(elements.get('filterDraftsMeta').textContent, '0 note(s)',
    'before any edits, Drafts count is 0');

  // Edit A → A is now a dirty vault note → counted as a draft.
  calls.cm6Adapter.text = '# A edited';
  elements.get('noteList').children[1].fire('click');
  assert.equal(elements.get('filterDraftsMeta').textContent, '1 note(s)',
    'Drafts count must include a dirty vault note');
});

// ── Stage 6.2: pre-vault draft preservation + Save-without-vault flow ─────
//
// Bug #1: a note typed before any vault is selected disappears the moment
// the user picks a vault, because refreshVaultNotes wipes in-memory drafts
// when hasLoadedVaultNotes is false. Stage 6.2 also makes Save Note from
// the no-vault state route through Choose Vault first, so a single click
// can both pick a vault and write the draft to disk.
//
// Initial state: notes is empty (no editable Welcome seed). Tests that
// need a starting note create one explicitly via newNoteButton or load
// one via vaultNotes + chooseVaultButton.

test('Stage 6.2: initial boot has no editable Welcome draft (empty notes list)', () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=cm6' });

  // No automatic note → setText is called with the empty doc only (the
  // no-selection branch loads ''), and the note list is empty.
  assert.deepEqual(calls.cm6SetText, [''],
    'boot must not auto-load a Welcome note via setText');
  assert.equal(elements.get('noteList').children.length, 0,
    'note list must be empty until the user creates a note or chooses a vault');
  assert.equal(elements.get('titleInput').value, '');
});

test('Stage 6.2: Case B — pre-vault draft survives Choose Vault and stays selected', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });

  // Create a draft and type into it.
  elements.get('newNoteButton').fire('click');
  elements.get('titleInput').value = 'My pre-vault idea';
  elements.get('titleInput').fire('input');
  calls.cm6OnChange('Body typed before choosing a vault.');

  const draftIdBefore = elements.get('noteList').children[0]
    && Array.from(elements.get('noteList').children).find((row) =>
      row.innerHTML.includes('My pre-vault idea')
    );
  assert.ok(draftIdBefore, 'draft row should be present before chooseVault');

  const saveCallsBefore = calls.saveNotePayloads.length;

  // Now choose a vault.
  await elements.get('chooseVaultButton').fireAsync('click');

  // Save IPC must NOT have fired during chooseVault.
  assert.equal(calls.saveNotePayloads.length, saveCallsBefore,
    'choosing a vault must not auto-save existing drafts');

  // The draft must still be present and selected.
  const rows = Array.from(elements.get('noteList').children);
  const draftRow = rows.find((row) => row.innerHTML.includes('My pre-vault idea'));
  assert.ok(draftRow, 'pre-vault draft must survive choose-vault refresh');
  assert.ok(draftRow.className.includes('active'),
    'preserved pre-vault draft must remain selected after choose-vault');

  // The draft body must still be readable through the editor model — verify
  // the row's snippet/meta still reflects the typed body via search.
  elements.get('searchInput').value = 'Body typed before';
  elements.get('searchInput').fire('input');
  assert.match(elements.get('searchMeta').textContent, /Found 1 result/);
});

test('Stage 6.2: Case A — Save Note before vault triggers chooseVault then saves the draft', async () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=cm6' });

  elements.get('newNoteButton').fire('click');
  elements.get('titleInput').value = 'A Pre Vault Draft';
  elements.get('titleInput').fire('input');
  // The harness's CM6 adapter only reflects setText calls in its `text`
  // field; cm6OnChange notifies the renderer but doesn't update the mock
  // adapter. Set both so saveCurrentNote's getText() reads what the user
  // would have typed under real CM6.
  const draftBody = '# A Pre Vault Draft\n\nbody-text-from-pre-vault-draft';
  calls.cm6Adapter.text = draftBody;
  calls.cm6OnChange(draftBody);

  await elements.get('saveNoteButton').fireAsync('click');

  // Save IPC fired exactly once with the draft's body and title.
  assert.equal(calls.saveNotePayloads.length, 1,
    'Save Note from no-vault must trigger exactly one save IPC after the user picks a vault');
  const payload = calls.saveNotePayloads[0];
  assert.equal(payload.note.title, 'A Pre Vault Draft');
  assert.match(payload.note.body, /body-text-from-pre-vault-draft/);
  assert.equal(payload.vaultPath, '/fake-vault',
    'save IPC must target the vault picked during the chooseVault flow');
});

test('Stage 6.2: Case A — when the user cancels vault selection, the draft is unchanged and not saved', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    chooseVaultCanceled: true,
  });

  elements.get('newNoteButton').fire('click');
  elements.get('titleInput').value = 'Untouched draft';
  elements.get('titleInput').fire('input');
  calls.cm6OnChange('this body must not be saved');

  await elements.get('saveNoteButton').fireAsync('click');

  // No save IPC.
  assert.equal(calls.saveNotePayloads.length, 0,
    'cancelling vault selection must not trigger any save IPC');

  // Status reflects the cancellation (pill stays in ready className but
  // shows the canceled message). Draft is still selected and unchanged.
  assert.equal(elements.get('statusText').className, 'topbar-status status-ready');

  const rows = Array.from(elements.get('noteList').children);
  const draftRow = rows.find((row) => row.innerHTML.includes('Untouched draft'));
  assert.ok(draftRow, 'draft must still be present after cancellation');
  assert.ok(draftRow.className.includes('active'),
    'draft must still be selected after cancellation');
});

test('Stage 6.2: Case A — duplicate-name guard still blocks save after Choose Vault picks a colliding vault', async () => {
  // Vault contains a file whose path will collide with a draft titled
  // "duplicate target". deriveDraftRelativePath kebabs the title.
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      {
        id: 'vault:duplicate-target',
        title: 'duplicate target',
        body: '# duplicate target',
        fileName: 'duplicate-target.md',
        relativePath: 'duplicate-target.md',
      },
    ],
  });

  // Create a draft with a colliding title.
  elements.get('newNoteButton').fire('click');
  elements.get('titleInput').value = 'duplicate target';
  elements.get('titleInput').fire('input');
  const collidingBody = 'content that should not be written';
  calls.cm6Adapter.text = collidingBody;
  calls.cm6OnChange(collidingBody);

  await elements.get('saveNoteButton').fireAsync('click');

  // The duplicate-name pre-check must run after chooseVault loads the
  // colliding vault file. Save IPC must NOT fire.
  assert.equal(calls.saveNotePayloads.length, 0,
    'duplicate-name guard must block save after the new vault loads');

  // Status surface should be the error class.
  assert.equal(elements.get('statusText').className, 'topbar-status status-error');
  assert.match(elements.get('statusText').textContent, /already exists/);
});

test('Stage 6.2: pre-vault dirty draft remains Draft after Choose Vault (Stage 6.1 regression guard)', async () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=cm6' });

  elements.get('newNoteButton').fire('click');
  calls.cm6OnChange('typed before vault');

  // Pre-condition: draft is dirty → status Draft.
  assert.equal(elements.get('statusText').textContent, 'Draft');

  await elements.get('chooseVaultButton').fireAsync('click');

  // After chooseVault, the draft is preserved (Stage 6.2) and selected
  // (Stage 6.2). It is still dirty (Stage 6.1) → status Draft.
  assert.equal(elements.get('statusText').textContent, 'Draft',
    'pre-vault dirty draft must keep showing Draft after choose-vault preservation');
});

// ── Stage 6.2 (revision): empty-state safety + DirtyState-aligned preservation
//
// Two edge cases the first round missed:
// (1) the no-selection editor was visually editable, so typed text could
//     accumulate in the preview/readouts without ever being attached to a
//     note. The fix disables the title input AND marks the editor
//     container with .is-no-selection, and handleWriteChange no-ops at the
//     top when there's no selection.
// (2) shouldPreserveDraft only filtered the exact 'Untitled note' + empty
//     placeholder. Whitespace-only titles/bodies sneaked through. The
//     revised predicate aligns with DirtyState.isNoteDirty for drafts.

test('Stage 6.2: initial no-selection state disables title input and marks editor container', () => {
  const { elements } = makeRendererHarness();

  assert.equal(elements.get('titleInput').disabled, true,
    'title input must be disabled in the no-selection state');
  assert.ok(elements.get('liveEditorContainer').className.includes('is-no-selection'),
    'editor container must carry the .is-no-selection class so CSS can disable interaction');
});

test('Stage 6.2: New Note enables editing (no-selection lock lifts on selection)', () => {
  const { elements } = makeRendererHarness();

  // Pre-condition: disabled.
  assert.equal(elements.get('titleInput').disabled, true);

  // Create a draft → editing enabled.
  elements.get('newNoteButton').fire('click');
  assert.equal(elements.get('titleInput').disabled, false,
    'after New Note, title input must be enabled');
  assert.ok(!elements.get('liveEditorContainer').className.includes('is-no-selection'),
    'after New Note, editor container must lose .is-no-selection');
});

test('Stage 6.2: handleWriteChange in the no-selection state is a no-op (no preview/readouts pollution)', () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=cm6' });

  // No notes → no selection. cm6OnChange must be safely ignored.
  const toastBefore = calls.toastSetMarkdown.length;
  calls.cm6OnChange('stray text that has nowhere to go');

  assert.equal(calls.toastSetMarkdown.length, toastBefore,
    'no-selection edits must not push text into the Toast UI Preview');
  assert.equal(elements.get('docWords').textContent, '0 words',
    'no-selection edits must not advance the words readout');
  assert.equal(elements.get('docChars').textContent, '0 chars');
  assert.equal(elements.get('docLines').textContent, '0 lines');
});

test('Stage 6.2: Save Note in the no-selection state does not pretend a note exists', async () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=cm6' });

  await elements.get('saveNoteButton').fireAsync('click');

  assert.equal(calls.saveNotePayloads.length, 0,
    'no-selection save must not fire a save IPC');
  assert.equal(elements.get('statusText').className, 'topbar-status status-error');
  assert.match(elements.get('statusText').textContent, /No note selected/,
    'no-selection save must surface a clear "no note selected" message');
});

test('Stage 6.2: empty/placeholder draft is NOT preserved across Choose Vault', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });

  // Create a blank draft (Stage 10.2: title '', empty body). DON'T type anything.
  elements.get('newNoteButton').fire('click');

  await elements.get('chooseVaultButton').fireAsync('click');
  // createNewNote pinned the filter to 'drafts'; switch to 'all' to assert
  // about the full notes set.
  elements.get('filterAll').fire('click');

  // Only the vault note remains; the empty placeholder draft was dropped.
  const rows = Array.from(elements.get('noteList').children);
  const titles = rows.map((r) => r.innerHTML);
  assert.equal(rows.length, 1, 'only the vault note should remain');
  assert.ok(titles.some((html) => html.includes('Vault A')));
  assert.ok(!titles.some((html) => html.includes('Untitled note')),
    'empty-title draft (displayed as "Untitled note") must NOT be preserved across Choose Vault');
  assert.equal(calls.saveNotePayloads.length, 0);
});

test('Stage 6.2: whitespace-only-title draft is NOT preserved across Choose Vault', async () => {
  const { elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });

  elements.get('newNoteButton').fire('click');
  // Title is whitespace-only; body is empty.
  elements.get('titleInput').value = '   ';
  elements.get('titleInput').fire('input');

  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('filterAll').fire('click');

  const rows = Array.from(elements.get('noteList').children);
  assert.equal(rows.length, 1, 'whitespace-only draft should not be preserved');
  assert.ok(rows[0].innerHTML.includes('Vault A'));
});

test('Stage 6.2: whitespace-only-body draft is NOT preserved across Choose Vault', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });

  elements.get('newNoteButton').fire('click');
  // Title is '' (Stage 10.2 default); body is whitespace-only.
  calls.cm6OnChange('   \n\n  \n');

  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('filterAll').fire('click');

  const rows = Array.from(elements.get('noteList').children);
  assert.equal(rows.length, 1, 'whitespace-only-body draft should not be preserved');
  assert.ok(rows[0].innerHTML.includes('Vault A'));
});

test('Stage 6.2: meaningful draft (custom title) IS preserved across Choose Vault', async () => {
  const { elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });

  elements.get('newNoteButton').fire('click');
  // Custom title, empty body — DirtyState says this is dirty (custom
  // title is meaningful), so it must be preserved.
  elements.get('titleInput').value = 'My pre-vault idea';
  elements.get('titleInput').fire('input');

  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('filterAll').fire('click');

  const rows = Array.from(elements.get('noteList').children);
  const titles = rows.map((r) => r.innerHTML);
  assert.ok(titles.some((html) => html.includes('My pre-vault idea')),
    'meaningful draft (custom title) must survive Choose Vault');
});

test('Stage 6.2: meaningful draft (non-empty body) IS preserved across Choose Vault', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });

  elements.get('newNoteButton').fire('click');
  // Default placeholder title, but non-empty body — DirtyState says dirty.
  calls.cm6OnChange('Real content typed by the user.');

  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('filterAll').fire('click');

  // Search for the typed content to confirm the draft survived with body.
  elements.get('searchInput').value = 'Real content typed';
  elements.get('searchInput').fire('input');
  assert.match(elements.get('searchMeta').textContent, /Found 1 result/,
    'meaningful draft (non-empty body) must survive Choose Vault with body intact');
});

// ── Stage 6.3A: close-request dirty-summary responder ────────────────
//
// Main asks the renderer at close time via vaultApi.onCloseRequest. The
// renderer registers exactly one responder that, when invoked with a
// `respond` callback, replies with DirtyState.summarizeDirty(notes).
// Boot must register the responder exactly once. The summary must
// reflect the live notes array at the moment of the request (not a
// stale snapshot).

test('Stage 6.3A: renderer registers a single close-request responder at boot', () => {
  const { calls } = makeRendererHarness();
  assert.equal(typeof calls.closeRequestHandler, 'function',
    'boot must register a close-request handler via vaultApi.onCloseRequest');
});

test('Stage 6.3A: close-request responder reports clean summary for a fresh app (no notes yet)', () => {
  const { calls } = makeRendererHarness();
  let received = 'unset';
  calls.closeRequestHandler((summary) => { received = summary; });
  assert.deepEqual(received, { count: 0, hasDraft: false, hasDirtyVault: false },
    'no notes means nothing dirty');
});

test('Stage 6.3A: close-request responder reports dirty summary after a draft gains content', () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=cm6' });
  // Stage 6.2: empty initial state — create a draft, then type into it.
  elements.get('newNoteButton').fire('click');
  calls.cm6OnChange('Real content typed by the user.');

  let received = 'unset';
  calls.closeRequestHandler((summary) => { received = summary; });

  assert.deepEqual(received, { count: 1, hasDraft: true, hasDirtyVault: false },
    'meaningful draft must register as 1 dirty draft');
});

test('Stage 6.3A: close-request responder reports clean for an untouched placeholder draft', () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=cm6' });
  // Untouched blank draft: title === '', body === ''. Not dirty (Stage 10.2).
  elements.get('newNoteButton').fire('click');

  let received = 'unset';
  calls.closeRequestHandler((summary) => { received = summary; });

  assert.deepEqual(received, { count: 0, hasDraft: false, hasDirtyVault: false },
    'an untouched blank-template draft is not unsaved work');
});

test('Stage 6.3A: close-request responder reports a dirty vault note', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [{
      id: 'vault:a',
      title: 'Vault A',
      body: '# Vault A\n\nbody',
      fileName: 'a.md',
      relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  // Mutate via the live editor's onChange → marks the vault note dirty.
  calls.cm6OnChange('# Vault A\n\nbody edited');

  let received = 'unset';
  calls.closeRequestHandler((summary) => { received = summary; });

  assert.deepEqual(received, { count: 1, hasDraft: false, hasDirtyVault: true },
    'edited vault note must register as 1 dirty vault note');
});

test('Stage 6.3A: close-request responder uses the live notes (re-invocation reflects latest state)', () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=cm6' });

  let received1 = 'unset';
  calls.closeRequestHandler((s) => { received1 = s; });
  assert.deepEqual(received1, { count: 0, hasDraft: false, hasDirtyVault: false });

  elements.get('newNoteButton').fire('click');
  calls.cm6OnChange('Now there is content.');

  let received2 = 'unset';
  calls.closeRequestHandler((s) => { received2 = s; });
  assert.deepEqual(received2, { count: 1, hasDraft: true, hasDirtyVault: false },
    'the responder must read the LIVE notes array, not a boot-time snapshot');
});

test('Stage 6.3A: close-request responder reports null when DirtyState is missing (Codex issue 3)', () => {
  const { calls, window } = makeRendererHarness();
  // Simulate the helper not being loaded (boot order broken, script
  // failed to execute, etc.). We must NOT fall back to a clean-looking
  // summary — main has to treat this as unsafe and show the dialog.
  window.DirtyState = undefined;
  let received = 'unset';
  calls.closeRequestHandler((s) => { received = s; });
  assert.equal(received, null,
    'missing DirtyState must produce a null reply — never a clean-looking summary');
});

test('Stage 6.3A: close-request responder reports null when summarizeDirty throws', () => {
  const { calls, window } = makeRendererHarness();
  window.DirtyState = {
    summarizeDirty: () => { throw new Error('boom'); },
  };
  let received = 'unset';
  calls.closeRequestHandler((s) => { received = s; });
  assert.equal(received, null,
    'a throwing summarizeDirty must reply with null, not silently allow close');
});

// ── Stage 6.3B: saveAllDirtyNotes via vaultApi.onSaveAllRequest ──────
//
// The renderer registers one save-all responder at boot that, when
// invoked, runs saveAllDirtyNotes() and replies with a single
// { ok: boolean, error?: string, savedCount?: number } shape.
// Drive it via calls.saveAllRequestHandler and a respond spy that
// resolves a Promise. The renderer is responsible for: flushing the
// editor, snapshotting dirty ids, triggering Choose Vault when
// needed, sequentially saving via the existing save-note IPC,
// suppressing watcher refreshes during the loop, and a single
// post-loop refreshVaultNotes.

function invokeSaveAllHandler(calls) {
  return new Promise((resolve) => {
    calls.saveAllRequestHandler((result) => {
      // The renderer constructs result objects inside the vm.context,
      // so their prototype is the VM's Object.prototype, not this
      // test runtime's. Re-spread into a plain object so deepEqual
      // comparisons against `{...}` literals don't trip on prototype
      // identity. Values are primitives → no nested-prototype issues.
      resolve(result == null ? result : { ...result });
    });
  });
}

test('Stage 6.3B: boot registers a single save-all request handler', () => {
  const { calls } = makeRendererHarness();
  assert.equal(typeof calls.saveAllRequestHandler, 'function',
    'boot must register a save-all handler via vaultApi.onSaveAllRequest');
});

test('Stage 6.3B: save-all on a clean app returns { ok: true, savedCount: 0 } and never calls saveNote', async () => {
  const { calls } = makeRendererHarness();
  const result = await invokeSaveAllHandler(calls);
  assert.deepEqual(result, { ok: true, savedCount: 0 });
  assert.equal(calls.saveNotePayloads.length, 0);
});

test('Stage 6.3B: save-all saves a single dirty vault note', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [{
      id: 'vault:a',
      title: 'Vault A',
      body: '# Vault A\n\noriginal',
      fileName: 'a.md',
      relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  // Mutate the live editor so the vault note becomes dirty.
  calls.cm6Adapter.text = '# Vault A\n\nedited';
  calls.cm6OnChange(calls.cm6Adapter.text);

  const result = await invokeSaveAllHandler(calls);

  assert.deepEqual({ ok: result.ok, savedCount: result.savedCount },
                   { ok: true, savedCount: 1 });
  assert.equal(calls.saveNotePayloads.length, 1);
  assert.equal(calls.saveNotePayloads[0].note.relativePath, 'a.md');
  assert.match(calls.saveNotePayloads[0].note.body, /edited/);
});

test('Stage 6.3B: save-all saves an unsaved draft and migrates its id', async () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=cm6' });
  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('newNoteButton').fire('click');
  // Give the draft a meaningful title so DirtyState marks it dirty.
  elements.get('titleInput').value = 'My Idea';
  elements.get('titleInput').fire('input');
  calls.cm6OnChange('# My Idea\n\nbody');

  const result = await invokeSaveAllHandler(calls);

  assert.equal(result.ok, true);
  assert.equal(result.savedCount, 1);
  assert.equal(calls.saveNotePayloads.length, 1);
  assert.equal(calls.saveNotePayloads[0].note.title, 'My Idea');
  // Source on the outgoing payload reflects the draft origin; the
  // server-side migration to vault: happens in the response handling.
  assert.equal(calls.saveNotePayloads[0].note.source, 'draft');
});

test('Stage 6.3B: save-all saves multiple dirty notes sequentially in snapshot order', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'A', body: '# A\n\norig-a', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b', title: 'B', body: '# B\n\norig-b', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  // Currently selected is the first note; mutate it dirty. Set both
  // the adapter buffer (which the click-handler flush reads via
  // getText) AND fire cm6OnChange so the renderer observes the edit.
  calls.cm6Adapter.text = '# A\n\nedited-a';
  calls.cm6OnChange(calls.cm6Adapter.text);

  // Switch to the second list row and mutate it dirty too.
  elements.get('noteList').children[1].fire('click');
  calls.cm6Adapter.text = '# B\n\nedited-b';
  calls.cm6OnChange(calls.cm6Adapter.text);

  const result = await invokeSaveAllHandler(calls);

  assert.equal(result.ok, true);
  assert.equal(result.savedCount, 2);
  assert.equal(calls.saveNotePayloads.length, 2);
  // Snapshot iterates `notes` in array order — A first, then B.
  assert.deepEqual(
    calls.saveNotePayloads.map((p) => p.note.relativePath),
    ['a.md', 'b.md']
  );
});

test('Stage 6.3B: save-all flushes the editor before reading the selected note body', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [{
      id: 'vault:a', title: 'A', body: '# A\n\norig',
      fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  // Simulate an in-progress edit that bypassed cm6OnChange (e.g. an
  // active Markdown shortcut still in the buffer). saveAllDirtyNotes
  // must call exitWriteMode + getText so the saved body matches the
  // current editor view, not the pre-flush note.body.
  calls.cm6Adapter.text = '# A\n\nedited-via-buffer-only';

  // The note body in `notes[]` still reflects the pre-buffer state;
  // confirm this baseline first.
  // (We can't read notes[] directly — but we know cm6OnChange wasn't
  // called, so the dirty check would only catch this if the renderer
  // flushes correctly.)

  const result = await invokeSaveAllHandler(calls);

  assert.equal(result.ok, true);
  assert.equal(result.savedCount, 1);
  // The whole point: the saved payload contains the post-flush text.
  assert.match(calls.saveNotePayloads[0].note.body, /edited-via-buffer-only/);
  // And the live editor was flushed via exitWriteMode prior to the read.
  assert.ok(calls.cm6ExitWriteMode >= 1, 'exitWriteMode must run before save');
});

test('Stage 6.3B: save-all triggers Choose Vault when no vault is selected', async () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=cm6' });
  // Pre-vault dirty draft (Stage 6.2 path).
  elements.get('newNoteButton').fire('click');
  elements.get('titleInput').value = 'Pre-Vault Draft';
  elements.get('titleInput').fire('input');
  calls.cm6OnChange('# Pre-Vault Draft\n\nbody');

  const initialLoadCount = calls.loadVaultNotesPayloads.length;
  const result = await invokeSaveAllHandler(calls);

  assert.equal(result.ok, true);
  assert.equal(result.savedCount, 1);
  // Choose Vault was triggered → vault was loaded → save proceeded.
  assert.ok(calls.loadVaultNotesPayloads.length > initialLoadCount,
    'choose-vault must run during save-all when no vault is selected');
  assert.equal(calls.saveNotePayloads.length, 1);
});

test('Stage 6.3B: save-all returns failure when Choose Vault is canceled', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    chooseVaultCanceled: true,
  });
  elements.get('newNoteButton').fire('click');
  elements.get('titleInput').value = 'Pre-Vault Draft';
  elements.get('titleInput').fire('input');
  calls.cm6OnChange('# Pre-Vault Draft\n\nbody');

  const result = await invokeSaveAllHandler(calls);

  assert.equal(result.ok, false);
  assert.match(String(result.error || ''), /vault.*cancel/i);
  assert.equal(calls.saveNotePayloads.length, 0,
    'no save attempts when the user canceled the vault picker');
});

test('Stage 6.3B: save-all aborts on a duplicate filename conflict and reports failure', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:my-idea.md', title: 'My Idea', body: '# My Idea\n\norig',
        fileName: 'my-idea.md', relativePath: 'my-idea.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  // Create a draft whose derived filename collides with the existing
  // vault note. The renderer pre-check (FileName.findRelativePathConflict)
  // catches this before the IPC save call runs.
  elements.get('newNoteButton').fire('click');
  elements.get('titleInput').value = 'My Idea';
  elements.get('titleInput').fire('input');
  calls.cm6OnChange('# My Idea\n\ndraft-body');

  const result = await invokeSaveAllHandler(calls);

  assert.equal(result.ok, false,
    'duplicate filename must block the entire save-all and the close');
  assert.match(String(result.error || ''), /already exists|conflict|exists/i);
  // The colliding draft's save IPC must NOT have been attempted.
  // (Saves of OTHER non-colliding dirty notes also abort — sequential.)
  const draftPaylod = calls.saveNotePayloads.find(
    (p) => p.note.source === 'draft' && p.note.title === 'My Idea'
  );
  assert.equal(draftPaylod, undefined,
    'the colliding draft must not be sent to the saveNote IPC');
});

test('Stage 10.2: save-all aborts when a dirty draft has no title, does not call save IPC, keeps draft intact', async () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=cm6' });
  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('newNoteButton').fire('click');
  // Set adapter text AND fire onChange — same pattern as other save-all tests.
  // exitWriteMode flushes the adapter text into the note, so both must agree.
  calls.cm6Adapter.text = 'Important content without a title.';
  calls.cm6OnChange('Important content without a title.');

  const result = await invokeSaveAllHandler(calls);

  assert.equal(result.ok, false, 'save-all must fail when a dirty draft has no title');
  assert.equal(calls.saveNotePayloads.length, 0, 'save IPC must not be called for an empty-title draft');
  assert.match(
    elements.get('statusText').textContent,
    /enter a title/i,
    'status must tell the user to enter a title'
  );
  // Draft must remain in the note list — body content not silently discarded.
  assert.ok(
    elements.get('noteList').children.length > 0,
    'draft must still appear in the note list after save-all failure'
  );
});

test('Stage 6.3B: save-all aborts on generic save failure and reports failure', async () => {
  const { calls, elements, window } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'A', body: '# A\n\norig-a', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  calls.cm6Adapter.text = '# A\n\nedited-a';
  calls.cm6OnChange(calls.cm6Adapter.text);

  // Inject a failing saveNote.
  window.vaultApi.saveNote = async () => ({ ok: false, error: 'EACCES: permission denied' });

  const result = await invokeSaveAllHandler(calls);

  assert.equal(result.ok, false);
  assert.match(String(result.error || ''), /EACCES|permission|denied/i);
});

test('Stage 6.3B: save-all success clears dirty state for the saved note', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [{
      id: 'vault:a', title: 'A', body: '# A\n\norig',
      fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  calls.cm6Adapter.text = '# A\n\nedited';
  calls.cm6OnChange(calls.cm6Adapter.text);

  // Pre: status pill shows Draft (Stage 6.1 derivation).
  assert.equal(elements.get('statusText').textContent, 'Draft');

  const result = await invokeSaveAllHandler(calls);

  assert.equal(result.ok, true);
  // After save+refresh, the note's loadedBody equals body, so dirty
  // is cleared. The status pill rolls back from Draft.
  assert.notEqual(elements.get('statusText').textContent, 'Draft',
    'after a successful save-all, the dirty pill must clear');

  // The dirty-summary responder also reports clean.
  let postSummary = 'unset';
  calls.closeRequestHandler((s) => { postSummary = s; });
  assert.deepEqual(postSummary, { count: 0, hasDraft: false, hasDirtyVault: false });
});

test('Stage 6.3B: save-all suppresses watcher refresh during the loop', async () => {
  const { calls, elements, window } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [{
      id: 'vault:a', title: 'A', body: '# A\n\norig',
      fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  calls.cm6Adapter.text = '# A\n\nedited-watcher-test';
  calls.cm6OnChange(calls.cm6Adapter.text);

  const beforeLoad = calls.loadVaultNotesPayloads.length;
  const realSaveFn = window.vaultApi.saveNote;
  window.vaultApi.saveNote = async (payload) => {
    // Fire a watcher event mid-save. If saveAllInProgress is set,
    // the renderer's onVaultChanged handler must bail out and NOT
    // trigger an in-loop refreshVaultNotes. Without suppression, this
    // would add an extra loadVaultNotes call before the post-loop
    // refresh, racing the in-flight save.
    if (typeof calls.vaultChangedCallback === 'function') {
      await calls.vaultChangedCallback({ fileName: 'a.md' });
    }
    return realSaveFn(payload);
  };

  const result = await invokeSaveAllHandler(calls);

  assert.equal(result.ok, true);
  // Exactly ONE refresh after the loop; the mid-flight watcher event
  // must have been suppressed.
  const refreshesDuringSaveAll = calls.loadVaultNotesPayloads.length - beforeLoad;
  assert.equal(refreshesDuringSaveAll, 1,
    'save-all must suppress mid-loop watcher refreshes (exactly one post-loop refresh)');
});

// ── Stage 6.3B Codex post-review: data-safety races & overlap guard ──
//
// These tests pin the three holes Codex flagged after the first 6.3B
// pass:
//   1. A note edited DURING the save loop (after its own save) must
//      keep that new edit and force save-all to return ok:false.
//   2. A partial failure (A succeeds, B fails) must surface as
//      ok:false with the dirty content for B preserved.
//   3. An overlapping save-all request must not start a second loop
//      against the same notes array.

test('Stage 6.3B (Codex follow-up): post-save edit during the loop forces ok:false and preserves the edit', async () => {
  const { calls, elements, window } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [{
      id: 'vault:a', title: 'A', body: '# A\n\norig',
      fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  // First edit: this is what the initial dirty snapshot will save.
  calls.cm6Adapter.text = '# A\n\nfirst-edit';
  calls.cm6OnChange(calls.cm6Adapter.text);

  // Wrap saveNote: AFTER it returns ok:true, sneak in a second edit
  // while saveAllDirtyNotes is still running. Without the captured-
  // at-save baselines + post-loop preserved overlay + final dirty
  // check, this new edit would be misclassified as already-saved
  // and main would be told it's safe to quit.
  const realSave = window.vaultApi.saveNote;
  let already = false;
  window.vaultApi.saveNote = async (payload) => {
    const result = await realSave(payload);
    if (!already && result.ok && payload.note.relativePath === 'a.md') {
      already = true;
      calls.cm6Adapter.text = '# A\n\nsneaked-second-edit';
      calls.cm6OnChange(calls.cm6Adapter.text);
    }
    return result;
  };

  const result = await invokeSaveAllHandler(calls);

  assert.equal(result.ok, false,
    'a post-save in-flight edit must keep save-all from declaring success');
  assert.match(String(result.error || ''), /unsaved|still/i);

  // The sneaked edit must remain in memory — main must not close.
  let summary = 'unset';
  calls.closeRequestHandler((s) => { summary = s; });
  assert.equal(summary && summary.count, 1,
    'the second edit must remain dirty in memory so the user does not lose it');
});

test('Stage 6.3B (Codex follow-up): partial failure (A saves, B fails) returns ok:false and preserves B', async () => {
  const { calls, elements, window } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [
      { id: 'vault:a', title: 'A', body: '# A\n\norig-a', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b', title: 'B', body: '# B\n\norig-b', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  calls.cm6Adapter.text = '# A\n\nedited-a';
  calls.cm6OnChange(calls.cm6Adapter.text);
  elements.get('noteList').children[1].fire('click');
  calls.cm6Adapter.text = '# B\n\nedited-b';
  calls.cm6OnChange(calls.cm6Adapter.text);

  // Inject failure for B only.
  const realSave = window.vaultApi.saveNote;
  window.vaultApi.saveNote = async (payload) => {
    if (payload.note.relativePath === 'b.md') {
      return { ok: false, error: 'EACCES: simulated failure' };
    }
    return realSave(payload);
  };

  const result = await invokeSaveAllHandler(calls);

  assert.equal(result.ok, false,
    'a partial failure must NOT report ok:true');
  assert.match(String(result.error || ''), /EACCES|simulated|unsaved/i);

  // B's in-memory edit must survive the post-loop refresh — the
  // overlay preserves all vault notes' current state, not just the
  // not-saved ones.
  let summary = 'unset';
  calls.closeRequestHandler((s) => { summary = s; });
  assert.ok(summary && summary.count >= 1,
    'B (the failed note) must remain dirty so its content is not lost');
});

test('Stage 6.3B (Codex follow-up): a second concurrent save-all request is rejected with ok:false', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [{
      id: 'vault:a', title: 'A', body: '# A\n\norig',
      fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  calls.cm6Adapter.text = '# A\n\nedited';
  calls.cm6OnChange(calls.cm6Adapter.text);

  // Fire two save-all requests synchronously. The first sets the
  // saveAllInProgress latch before any await; the second sees it
  // and returns immediately with ok:false.
  const promise1 = new Promise((resolve) => {
    calls.saveAllRequestHandler((r) => resolve(r == null ? r : { ...r }));
  });
  const promise2 = new Promise((resolve) => {
    calls.saveAllRequestHandler((r) => resolve(r == null ? r : { ...r }));
  });

  const [r1, r2] = await Promise.all([promise1, promise2]);

  // Exactly one must succeed; exactly one must be the overlap reject.
  const successes = [r1, r2].filter((r) => r && r.ok === true);
  const failures  = [r1, r2].filter((r) => r && r.ok === false);
  assert.equal(successes.length, 1, 'exactly one save-all must complete normally');
  assert.equal(failures.length,  1, 'exactly one save-all must be rejected as overlapping');
  assert.match(String(failures[0].error || ''), /already in progress|in flight|busy/i,
    'the overlap rejection error must explain why');
});

// ── Keyboard shortcuts (Stage 8.1) ────────────────────────────────────────

// Fires all document-level 'keydown' handlers and awaits completion.
// Returns { preventDefaultCalled } so tests can assert on preventDefault behavior.
async function fireDocumentKeydown(documentHandlers, key, {
  metaKey = false, ctrlKey = false, shiftKey = false, altKey = false, isComposing = false,
} = {}) {
  let preventDefaultCalled = false;
  const event = {
    key,
    metaKey,
    ctrlKey,
    shiftKey,
    altKey,
    isComposing,
    preventDefault() { preventDefaultCalled = true; },
  };
  await Promise.all((documentHandlers['keydown'] || []).map((h) => h(event)));
  return { preventDefaultCalled };
}

test('Cmd+N with no note selected creates a new draft', async () => {
  const { elements, documentHandlers } = makeRendererHarness();

  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'n', { metaKey: true });

  assert.equal(
    elements.get('statusText').textContent,
    'New draft created'
  );
  assert.ok(preventDefaultCalled, 'Cmd+N must call preventDefault()');
});

test('Cmd+N with a clean vault note selected adds a draft without saving', async () => {
  const { calls, elements, documentHandlers } = makeRendererHarness({
    vaultNotes: [{
      id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md',
    }],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  await fireDocumentKeydown(documentHandlers, 'n', { metaKey: true });

  assert.equal(
    elements.get('statusText').textContent,
    'New draft created',
    'Cmd+N should create a new draft'
  );
  assert.equal(calls.saveNotePayloads.length, 0, 'Cmd+N must not trigger a save');
});

test('Cmd+N during IME composition does nothing', async () => {
  const { elements, documentHandlers } = makeRendererHarness();
  const beforeStatus = elements.get('statusText').textContent;

  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'n', { metaKey: true, isComposing: true });

  assert.equal(
    elements.get('statusText').textContent,
    beforeStatus,
    'Cmd+N must be suppressed during IME composition'
  );
  assert.ok(!preventDefaultCalled, 'Cmd+N during IME composition must not call preventDefault()');
});

test('Ctrl+N creates a new draft (cross-platform)', async () => {
  const { elements, documentHandlers } = makeRendererHarness();

  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'n', { ctrlKey: true });

  assert.equal(
    elements.get('statusText').textContent,
    'New draft created',
    'Ctrl+N should create a new draft'
  );
  assert.ok(preventDefaultCalled, 'Ctrl+N must call preventDefault()');
});

test('Cmd+N with uppercase N (Caps Lock) creates a new draft', async () => {
  const { elements, documentHandlers } = makeRendererHarness();

  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'N', { metaKey: true });

  assert.equal(
    elements.get('statusText').textContent,
    'New draft created',
    'Cmd+N with Caps Lock should create a new draft'
  );
  assert.ok(preventDefaultCalled, 'Cmd+N with uppercase key must call preventDefault()');
});

test('Cmd+S with a vault note selected triggers save once', async () => {
  const { calls, elements, documentHandlers } = makeRendererHarness({
    vaultNotes: [{
      id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md',
    }],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 's', { metaKey: true });

  assert.equal(calls.saveNotePayloads.length, 1, 'Cmd+S should trigger exactly one save');
  assert.ok(preventDefaultCalled, 'Cmd+S must call preventDefault()');
});

test('Cmd+S with no selected note does not call save IPC', async () => {
  const { calls, documentHandlers } = makeRendererHarness();

  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 's', { metaKey: true });

  assert.equal(calls.saveNotePayloads.length, 0, 'Cmd+S with no selection must not call saveNote');
  assert.ok(preventDefaultCalled, 'Cmd+S must call preventDefault() even with no selection');
});

test('Ctrl+S triggers save (cross-platform)', async () => {
  const { calls, elements, documentHandlers } = makeRendererHarness({
    vaultNotes: [{
      id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md',
    }],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 's', { ctrlKey: true });

  assert.equal(calls.saveNotePayloads.length, 1, 'Ctrl+S should trigger exactly one save');
  assert.ok(preventDefaultCalled, 'Ctrl+S must call preventDefault()');
});

test('Cmd+S with uppercase S (Caps Lock) triggers save', async () => {
  const { calls, elements, documentHandlers } = makeRendererHarness({
    vaultNotes: [{
      id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md',
    }],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'S', { metaKey: true });

  assert.equal(calls.saveNotePayloads.length, 1, 'Cmd+S with Caps Lock should trigger save');
  assert.ok(preventDefaultCalled, 'Cmd+S with uppercase key must call preventDefault()');
});

test('Cmd+S with an unsaved draft and no vault triggers the choose-vault then save flow', async () => {
  const { calls, documentHandlers } = makeRendererHarness();

  // Create a draft first, then immediately save without a vault
  await fireDocumentKeydown(documentHandlers, 'n', { metaKey: true });
  await fireDocumentKeydown(documentHandlers, 's', { metaKey: true });

  // Vault was chosen: watchVaultFolder is called exactly once during chooseVaultFolder
  assert.equal(calls.watchVaultFolderPayloads.length, 1, 'vault should be chosen automatically');
  assert.equal(calls.saveNotePayloads.length, 1, 'save should proceed after vault selection');
});

// ── Negative tests: Shift and Alt modifier combinations must not fire ─────

test('Cmd+Shift+N does not create a new draft', async () => {
  const { elements, documentHandlers } = makeRendererHarness();
  const beforeStatus = elements.get('statusText').textContent;

  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'n', { metaKey: true, shiftKey: true });

  assert.equal(elements.get('statusText').textContent, beforeStatus, 'Cmd+Shift+N must not create a draft');
  assert.ok(!preventDefaultCalled, 'Cmd+Shift+N must not call preventDefault()');
});

test('Cmd+Shift+S does not trigger save', async () => {
  const { calls, elements, documentHandlers } = makeRendererHarness({
    vaultNotes: [{
      id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md',
    }],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 's', { metaKey: true, shiftKey: true });

  assert.equal(calls.saveNotePayloads.length, 0, 'Cmd+Shift+S must not trigger save');
  assert.ok(!preventDefaultCalled, 'Cmd+Shift+S must not call preventDefault()');
});

test('Ctrl+Alt+N does not create a new draft', async () => {
  const { elements, documentHandlers } = makeRendererHarness();
  const beforeStatus = elements.get('statusText').textContent;

  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'n', { ctrlKey: true, altKey: true });

  assert.equal(elements.get('statusText').textContent, beforeStatus, 'Ctrl+Alt+N must not create a draft');
  assert.ok(!preventDefaultCalled, 'Ctrl+Alt+N must not call preventDefault()');
});

test('Ctrl+Alt+S does not trigger save', async () => {
  const { calls, elements, documentHandlers } = makeRendererHarness({
    vaultNotes: [{
      id: 'vault:a', title: 'Vault A', body: '# A', fileName: 'a.md', relativePath: 'a.md',
    }],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 's', { ctrlKey: true, altKey: true });

  assert.equal(calls.saveNotePayloads.length, 0, 'Ctrl+Alt+S must not trigger save');
  assert.ok(!preventDefaultCalled, 'Ctrl+Alt+S must not call preventDefault()');
});

// ── Stage 13: editor text-size adjust (zoom in / out / reset) ──────────────
//
// CSS-only, renderer-local. A single :root CSS variable --editor-font-size
// (default 15px) is consumed by the Write pane root (.hybrid-write-pane) and
// the Toast UI Preview body selectors. Three keyboard shortcuts adjust the
// variable: Cmd/Ctrl+= grows by one step, Cmd/Ctrl+- shrinks, Cmd/Ctrl+0
// resets. Persisted to localStorage under markdownVault.editorFontSize.
//
// Strict numeric parsing on read: Number(raw) + Number.isInteger +
// FONT_SIZE_STEPS.includes; fallback to default for missing / non-numeric /
// partial-numeric / non-integer / out-of-range / off-step values.
//
// Boot APPLIES the restored size without writing localStorage; only keyboard
// actions persist.

function readEditorFontSizeVar(harness) {
  return harness.document.documentElement.style.getPropertyValue('--editor-font-size');
}

function setItemForEditorFontSize(setItemCalls) {
  return setItemCalls.filter((entry) => entry[0] === 'markdownVault.editorFontSize');
}

test('Stage 13: Cmd+= grows editor font size by one step and persists', async () => {
  const harness = makeRendererHarness();
  const { documentHandlers, setItemCalls } = harness;

  // Boot at default 15px.
  assert.equal(readEditorFontSizeVar(harness), '15px',
    'boot should apply default --editor-font-size: 15px');
  assert.equal(setItemForEditorFontSize(setItemCalls).length, 0,
    'boot must NOT persist (apply only, no setItem)');

  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, '=', { metaKey: true });

  assert.equal(readEditorFontSizeVar(harness), '16px',
    'Cmd+= should grow one step (15 → 16)');
  assert.ok(preventDefaultCalled, 'Cmd+= must call preventDefault()');
  const editorPersists = setItemForEditorFontSize(setItemCalls);
  assert.equal(editorPersists.length, 1, 'Cmd+= must persist exactly once');
  assert.deepEqual(editorPersists[0], ['markdownVault.editorFontSize', '16'],
    'Cmd+= must persist new step value as decimal string');
});

test('Stage 13: Cmd+Shift+= also grows editor font size by one step', async () => {
  const harness = makeRendererHarness();
  // On a US keyboard, Cmd+Shift+= produces e.key === '+' (the shifted form).
  const { preventDefaultCalled } = await fireDocumentKeydown(harness.documentHandlers, '+', { metaKey: true, shiftKey: true });

  assert.equal(readEditorFontSizeVar(harness), '16px',
    'Cmd+Shift+= (e.key === "+") should grow one step');
  assert.ok(preventDefaultCalled, 'Cmd+Shift+= must call preventDefault()');
});

test('Stage 13: Ctrl+= grows editor font size by one step (Linux/Windows shortcut)', async () => {
  const harness = makeRendererHarness();
  const { preventDefaultCalled } = await fireDocumentKeydown(harness.documentHandlers, '=', { ctrlKey: true });

  assert.equal(readEditorFontSizeVar(harness), '16px',
    'Ctrl+= must work the same as Cmd+= for Linux/Windows users');
  assert.ok(preventDefaultCalled, 'Ctrl+= must call preventDefault()');
});

test('Stage 13: Cmd+- shrinks editor font size by one step and persists', async () => {
  const harness = makeRendererHarness();
  const { preventDefaultCalled } = await fireDocumentKeydown(harness.documentHandlers, '-', { metaKey: true });

  assert.equal(readEditorFontSizeVar(harness), '14px',
    'Cmd+- should shrink one step (15 → 14)');
  assert.ok(preventDefaultCalled, 'Cmd+- must call preventDefault()');
  const editorPersists = setItemForEditorFontSize(harness.setItemCalls);
  assert.deepEqual(editorPersists[0], ['markdownVault.editorFontSize', '14']);
});

test('Stage 13: Cmd+0 resets editor font size to default and persists', async () => {
  const harness = makeRendererHarness({ storageEntries: { 'markdownVault.editorFontSize': '24' } });
  // Confirm boot landed at 24px.
  assert.equal(readEditorFontSizeVar(harness), '24px', 'boot should restore 24px');

  const { preventDefaultCalled } = await fireDocumentKeydown(harness.documentHandlers, '0', { metaKey: true });

  assert.equal(readEditorFontSizeVar(harness), '15px', 'Cmd+0 must reset to default 15');
  assert.ok(preventDefaultCalled, 'Cmd+0 must call preventDefault()');
  const editorPersists = setItemForEditorFontSize(harness.setItemCalls);
  assert.deepEqual(editorPersists[editorPersists.length - 1], ['markdownVault.editorFontSize', '15']);
});

test('Stage 13: Cmd+= at maximum step is a no-op (clamped) but still consumes the key', async () => {
  const harness = makeRendererHarness({ storageEntries: { 'markdownVault.editorFontSize': '36' } });
  assert.equal(readEditorFontSizeVar(harness), '36px', 'boot at max');
  const persistsBefore = setItemForEditorFontSize(harness.setItemCalls).length;

  const { preventDefaultCalled } = await fireDocumentKeydown(harness.documentHandlers, '=', { metaKey: true });

  assert.equal(readEditorFontSizeVar(harness), '36px', 'Cmd+= at max must clamp');
  assert.ok(preventDefaultCalled, 'Cmd+= still calls preventDefault even when clamped');
  const persistsAfter = setItemForEditorFontSize(harness.setItemCalls).length;
  assert.equal(persistsAfter, persistsBefore,
    'no-op Cmd+= must NOT write a redundant persistence entry');
});

test('Stage 13: Cmd+- at minimum step is a no-op (clamped) but still consumes the key', async () => {
  const harness = makeRendererHarness({ storageEntries: { 'markdownVault.editorFontSize': '12' } });
  assert.equal(readEditorFontSizeVar(harness), '12px', 'boot at min');
  const persistsBefore = setItemForEditorFontSize(harness.setItemCalls).length;

  const { preventDefaultCalled } = await fireDocumentKeydown(harness.documentHandlers, '-', { metaKey: true });

  assert.equal(readEditorFontSizeVar(harness), '12px', 'Cmd+- at min must clamp');
  assert.ok(preventDefaultCalled, 'Cmd+- still calls preventDefault even when clamped');
  const persistsAfter = setItemForEditorFontSize(harness.setItemCalls).length;
  assert.equal(persistsAfter, persistsBefore,
    'no-op Cmd+- must NOT write a redundant persistence entry');
});

test('Stage 13: Cmd+Alt+= does NOT zoom and does NOT call preventDefault', async () => {
  const harness = makeRendererHarness();
  const { preventDefaultCalled } = await fireDocumentKeydown(harness.documentHandlers, '=', { metaKey: true, altKey: true });

  assert.equal(readEditorFontSizeVar(harness), '15px',
    'Cmd+Alt+= must not change the font-size variable');
  assert.ok(!preventDefaultCalled,
    'Cmd+Alt+= must not call preventDefault — handler must not consume the key');
});

test('Stage 13: IME composition suppresses zoom shortcut', async () => {
  const harness = makeRendererHarness();
  const { preventDefaultCalled } = await fireDocumentKeydown(harness.documentHandlers, '=', { metaKey: true, isComposing: true });

  assert.equal(readEditorFontSizeVar(harness), '15px',
    'composition (e.isComposing) must suppress zoom');
  assert.ok(!preventDefaultCalled,
    'composition path returns early; preventDefault must not be called');
});

test('Stage 13: boot restores valid persisted size WITHOUT writing localStorage', () => {
  const harness = makeRendererHarness({ storageEntries: { 'markdownVault.editorFontSize': '20' } });

  assert.equal(readEditorFontSizeVar(harness), '20px',
    'boot must apply restored size to --editor-font-size');
  assert.equal(setItemForEditorFontSize(harness.setItemCalls).length, 0,
    'boot apply must NOT trigger setItem (apply with persist:false)');
});

test('Stage 13: boot falls back to default when persisted value is missing', () => {
  const harness = makeRendererHarness();
  assert.equal(readEditorFontSizeVar(harness), '15px',
    'no persisted value → default 15px');
});

test('Stage 13: boot falls back to default for non-numeric persisted value "banana"', () => {
  const harness = makeRendererHarness({ storageEntries: { 'markdownVault.editorFontSize': 'banana' } });
  assert.equal(readEditorFontSizeVar(harness), '15px',
    'Number("banana") is NaN → default');
});

test('Stage 13: boot falls back to default for partial-numeric "14px"', () => {
  // parseInt('14px') is 14 — insufficient. Number('14px') is NaN — strict.
  const harness = makeRendererHarness({ storageEntries: { 'markdownVault.editorFontSize': '14px' } });
  assert.equal(readEditorFontSizeVar(harness), '15px',
    'Number("14px") is NaN; strict parsing must fall back');
});

test('Stage 13: boot falls back to default for non-integer "14.5"', () => {
  const harness = makeRendererHarness({ storageEntries: { 'markdownVault.editorFontSize': '14.5' } });
  assert.equal(readEditorFontSizeVar(harness), '15px',
    'Number.isInteger(14.5) is false → default');
});

test('Stage 13: boot falls back to default for in-range but off-step "17"', () => {
  // 17 is between 16 and 18 in the step list — not a valid step.
  const harness = makeRendererHarness({ storageEntries: { 'markdownVault.editorFontSize': '17' } });
  assert.equal(readEditorFontSizeVar(harness), '15px',
    'FONT_SIZE_STEPS.includes(17) is false → default');
});

test('Stage 13: boot falls back to default for out-of-range "999"', () => {
  const harness = makeRendererHarness({ storageEntries: { 'markdownVault.editorFontSize': '999' } });
  assert.equal(readEditorFontSizeVar(harness), '15px',
    'value outside step list → default');
});

// ── Stage A (Issue #12 R1a + R3): title sync + per-note save latch ────────
// R1a: titleInput listens to 'input', not 'change'. A keystroke that fires
// 'keydown' before 'input' leaves selectedNote.title stale. saveCurrentNote
// and saveAllDirtyNotes must call updateSelectedNoteFromInputs() (via a
// value-based gate) before reading selectedNote.title.
// R3: saveCurrentNote is async. Without a per-note latch, two Cmd+S
// keystrokes during a delayed save (or pre-vault picker) double-dispatch.

// Manually-released barrier for in-flight latch tests.
function makeBlocker() {
  let resolveFn;
  let rejectFn;
  const promise = new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });
  return {
    wait:    () => promise,
    release: (v) => resolveFn(v),
    fail:    (e) => rejectFn(e),
  };
}

// Drain the microtask queue so an awaited async function reaches its first
// real `await` (e.g., the IPC barrier). Two ticks is empirically enough for
// saveCurrentNote's synchronous prologue.
async function flushMicrotasks(n = 8) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// Like fireDocumentKeydown, but returns the in-flight promise *without*
// awaiting it. Use for concurrency tests where awaiting would block on a
// barrier that the test hasn't released yet. preventDefaultCalled is
// readable synchronously because the keydown handler calls preventDefault()
// before any `await`.
function fireDocumentKeydownAsync(documentHandlers, key, opts = {}) {
  let preventDefaultCalled = false;
  const event = {
    key,
    metaKey:     opts.metaKey     || false,
    ctrlKey:     opts.ctrlKey     || false,
    shiftKey:    opts.shiftKey    || false,
    altKey:      opts.altKey      || false,
    isComposing: opts.isComposing || false,
    preventDefault() { preventDefaultCalled = true; },
  };
  const promise = Promise.all((documentHandlers['keydown'] || []).map((h) => h(event)));
  return {
    promise,
    get preventDefaultCalled() { return preventDefaultCalled; },
  };
}

// ── Cluster A: title sync via Cmd+S and toolbar Save ─────────────────────

test('A1: Cmd+S with pending titleInput value saves the new title', async () => {
  const { calls, elements, documentHandlers, document: doc } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [{
      id: 'vault:a', title: 'Original', body: '# A', fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  // Type a new title in the DOM but DO NOT fire 'input' — mirrors the
  // keydown-before-input race a real keystroke can produce.
  elements.get('titleInput').value = 'Renamed';
  doc.activeElement = elements.get('titleInput');

  await fireDocumentKeydown(documentHandlers, 's', { metaKey: true });

  assert.equal(calls.saveNotePayloads.length, 1, 'one save dispatched');
  assert.equal(calls.saveNotePayloads[0].note.title, 'Renamed',
    'saved title reflects the unflushed DOM value');
});

test('A2: toolbar Save with pending titleInput value (focus moved away) saves the new title', async () => {
  const { calls, elements, document: doc } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [{
      id: 'vault:a', title: 'Original', body: '# A', fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  elements.get('titleInput').value = 'Renamed';
  // Real-browser case: clicking the button moved focus off titleInput
  // BEFORE the click handler runs. An activeElement-based gate would skip
  // the sync here; the value-based gate must catch it.
  doc.activeElement = elements.get('saveNoteButton');

  await elements.get('saveNoteButton').fireAsync('click');

  assert.equal(calls.saveNotePayloads.length, 1);
  assert.equal(calls.saveNotePayloads[0].note.title, 'Renamed',
    'toolbar Save must sync the unflushed title even when focus is not on titleInput');
});

test('A3: Cmd+S with no selected note dispatches no save', async () => {
  const { calls, documentHandlers } = makeRendererHarness({
    search: '?writeEngine=cm6',
  });

  await fireDocumentKeydown(documentHandlers, 's', { metaKey: true });

  assert.equal(calls.saveNotePayloads.length, 0,
    'Cmd+S with no selection must not dispatch a save');
});

test('A4: Cmd+S with titleInput.value === selectedNote.title saves the existing title', async () => {
  const { calls, elements, documentHandlers } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [{
      id: 'vault:a', title: 'Original', body: '# A', fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  // titleInput.value already matches selectedNote.title from the load.
  // Make a body edit so save proceeds (no-op saves return early elsewhere).
  calls.cm6Adapter.text = '# A edited';
  calls.cm6OnChange(calls.cm6Adapter.text);

  await fireDocumentKeydown(documentHandlers, 's', { metaKey: true });

  assert.equal(calls.saveNotePayloads.length, 1);
  assert.equal(calls.saveNotePayloads[0].note.title, 'Original',
    'unchanged title flows through unchanged');
});

// ── Cluster B: concurrency latch ─────────────────────────────────────────

test('B1: two Cmd+S during a delayed save IPC dispatch the IPC once', async () => {
  const { calls, elements, documentHandlers, window: win } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [{
      id: 'vault:a', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  calls.cm6Adapter.text = '# A edited';
  calls.cm6OnChange(calls.cm6Adapter.text);

  const blocker  = makeBlocker();
  const realSave = win.vaultApi.saveNote;
  win.vaultApi.saveNote = async (payload) => {
    await blocker.wait();
    return realSave(payload);
  };

  // Use the non-awaiting helper so pre-implementation (where the second
  // call also blocks on the barrier) fails cleanly via the saveNotePayloads
  // count assertion instead of timing out.
  const first  = fireDocumentKeydownAsync(documentHandlers, 's', { metaKey: true });
  await flushMicrotasks();
  const second = fireDocumentKeydownAsync(documentHandlers, 's', { metaKey: true });
  await flushMicrotasks();
  blocker.release();
  await Promise.all([first.promise, second.promise]);

  assert.equal(calls.saveNotePayloads.length, 1,
    'second Cmd+S during in-flight save must not dispatch a second IPC');
});

test('B2: two Cmd+S during a delayed pre-vault picker open one picker and one save', async () => {
  const { calls, elements, documentHandlers, window: win } = makeRendererHarness({
    search: '?writeEngine=cm6',
  });
  // Pre-vault draft.
  elements.get('newNoteButton').fire('click');
  elements.get('titleInput').value = 'Draft';
  elements.get('titleInput').fire('input');
  calls.cm6Adapter.text = 'body';
  calls.cm6OnChange(calls.cm6Adapter.text);

  // Block the renderer's chooseVaultFolder behind a barrier.
  const blocker     = makeBlocker();
  const realChoose  = win.VaultActions.chooseVaultFolder;
  win.VaultActions.chooseVaultFolder = async (deps) => {
    await blocker.wait();
    return realChoose(deps);
  };

  const first  = fireDocumentKeydownAsync(documentHandlers, 's', { metaKey: true });
  await flushMicrotasks();
  const second = fireDocumentKeydownAsync(documentHandlers, 's', { metaKey: true });
  await flushMicrotasks();
  blocker.release();
  await Promise.all([first.promise, second.promise]);

  assert.equal(calls.watchVaultFolderPayloads.length, 1,
    'only one pre-vault picker completes');
  assert.equal(calls.saveNotePayloads.length, 1,
    'only one save IPC fires');
});

test('B3: per-note save latch resets after a successful save', async () => {
  const { calls, elements, documentHandlers } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [{
      id: 'vault:a', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  calls.cm6Adapter.text = '# A first';
  calls.cm6OnChange(calls.cm6Adapter.text);

  await fireDocumentKeydown(documentHandlers, 's', { metaKey: true });
  assert.equal(calls.saveNotePayloads.length, 1);

  // Make another dirty edit and save again. Latch must have reset.
  calls.cm6Adapter.text = '# A second';
  calls.cm6OnChange(calls.cm6Adapter.text);
  await fireDocumentKeydown(documentHandlers, 's', { metaKey: true });
  assert.equal(calls.saveNotePayloads.length, 2,
    'second save proceeds after first completed (latch reset in finally)');
});

test('B4: per-note save latch resets after a thrown save error', async () => {
  const { calls, elements, documentHandlers, window: win } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [{
      id: 'vault:a', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  calls.cm6Adapter.text = '# A first';
  calls.cm6OnChange(calls.cm6Adapter.text);

  const realSave = win.vaultApi.saveNote;
  let throwOnce = true;
  win.vaultApi.saveNote = async (payload) => {
    if (throwOnce) {
      throwOnce = false;
      throw new Error('simulated IPC throw');
    }
    return realSave(payload);
  };

  // First save throws inside the IPC; finally must reset the latch.
  await fireDocumentKeydown(documentHandlers, 's', { metaKey: true }).catch(() => {});

  // Second save (impl now succeeds) must proceed.
  await fireDocumentKeydown(documentHandlers, 's', { metaKey: true });
  assert.equal(calls.saveNotePayloads.length, 1,
    'second save proceeds after first threw (latch reset in finally)');
  assert.equal(calls.saveNotePayloads[0].note.title, 'A');
});

test('B5: per-note save latch resets after a pre-vault cancel', async () => {
  const { calls, elements, documentHandlers, window: win } = makeRendererHarness({
    search: '?writeEngine=cm6',
    chooseVaultCanceled: true,
  });
  // Pre-vault draft with a real title.
  elements.get('newNoteButton').fire('click');
  elements.get('titleInput').value = 'Draft';
  elements.get('titleInput').fire('input');
  calls.cm6Adapter.text = 'body';
  calls.cm6OnChange(calls.cm6Adapter.text);

  // First Cmd+S: pre-vault, user cancels.
  await fireDocumentKeydown(documentHandlers, 's', { metaKey: true });
  assert.equal(calls.saveNotePayloads.length, 0, 'cancel produces no save');

  // Second attempt: override VaultActions.chooseVaultFolder to succeed
  // (no longer canceled). The latch must have reset, so the second Cmd+S
  // enters saveCurrentNote, completes choose-vault, and dispatches a save.
  win.VaultActions.chooseVaultFolder = async (deps) => {
    await deps.stopWatching();
    deps.setCurrentVaultPath('/fake-vault');
    deps.updateDisplay();
    await deps.startWatching();
    await deps.refreshVaultNotes('', true);
  };

  await fireDocumentKeydown(documentHandlers, 's', { metaKey: true });
  assert.equal(calls.saveNotePayloads.length, 1,
    'second Cmd+S proceeds (latch was reset by finally)');
});

test('B6: Cmd+S calls preventDefault even when a save is already in flight', async () => {
  const { calls, elements, documentHandlers, window: win } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [{
      id: 'vault:a', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  calls.cm6Adapter.text = '# A edited';
  calls.cm6OnChange(calls.cm6Adapter.text);

  const blocker  = makeBlocker();
  const realSave = win.vaultApi.saveNote;
  win.vaultApi.saveNote = async (payload) => {
    await blocker.wait();
    return realSave(payload);
  };

  const first  = fireDocumentKeydownAsync(documentHandlers, 's', { metaKey: true });
  await flushMicrotasks();
  const second = fireDocumentKeydownAsync(documentHandlers, 's', { metaKey: true });
  await flushMicrotasks();
  // preventDefault is called synchronously by the keydown handler before
  // it awaits saveCurrentNote, so it is observable here regardless of
  // whether the latch will accept or reject the call.
  assert.ok(second.preventDefaultCalled,
    'Cmd+S during in-flight save must still call preventDefault()');

  blocker.release();
  await Promise.all([first.promise, second.promise]);
});

// ── Cluster C: save-all title sync ────────────────────────────────────────

test('C1: Save All with pending titleInput value (only dirty via title) saves the new title', async () => {
  const { calls, elements, document: doc } = makeRendererHarness({
    search: '?writeEngine=cm6',
    vaultNotes: [{
      id: 'vault:a', title: 'Original', body: '# A', fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  // The body is unchanged from load — the only dirty signal is the
  // unflushed title in the DOM. Without sync running before dirty-id
  // snapshotting, save-all would see no dirty notes and dispatch nothing.
  elements.get('titleInput').value = 'Renamed';
  doc.activeElement = elements.get('titleInput');

  const result = await invokeSaveAllHandler(calls);

  assert.equal(result.ok, true);
  assert.equal(calls.saveNotePayloads.length, 1,
    'sync makes the note dirty before the dirty-id snapshot');
  assert.equal(calls.saveNotePayloads[0].note.title, 'Renamed');
});

// ── Cluster D: pre-vault title-only Cmd+S (ordering proof) ───────────────

test('D1: pre-vault title-only Cmd+S preserves the draft and saves with the pending title', async () => {
  const { calls, elements, documentHandlers, document: doc } = makeRendererHarness({
    search: '?writeEngine=cm6',
  });
  // Fresh boot, no vault. Create a draft.
  elements.get('newNoteButton').fire('click');
  // Type a title into the DOM WITHOUT firing 'input' — selectedNote.title
  // stays '' (the createNewNote default).
  elements.get('titleInput').value = 'Renamed';
  doc.activeElement = elements.get('titleInput');

  // Body has content so the empty-title guard's title check is what
  // matters (without sync, title='' would block the save).
  calls.cm6Adapter.text = 'body';
  calls.cm6OnChange(calls.cm6Adapter.text);

  await fireDocumentKeydown(documentHandlers, 's', { metaKey: true });

  assert.equal(calls.watchVaultFolderPayloads.length, 1,
    'vault was chosen during the pre-vault flow');
  assert.equal(calls.saveNotePayloads.length, 1,
    'one save dispatched after vault selection');
  assert.equal(calls.saveNotePayloads[0].note.title, 'Renamed',
    'saved title reflects the unflushed DOM value (sync ran BEFORE chooseVault)');
});

// ── Stage 8.2: ArrowDown / ArrowUp note navigation ───────────────────────────
// After vault load, the renderer auto-selects the first visible note.
// Tests therefore start from that state (first note at index 0 selected).

test('ArrowDown moves selection from the first note to the second note', async () => {
  const { elements, documentHandlers } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'ArrowDown');

  const noteList = elements.get('noteList');
  assert.ok(!noteList.children[0].className.includes('active'), 'Note A should no longer be active');
  assert.ok(noteList.children[1].className.includes('active'), 'Note B should become active');
  assert.ok(preventDefaultCalled, 'ArrowDown must call preventDefault()');
});

test('ArrowDown from the second note moves to the third note', async () => {
  const { elements, documentHandlers } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
      { id: 'vault:c.md', title: 'Note C', body: '# C', fileName: 'c.md', relativePath: 'c.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  await fireDocumentKeydown(documentHandlers, 'ArrowDown');

  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'ArrowDown');

  const noteList = elements.get('noteList');
  assert.ok(noteList.children[2].className.includes('active'), 'Note C should become active');
  assert.ok(preventDefaultCalled, 'ArrowDown must call preventDefault()');
});

test('ArrowUp from the second note moves back to the first note', async () => {
  const { elements, documentHandlers } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  await fireDocumentKeydown(documentHandlers, 'ArrowDown');

  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'ArrowUp');

  const noteList = elements.get('noteList');
  assert.ok(noteList.children[0].className.includes('active'), 'Note A should be re-selected');
  assert.ok(!noteList.children[1].className.includes('active'), 'Note B should no longer be active');
  assert.ok(preventDefaultCalled, 'ArrowUp must call preventDefault()');
});

test('ArrowDown at the last note does nothing', async () => {
  const { elements, documentHandlers } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  await fireDocumentKeydown(documentHandlers, 'ArrowDown');

  const classNamesBefore = elements.get('noteList').children.map((c) => c.className);
  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'ArrowDown');
  const classNamesAfter = elements.get('noteList').children.map((c) => c.className);

  assert.deepEqual(classNamesAfter, classNamesBefore, 'ArrowDown at last note must not change selection');
  assert.ok(preventDefaultCalled, 'ArrowDown at last note must still call preventDefault()');
});

test('ArrowUp at the first note does nothing', async () => {
  const { elements, documentHandlers } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  const classNamesBefore = elements.get('noteList').children.map((c) => c.className);
  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'ArrowUp');
  const classNamesAfter = elements.get('noteList').children.map((c) => c.className);

  assert.deepEqual(classNamesAfter, classNamesBefore, 'ArrowUp at first note must not change selection');
  assert.ok(preventDefaultCalled, 'ArrowUp at first note must still call preventDefault()');
});

test('ArrowDown while titleInput is focused does nothing', async () => {
  const { elements, documentHandlers, document: doc } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  doc.activeElement = elements.get('titleInput');

  const classNamesBefore = elements.get('noteList').children.map((c) => c.className);
  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'ArrowDown');
  const classNamesAfter = elements.get('noteList').children.map((c) => c.className);

  assert.deepEqual(classNamesAfter, classNamesBefore, 'ArrowDown while titleInput is focused must not navigate');
  assert.ok(!preventDefaultCalled, 'ArrowDown in titleInput must not call preventDefault()');
});

test('ArrowDown while searchInput is focused does nothing', async () => {
  const { elements, documentHandlers, document: doc } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  doc.activeElement = elements.get('searchInput');

  const classNamesBefore = elements.get('noteList').children.map((c) => c.className);
  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'ArrowDown');
  const classNamesAfter = elements.get('noteList').children.map((c) => c.className);

  assert.deepEqual(classNamesAfter, classNamesBefore, 'ArrowDown while searchInput is focused must not navigate');
  assert.ok(!preventDefaultCalled, 'ArrowDown in searchInput must not call preventDefault()');
});

test('ArrowDown while focus is inside hybridWritePane does nothing', async () => {
  const { elements, documentHandlers, document: doc } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  const editorInner = { tagName: 'DIV', id: 'cm6-inner', children: [] };
  elements.get('hybridWritePane').children.push(editorInner);
  doc.activeElement = editorInner;

  const classNamesBefore = elements.get('noteList').children.map((c) => c.className);
  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'ArrowDown');
  const classNamesAfter = elements.get('noteList').children.map((c) => c.className);

  assert.deepEqual(classNamesAfter, classNamesBefore, 'ArrowDown inside hybridWritePane must not navigate');
  assert.ok(!preventDefaultCalled, 'ArrowDown inside hybridWritePane must not call preventDefault()');
});

// ── #23-C: Toast UI Preview pane focus exemption for ArrowUp/ArrowDown ──────
//
// When the user is in Preview mode and clicks into the rendered preview pane,
// ArrowUp/ArrowDown should fall through to the preview's native scroll
// behavior, not switch notes via the document-level note-nav handler. The
// existing inTextSurface predicate at index.html:3214-3216 exempts only
// titleInput, searchInput, and hybridWritePane.contains(focused); the preview
// pane (toastPreviewMount and its descendants) is not exempted, so ArrowDown
// inside Preview switches notes — the bug.

test('#23-C: ArrowDown while focus is on the Toast UI Preview scroller does nothing', async () => {
  const { elements, documentHandlers, document: doc } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('previewModeButton').fire('click');
  doc.activeElement = elements.get('toastPreviewMount')._previewScrollEl;

  const classNamesBefore = elements.get('noteList').children.map((c) => c.className);
  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'ArrowDown');
  const classNamesAfter = elements.get('noteList').children.map((c) => c.className);

  assert.deepEqual(classNamesAfter, classNamesBefore,
    'ArrowDown on the Preview scroller must not navigate the note list');
  assert.ok(!preventDefaultCalled,
    'ArrowDown on the Preview scroller must not call preventDefault()');
});

test('#23-C: ArrowDown while focus is on the nested Toast UI Preview contents does nothing', async () => {
  const { elements, documentHandlers, document: doc } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('previewModeButton').fire('click');
  doc.activeElement = elements.get('toastPreviewMount')._previewScrollEl._previewContentsEl;

  const classNamesBefore = elements.get('noteList').children.map((c) => c.className);
  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'ArrowDown');
  const classNamesAfter = elements.get('noteList').children.map((c) => c.className);

  assert.deepEqual(classNamesAfter, classNamesBefore,
    'ArrowDown on the nested Preview contents must not navigate the note list');
  assert.ok(!preventDefaultCalled,
    'ArrowDown on the nested Preview contents must not call preventDefault()');
});

test('#23-C: ArrowUp while focus is on the Toast UI Preview scroller does nothing', async () => {
  const { elements, documentHandlers, document: doc } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  // Move to second note so ArrowUp would otherwise navigate back to the first.
  elements.get('noteList').children[1].fire('click');
  elements.get('previewModeButton').fire('click');
  doc.activeElement = elements.get('toastPreviewMount')._previewScrollEl;

  const classNamesBefore = elements.get('noteList').children.map((c) => c.className);
  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'ArrowUp');
  const classNamesAfter = elements.get('noteList').children.map((c) => c.className);

  assert.deepEqual(classNamesAfter, classNamesBefore,
    'ArrowUp on the Preview scroller must not navigate the note list');
  assert.ok(!preventDefaultCalled,
    'ArrowUp on the Preview scroller must not call preventDefault()');
});

// ── Negative: modified arrows must not trigger note navigation ────────────────

test('Cmd+ArrowDown does not navigate the note list', async () => {
  const { elements, documentHandlers } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  const classNamesBefore = elements.get('noteList').children.map((c) => c.className);
  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'ArrowDown', { metaKey: true });
  const classNamesAfter = elements.get('noteList').children.map((c) => c.className);

  assert.deepEqual(classNamesAfter, classNamesBefore, 'Cmd+ArrowDown must not navigate');
  assert.ok(!preventDefaultCalled, 'Cmd+ArrowDown must not call preventDefault()');
});

test('Shift+ArrowDown does not navigate the note list', async () => {
  const { elements, documentHandlers } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  const classNamesBefore = elements.get('noteList').children.map((c) => c.className);
  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'ArrowDown', { shiftKey: true });
  const classNamesAfter = elements.get('noteList').children.map((c) => c.className);

  assert.deepEqual(classNamesAfter, classNamesBefore, 'Shift+ArrowDown must not navigate');
  assert.ok(!preventDefaultCalled, 'Shift+ArrowDown must not call preventDefault()');
});

test('Ctrl+ArrowDown does not navigate the note list', async () => {
  const { elements, documentHandlers } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  const classNamesBefore = elements.get('noteList').children.map((c) => c.className);
  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'ArrowDown', { ctrlKey: true });
  const classNamesAfter = elements.get('noteList').children.map((c) => c.className);

  assert.deepEqual(classNamesAfter, classNamesBefore, 'Ctrl+ArrowDown must not navigate');
  assert.ok(!preventDefaultCalled, 'Ctrl+ArrowDown must not call preventDefault()');
});

test('Alt+ArrowUp does not navigate the note list', async () => {
  const { elements, documentHandlers } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  await fireDocumentKeydown(documentHandlers, 'ArrowDown');

  const classNamesBefore = elements.get('noteList').children.map((c) => c.className);
  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'ArrowUp', { altKey: true });
  const classNamesAfter = elements.get('noteList').children.map((c) => c.className);

  assert.deepEqual(classNamesAfter, classNamesBefore, 'Alt+ArrowUp must not navigate');
  assert.ok(!preventDefaultCalled, 'Alt+ArrowUp must not call preventDefault()');
});

// ── Boundary: no note selected (empty vault) ──────────────────────────────────
// The auto-selection in ensureSelectionMatchesVisibleResults() means that once
// notes are loaded, a note is always selected. The "no note selected + visible
// notes" state is unreachable through normal harness operations. This test
// covers the structurally equivalent boundary: selectedNoteId is empty and
// visible results are also empty, confirming the handler exits cleanly with no
// navigation and no crash.

test('ArrowDown with no note selected and no visible notes does nothing', async () => {
  const { elements, documentHandlers } = makeRendererHarness();

  const classNamesBefore = elements.get('noteList').children.map((c) => c.className);
  const { preventDefaultCalled } = await fireDocumentKeydown(documentHandlers, 'ArrowDown');
  const classNamesAfter = elements.get('noteList').children.map((c) => c.className);

  assert.deepEqual(classNamesAfter, classNamesBefore, 'ArrowDown with no notes must not change note list');
  assert.ok(preventDefaultCalled, 'ArrowDown with no notes must still call preventDefault()');
});

// ── Stage 8.3: scroll selected note to top using getBoundingClientRect ──────────
// Formula: noteList.scrollTop += item.getBoundingClientRect().top - noteList.getBoundingClientRect().top
//
// Layout simulation (harness):
//   - noteList.getBoundingClientRect().top = 0 (stable viewport reference)
//   - child at index n: getBoundingClientRect().top = n*50 - noteList.scrollTop
//   - child.offsetTop = _SIDEBAR_OFFSET(200) + n*50  ← body-relative, as in real browser
//
// Expected scrollTop after selecting note at index n:
//   delta = (n*50 - current_scrollTop) - 0
//   scrollTop += delta  →  scrollTop = n*50
//
// Any formula using child.offsetTop directly would produce scrollTop = 200 + n*50 (wrong).

test('ArrowDown aligns the selected note to the top using getBoundingClientRect', async () => {
  // 2 notes. Note B is at index 1 (getBoundingClientRect().top = 50 - scrollTop).
  // Starting scrollTop=0: delta = (50-0)-0 = 50 → scrollTop = 50.
  const { elements, documentHandlers } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  const noteList = elements.get('noteList');
  noteList.clientHeight = 60;
  noteList.scrollTop = 0;

  await fireDocumentKeydown(documentHandlers, 'ArrowDown');

  assert.equal(noteList.scrollTop, 50,
    'ArrowDown must set scrollTop=50 (Note B index-top via getBoundingClientRect)');
});

test('ArrowUp aligns the selected note to the top using getBoundingClientRect', async () => {
  // 3 notes. Navigate to Note C (two ArrowDowns → scrollTop=100).
  // ArrowUp → Note B: getBoundingClientRect().top = 50-100 = -50. delta=-50 → scrollTop=50.
  const { elements, documentHandlers } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
      { id: 'vault:c.md', title: 'Note C', body: '# C', fileName: 'c.md', relativePath: 'c.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  const noteList = elements.get('noteList');
  noteList.clientHeight = 60;
  await fireDocumentKeydown(documentHandlers, 'ArrowDown'); // scrollTop → 50
  await fireDocumentKeydown(documentHandlers, 'ArrowDown'); // scrollTop → 100

  await fireDocumentKeydown(documentHandlers, 'ArrowUp'); // scrollTop → 50

  assert.equal(noteList.scrollTop, 50,
    'ArrowUp must set scrollTop=50 (Note B index-top via getBoundingClientRect)');
});

test('no scroll when entire list fits in the viewport', async () => {
  // scrollHeight(100) <= clientHeight(200): guard exits early, scrollTop stays 0.
  const { elements, documentHandlers } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  const noteList = elements.get('noteList');
  noteList.clientHeight = 200;
  noteList.scrollTop = 0;

  await fireDocumentKeydown(documentHandlers, 'ArrowDown');

  assert.equal(noteList.scrollTop, 0,
    'no scroll when scrollHeight(100) <= clientHeight(200)');
});

test('mouse click aligns the clicked note to the top using getBoundingClientRect', async () => {
  // Click Note B (index 1, getBoundingClientRect().top = 50-0 = 50). delta=50 → scrollTop=50.
  const { elements } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'Note B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  const noteList = elements.get('noteList');
  noteList.clientHeight = 60;
  noteList.scrollTop = 0;

  noteList.children[1].fire('click');

  assert.equal(noteList.scrollTop, 50,
    'mouse click must set scrollTop=50 (Note B index-top via getBoundingClientRect)');
});

// ── Stage 10.1: title textarea + sidebar default ──────────────────────────────

test('titleInput is a textarea element', () => {
  const { elements } = makeRendererHarness({ vaultNotes: [] });
  assert.equal(elements.get('titleInput').tagName, 'TEXTAREA',
    'titleInput must be a textarea so long titles can wrap to multiple lines');
});

test('titleInput.value interface is preserved: setting value and firing input updates note title', async () => {
  const { elements } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Short', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  const titleInput = elements.get('titleInput');
  const longTitle = 'A Very Long Title That Would Wrap Across Multiple Lines In A Narrow Editor Column';
  titleInput.value = longTitle;
  titleInput.fire('input');
  assert.equal(titleInput.value, longTitle, 'titleInput.value must reflect the long title');
});

test('titleInput is disabled when no note is selected', () => {
  const { elements } = makeRendererHarness({ vaultNotes: [] });
  assert.equal(elements.get('titleInput').disabled, true,
    'titleInput must be disabled with no note selected');
});

test('titleInput is enabled after selecting a note', async () => {
  const { elements } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  assert.equal(elements.get('titleInput').disabled, false,
    'titleInput must be enabled once a note is selected');
});

test('sidebar is open by default on fresh boot', () => {
  const { elements } = makeRendererHarness({ vaultNotes: [] });
  const toggle = elements.get('sidebarToggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true',
    'sidebar toggle aria-expanded must be true (open) on fresh boot');
});

test('sidebar toggle closes then re-opens the sidebar', () => {
  const { elements } = makeRendererHarness({ vaultNotes: [] });
  const toggle = elements.get('sidebarToggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'starts open');
  toggle.fire('click');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false', 'closed after first click');
  toggle.fire('click');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true', 're-opened after second click');
});

// ── Stage 10.1 revision: title newline normalization ──────────────────────────

test('Enter keydown in title textarea is prevented', async () => {
  const { elements } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  let preventDefaultCalled = false;
  elements.get('titleInput').fire('keydown', {
    key: 'Enter',
    isComposing: false,
    preventDefault() { preventDefaultCalled = true; },
  });
  assert.ok(preventDefaultCalled, 'non-composing Enter in title textarea must call preventDefault()');
});

test('Enter keydown during IME composition in title textarea does not call preventDefault', async () => {
  const { elements } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  let preventDefaultCalled = false;
  elements.get('titleInput').fire('keydown', {
    key: 'Enter',
    isComposing: true,
    preventDefault() { preventDefaultCalled = true; },
  });
  assert.ok(!preventDefaultCalled, 'composing Enter must not call preventDefault() — IME commit must not be blocked');
});

test('multiline paste into title textarea is normalized to single line before note title is stored', async () => {
  const { elements, calls } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  const titleInput = elements.get('titleInput');
  titleInput.value = 'Line 1\nLine 2\r\nLine 3';
  titleInput.fire('input');
  assert.ok(!titleInput.value.includes('\n'), 'titleInput.value must have no newlines after normalization');
  assert.ok(!titleInput.value.includes('\r'), 'titleInput.value must have no CR after normalization');
  assert.equal(titleInput.value, 'Line 1 Line 2 Line 3', 'newlines replaced by spaces');
});

test('selectedNote.title contains no \\r or \\n after multiline title input', async () => {
  const { elements, calls } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('titleInput').value = 'First\nSecond';
  elements.get('titleInput').fire('input');
  await elements.get('saveNoteButton').fireAsync('click');
  const savedTitle = calls.saveNotePayloads[0].note.title;
  assert.ok(!savedTitle.includes('\n'), 'save payload title must contain no newline');
  assert.ok(!savedTitle.includes('\r'), 'save payload title must contain no CR');
  assert.equal(savedTitle, 'First Second');
});

test('rename-on-save uses the normalized (newline-free) title', async () => {
  const { elements, calls } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'Note A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('titleInput').value = 'New\nTitle';
  elements.get('titleInput').fire('input');
  await elements.get('saveNoteButton').fireAsync('click');
  const payload = calls.saveNotePayloads[0];
  assert.ok(!payload.note.title.includes('\n'), 'rename payload title must be newline-free');
  assert.equal(payload.note.title, 'New Title', 'rename uses the space-joined normalized title');
});

// ── Stage 11.2: hybrid-cm6 engine boot tests ─────────────────────────────────

test('Stage 11.2: ?writeEngine=hybrid-cm6 constructs Cm6HybridView and not CM6 or HybridWriteView', () => {
  const { calls } = makeRendererHarness({ search: '?writeEngine=hybrid-cm6' });

  assert.deepEqual(calls.resolvedEngines, ['hybrid-cm6']);
  assert.deepEqual(calls.consoleDebug, [['[write-engine]', 'hybrid-cm6']]);
  assert.equal(calls.cm6HybridConstructed, 1, 'Cm6HybridView should be constructed');
  assert.equal(calls.cm6Constructed,       0, 'CM6WriteView must not be constructed');
  assert.equal(calls.hybridConstructed,    0, 'HybridWriteView must not be constructed');
});

test('Stage 11.2: engine label shows "CM6 Hybrid" for hybrid-cm6', () => {
  const { elements } = makeRendererHarness({ search: '?writeEngine=hybrid-cm6' });
  assert.equal(
    elements.get('docEngine').textContent,
    'CM6 Hybrid',
    'status-bar engine label must be "CM6 Hybrid" for hybrid-cm6'
  );
});

test('Stage 11.2: default boot still uses CM6, not Cm6HybridView', () => {
  const { calls } = makeRendererHarness();
  assert.deepEqual(calls.resolvedEngines, ['cm6']);
  assert.equal(calls.cm6Constructed,    1, 'default engine must be CM6');
  assert.equal(calls.cm6HybridConstructed, 0, 'Cm6HybridView must not be constructed by default');
});

test('Stage 11.4: index.html contains .cm-md-heading-mark CSS rule', () => {
  const html = readIndexHtml();
  assert.ok(html.includes('.cm-md-heading-mark'), 'must have .cm-md-heading-mark CSS rule');
});

test('Stage 11.4: index.html reveals heading marks on the active line', () => {
  const html = readIndexHtml();
  // Both classes must appear together — order may vary across browsers, but
  // the descendant selector pairs them as ".cm-activeLine .cm-md-heading-mark".
  assert.ok(
    html.includes('.cm-activeLine .cm-md-heading-mark'),
    'must have .cm-activeLine .cm-md-heading-mark rule for active-line marker visibility'
  );
});

test('Stage 11.4: index.html contains .cm-md-h1 through .cm-md-h6 CSS rules', () => {
  const html = readIndexHtml();
  for (let n = 1; n <= 6; n++) {
    assert.ok(html.includes('.cm-md-h' + n), 'must have .cm-md-h' + n + ' CSS rule');
  }
});

test('Stage 11.4: obsolete widget CSS classes are removed', () => {
  const html = readIndexHtml();
  assert.ok(!html.includes('.cm6-heading-widget'),
    'old .cm6-heading-widget rule must be removed');
  assert.ok(!html.includes('.cm6-paragraph-widget'),
    'old .cm6-paragraph-widget rule must be removed');
});

test('Stage 11.5: index.html contains inline live-styling content classes', () => {
  const html = readIndexHtml();
  assert.ok(html.includes('.cm-md-bold'),        'must have .cm-md-bold rule');
  assert.ok(html.includes('.cm-md-italic'),      'must have .cm-md-italic rule');
  assert.ok(html.includes('.cm-md-inline-code'), 'must have .cm-md-inline-code rule');
});

test('Stage 11.5: index.html contains shared .cm-md-syntax marker class', () => {
  const html = readIndexHtml();
  assert.ok(html.includes('.cm-md-syntax'),
    'must have .cm-md-syntax base rule (shared by emphasis/code markers)');
});

test('Stage 11.5: index.html reveals inline syntax markers on the active line', () => {
  const html = readIndexHtml();
  assert.ok(html.includes('.cm-activeLine .cm-md-syntax'),
    'must have .cm-activeLine .cm-md-syntax rule for active-line marker visibility');
});

test('Stage 11.7: index.html contains .cm-md-link-text rule', () => {
  const html = readIndexHtml();
  assert.ok(html.includes('.cm-md-link-text'),
    'must have .cm-md-link-text CSS rule for inline link styling');
});

test('Stage 11.7: .cm-md-link-text rule includes text-decoration', () => {
  const html = readIndexHtml();
  // Locate the .cm-md-link-text rule body and assert it sets text-decoration.
  const idx = html.indexOf('.cm-md-link-text');
  assert.ok(idx >= 0, 'rule must exist');
  const ruleBlock = html.slice(idx, idx + 400);
  assert.ok(ruleBlock.includes('text-decoration'),
    '.cm-md-link-text must use text-decoration to give link-like styling');
});

test('Stage 11.8: index.html contains .cm-md-list-mark rule', () => {
  const html = readIndexHtml();
  assert.ok(html.includes('.cm-md-list-mark'),
    'must have .cm-md-list-mark CSS rule for dimmed list markers');
});

test('Stage 11.8: index.html contains .cm-md-quote-mark rule', () => {
  const html = readIndexHtml();
  assert.ok(html.includes('.cm-md-quote-mark'),
    'must have .cm-md-quote-mark CSS rule for dimmed blockquote markers');
});

test('Stage 11.9: index.html contains .cm-md-fenced-code-mark rule', () => {
  const html = readIndexHtml();
  assert.ok(html.includes('.cm-md-fenced-code-mark'),
    'must have .cm-md-fenced-code-mark CSS rule for dimmed fence delimiters');
});

test('Stage 11.9: index.html contains .cm-md-fenced-code-info rule', () => {
  const html = readIndexHtml();
  assert.ok(html.includes('.cm-md-fenced-code-info'),
    'must have .cm-md-fenced-code-info CSS rule for dimmed code-block language info');
});

// ── Stage 12.1: bottom scroll padding for the CM6 editor ─────────────────
//
// The Write-mode CM6 editor (used by both ?writeEngine=cm6 and
// ?writeEngine=hybrid-cm6) gets a bottom padding so the last line of a long
// document can be manually scrolled up to roughly the middle of the viewport.
// CSS-only — no document mutation, no save-payload effect, no dirty-state
// effect. Acceptance criterion is "manual scroll past end"; automatic
// cursor centering on Cmd+End is intentionally NOT a contract.

test('Stage 12.1: index.html scopes #hybridWritePane .cm-content padding-bottom: 50vh', () => {
  const html = readIndexHtml();
  // Bind the entire rule in one regex so we pin: (a) the scoped selector,
  // (b) padding-bottom inside that block, and (c) the exact 50vh value.
  // [\s\S]*? is non-greedy so the match cannot escape the closing brace.
  const re = /#hybridWritePane\s+\.cm-content\s*\{[\s\S]*?padding-bottom\s*:\s*50vh\s*;?[\s\S]*?\}/;
  assert.ok(re.test(html),
    'must contain "#hybridWritePane .cm-content { … padding-bottom: 50vh; … }"');
});

// ── Stage 12.2: hide CM6 line-number gutter and active-line background ──────
//
// Two scoped CSS-only overrides on the Write pane:
//   - #hybridWritePane .cm-gutters    { display: none; }
//   - #hybridWritePane .cm-activeLine { background: transparent !important; }
//
// CSS-only on purpose. The CM6 chrome (lineNumbers, highlightActiveLine,
// highlightActiveLineGutter) stays registered in lib/cm6-entry.js so the
// .cm-activeLine class continues to be applied to the cursor's line. That
// class is the trigger for the Stage 11.4 / 11.5 marker-reveal rules
// (.cm-activeLine .cm-md-heading-mark, .cm-activeLine .cm-md-syntax) — those
// must keep working in ?writeEngine=hybrid-cm6.
//
// Block-bound regex assertions (same convention as Stage 12.1) bind the
// scoped selector and the expected property in a single match.

test('Stage 12.2: index.html scopes #hybridWritePane .cm-gutters display: none', () => {
  const html = readIndexHtml();
  // Block-bound: [^}]* cannot cross a closing brace, so the property must
  // appear inside this exact rule's body — not in some later rule (e.g.,
  // .toast-preview-mount also sets display: none).
  const re = /#hybridWritePane\s+\.cm-gutters\s*\{[^}]*display\s*:\s*none\s*;?[^}]*\}/;
  assert.ok(re.test(html),
    'must contain "#hybridWritePane .cm-gutters { … display: none; … }"');
});

test('Stage 12.2: index.html scopes #hybridWritePane .cm-activeLine background: transparent !important', () => {
  const html = readIndexHtml();
  // Block-bound: the scoped selector and the full `background: transparent
  // !important` declaration (or the -color shorthand) must appear together
  // inside this rule's body. !important is load-bearing here — without it,
  // CM6's injected theme selector wins and the line-wide background remains
  // visible. [^}]* prevents the match from leaking into a later CSS rule.
  const re = /#hybridWritePane\s+\.cm-activeLine\s*\{[^}]*background(?:-color)?\s*:\s*transparent\s*!important[^}]*\}/;
  assert.ok(re.test(html),
    'must contain "#hybridWritePane .cm-activeLine { … background: transparent !important … }"');
});

test('Stage 12.2: marker-reveal CSS contract intact (.cm-activeLine .cm-md-heading-mark / .cm-md-syntax keep display: inline)', () => {
  const html = readIndexHtml();
  // Load-bearing regression: the Stage 12.2 active-line background override
  // must NOT disturb the existing marker-reveal rules. Bind selector AND
  // `display: inline` inside each rule's body using [^}]* so the match
  // cannot escape into a later CSS block.
  const headingRe = /\.cm-activeLine\s+\.cm-md-heading-mark\s*\{[^}]*display\s*:\s*inline[^}]*\}/;
  const syntaxRe  = /\.cm-activeLine\s+\.cm-md-syntax\s*\{[^}]*display\s*:\s*inline[^}]*\}/;
  assert.ok(headingRe.test(html),
    '.cm-activeLine .cm-md-heading-mark must still set display: inline (Stage 11.4 marker reveal)');
  assert.ok(syntaxRe.test(html),
    '.cm-activeLine .cm-md-syntax must still set display: inline (Stage 11.5 marker reveal)');
});

// ── Stage 13: editor text-size CSS contract ─────────────────────────────────
//
// Source-regex assertions that the production CSS exposes the
// --editor-font-size variable on :root and consumes it from the live
// surfaces (.hybrid-write-pane root for Write; Toast UI preview body for
// Preview). Block-bound [^}]* prevents the property match from leaking
// outside its CSS rule.

test('Stage 13: :root declares --editor-font-size: 15px', () => {
  const html = readIndexHtml();
  const re = /:root\s*\{[^}]*--editor-font-size\s*:\s*15px\s*;?[^}]*\}/;
  assert.ok(re.test(html),
    'must contain ":root { … --editor-font-size: 15px; … }"');
});

test('Stage 13: .hybrid-write-pane consumes var(--editor-font-size, …) for font-size', () => {
  const html = readIndexHtml();
  // Match the .hybrid-write-pane base block (not .hybrid-write-pane.is-hidden);
  // the bare class selector is followed by `{` after optional whitespace.
  const re = /\.hybrid-write-pane\s*\{[^}]*font-size\s*:\s*var\(\s*--editor-font-size[^}]*\}/;
  assert.ok(re.test(html),
    '.hybrid-write-pane must declare font-size: var(--editor-font-size, …) so CM6/.cm-content and legacy hybrid .hybrid-active-textarea (font: inherit) both scale');
});

test('Stage 13: Toast UI Preview body consumes var(--editor-font-size, …)', () => {
  const html = readIndexHtml();
  // The rule must reference both Toast UI preview surface selectors AND set
  // font-size: var(--editor-font-size, …) inside the SAME block. Allow either
  // a comma-separated grouped selector or two adjacent rules; this regex
  // accepts the grouped form.
  const re = /\.toast-preview-mount\s+\.toastui-editor-md-preview\s*,\s*\.toast-preview-mount\s+\.toastui-editor-contents\s*\{[^}]*font-size\s*:\s*var\(\s*--editor-font-size[^}]*\}/;
  assert.ok(re.test(html),
    'Toast UI preview must consume var(--editor-font-size, …) on both .toastui-editor-md-preview and .toastui-editor-contents');
});

test('Stage 13: Toast UI Preview headings h1–h6 use em-relative font-size so they scale with --editor-font-size', () => {
  const html = readIndexHtml();
  // Toast UI ships fixed-px heading sizes on .toastui-editor-contents h1…h6
  // that would otherwise override container inheritance. The Stage 13 rules
  // must re-declare them with em-based sizes scoped under .toast-preview-mount
  // so headings scale alongside body text when the editor font-size changes.
  // For each level, bind selector + em-form font-size in one block-bound regex.
  for (let n = 1; n <= 6; n++) {
    const re = new RegExp(
      `\\.toast-preview-mount\\s+\\.toastui-editor-contents\\s+h${n}\\s*\\{[^}]*font-size\\s*:\\s*[\\d.]+em[^}]*\\}`
    );
    assert.ok(re.test(html),
      `.toast-preview-mount .toastui-editor-contents h${n} must declare an em-relative font-size so it scales with --editor-font-size`);
  }
});

test('Stage 13: Toast UI Preview headings h1–h6 use a unitless line-height so the line box scales with heading font-size', () => {
  const html = readIndexHtml();
  // Toast UI ships fixed-px line-height on .toastui-editor-contents h1…h6
  // (e.g., h1: 28px). At larger zoom levels, scaled heading text inside a
  // frozen line-height box gets cramped/clipped. The Stage 13 rules must
  // override line-height with a unitless value (no px / em / rem) for each
  // level, scoped under .toast-preview-mount.
  //
  // Match strategy: locate every CSS rule that targets the level (either
  // alone or grouped) inside the .toast-preview-mount .toastui-editor-contents
  // h<N> namespace; require at least one such rule whose body declares
  // line-height with a plain numeric value (no px / em / rem suffix).
  for (let n = 1; n <= 6; n++) {
    // Block-bound regex: a rule whose selector list contains the scoped h<N>
    // selector AND whose body declares line-height: <number> (no unit).
    // The `[^{};]*` guards keep the line-height value tight (no semicolon,
    // no nested rule); the `(?:em|px|rem|%|pt|ex|ch|vh|vw)` exclusion ensures
    // a unitless value, not a frozen-px one.
    const re = new RegExp(
      `\\.toast-preview-mount\\s+\\.toastui-editor-contents\\s+h${n}\\b[^{}]*\\{[^}]*line-height\\s*:\\s*[\\d.]+\\s*(?:;|\\})`
    );
    assert.ok(re.test(html),
      `.toast-preview-mount .toastui-editor-contents h${n} must declare a unitless line-height (e.g., 1.2) so the line box scales with heading font-size`);
  }
});

// ── Stage 13.1: Preview heading spacing fix at max editor zoom ─────────────
//
// Stage 13 made Preview heading font-size and line-height em-relative, but
// Toast UI's bundled heading margins and H1/H2 padding-bottom remained in
// fixed px. At max --editor-font-size, scaled headings overrun their own
// underline (H1/H2) and visually touch each other (stacked H1–H6). Stage 13.1
// adds em-relative margin-top, margin-bottom, and (for H1/H2) padding-bottom
// scoped under .toast-preview-mount .toastui-editor-contents.
//
// Toast UI's bundled border-bottom values (H1: 3px double #999, H2: 1px solid
// #dbdbdb) are intentionally NOT redeclared — duplicating them would force us
// to pick the color and would diverge from any future theme update. Test D
// below defends that decision by asserting the new scoped rules do not
// contain a border-bottom declaration.
//
// Regex shape: value-tight terminator `\s*(?:;|\})` requires the em value to
// end with a property semicolon or the rule's closing brace, so malformed
// values like `1empx` cannot match.

test('Stage 13.1: Preview headings h1–h6 declare em-relative margin-top', () => {
  const html = readIndexHtml();
  for (let n = 1; n <= 6; n++) {
    const re = new RegExp(
      `\\.toast-preview-mount\\s+\\.toastui-editor-contents\\s+h${n}\\b[^{}]*\\{[^}]*margin-top\\s*:\\s*[\\d.]+em\\s*(?:;|\\})`
    );
    assert.ok(re.test(html),
      `.toast-preview-mount .toastui-editor-contents h${n} must declare an em-relative margin-top so the gap above scales with --editor-font-size`);
  }
});

test('Stage 13.1: Preview headings h1–h6 declare em-relative margin-bottom', () => {
  const html = readIndexHtml();
  for (let n = 1; n <= 6; n++) {
    const re = new RegExp(
      `\\.toast-preview-mount\\s+\\.toastui-editor-contents\\s+h${n}\\b[^{}]*\\{[^}]*margin-bottom\\s*:\\s*[\\d.]+em\\s*(?:;|\\})`
    );
    assert.ok(re.test(html),
      `.toast-preview-mount .toastui-editor-contents h${n} must declare an em-relative margin-bottom so the gap below scales with --editor-font-size`);
  }
});

test('Stage 13.1: Preview headings h1 and h2 declare em-relative padding-bottom (underline gap)', () => {
  const html = readIndexHtml();
  for (const n of [1, 2]) {
    const re = new RegExp(
      `\\.toast-preview-mount\\s+\\.toastui-editor-contents\\s+h${n}\\b[^{}]*\\{[^}]*padding-bottom\\s*:\\s*[\\d.]+em\\s*(?:;|\\})`
    );
    assert.ok(re.test(html),
      `.toast-preview-mount .toastui-editor-contents h${n} must declare an em-relative padding-bottom so the gap to its underline scales with --editor-font-size`);
  }
});

test('Stage 13.1: scoped Preview h1/h2 rules MUST NOT redeclare border-bottom (Toast UI defaults travel through unchanged)', () => {
  const html = readIndexHtml();
  // Toast UI bundles h1 { border-bottom: 3px double #999 } and
  // h2 { border-bottom: 1px solid #dbdbdb }. Re-declaring would duplicate
  // the color/style and would diverge from any future theme update. Walk
  // every scoped rule whose selector list contains the level and assert
  // the rule body does not declare border-bottom. Global flag so multiple
  // matching blocks are all checked.
  for (const level of ['h1', 'h2']) {
    const re = new RegExp(
      `\\.toast-preview-mount\\s+\\.toastui-editor-contents\\s+${level}\\b[^{}]*\\{([^}]*)\\}`,
      'g'
    );
    let match;
    while ((match = re.exec(html)) !== null) {
      const body = match[1];
      assert.ok(!/border-bottom\s*:/.test(body),
        `Stage 13.1 must not declare border-bottom in any scoped Preview ${level} rule; Toast UI's bundled value must travel through unchanged`);
    }
  }
});

test('Stage 13: source contains literal storage key "markdownVault.editorFontSize"', () => {
  const html = readIndexHtml();
  assert.ok(html.includes("'markdownVault.editorFontSize'") || html.includes('"markdownVault.editorFontSize"'),
    'source must reference the literal storage-key string for the font-size preference');
});

// ── Stage 11.11: hybrid-cm6 default-readiness host-integration tests ────────
//
// These tests exercise host-level wiring (save payload, dirty state, close
// guard, Save All, note switching) against the hybrid-cm6 engine using the
// renderer harness's Cm6HybridView mock. Real CM6 state-level coverage and
// long-document smoke live in test/cm6-write-view/hybrid-cm6-readiness.test.js.
//
// Stage 11.11 must not change product behavior; these are tests-only changes
// to prove parity with the cm6 engine before any future default flip.

// ── Section A: engine boot / selection ──
//
// A.1 default-cm6 boot is already covered above (renderer-boot test "default
// boot still uses CM6, not Cm6HybridView" at the Stage 11.2 boot section).
// A.2 ?writeEngine=hybrid-cm6 boot is covered there as well.
// A.5 ?writeEngine=hybrid → HybridWriteView is covered at the Stage 5.x
// section. A.3 and A.4 are the new gaps.

test('Stage 11.11/A.3: localStorage hybrid-cm6 boots Cm6HybridView when no query is present', () => {
  const { calls } = makeRendererHarness({ storageValue: 'hybrid-cm6' });
  assert.deepEqual(calls.resolvedEngines, ['hybrid-cm6']);
  assert.equal(calls.cm6HybridConstructed, 1, 'Cm6HybridView must be constructed');
  assert.equal(calls.cm6Constructed,       0, 'normal CM6 must not be constructed');
  assert.equal(calls.hybridConstructed,    0, 'old HybridWriteView must not be constructed');
});

test('Stage 11.11/A.4: ?writeEngine=cm6 overrides localStorage hybrid-cm6', () => {
  const { calls } = makeRendererHarness({
    search: '?writeEngine=cm6',
    storageValue: 'hybrid-cm6',
  });
  assert.deepEqual(calls.resolvedEngines, ['cm6']);
  assert.equal(calls.cm6Constructed,       1, 'URL must win — normal CM6 is constructed');
  assert.equal(calls.cm6HybridConstructed, 0, 'Cm6HybridView must not be constructed');
});

// ── Section B: raw Markdown save payload ──

test('Stage 11.11/B.1-3: hybrid-cm6 save payload is raw Markdown across all live-styled constructs', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=hybrid-cm6',
    vaultNotes: [{
      id: 'vault:r.md', title: 'Readiness',
      body: '# Readiness\n\nseed',
      fileName: 'r.md', relativePath: 'r.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  // A document that exercises every Stage 11.4–11.9 live-styled construct.
  const raw = [
    '# Heading 1',
    '',
    'Body with **bold**, *italic*, and `inline code`.',
    '',
    '[OpenAI](https://openai.com)',
    '',
    '- bullet one',
    '- bullet two',
    '',
    '> a blockquote',
    '',
    '```js',
    'let x = 1;',
    '```',
    '',
  ].join('\n');
  calls.cm6HybridAdapter.text = raw;
  calls.cm6HybridOnChange(raw);

  await elements.get('saveNoteButton').fireAsync('click');

  assert.equal(calls.saveNotePayloads.length, 1, 'one save must occur');
  const body = calls.saveNotePayloads[0].note.body;

  // B.1+B.2 — payload IS the raw Markdown.
  assert.equal(body, raw, 'save payload must be the raw Markdown verbatim');
  assert.ok(body.includes('# '),               'payload preserves "#" heading marker');
  assert.ok(body.includes('**bold**'),         'payload preserves "**" bold markers');
  assert.ok(body.includes('[OpenAI](https://openai.com)'),
    'payload preserves inline link "[text](url)" syntax');
  assert.ok(body.includes('\n- bullet one'),   'payload preserves "-" list marker');
  assert.ok(body.includes('\n> a blockquote'), 'payload preserves ">" blockquote marker');
  assert.ok(body.includes('```'),              'payload preserves "```" fence delimiter');

  // B.3 — payload contains no rendered styling artifacts.
  assert.ok(!body.includes('cm-md-'),   'no Decoration class names');
  assert.ok(!body.includes('<h1'),      'no rendered heading HTML');
  assert.ok(!body.includes('<strong'),  'no rendered <strong>');
  assert.ok(!body.includes('<em'),      'no rendered <em>');
  assert.ok(!body.includes('<code'),    'no rendered <code>');
  assert.ok(!body.includes('<a '),      'no rendered <a>');
  assert.ok(!body.includes('href='),    'no link href attribute');
  assert.ok(!body.includes('<ul'),      'no rendered <ul>');
  assert.ok(!body.includes('<blockquote'), 'no rendered <blockquote>');
});

// ── Section C: dirty-state parity ──

test('Stage 11.11/C.1: editing body in hybrid-cm6 marks the note dirty', () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=hybrid-cm6' });
  elements.get('newNoteButton').fire('click');

  // Pre-edit: untouched draft is not dirty.
  let summary = 'unset';
  calls.closeRequestHandler((s) => { summary = s; });
  assert.deepEqual(summary, { count: 0, hasDraft: false, hasDirtyVault: false });

  calls.cm6HybridOnChange('Real content typed by the user.');

  let postSummary = 'unset';
  calls.closeRequestHandler((s) => { postSummary = s; });
  assert.deepEqual(postSummary, { count: 1, hasDraft: true, hasDirtyVault: false },
    'meaningful onChange in hybrid-cm6 must mark the draft dirty');
});

test('Stage 11.11/C.2: setText / load in hybrid-cm6 does NOT mark the note dirty', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=hybrid-cm6',
    vaultNotes: [{
      id: 'vault:a.md', title: 'A', body: '# A\n\nbody',
      fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  // Loading the vault routed setText through the adapter; nothing should be dirty.
  assert.ok(calls.cm6HybridSetText.length >= 1, 'setText must have been used to load the note');
  let summary = 'unset';
  calls.closeRequestHandler((s) => { summary = s; });
  assert.deepEqual(summary, { count: 0, hasDraft: false, hasDirtyVault: false },
    'loading via setText must not mark anything dirty');
});

test('Stage 11.11/C.3: editing title in hybrid-cm6 marks the note dirty', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=hybrid-cm6',
    vaultNotes: [{
      id: 'vault:a.md', title: 'A', body: '# A\n\nbody',
      fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  elements.get('titleInput').value = 'A renamed';
  elements.get('titleInput').fire('input');

  let summary = 'unset';
  calls.closeRequestHandler((s) => { summary = s; });
  assert.deepEqual(summary, { count: 1, hasDraft: false, hasDirtyVault: true },
    'title-only edit must mark the vault note dirty');
});

test('Stage 11.11/C.4: returning body to baseline in hybrid-cm6 clears dirty', async () => {
  // dirty-state.test.js already proves the underlying body===loadedBody rule
  // (test "vault note returning to original body via undo is NOT dirty"). This
  // test pins the same semantic through the hybrid-cm6 onChange wiring.
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=hybrid-cm6',
    vaultNotes: [{
      id: 'vault:a.md', title: 'A', body: '# A\n\nbody',
      fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  // Edit → dirty
  calls.cm6HybridOnChange('# A\n\nbody edited');
  let dirty = 'unset';
  calls.closeRequestHandler((s) => { dirty = s; });
  assert.deepEqual(dirty, { count: 1, hasDraft: false, hasDirtyVault: true });

  // Revert to baseline → not dirty
  calls.cm6HybridOnChange('# A\n\nbody');
  let clean = 'unset';
  calls.closeRequestHandler((s) => { clean = s; });
  assert.deepEqual(clean, { count: 0, hasDraft: false, hasDirtyVault: false },
    'returning body to loadedBody clears dirty in hybrid-cm6');
});

// ── Section D: close guard parity ──
//
// D.3 (save/discard flow) and D.4 (failed-summary unsafe behavior) are
// engine-agnostic and already covered by Stage 6.3A tests "responder reports
// null when DirtyState is missing" and "responder reports null when
// summarizeDirty throws". The summary responder is wired once at boot and
// has no per-engine code path. D.1 + D.2 below pin the boot wiring against
// hybrid-cm6 explicitly.

test('Stage 11.11/D.1: dirty hybrid-cm6 note triggers a non-clean close summary', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=hybrid-cm6',
    vaultNotes: [{
      id: 'vault:a.md', title: 'A', body: '# A',
      fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  calls.cm6HybridOnChange('# A edited via hybrid-cm6');

  let summary = 'unset';
  calls.closeRequestHandler((s) => { summary = s; });
  assert.deepEqual(summary, { count: 1, hasDraft: false, hasDirtyVault: true },
    'dirty hybrid-cm6 vault note must surface in the close-request summary');
});

test('Stage 11.11/D.2: clean hybrid-cm6 note produces a clean close summary', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=hybrid-cm6',
    vaultNotes: [{
      id: 'vault:a.md', title: 'A', body: '# A',
      fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  let summary = 'unset';
  calls.closeRequestHandler((s) => { summary = s; });
  assert.deepEqual(summary, { count: 0, hasDraft: false, hasDirtyVault: false },
    'fresh-loaded hybrid-cm6 vault note must produce a clean summary');
});

// ── Section E: Save All parity ──

test('Stage 11.11/E.1+E.3: Save All in hybrid-cm6 saves raw Markdown for multiple dirty notes', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=hybrid-cm6',
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A\n\norig-a',
        fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B\n\norig-b',
        fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');

  // Edit A first.
  calls.cm6HybridAdapter.text = '# A\n\n**edited-a** with [link](https://x.test)';
  calls.cm6HybridOnChange(calls.cm6HybridAdapter.text);

  // Switch to B and edit it too.
  elements.get('noteList').children[1].fire('click');
  calls.cm6HybridAdapter.text = '# B\n\n- bullet\n\n> quoted-edited-b';
  calls.cm6HybridOnChange(calls.cm6HybridAdapter.text);

  const result = await invokeSaveAllHandler(calls);

  // E.1
  assert.equal(result.ok, true,         'save-all must succeed');
  assert.equal(result.savedCount, 2,    'both dirty notes must be saved');
  assert.equal(calls.saveNotePayloads.length, 2);
  assert.deepEqual(
    calls.saveNotePayloads.map((p) => p.note.relativePath),
    ['a.md', 'b.md'],
    'snapshot order preserved in save-all'
  );

  // E.3 — payloads contain raw Markdown only.
  for (const p of calls.saveNotePayloads) {
    assert.ok(!p.note.body.includes('cm-md-'),  'no Decoration class names in any save-all payload');
    assert.ok(!p.note.body.includes('<h1'),     'no rendered <h1>');
    assert.ok(!p.note.body.includes('<strong'), 'no rendered <strong>');
    assert.ok(!p.note.body.includes('<a '),     'no rendered <a>');
  }
  assert.match(calls.saveNotePayloads[0].note.body, /\*\*edited-a\*\*/);
  assert.match(calls.saveNotePayloads[0].note.body, /\[link\]\(https:\/\/x\.test\)/);
  assert.match(calls.saveNotePayloads[1].note.body, /^- bullet$/m);
  assert.match(calls.saveNotePayloads[1].note.body, /^> quoted-edited-b$/m);
});

test('Stage 11.11/E.2: Save All in hybrid-cm6 blocks an empty-title draft', async () => {
  // Mirrors Stage 10.2 save-all empty-title test, pinned to hybrid-cm6.
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=hybrid-cm6' });
  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('newNoteButton').fire('click');
  calls.cm6HybridAdapter.text = 'Important content without a title.';
  calls.cm6HybridOnChange('Important content without a title.');

  const result = await invokeSaveAllHandler(calls);

  assert.equal(result.ok, false, 'save-all must fail when a dirty draft has no title');
  assert.equal(calls.saveNotePayloads.length, 0,
    'save IPC must not run for an empty-title draft in hybrid-cm6');
});

test('Stage 11.11/E.4: Save All in hybrid-cm6 final dirty summary is clean only after success', async () => {
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=hybrid-cm6',
    vaultNotes: [{
      id: 'vault:a.md', title: 'A', body: '# A\n\norig',
      fileName: 'a.md', relativePath: 'a.md',
    }],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  calls.cm6HybridAdapter.text = '# A\n\nedited';
  calls.cm6HybridOnChange(calls.cm6HybridAdapter.text);

  // Pre-condition: dirty.
  let preSummary = 'unset';
  calls.closeRequestHandler((s) => { preSummary = s; });
  assert.deepEqual(preSummary, { count: 1, hasDraft: false, hasDirtyVault: true });

  const result = await invokeSaveAllHandler(calls);
  assert.equal(result.ok, true);

  // Post-condition: clean only after a successful save+refresh.
  let postSummary = 'unset';
  calls.closeRequestHandler((s) => { postSummary = s; });
  assert.deepEqual(postSummary, { count: 0, hasDraft: false, hasDirtyVault: false },
    'after Save All success in hybrid-cm6, dirty summary must be clean');
});

// ── Section F.1: note-switching preserves text in hybrid-cm6 ──
// F.2–F.4 (real-CM6 state round-trip, cursor-only does not fire onChange after
// live decorations) live in test/cm6-write-view/hybrid-cm6-readiness.test.js.

test('Stage 11.11/F.1: A → B → A in hybrid-cm6 preserves the outgoing edit', async () => {
  // Like the CM6 engine, hybrid-cm6 exposes getState / setState — so the host
  // caches per-note EditorState and restores it via setState on return rather
  // than re-running setText. We verify by reading the adapter's resulting text
  // (the mock's setState writes state.doc back into adapter.text).
  const { calls, elements } = makeRendererHarness({
    search: '?writeEngine=hybrid-cm6',
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# Note A',
        fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# Note B',
        fileName: 'b.md', relativePath: 'b.md' },
    ],
  });
  await elements.get('chooseVaultButton').fireAsync('click');
  assert.equal(calls.cm6HybridSetText.at(-1), '# Note A',
    'A loaded via setText on initial select');

  // Edit A through the adapter buffer (mimicking unflushed CM6 state) and
  // also fire onChange so the renderer captures it.
  calls.cm6HybridAdapter.text = '# Note A edited via hybrid-cm6';
  calls.cm6HybridOnChange(calls.cm6HybridAdapter.text);

  // Switch to B → outgoing flush + B loads via setText.
  elements.get('noteList').children[1].fire('click');
  assert.equal(calls.cm6HybridSetText.at(-1), '# Note B',
    'B loaded via setText on switch');
  assert.equal(calls.cm6HybridAdapter.text, '# Note B', 'adapter now shows B');

  // Switch back to A — the edited body must come back via setState.
  elements.get('noteList').children[0].fire('click');
  assert.equal(calls.cm6HybridAdapter.text, '# Note A edited via hybrid-cm6',
    'A’s in-memory edit must be restored on return through setState');
  assert.ok(calls.cm6HybridSetState.length >= 1,
    'host must use setState (not setText) to restore A’s cached editor state');
});
