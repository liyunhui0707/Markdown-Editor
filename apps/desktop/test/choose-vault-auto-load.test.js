/* TDD: choosing a vault should automatically load its notes.
   Run: node --test test/choose-vault-auto-load.test.js */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { chooseVaultFolder } = require('../lib/vault-actions');

// ── helpers ──────────────────────────────────────────────────────────────────

function makeDeps(overrides = {}) {
  return {
    vaultApi:           { chooseVaultFolder: async () => ({ ok: true, vaultPath: '/my/vault' }) },
    setCurrentVaultPath: () => {},
    stopWatching:       async () => {},
    startWatching:      async () => {},
    refreshVaultNotes:  async () => {},
    updateDisplay:      () => {},
    setStatus:          () => {},
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

test('loads vault notes automatically after successful vault selection', async () => {
  let refreshCalled = false;

  await chooseVaultFolder(makeDeps({
    refreshVaultNotes: async () => { refreshCalled = true; },
  }));

  assert.ok(refreshCalled, 'refreshVaultNotes must be called automatically after choosing a vault');
});

test('sets currentVaultPath to the chosen path', async () => {
  let capturedPath = '';

  await chooseVaultFolder(makeDeps({
    setCurrentVaultPath: (p) => { capturedPath = p; },
  }));

  assert.equal(capturedPath, '/my/vault');
});

test('does NOT load notes when user cancels vault selection', async () => {
  let refreshCalled = false;

  await chooseVaultFolder(makeDeps({
    vaultApi: { chooseVaultFolder: async () => ({ ok: false, canceled: true }) },
    refreshVaultNotes: async () => { refreshCalled = true; },
  }));

  assert.equal(refreshCalled, false, 'refreshVaultNotes must NOT be called when selection is canceled');
});

test('does NOT load notes when vault selection fails with an error', async () => {
  let refreshCalled = false;

  await chooseVaultFolder(makeDeps({
    vaultApi: { chooseVaultFolder: async () => ({ ok: false, canceled: false, error: 'Permission denied' }) },
    refreshVaultNotes: async () => { refreshCalled = true; },
  }));

  assert.equal(refreshCalled, false, 'refreshVaultNotes must NOT be called on error');
});
