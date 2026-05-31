/* Stage A WAVE 0 — pre-flight bundle-exports contract for hybrid-cm6-lp.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-bundle-exports.test.js

   The hybrid-cm6-lp engine needs four surfaces from window.CM6Production
   that the legacy hybrid-cm6 engine never used:

     - Decoration.replace   — replace an existing range with a widget
     - WidgetType           — base class for the empty-widget used by replace
     - EditorView.atomicRanges — facet that makes replaced ranges atomic for cursor motion
     - Decoration.none      — sentinel empty RangeSet, used as the atomicRanges fallback

   This file is a contract gate: if any of the four surfaces is missing,
   the lp engine cannot be constructed, and an additive export change to
   cm6-entry.js + npm run build:cm6 rebuild is required (see the plan's
   WAVE 0 STOP CONDITION).

   Pattern mirrors cm6-bundle-parity.test.js — load the bundle into a
   global.window shim and inspect CM6Production. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

function loadCM6Production() {
  if (!global.window) global.window = {};
  if (!global.window.CM6Production) {
    require('../../lib/cm6-bundle.js');
  }
  return global.window.CM6Production;
}

test('Stage A WAVE 0-1: CM6Production.Decoration.replace exists', () => {
  const cm6 = loadCM6Production();
  assert.ok(cm6, 'CM6Production namespace must be present on window');
  assert.ok(cm6.Decoration, 'CM6Production.Decoration must be present');
  assert.equal(typeof cm6.Decoration.replace, 'function',
    'Decoration.replace must be a function for hybrid-cm6-lp to replace emphasis markers');
});

test('Stage A WAVE 0-2: CM6Production.WidgetType exists', () => {
  const cm6 = loadCM6Production();
  assert.ok(cm6.WidgetType, 'CM6Production.WidgetType must be present');
  assert.equal(typeof cm6.WidgetType, 'function',
    'WidgetType must be a constructor (class) so the lp emphasis empty-widget can subclass it');
});

test('Stage A WAVE 0-3: CM6Production.EditorView.atomicRanges facet exists', () => {
  const cm6 = loadCM6Production();
  assert.ok(cm6.EditorView, 'CM6Production.EditorView must be present');
  assert.ok(cm6.EditorView.atomicRanges,
    'EditorView.atomicRanges facet must be present so replaced ranges step atomically');
  assert.equal(typeof cm6.EditorView.atomicRanges.of, 'function',
    'EditorView.atomicRanges must be a facet with .of() to register a provider');
});

test('Stage A WAVE 0-4: CM6Production.Decoration.none sentinel exists', () => {
  const cm6 = loadCM6Production();
  assert.ok(cm6.Decoration.none,
    'Decoration.none must be present for the atomicRanges fallback when the plugin is detached');
});
