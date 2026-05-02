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
      const adapter = {
        text: calls.cm6Options.initialDoc || '',
        getText() {
          calls.cm6GetText += 1;
          return this.text;
        },
        setText(text) {
          const value = text == null ? '' : String(text);
          calls.cm6SetText.push(value);
          this.text = value;
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

  elements.get('newNoteButton').fire('click');
  adapter.text = `Body A unique ${engineName}`;
  onChange(`Body A unique ${engineName}`);

  elements.get('newNoteButton').fire('click');
  adapter.text = `Body B unique ${engineName}`;
  onChange(`Body B unique ${engineName}`);

  elements.get('noteList').children[1].fire('click');
  assert.equal(setTextCalls.at(-1), `Body A unique ${engineName}`);

  await elements.get('saveNoteButton').fireAsync('click');
  assert.equal(calls.loadVaultNotesPayloads.length, 2, 'save should refresh from disk once');

  assert.equal(typeof calls.vaultChangedCallback, 'function', 'vault watcher should be active after choosing a vault');
  await calls.vaultChangedCallback({ fileName: 'saved-1.md' });
  assert.equal(calls.loadVaultNotesPayloads.length, 3, 'watcher should cause the real second refresh after save');

  assert.equal(elements.get('noteList').children.length, 1, 'only the remaining unsaved draft should stay visible in Drafts');
  assert.ok(elements.get('noteList').children[0].className.includes('active'), 'remaining draft should be selected');
  assert.equal(setTextCalls.at(-1), `Body B unique ${engineName}`);
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
