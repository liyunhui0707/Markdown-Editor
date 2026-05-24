/* Stage S2 — sessions-filter (path matcher for the new AI Sessions filter).
   Run focused: node --test test/session-viewer/sessions-filter.test.js
   Tests T-S2-6..T-S2-10 from s2-04-implementation-plan.md.
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MODULE_REL = '../../lib/session-viewer/sessions-filter.js';

function load() {
  delete require.cache[require.resolve(MODULE_REL)];
  return require(MODULE_REL);
}

test('S2-6: Claude-shaped path matches', () => {
  const { isSessionsImport } = load();
  assert.equal(
    isSessionsImport('Inbox/AI Chats/claude-code/proj/00000000-0000-4000-8000-000000000001.md'),
    true,
  );
});

test('S2-7: Codex-shaped path matches', () => {
  const { isSessionsImport } = load();
  assert.equal(
    isSessionsImport('Inbox/AI Chats/codex/2026/01/01/rollout-2026-01-01T00-00-00-019c5f21-83e1-72c2-a129-83fa090f4c41.md'),
    true,
  );
});

test('S2-8: legacy AI-Chats path (no agent subdir) does NOT match', () => {
  const { isSessionsImport } = load();
  assert.equal(isSessionsImport('Inbox/AI Chats/2026/01/loose.md'), false);
  assert.equal(isSessionsImport('Inbox/AI Chats/some-chat.md'), false);
});

test('S2-9: paths outside Inbox/AI Chats/<agent>/ never match', () => {
  const { isSessionsImport } = load();
  assert.equal(isSessionsImport('Inbox/notes/foo.md'), false);
  assert.equal(isSessionsImport('claude-code/proj/x.md'), false);
  assert.equal(isSessionsImport('AI Chats/claude-code/x.md'), false);
});

test('S2-10: directory-only or empty path never matches', () => {
  const { isSessionsImport } = load();
  assert.equal(isSessionsImport('Inbox/AI Chats/claude-code/'), false);
  assert.equal(isSessionsImport('Inbox/AI Chats/codex/'), false);
  assert.equal(isSessionsImport(''), false);
  assert.equal(isSessionsImport('/'), false);
});

test('non-string input is rejected (defense in depth)', () => {
  const { isSessionsImport } = load();
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.equal(isSessionsImport(bad), false);
  }
});

test('backslash inputs are rejected (forward-slash form only)', () => {
  const { isSessionsImport } = load();
  assert.equal(
    isSessionsImport('Inbox\\AI Chats\\claude-code\\proj\\x.md'),
    false,
    'plan §2 explicitly: forward-slash form only',
  );
});

test('leading slash is normalized away (relative-path semantics)', () => {
  const { isSessionsImport } = load();
  // Relative paths from the vault root: a leading "/" is permitted because
  // some callers prepend one. The matcher should still match.
  assert.equal(
    isSessionsImport('/Inbox/AI Chats/claude-code/proj/x.md'),
    true,
  );
});
