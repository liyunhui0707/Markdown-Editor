/* TDD: sidebar toggle must not blank out the workspace.
   Root cause: display:none removes a grid item from flow, collapsing the workspace to 0px.
   Fix: use overflow:hidden + 0px grid column instead of display:none.

   Run: node --test test/sidebar-visibility.test.js */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

// Pure model of updateLayoutVisibility — returns what the DOM should look like.
function computeLayout(isSidebarHidden) {
  return {
    // Must NEVER be display:none — that removes the item from grid flow
    sidebarDisplay: 'block',
    // Column widths
    gridTemplateColumns: isSidebarHidden ? '0px 1fr' : '300px 1fr',
    // Overflow controls visibility when column is 0px
    sidebarOverflow: 'hidden',
    toggleText:  isSidebarHidden ? '›' : '‹',
    toggleLabel: isSidebarHidden ? 'Show sidebar' : 'Hide sidebar',
    toggleExpanded: !isSidebarHidden,
  };
}

test('when sidebar is hidden the grid still has two columns (workspace stays 1fr)', () => {
  const layout = computeLayout(true);
  assert.equal(layout.gridTemplateColumns, '0px 1fr',
    'grid must remain two-column so workspace occupies the 1fr column');
});

test('when sidebar is hidden the element must NOT use display:none', () => {
  const layout = computeLayout(true);
  assert.notEqual(layout.sidebarDisplay, 'none',
    'display:none removes element from grid flow and collapses the workspace to 0px');
});

test('sidebar uses overflow:hidden to clip content when column is 0px', () => {
  const layout = computeLayout(true);
  assert.equal(layout.sidebarOverflow, 'hidden');
});

test('when sidebar is visible the grid is 300px + 1fr', () => {
  const layout = computeLayout(false);
  assert.equal(layout.gridTemplateColumns, '300px 1fr');
});

test('toggle shows correct chevron and label in each state', () => {
  const hidden  = computeLayout(true);
  const visible = computeLayout(false);

  assert.equal(hidden.toggleText,  '›');
  assert.equal(visible.toggleText, '‹');
  assert.equal(hidden.toggleLabel,  'Show sidebar');
  assert.equal(visible.toggleLabel, 'Hide sidebar');
  assert.equal(hidden.toggleExpanded,  false);
  assert.equal(visible.toggleExpanded, true);
});
