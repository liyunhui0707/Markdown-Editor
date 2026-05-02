/* Renderer boot wiring tests for index.html.
   Run: node --test test/renderer-boot.test.js

   These tests execute the real inline boot script against a small fake
   renderer environment. They pin Step 3B behavior: HybridWriteView remains the
   default, while the production CM6 adapter is activated only when the write
   engine resolver explicitly selects 'cm6'. */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');
const vm       = require('node:vm');

const WriteEngine = require('../lib/write-engine');
const FileName    = require('../lib/file-name');

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
    this.setMarkdown = (text) => {
      calls.toastSetMarkdown.push(text);
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
  const persistedVaultNotes = vaultNotes.map((note) => ({
    frontmatter: { tags: [], source: '', ...(note.frontmatter || {}) },
    aiImported: false,
    fileName: '',
    relativePath: '',
    source: 'vault',
    meta: 'File note',
    ...note,
  }));

  const vaultApi = {
    async loadVaultNotes(payload) {
      calls.loadVaultNotesPayloads.push(payload);
      return {
        ok: true,
        notes: persistedVaultNotes.map((note) => ({
          ...note,
          frontmatter: { ...(note.frontmatter || {}) },
        })),
      };
    },
    async saveNote(payload) {
      calls.saveNotePayloads.push(payload);
      const relativePath = payload.note.relativePath || `saved-${nextSavedFileId}.md`;
      const fileName = payload.note.fileName || relativePath.split('/').pop();
      nextSavedFileId += payload.note.relativePath ? 0 : 1;
      const savedNote = {
        id: `vault:${relativePath}`,
        title: payload.note.title,
        body: payload.note.body,
        fileName,
        relativePath,
        source: 'vault',
        aiImported: false,
        meta: 'File note',
        frontmatter: { ...(payload.note.frontmatter || {}) },
      };
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
    setTimeout() {},
    clearTimeout() {},
  };
  context.globalThis = context;
  vm.createContext(context);

  const html = readIndexHtml();
  const bootScript = getBootScript(html);
  new vm.Script(bootScript, { filename: 'index.html:inline-boot.js' }).runInContext(context);

  return { calls, elements, window, documentHandlers };
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

test('default renderer boot resolves hybrid, constructs HybridWriteView, and does not construct CM6', () => {
  const { calls } = makeRendererHarness();

  assert.deepEqual(calls.resolvedEngines, ['hybrid']);
  assert.deepEqual(calls.consoleDebug, [['[write-engine]', 'hybrid']]);
  assert.equal(calls.toastConstructed, 1);
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
  const { calls, elements } = makeRendererHarness();

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
  await assertSavingOneUnsavedDraftPreservesAnother({ engineName: 'hybrid' });
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
  await assertSavePreservesUnrelatedDirtyVaultNotes({ engineName: 'hybrid' });
});

test('save preserves unrelated dirty vault-backed notes (cm6)', async () => {
  await assertSavePreservesUnrelatedDirtyVaultNotes({
    search: '?writeEngine=cm6',
    engineName: 'cm6',
  });
});

test('save preserves both dirty vault notes AND unsaved drafts in the same flow', async () => {
  // Mixed scenario: a vault note and a draft both have unsaved edits when
  // another vault note is saved. Both must survive the refresh.
  const { calls, elements } = makeRendererHarness({
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

test('after save, the saved note remains selected and shows the saved body', async () => {
  // Selection-and-canonicality regression: after a save+refresh the just-saved
  // note must remain the selected one and `notes[i].body` for that note must
  // equal what was sent to saveNote (the disk truth). This pins the behavior
  // in the presence of the new overlay logic — the saved note must NOT be
  // routed through the in-memory overlay.
  const { calls, elements } = makeRendererHarness({
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

test('watcher refresh uses disk truth for the changed file but preserves edits in unrelated notes', async () => {
  // The watcher only knows that ONE specific file changed. Disk truth is the
  // right answer for that file (whether the change came from our save or an
  // external editor), but every other vault-backed note is unchanged on disk
  // and its in-memory edits must NOT be silently reverted. Drafts continue to
  // be auto-preserved by refreshVaultNotes.
  const { calls, elements } = makeRendererHarness({
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
  await assertSaveAndWatcherPreserveOtherDirtyVaultNotes({ engineName: 'hybrid' });
});

test('save + post-save watcher both preserve unrelated dirty vault notes (cm6)', async () => {
  await assertSaveAndWatcherPreserveOtherDirtyVaultNotes({
    search: '?writeEngine=cm6',
    engineName: 'cm6',
  });
});

test('save + watcher preserve both a dirty vault note AND an unsaved draft', async () => {
  // Mixed regression: when another note is saved, both the unrelated dirty
  // saved note and an unsaved draft must survive (1) the save refresh and
  // (2) the watcher refresh that fires for the saved file.
  const { calls, elements } = makeRendererHarness({
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

test('save succeeds: re-saving an existing vault note targets its own file', async () => {
  // Even though notes[A].relativePath = 'note.md' equals the candidate for a
  // hypothetical draft titled "Note", saving the vault note A itself is the
  // legitimate update flow and must NOT be blocked.
  const { calls, elements } = makeRendererHarness({
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

test('save succeeds: renaming a vault-backed note title does NOT block when relativePath stays', async () => {
  // The renderer sends source='vault' + the original relativePath. Main.js
  // preserves that path on the disk write, so no new file is created and no
  // collision can occur. The renderer pre-check must respect the same
  // logic — a title rename on a vault note must not be falsely blocked even
  // if the new title's derived path matches another vault note in `notes`.
  const { calls, elements } = makeRendererHarness({
    vaultNotes: [
      { id: 'vault:a.md', title: 'A', body: '# A', fileName: 'a.md', relativePath: 'a.md' },
      { id: 'vault:b.md', title: 'B', body: '# B', fileName: 'b.md', relativePath: 'b.md' },
    ],
  });

  await elements.get('chooseVaultButton').fireAsync('click');
  // A is selected. Rename its title to "B" (which would derive 'b.md',
  // matching B's relativePath). The save must still target a.md (renamer
  // semantics in main.js) and must not be blocked.
  setDraftTitle(elements, 'B');

  await elements.get('saveNoteButton').fireAsync('click');

  assert.equal(calls.saveNotePayloads.length, 1, 'vault title-rename must reach the IPC');
  assert.equal(calls.saveNotePayloads[0].note.relativePath, 'a.md',
    'renamed vault note keeps its original relativePath; only the title changes');
  assert.equal(calls.saveNotePayloads[0].note.title, 'B');
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
  await assertVaultConflictBlocksSave({ search: '', engineName: 'hybrid' });
});

test('engine parity: vault conflict blocks save (cm6)', async () => {
  await assertVaultConflictBlocksSave({ search: '?writeEngine=cm6', engineName: 'cm6' });
});

test('engine parity: draft-vs-draft conflict blocks save (hybrid)', async () => {
  await assertDraftConflictBlocksSave({ search: '', engineName: 'hybrid' });
});

test('engine parity: draft-vs-draft conflict blocks save (cm6)', async () => {
  await assertDraftConflictBlocksSave({ search: '?writeEngine=cm6', engineName: 'cm6' });
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
