/* Stage 23 — peer source-file contract for cm6-task-toggle.js.
   Run focused: node --test test/cm6-write-view/cm6-task-toggle-invariants.test.js

   This is the named, narrow exception to the walker's pure-observation
   contract (cm6-hybrid-view.js Section H is unchanged). The toggle module
   is allowed exactly one EditorView.domEventHandlers call (the mousedown
   handler) and exactly one cm6.keymap.of call (the Mod-Shift-x binding),
   and nothing else from the forbidden token set. Production source
   comments must phrase guidance WITHOUT using the literal forbidden
   substrings because the scanner reads raw source. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const TOGGLE_PATH = path.join(__dirname, '..', '..', 'lib', 'cm6-task-toggle.js');

test('Stage 23-19: cm6-task-toggle.js source-file invariants', () => {
  const src = fs.readFileSync(TOGGLE_PATH, 'utf8');

  // Allowed event surface: exactly one EditorView.domEventHandlers call
  // and exactly one cm6.keymap.of call. These two calls are the entire
  // named exception this file represents.
  const eventHandlers = src.match(/EditorView\.domEventHandlers\s*\(/g) || [];
  assert.equal(eventHandlers.length, 1,
    'cm6-task-toggle.js must call EditorView.domEventHandlers exactly once');
  const keymapCalls = src.match(/cm6\.keymap\.of\s*\(/g) || [];
  assert.equal(keymapCalls.length, 1,
    'cm6-task-toggle.js must call cm6.keymap.of exactly once');

  // Forbidden tokens — same set as Section H plus the Stage 16-10
  // adapter-output set. Production comments must phrase guidance
  // WITHOUT using these literal substrings.
  assert.ok(!src.includes('Decoration.replace'), 'no Decoration.replace');
  assert.ok(!src.includes('Decoration.widget'),  'no Decoration.widget');
  assert.ok(!src.includes('WidgetType'),         'no WidgetType');
  assert.ok(!src.includes('<a'),                 'no "<a" anywhere');
  assert.ok(!src.includes('href'),               'no "href" anywhere');
  assert.ok(!src.includes('<img'),               'no "<img"');
  assert.ok(!src.includes('<div'),               'no "<div"');
  assert.ok(!src.includes('addEventListener'),   'no raw addEventListener');
  assert.ok(!/onclick\s*[:=]/.test(src),          'no onclick property/handler');
  assert.ok(!src.includes('innerHTML'),          'no innerHTML');
  assert.ok(!src.includes('document.write'),     'no document.write');
  assert.ok(!src.includes('eval('),              'no eval(');
});
