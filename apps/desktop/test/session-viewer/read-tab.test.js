/* Stage S3 — Read-tab controller (headless).
   Run focused: node --test test/session-viewer/read-tab.test.js
   Asserts: setSessionsMode toggles readButton.hidden; renderInto clears
   the mount WITHOUT innerHTML and appends a fresh fragment; repeated
   renderInto calls do not accumulate stale DOM.
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createReadTabController } = require('../../lib/session-viewer/read-tab.js');
const { makeFakeDocument } = require('./read-fake-document.js');

function setup({ rendererImpl } = {}) {
  const doc = makeFakeDocument();
  const readButton = doc.createElement('button');
  readButton.hidden = true;
  const readMount = doc.createElement('div');
  let lastInput = null;
  const renderMarkdown = rendererImpl || ((text, opts) => {
    lastInput = { text, opts };
    const frag = opts.document.createDocumentFragment();
    const p = opts.document.createElement('p');
    p.appendChild(opts.document.createTextNode(text));
    frag.appendChild(p);
    return frag;
  });
  const ctl = createReadTabController({
    readButton,
    readMount,
    document: doc,
    renderMarkdown,
  });
  return { ctl, doc, readButton, readMount, getLastInput: () => lastInput };
}

test('throws if any required option is missing', () => {
  const doc = makeFakeDocument();
  const button = doc.createElement('button');
  const mount = doc.createElement('div');
  assert.throws(() => createReadTabController({}), /opts is required|readButton/);
  assert.throws(() => createReadTabController({ readMount: mount, document: doc, renderMarkdown: () => {} }), /readButton/);
  assert.throws(() => createReadTabController({ readButton: button, document: doc, renderMarkdown: () => {} }), /readMount/);
  assert.throws(() => createReadTabController({ readButton: button, readMount: mount, renderMarkdown: () => {} }), /document/);
  assert.throws(() => createReadTabController({ readButton: button, readMount: mount, document: doc }), /renderMarkdown/);
});

test('setSessionsMode(true) shows the button; setSessionsMode(false) hides it', () => {
  const { ctl, readButton } = setup();
  assert.equal(readButton.hidden, true);
  ctl.setSessionsMode(true);
  assert.equal(readButton.hidden, false);
  ctl.setSessionsMode(false);
  assert.equal(readButton.hidden, true);
});

test('renderInto appends a fragment from renderMarkdown into the mount', () => {
  const { ctl, readMount, getLastInput } = setup();
  ctl.renderInto('hello world');
  assert.equal(getLastInput().text, 'hello world');
  // The fragment contained one <p>; after appending, the mount has 1 child.
  assert.equal(readMount.children.length, 1);
  assert.equal(readMount.children[0].tag, 'p');
});

test('renderInto clears prior children WITHOUT touching innerHTML', () => {
  const { ctl, doc, readMount } = setup();
  // Prime with some children.
  readMount.appendChild(doc.createElement('span'));
  readMount.appendChild(doc.createElement('span'));
  assert.equal(readMount.children.length, 2);
  ctl.renderInto('replacement');
  // After renderInto, only the new fragment's children remain.
  assert.equal(readMount.children.length, 1);
  assert.equal(readMount.children[0].tag, 'p');
  // No innerHTML / outerHTML / insertAdjacentHTML write happened anywhere.
  assert.equal(doc.unsafeApiWrites, 0);
});

test('repeated renderInto calls do not accumulate stale DOM', () => {
  const { ctl, readMount } = setup();
  ctl.renderInto('first');
  ctl.renderInto('second');
  ctl.renderInto('third');
  assert.equal(readMount.children.length, 1);
});

test('null / undefined text are coerced to empty string', () => {
  const { ctl, readMount, getLastInput } = setup();
  ctl.renderInto(null);
  assert.equal(getLastInput().text, '');
  assert.equal(readMount.children.length, 1);
  ctl.renderInto(undefined);
  assert.equal(getLastInput().text, '');
});

test('clearMount removes all children and never writes innerHTML', () => {
  const { ctl, doc, readMount } = setup();
  readMount.appendChild(doc.createElement('div'));
  readMount.appendChild(doc.createElement('div'));
  ctl.clearMount();
  assert.equal(readMount.children.length, 0);
  assert.equal(doc.unsafeApiWrites, 0);
});

test('renderMarkdown is invoked with the controller-provided document', () => {
  const { ctl, doc, getLastInput } = setup();
  ctl.renderInto('hi');
  assert.equal(getLastInput().opts.document, doc);
});
