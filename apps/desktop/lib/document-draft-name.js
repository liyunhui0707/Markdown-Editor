'use strict';
const { copyName } = require('./document-save-policy');
// Display metadata only. A suggestion is never a destination or write capability.
function normalizeDraftName(value) {
  if (typeof value !== 'string' || !value.isWellFormed()) return null;
  const name = value.trim().replace(/\.md$/i, '').trim();
  return name && copyName(name + '.md') ? name : null;
}
const draftFileName = label => {
  const name = normalizeDraftName(label);
  return name ? name + '.md' : 'Untitled.md';
};
module.exports = { normalizeDraftName, draftFileName };
