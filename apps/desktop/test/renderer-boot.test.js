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

function makeElement(tag = 'div', id = '') {
  const el = {
    tagName: tag.toUpperCase(),
    id,
    className: '',
    _innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    children: [],
    attributes: {},
    handlers: {},
    classList: null,
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

function makeRendererHarness({ search = '', storageValue = null, vaultNotes = [] } = {}) {
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
    'seedDemoVaultButton',
    'templateSelect',
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
    'moreButton',
    'moreMenu',
  ];

  const elements = new Map();
  for (const id of ids) {
    const element = makeElement(id === 'titleInput' || id === 'searchInput' ? 'input' : 'div', id);
    element.classList = makeClassList(element);
    elements.set(id, element);
  }

  elements.get('templateSelect').value = 'blank';

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

  const _toastPreviewMount = elements.get('toastPreviewMount');
  _toastPreviewMount.scrollTop = 0;
  _toastPreviewMount.scrollHeight = 0;
  _toastPreviewMount.clientHeight = 0;
  _toastPreviewMount._previewScrollEl = _previewScrollEl;
  _toastPreviewMount.querySelector = function (selector) {
    return selector === '.toastui-editor-md-preview' ? _previewScrollEl : null;
  };
  // hybridWritePane is the Write-side scroll container for both Hybrid and
  // CM6 (the CM6 view mounts inside it via Cm6WriteView's `parent: parent`,
  // and its outer pane's `overflow: auto` handles scrolling).
  const _hybridWritePane = elements.get('hybridWritePane');
  _hybridWritePane.scrollTop = 0;
  _hybridWritePane.scrollHeight = 0;
  _hybridWritePane.clientHeight = 0;

  const documentHandlers = {};
  const document = {
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
  };

  const storage = {
    getItem(key) {
      assert.equal(key, WriteEngine.STORAGE_KEY);
      return storageValue;
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
      await stopWatching();
      setCurrentVaultPath('/fake-vault');
      updateDisplay();
      await startWatching();
      const refreshed = await refreshVaultNotes('', false);
      if (refreshed) {
        setStatus('ready', 'Vault loaded');
      }
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

  return { calls, elements, window, documentHandlers, flushRaf, flushTimers };
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

test('hybrid-backed adapter still uses setText, getText, and exitWriteMode for boot and Preview', () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=hybrid' });

  assert.equal(calls.hybridSetText.length, 1, 'initial render should load the selected note');
  assert.match(calls.hybridSetText[0], /^Tags: mcp, ingest\nSource: manual\n\n# Day 25/);
  assert.equal(calls.hybridExitWriteMode, 1, 'adapter.setText exits write mode before loading text');
  assert.equal(calls.toastSetMarkdown.at(-1), calls.hybridSetText[0]);

  elements.get('previewModeButton').fire('click');

  assert.equal(calls.hybridGetText, 1, 'Preview reads from the hybrid adapter');
  assert.equal(calls.hybridExitWriteMode, 2, 'Preview flushes the hybrid adapter before rendering');
  assert.equal(calls.toastSetMarkdown.at(-1), calls.hybridSetText[0]);
  assert.ok(calls.toastEmits.includes('changePreviewTabPreview'));
});

test('CM6-backed adapter uses setText, getText, and exitWriteMode for boot and Preview', () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=cm6' });

  assert.equal(calls.cm6SetText.length, 1, 'initial render should load the selected note through setText');
  assert.match(calls.cm6SetText[0], /^Tags: mcp, ingest\nSource: manual\n\n# Day 25/);
  assert.equal(calls.cm6ExitWriteMode, 0, 'CM6 construction starts empty and loads through setText');
  assert.equal(calls.toastSetMarkdown.at(-1), calls.cm6SetText[0]);

  elements.get('previewModeButton').fire('click');

  assert.equal(calls.cm6GetText, 1, 'Preview reads from the liveEditorInstance CM6 adapter');
  assert.equal(calls.cm6ExitWriteMode, 1, 'Preview flushes through the liveEditorInstance adapter');
  assert.equal(calls.toastSetMarkdown.at(-1), calls.cm6SetText[0]);
  assert.ok(calls.toastEmits.includes('changePreviewTabPreview'));
});

test('CM6 onChange uses the same preview sync, note body, note list, and draft status behavior', () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=cm6' });
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

test('save is blocked: empty-title draft collides with existing untitled-note.md', async () => {
  const { calls, elements } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:untitled-note.md', title: 'Untitled note', body: '#', fileName: 'untitled-note.md', relativePath: 'untitled-note.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  elements.get('newNoteButton').fire('click');
  setDraftTitle(elements, '');

  await assertSaveBlockedWithConflict({ elements, calls, expectedFileName: 'untitled-note.md' });
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

  // Sanity: boot landed on the seeded note with non-empty content.
  assert.notEqual(elements.get('docWords').textContent, '0 words');

  // Type something into the current note so we can prove the switch resets.
  calls.cm6OnChange('temporary text');
  assert.equal(elements.get('docWords').textContent, '2 words');

  // Switching to a new blank draft (templateSelect is 'blank' in the harness)
  // routes through renderApp and should refresh readouts to the new note's
  // body — which is empty.
  elements.get('newNoteButton').fire('click');
  assert.equal(elements.get('docWords').textContent, '0 words');
  assert.equal(elements.get('docChars').textContent, '0 chars');
  assert.equal(elements.get('docLines').textContent, '0 lines');
});

test('Stage 5.2: ?writeEngine=hybrid shows engine label "Hybrid" and readouts reflect Hybrid onChange', () => {
  const { calls, elements } = makeRendererHarness({ search: '?writeEngine=hybrid' });

  assert.equal(elements.get('docEngine').textContent, 'Hybrid');

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

test('Stage 5.3: draft row renders the Draft badge and tag chips for the seeded draft', () => {
  const { elements } = makeRendererHarness();

  // Default seed is one draft note with tags ['mcp', 'ingest'].
  const row = elements.get('noteList').children[0];
  assert.ok(row, 'expected at least one row in the note list');
  const html = row.innerHTML;

  assert.ok(html.includes('note-badge note-badge-draft'), 'draft row should render the Draft badge');
  assert.ok(html.includes('>Draft<'), 'Draft badge label should appear in the markup');
  assert.ok(!html.includes('note-badge-ai'), 'draft row should not render the AI badge');

  assert.ok(html.includes('class="note-tag">#mcp<'),    'first tag chip should render');
  assert.ok(html.includes('class="note-tag">#ingest<'), 'second tag chip should render');
  assert.ok(!html.includes('note-tag-overflow'), '2 tags (≤3) should not render an overflow chip');
});

test('Stage 5.3: when tag chips render, the meta line drops the duplicate "tags: ..." segment', () => {
  const { elements } = makeRendererHarness();

  const row = elements.get('noteList').children[0];
  const html = row.innerHTML;

  // The seeded draft has tags ['mcp', 'ingest']. They should appear as
  // chips (asserted above) but not also be repeated as text in the meta.
  assert.ok(!html.includes('tags: mcp, ingest'), 'meta line should not duplicate tags rendered as chips');
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
