const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { getMainFileMatchers, getNodeModuleFileMatcher } = require('app-builder-lib/out/fileMatcher');
const { build: config } = require('../package.json');

// Use builder's composed rules (including defaults), not a second glob implementation.
// Paths are synthetic: no environment files, secrets or user documents are read.
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'dist', 'packaging-policy-fixture');
const info = {
  config, projectDir: root, buildResourcesDir: 'build', isPrepackedAppAsar: false,
  debugLogger: { isEnabled: false },
};
const main = getMainFileMatchers(root, destination, value => value, config.mac,
  { info }, path.join(root, 'dist'), false)[0].createFilter();
const modules = getNodeModuleFileMatcher(root, destination, value => value,
  config.mac, info).createFilter();
const selected = (filter, file) => filter(path.join(root, file), { isDirectory: () => false });

test('packaging excludes synthetic private data even inside runtime directories', () => {
  for (const prefix of ['', 'lib/', 'lib/vendor/example/']) {
    for (const file of ['.env', '.env.production', '.env.local', 'secrets/synthetic.json',
      'Inbox/synthetic.md', '.codex/state.json', '.claude/state.json', '.workflow/state.json']) {
      assert.equal(selected(main, prefix + file), false, `must exclude ${prefix + file}`);
    }
  }
});

test('packaging excludes development artifacts and retired session modules', () => {
  for (const file of ['e2e/session.cjs', 'test-results/run/trace.zip', 'test/example.test.js',
    'tools/example.js', 'spike/example.js', 'lib/e2e/probe.cjs', 'lib/test-results/run/trace.zip',
    'lib/session-viewer/read-tab.js', 'lib/session-import-ipc.js', 'lib/session-title.js']) {
    assert.equal(selected(main, file), false, `must exclude ${file}`);
  }
});

test('packaging retains required entry points, helpers, bundles, styles and fonts', () => {
  for (const file of ['package.json', 'main.js', 'preload.js', 'index.html',
    'lib/editor-path-policy.js', 'lib/frontmatter-save-safety.js', 'lib/frontmatter-scalar.js',
    'lib/vault-actions.js', 'lib/file-name.js', 'lib/ai-boot.js', 'lib/ai-result-panel.js',
    'lib/cm6-bundle.js', 'lib/tiptap-bundle.js', 'lib/toastui-bundle.js',
    'lib/vendor/katex/katex.min.js', 'lib/vendor/katex/katex.min.css',
    'lib/vendor/katex/fonts/KaTeX_Main-Regular.woff2',
    'lib/vendor/katex/fonts/KaTeX_Main-Regular.woff',
    'lib/vendor/katex/fonts/KaTeX_Main-Regular.ttf',
    'lib/vendor/highlight/highlight.min.js', 'lib/vendor/highlight/hljs.css',
    'lib/vendor/mermaid/mermaid.min.js']) {
    assert.equal(selected(main, file), true, `must include ${file}`);
  }
});

test('dependency exclusions preserve runtime resources and reject private canaries', () => {
  // Builder collects production dependencies separately; actual membership is also
  // verified in the built ASAR. This checks that our exclusions do not prune assets.
  for (const file of ['node_modules/marked/lib/marked.umd.js',
    'node_modules/@toast-ui/editor/dist/toastui-editor.css']) {
    assert.equal(selected(modules, file), true, `must retain ${file}`);
  }
  for (const file of ['.env', '.env.production', 'secrets/synthetic.json', 'Inbox/synthetic.md']) {
    assert.equal(selected(modules, `node_modules/example/${file}`), false, `must exclude ${file}`);
  }
});
