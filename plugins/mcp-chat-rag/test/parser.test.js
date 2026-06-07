const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLine } = require('../lib/parser');
const F = require('./fixtures/parser-cases');

test('T1.1 user line with string content returns one user turn', () => {
  const turns = parseLine(F.asLine(F.userStringContent), 1);
  assert.ok(Array.isArray(turns));
  assert.equal(turns.length, 1);
  const t = turns[0];
  assert.equal(t.role, 'user');
  assert.equal(t.kind, 'user_text');
  assert.equal(t.text, 'how do we handle CRLF?');
  assert.equal(t.session_id, 'sess-1');
  assert.equal(t.uuid, 'u-1');
  assert.equal(t.parent_uuid, null);
  assert.equal(t.cwd, '/Users/x/proj');
  assert.equal(t.git_branch, 'main');
  assert.equal(t.ts, '2026-05-30T22:19:59.487Z');
});

test('T1.2 assistant array content drops thinking, keeps text, summarizes tool_use', () => {
  const turns = parseLine(F.asLine(F.assistantArrayBlocks), 2);
  assert.ok(Array.isArray(turns));
  assert.equal(turns.length, 2, 'thinking dropped, text + tool_use kept');

  const [textTurn, toolUseTurn] = turns;

  assert.equal(textTurn.role, 'assistant');
  assert.equal(textTurn.kind, 'assistant_text');
  assert.equal(textTurn.text, 'Use \\n explicitly.');
  assert.equal(textTurn.uuid, 'u-2');

  assert.equal(toolUseTurn.role, 'assistant');
  assert.equal(toolUseTurn.kind, 'tool_use_summary');
  assert.match(toolUseTurn.text, /^tool_use: Edit input\./);
});

test('T1.3 every noise type returns null', () => {
  for (const noise of F.noiseTypes) {
    const result = parseLine(F.asLine(noise), 1);
    assert.equal(result, null, `expected null for type=${noise.type}`);
  }
});

test('T1.4 malformed JSON returns null and does not throw', () => {
  let threw = false;
  let result;
  try {
    result = parseLine(F.malformedJson, 99);
  } catch (e) {
    threw = true;
  }
  assert.equal(threw, false, 'parser must not throw on malformed JSON');
  assert.equal(result, null);
});

test('T1.5 tool_use input over 200 chars is truncated with ellipsis', () => {
  const turns = parseLine(F.asLine(F.oversizedToolUseInput), 3);
  assert.equal(turns.length, 1);
  const t = turns[0];
  assert.equal(t.kind, 'tool_use_summary');
  assert.ok(t.text.length <= 220, `expected <= 220 chars, got ${t.text.length}`);
  assert.ok(t.text.endsWith('…'), 'expected ellipsis suffix on truncated input');
});

test('T1.6 empty text block produces no turn', () => {
  const turns = parseLine(F.asLine(F.emptyTextBlock), 4);
  assert.equal(Array.isArray(turns), true);
  assert.equal(turns.length, 0, 'empty text block should yield zero turns');
});
