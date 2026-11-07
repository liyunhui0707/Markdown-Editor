'use strict';
const {MAX_HISTORY_UNITS} = require('./document-capacity');
const units = entry => (entry.undo?.insert?.length || 0) + (entry.redo?.insert?.length || 0);
// Called only after a confirmed new edit. Moving entries between Undo/Redo does
// not allocate new text or discard the most recent redo chain.
function trimHistory(stack) {
  let total = stack.reduce((sum, entry) => sum + units(entry), 0);
  while (stack.length > 1 && (stack.length > 64 || total > MAX_HISTORY_UNITS)) total -= units(stack.shift());
}
module.exports = {trimHistory};
