/* test/ai-renderer-wiring-settings.test.js
   Stage C — CS5: in-app settings panel UI wiring.

   - index.html has the gear button + a hidden modal with baseUrl / model /
     allow-remote controls, save + cancel, a privacy warning, and overlay CSS.
   - lib/ai-boot.js wires the modal: open loads vaultApi.getAiSettings(),
     disables env-overridden fields, Save calls vaultApi.saveAiSettings() and
     re-renders the badge live. All wiring lives in ai-boot.js (NOT the inline
     boot script — H1). XSS-safe (textContent only).
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX = path.join(__dirname, '..', 'index.html');
const AIBOOT = path.join(__dirname, '..', 'lib', 'ai-boot.js');
const readHtml = () => fs.readFileSync(INDEX, 'utf8');
const readBoot = () => fs.readFileSync(AIBOOT, 'utf8');

// ===== CS5.A — index.html =====

test('CS5.A1 settings button present in toolbar near the AI buttons', () => {
  const html = readHtml();
  assert.match(html, /id=["']aiSettingsButton["']/);
  assert.match(html, /rewriteButton[\s\S]{0,400}aiSettingsButton/);
});

test('CS5.A2 settings modal present, hidden by default', () => {
  assert.match(readHtml(), /id=["']aiSettingsOverlay["'][^>]*hidden/);
});

test('CS5.A3 modal has baseUrl, model, and allow-remote checkbox controls', () => {
  const html = readHtml();
  assert.match(html, /id=["']aiSettingsBaseUrl["']/);
  assert.match(html, /id=["']aiSettingsModel["']/);
  assert.match(html, /id=["']aiSettingsAllowRemote["'][^>]*type=["']checkbox["']/);
});

test('CS5.A4 modal has save + cancel buttons', () => {
  const html = readHtml();
  assert.match(html, /id=["']aiSettingsSave["']/);
  assert.match(html, /id=["']aiSettingsCancel["']/);
});

test('CS5.A5 modal carries a privacy warning + overlay-hidden CSS', () => {
  const html = readHtml();
  assert.match(html, /sends your note content off your machine/i);
  assert.match(html, /\.ai-settings-overlay\[hidden\]\s*\{[^}]*display\s*:\s*none/);
});

test('CS5.A6 inline boot script untouched for AI settings (H1 contract)', () => {
  const html = readHtml();
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  const inlineBoot = scripts.map((m) => m[1]).find((c) => c.includes('Boot the Markdown editor')) || '';
  assert.doesNotMatch(inlineBoot, /aiSettings/);
});

// ===== CS5.B — lib/ai-boot.js =====

test('CS5.B1 ai-boot looks up the settings button + modal overlay', () => {
  const src = readBoot();
  assert.match(src, /getElementById\(\s*['"]aiSettingsButton['"]\s*\)/);
  assert.match(src, /getElementById\(\s*['"]aiSettingsOverlay['"]\s*\)/);
});

test('CS5.B2 ai-boot calls getAiSettings on open and saveAiSettings on save', () => {
  const src = readBoot();
  assert.match(src, /vaultApi\.getAiSettings\(\s*\)/);
  assert.match(src, /vaultApi\.saveAiSettings\(/);
});

test('CS5.B3 ai-boot re-renders the badge after a successful save', () => {
  const src = readBoot();
  assert.match(src, /function renderBadge\s*\(/);
  assert.match(src, /res\.ok[\s\S]{0,300}renderBadge\(\)/);
});

test('CS5.B4 ai-boot disables env-overridden fields', () => {
  const src = readBoot();
  assert.match(src, /envOverridden/);
  assert.match(src, /\.disabled\s*=/);
});

test('CS5.B5 ai-boot settings wiring is XSS-safe (no innerHTML)', () => {
  const region = readBoot().match(/setupAiSettingsPanel[\s\S]{0,2800}/);
  assert.ok(region);
  assert.doesNotMatch(region[0], /\.innerHTML\s*=/);
});

test('CS5.B6 ai-boot is defensive when modal elements are missing', () => {
  assert.match(readBoot(), /setupAiSettingsPanel[\s\S]{0,1500}if\s*\(\s*!settingsButton/);
});
