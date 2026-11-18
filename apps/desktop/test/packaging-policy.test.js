const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root=path.resolve(__dirname,'..');
const main=require('../tools/document-package-policy.cjs').runtimeFilter(root,require('../package-lock.json'));
const modules=main;
const selected=(filter,file)=>filter(path.join(root,file));

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
  for (const file of ['package.json','document-app-main.js','lib/editor-path-policy.js',
    'lib/document-window-main.js','lib/document-demo-preload.js','lib/document-demo-bundle.js',
    'lib/document-writing-shell.css','lib/document-source-map.mjs','lib/document-demo.html']) {
    assert.equal(selected(main, file), true, `must include ${file}`);
  }
});

test('dependency exclusions preserve runtime resources and reject private canaries', () => {
  // The locked production graph and the actual Packager copy filter are shared;
  // actual ASAR contents and runtime hashes are also verified after packaging.
  for (const file of ['node_modules/marked/lib/marked.umd.js',
    'node_modules/unified/index.js']) {
    assert.equal(selected(modules, file), true, `must retain ${file}`);
  }
  for (const file of ['.env', '.env.production', 'secrets/synthetic.json', 'Inbox/synthetic.md']) {
    assert.equal(selected(modules, `node_modules/example/${file}`), false, `must exclude ${file}`);
  }
});
