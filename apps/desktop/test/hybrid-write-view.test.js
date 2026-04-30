/* TDD: HybridWriteView — isolated component tests (no index.html, no bundle).
   Run: node --test test/hybrid-write-view.test.js

   DOM API surface that HybridWriteView is ALLOWED to use:
     container.ownerDocument.createElement('div'|'textarea')
     el.appendChild(child)
     el.removeChild(child)
     el.className = string          (write only)
     el.innerHTML = string          (write only — safeMarked output on inactive blocks)
     textarea.value                 (read on flush; write on activation)
     textarea.placeholder = string  (write only)
     textarea.setSelectionRange(0, 0)
     textarea.focus()               (no-op in tests)
     el.addEventListener(type, fn)  (types: click, input, blur,
                                           compositionstart, compositionend)
   Test helper only (not a DOM API):
     el._fire(type, extraProps)     (dispatches event to registered handlers)
     el._children                  (inspects the rendered child list)
*/
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const { HybridWriteView } = require('../lib/hybrid-write-view');

// ── Minimal DOM fake ──────────────────────────────────────────────────────────
// Implements only the documented DOM API surface above.

function makeDOM() {
  function createElement(tag) {
    const el = {
      _tag:         tag,
      className:    '',
      innerHTML:    '',
      value:        '',
      placeholder:  '',
      selectionStart: 0,
      selectionEnd:   0,
      _children:    [],
      _handlers:    Object.create(null),

      // Style is a recording proxy: production code writes things like
      //   ta.style.height = 'auto'
      //   ta.style.height = ta.scrollHeight + 'px'
      // and tests need to inspect both the final value AND the order of
      // writes (e.g. to prove autoresize resets to 'auto' before measuring).
      style:        {},
      _styleWrites: [],

      // scrollHeight is exposed as a plain settable number so tests can
      // arrange it BEFORE autoresize is called from production code.
      scrollHeight: 0,

      appendChild(child)  { this._children.push(child); return child; },
      removeChild(child)  {
        const i = this._children.indexOf(child);
        if (i !== -1) this._children.splice(i, 1);
        return child;
      },
      setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; },
      focus() {},
      addEventListener(type, fn) {
        (this._handlers[type] = this._handlers[type] || []).push(fn);
      },
      // test helper — not a production DOM method
      _fire(type, extra) {
        (this._handlers[type] || []).forEach(fn =>
          fn(Object.assign({ type, target: this }, extra)));
      },
    };

    // Wrap el.style so writes to any property are recorded in order on
    // the host element. We don't need a full Proxy — production code only
    // assigns string properties, never reads them.
    const recorder = el._styleWrites;
    el.style = new Proxy({}, {
      set(target, prop, value) {
        target[prop] = value;
        recorder.push({ prop, value });
        return true;
      },
    });

    el.ownerDocument = doc;

    // Allow a test to pre-set scrollHeight on the NEXT textarea created
    // (i.e. before HybridWriteView attaches it and runs autoresize).
    if (tag === 'textarea' && doc._nextScrollHeight !== undefined) {
      el.scrollHeight = doc._nextScrollHeight;
      doc._nextScrollHeight = undefined;
    }
    return el;
  }

  const doc        = { createElement, _nextScrollHeight: undefined };
  const container  = createElement('div');
  return { container, doc };
}

// Helpers to navigate the rendered tree:
//   container._children[0] = innerContainer
//   innerContainer._children = segment elements + (optionally) tail affordance
function inner(container) { return container._children[0]; }
// segments() = block/gap content. The tail affordance is a click target, not
// content, so it is excluded so existing index-based assertions stay valid.
function segments(container) {
  return inner(container)._children.filter(c => c.className !== 'hybrid-tail-affordance');
}
function blockSegs(container) {
  return segments(container).filter(el =>
    el.className === 'hybrid-block-inactive' || el.className === 'hybrid-block-active');
}
function activeTextarea(container) {
  const active = segments(container).find(el => el.className === 'hybrid-block-active');
  return active ? active._children.find(el => el._tag === 'textarea') : null;
}
function tailAffordance(container) {
  return inner(container)._children.find(c => c.className === 'hybrid-tail-affordance');
}
function tailAffordances(container) {
  return inner(container)._children.filter(c => c.className === 'hybrid-tail-affordance');
}

// ── setText / getText ─────────────────────────────────────────────────────────

test('getText returns empty string before setText', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  assert.equal(hw.getText(), '');
});

test('setText then getText returns the same raw string', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  const raw = '# Title\n\nParagraph text.';
  hw.setText(raw);
  assert.equal(hw.getText(), raw);
});

test('setText round-trip for all Phase 0 block types', () => {
  const fixtures = [
    '# Heading only',
    'Paragraph only.',
    '# Title\n\nParagraph.',
    '- item one\n- item two',
    '1. first\n2. second',
    '> blockquote\n> line two',
    '```js\nconsole.log("hi");\n```',
    '# Title\n\nParagraph.\n\n- item\n\n> quote\n\n```\ncode\n```',
  ];
  for (const raw of fixtures) {
    const { container } = makeDOM();
    const hw = new HybridWriteView(container, {});
    hw.setText(raw);
    assert.equal(hw.getText(), raw, `round-trip failed for: ${JSON.stringify(raw)}`);
  }
});

test('setText with empty string does not throw', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  assert.doesNotThrow(() => hw.setText(''));
  assert.equal(hw.getText(), '');
});

test('setText with null or undefined coerces to empty string', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText(null);
  assert.equal(hw.getText(), '');
});

// ── Inactive block rendering ──────────────────────────────────────────────────

test('heading block is rendered as an inactive block element', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# My Heading');
  const blocks = blockSegs(container);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].className, 'hybrid-block-inactive');
});

test('inactive heading block innerHTML contains safeMarked output', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# My Heading');
  const blocks = blockSegs(container);
  assert.ok(blocks[0].innerHTML.includes('<h1>'), 'expected <h1> in rendered heading');
  assert.ok(blocks[0].innerHTML.includes('My Heading'));
});

test('inactive paragraph block innerHTML contains rendered paragraph', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('Hello **world**.');
  const blocks = blockSegs(container);
  assert.ok(blocks[0].innerHTML.includes('<strong>world</strong>'));
});

test('multiple blocks produce the correct number of segment elements', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nParagraph.');
  // heading, gap, paragraph = 3 segments total; 2 blocks
  assert.equal(blockSegs(container).length, 2);
});

// ── Raw HTML safety ───────────────────────────────────────────────────────────

test('block-level raw HTML is escaped in inactive block innerHTML', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('<script>window._xss=1</script>');
  const blocks = blockSegs(container);
  const html = blocks[0].innerHTML;
  assert.ok(!html.includes('<script'),   'raw <script must be escaped');
  assert.ok(html.includes('&lt;script'), 'expected &lt;script in output');
  assert.equal(typeof (globalThis._xss ?? undefined), 'undefined', '_xss must not be set');
});

test('inline onclick= attribute is escaped in inactive block innerHTML', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('Click <span onclick="evil()">here</span>.');
  const blocks = blockSegs(container);
  const html = blocks[0].innerHTML;
  assert.ok(!html.includes('onclick='),  'onclick= must be escaped');
  assert.ok(html.includes('&lt;span'),   'span must be escaped');
});

test('onerror= attribute is escaped', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('<img src=x onerror="evil()">');
  const blocks = blockSegs(container);
  const html = blocks[0].innerHTML;
  assert.ok(!html.includes('onerror='), 'onerror= must be escaped');
});

test('javascript: URL in raw HTML is escaped', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('<a href="javascript:evil()">click</a>');
  const blocks = blockSegs(container);
  const html = blocks[0].innerHTML;
  assert.ok(!html.includes('<a '), 'raw <a> must be escaped');
});

test('div tag in source is escaped in inactive block innerHTML', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('<div>content</div>');
  const blocks = blockSegs(container);
  const html = blocks[0].innerHTML;
  assert.ok(!html.includes('<div>'),   'raw <div> must be escaped');
  assert.ok(html.includes('&lt;div'), 'expected &lt;div in output');
});

test('getText never returns HTML injected by the component', () => {
  const sources = [
    '<script>x=1</script>',
    '# Title\n\nParagraph.',
    '**bold** and _italic_',
    '```js\nconst x = 1;\n```',
  ];
  for (const raw of sources) {
    const { container } = makeDOM();
    const hw = new HybridWriteView(container, {});
    hw.setText(raw);
    const result = hw.getText();
    assert.equal(result, raw, 'getText must return raw source unchanged');
    // No <h1>, <p>, <strong>, etc. should appear unless they were in the original source
    if (!raw.includes('<')) {
      assert.ok(!result.includes('<'), `getText added HTML tags for: ${raw}`);
    }
  }
});

// ── Markdown link/image URL safety ────────────────────────────────────────────

test('markdown link with javascript: scheme is rendered as plain text, not <a href>', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('[x](javascript:alert(1))');
  const html = blockSegs(container)[0].innerHTML;
  assert.ok(!/href=["']?javascript/i.test(html), 'must not produce a javascript: href');
  assert.ok(!html.includes('alert(1)') || !/<a\s/i.test(html),
    'if alert(1) text appears it must be inside an escaped, non-anchor context');
});

test('markdown link with mixed-case JaVaScRiPt: scheme is rejected', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('[x](JaVaScRiPt:alert(1))');
  const html = blockSegs(container)[0].innerHTML;
  assert.ok(!/href=/i.test(html),       'must not produce ANY href for unsafe scheme');
  assert.ok(!/<a\s/i.test(html),        'must not produce an anchor tag at all');
});

test('markdown image with javascript: scheme is rendered as plain text, not <img src>', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('![x](javascript:alert(1))');
  const html = blockSegs(container)[0].innerHTML;
  assert.ok(!/src=["']?javascript/i.test(html), 'must not produce a javascript: src');
  assert.ok(!/<img\s/i.test(html),               'must not produce an <img> tag');
});

test('markdown link with data:text/html scheme is rejected', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('[x](data:text/html,<script>x</script>)');
  const html = blockSegs(container)[0].innerHTML;
  assert.ok(!/href=["']?data:/i.test(html), 'must not produce a data: href');
  assert.ok(!html.includes('<script'),       'must not produce a literal <script tag');
});

test('markdown link with vbscript: scheme is rejected', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('[x](vbscript:msgbox(1))');
  const html = blockSegs(container)[0].innerHTML;
  assert.ok(!/href=["']?vbscript/i.test(html), 'must not produce a vbscript: href');
});

test('normal https markdown link still renders as a real <a> tag', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('[click](https://example.com)');
  const html = blockSegs(container)[0].innerHTML;
  assert.ok(html.includes('href="https://example.com"'), 'https link should render');
  assert.ok(/<a\s+href="https:\/\/example\.com"[^>]*>click<\/a>/.test(html),
    'expected a complete <a> tag with text "click"');
});

test('relative markdown link still renders as a real <a> tag', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('[home](/home)');
  const html = blockSegs(container)[0].innerHTML;
  assert.ok(html.includes('href="/home"'), 'relative link should render');
  assert.ok(/<a\s+href="\/home"[^>]*>home<\/a>/.test(html),
    'expected a complete <a> tag with text "home"');
});

test('mailto markdown link still renders as a real <a> tag', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('[mail](mailto:a@b.com)');
  const html = blockSegs(container)[0].innerHTML;
  assert.ok(html.includes('href="mailto:a@b.com"'), 'mailto link should render');
});

// ── Click activates a block ───────────────────────────────────────────────────

test('clicking an inactive block creates a textarea', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nParagraph.');
  // paragraph is the last block segment
  const segs = segments(container);
  const paraEl = segs[segs.length - 1];
  paraEl._fire('click');
  const ta = activeTextarea(container);
  assert.ok(ta !== null, 'expected a textarea after clicking inactive block');
});

test('textarea value equals the raw block source', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nParagraph text here.');
  const segs = segments(container);
  const paraEl = segs[segs.length - 1];
  paraEl._fire('click');
  const ta = activeTextarea(container);
  assert.equal(ta.value, 'Paragraph text here.');
});

test('clicking heading block creates textarea with heading raw value', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nParagraph.');
  const segs = segments(container);
  const headingEl = segs[0];
  headingEl._fire('click');
  const ta = activeTextarea(container);
  assert.equal(ta.value, '# Title');
});

// ── Caret position on click ───────────────────────────────────────────────────

test('caret lands at offset 0 after clicking inactive block', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nParagraph text.');
  const segs = segments(container);
  segs[segs.length - 1]._fire('click');
  const ta = activeTextarea(container);
  assert.equal(ta.selectionStart, 0, 'selectionStart must be 0');
  assert.equal(ta.selectionEnd,   0, 'selectionEnd must be 0');
});

test('active textarea has the hybrid-active-textarea class', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nParagraph text.');
  const segs = segments(container);
  segs[segs.length - 1]._fire('click');
  const ta = activeTextarea(container);
  assert.ok(ta, 'expected an active textarea after click');
  assert.equal(
    ta.className,
    'hybrid-active-textarea',
    'active textarea must use the hybrid-active-textarea class so scoped CSS strips native chrome'
  );
});

// ── input updates source ──────────────────────────────────────────────────────

test('input event on active textarea updates getText()', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nOld paragraph.');
  const segs = segments(container);
  segs[segs.length - 1]._fire('click');
  const ta = activeTextarea(container);
  ta.value = 'New paragraph.';
  ta._fire('input');
  assert.ok(hw.getText().includes('New paragraph.'));
  assert.ok(hw.getText().includes('# Title'));
  assert.ok(!hw.getText().includes('Old paragraph.'));
});

test('input event fires onChange callback with updated source', () => {
  const { container } = makeDOM();
  const received = [];
  const hw = new HybridWriteView(container, { onChange: t => received.push(t) });
  hw.setText('Paragraph.');
  const segs = segments(container);
  segs[0]._fire('click');
  const ta = activeTextarea(container);
  ta.value = 'Changed.';
  ta._fire('input');
  assert.equal(received.length, 1);
  assert.equal(received[0], 'Changed.');
});

// ── exitWriteMode flushes before returning ────────────────────────────────────

test('exitWriteMode flushes active textarea value to getText() synchronously', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nParagraph.');
  const segs = segments(container);
  segs[segs.length - 1]._fire('click');
  const ta = activeTextarea(container);
  ta.value = 'Updated paragraph.';
  // Do NOT fire input — exitWriteMode must flush the textarea regardless
  hw.exitWriteMode();
  assert.ok(hw.getText().includes('Updated paragraph.'), 'exitWriteMode must flush before returning');
  assert.ok(!hw.getText().includes('Paragraph.'),        'old content must be gone after flush');
});

test('exitWriteMode with no active block is a no-op', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nParagraph.');
  assert.doesNotThrow(() => hw.exitWriteMode());
  assert.equal(hw.getText(), '# Title\n\nParagraph.');
});

test('getText after exitWriteMode never contains HTML tags from the component', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nParagraph.');
  const segs = segments(container);
  segs[0]._fire('click');
  hw.exitWriteMode();
  assert.ok(!hw.getText().includes('<h1>'), 'getText must not contain <h1>');
  assert.ok(!hw.getText().includes('<p>'),  'getText must not contain <p>');
});

// ── IME composition gates block-swap ─────────────────────────────────────────

test('compositionstart on active textarea blocks click-triggered block swap', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nParagraph.');

  // Activate the paragraph block
  const segs0 = segments(container);
  segs0[segs0.length - 1]._fire('click');
  const ta = activeTextarea(container);
  assert.ok(ta !== null, 'paragraph textarea must be active');

  // Begin IME composition
  ta._fire('compositionstart');

  // Attempt to click the heading block
  const segs1 = segments(container);
  const headingEl = segs1[0];
  headingEl._fire('click');

  // Block swap must NOT have happened — paragraph textarea still active
  const ta2 = activeTextarea(container);
  assert.ok(ta2 !== null, 'textarea must still be active during composition');
  assert.equal(ta2.value, 'Paragraph.');
});

// ── Production code must use only real DOM APIs ──────────────────────────────

test('production code does not access fake-DOM internals (_children, _tag)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'hybrid-write-view.js'),
    'utf8'
  );
  assert.ok(!/_children/.test(src), 'production code must not reference _children');
  assert.ok(!/_tag/.test(src),      'production code must not reference _tag');
});

// ── Multi-block edit: no source corruption ───────────────────────────────────

test('editing active block into multiple Markdown blocks does not duplicate content across repeated input events', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('A\n\nC');
  const segs = segments(container);
  segs[0]._fire('click'); // activate "A"
  const ta = activeTextarea(container);

  ta.value = 'A\n\nB';
  ta._fire('input');
  assert.equal(hw.getText(), 'A\n\nB\n\nC',
    'after first input, source should reflect inserted block');

  ta.value = 'A\n\nBC';
  ta._fire('input');
  assert.equal(hw.getText(), 'A\n\nBC\n\nC',
    'after second input, source must NOT duplicate the trailing C block');
});

test('exitWriteMode after editing active block into multiple blocks preserves exact source', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('A\n\nC');
  const segs = segments(container);
  segs[0]._fire('click');
  const ta = activeTextarea(container);

  ta.value = 'A\n\nB';
  ta._fire('input');
  ta.value = 'A\n\nBC';
  ta._fire('input');
  hw.exitWriteMode();

  assert.equal(hw.getText(), 'A\n\nBC\n\nC',
    'exitWriteMode after multi-block edit must produce exactly A\\n\\nBC\\n\\nC');
});

test('onChange receives exact source for each input in multi-block edit case', () => {
  const { container } = makeDOM();
  const received = [];
  const hw = new HybridWriteView(container, { onChange: t => received.push(t) });
  hw.setText('A\n\nC');
  const segs = segments(container);
  segs[0]._fire('click');
  const ta = activeTextarea(container);

  ta.value = 'A\n\nB';
  ta._fire('input');
  ta.value = 'A\n\nBC';
  ta._fire('input');

  assert.equal(received.length, 2);
  assert.equal(received[0], 'A\n\nB\n\nC');
  assert.equal(received[1], 'A\n\nBC\n\nC');
});

// ── Duplicate-content blocks: identify by position, not raw text ─────────────

test('duplicate raw blocks: clicking the second duplicate activates the second one, not the first', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('Same\n\nOther\n\nSame');
  // Three inactive blocks: Same(0..4), Other(6..11), Same(13..17)
  const inactives = blockSegs(container);
  assert.equal(inactives.length, 3);
  inactives[2]._fire('click'); // click the LAST "Same"

  const ta = activeTextarea(container);
  assert.equal(ta.value, 'Same');
  ta.value = 'Changed';
  ta._fire('input');

  assert.equal(hw.getText(), 'Same\n\nOther\n\nChanged',
    'editing the second duplicate must not modify the first duplicate');
});

test('duplicate raw blocks with active edit before clicked target: activation accounts for source-length delta', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('Same\n\nOther\n\nSame');
  // Activate the FIRST "Same"
  blockSegs(container)[0]._fire('click');
  const ta1 = activeTextarea(container);
  // Lengthen the first block — this shifts later blocks in the source
  ta1.value = 'Same EDITED';
  ta1._fire('input');
  assert.equal(hw.getText(), 'Same EDITED\n\nOther\n\nSame');

  // Layout now: [active(Same EDITED), gap, inactive(Other), gap, inactive(Same)]
  // blockSegs returns [active, inactive(Other), inactive(Same)]; index 2 is the last Same.
  blockSegs(container)[2]._fire('click');

  const ta2 = activeTextarea(container);
  assert.equal(ta2.value, 'Same', 'newly active textarea must hold the LAST Same, not the first');
  ta2.value = 'New';
  ta2._fire('input');

  assert.equal(hw.getText(), 'Same EDITED\n\nOther\n\nNew',
    'edit must land on the last Same, not on the first (which is "Same EDITED")');
});

test('composition pending swap targets the correct duplicate block', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('Same\n\nOther\n\nSame');

  // Activate the first "Same"
  blockSegs(container)[0]._fire('click');
  const ta = activeTextarea(container);
  assert.equal(ta.value, 'Same');
  ta._fire('compositionstart');

  // While composing, click the LAST "Same" (blockSegs[2] = last inactive Same)
  blockSegs(container)[2]._fire('click');

  // Block swap must NOT have happened yet
  assert.equal(activeTextarea(container).value, 'Same',
    'first Same must still be active during composition');

  ta._fire('compositionend');

  // Pending swap fires; LAST Same must be active now
  const ta2 = activeTextarea(container);
  ta2.value = 'Changed';
  ta2._fire('input');

  assert.equal(hw.getText(), 'Same\n\nOther\n\nChanged',
    'composition swap must target the LAST Same, not the first');
});

test('compositionend after blocked click completes the pending block swap', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nParagraph.');

  // Activate paragraph
  const segs0 = segments(container);
  segs0[segs0.length - 1]._fire('click');
  let ta = activeTextarea(container);
  ta._fire('compositionstart');

  // Click heading during composition (blocked)
  const headingEl = segments(container)[0];
  headingEl._fire('click');

  // End composition — pending swap should execute
  ta._fire('compositionend');

  // Heading should now be the active block
  const ta2 = activeTextarea(container);
  assert.ok(ta2 !== null, 'a textarea must be active after compositionend');
  assert.equal(ta2.value, '# Title', 'heading textarea must now be active');
});

// ── Inactive multi-line paragraph: visible line breaks ──────────────────────
// Markdown's spec-default behavior collapses single newlines inside a paragraph
// to whitespace, which the browser then renders as a single space. The Write
// pane needs the rendered inactive block to visually mirror the source — one
// line per line — so the local marked instance must emit <br> for soft breaks.

test('inactive multi-line paragraph renders visible line breaks (br) between lines', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('Line 1\nLine 2\nLine 3');
  const blocks = blockSegs(container);
  assert.equal(blocks.length, 1, 'expected a single paragraph block');
  assert.equal(blocks[0].className, 'hybrid-block-inactive');
  const html = blocks[0].innerHTML;
  assert.match(
    html,
    /Line 1\s*<br[^>]*>\s*Line 2\s*<br[^>]*>\s*Line 3/,
    'expected <br> tags between each source line so visible breaks are preserved'
  );
});

test('inactive multi-line paragraph with inline Markdown renders bold, safe link, and visible <br>', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('Line 1 with **bold**\nLine 2 with [link](https://example.com)');
  const blocks = blockSegs(container);
  assert.equal(blocks.length, 1, 'expected a single paragraph block');
  const html = blocks[0].innerHTML;
  assert.ok(html.includes('<strong>bold</strong>'),               'bold must still render');
  assert.ok(html.includes('href="https://example.com"'),          'safe link href must still render');
  assert.match(html, /<a\s+href="https:\/\/example\.com"[^>]*>link<\/a>/,
    'expected complete <a> tag with text "link"');
  assert.match(html, /<br[^>]*>/,
    'expected at least one <br> between the two source lines');
});

// ── Active textarea autoresize ────────────────────────────────────────────────
// Reviewer requirement: a long active block must size the textarea to fit ALL
// of its content (no fixed-height invisible scrolling box). The fake DOM lets
// us pre-set scrollHeight on the *next* textarea created so that production
// code can read it during initial activation.

test('initial activation of a long block sets textarea height to its scrollHeight', () => {
  const { container, doc } = makeDOM();
  const hw = new HybridWriteView(container, {});
  // Pre-arm scrollHeight before HybridWriteView creates the textarea.
  doc._nextScrollHeight = 200;
  hw.setText('Line one paragraph block.');
  // Activate the only block
  blockSegs(container)[0]._fire('click');
  const ta = activeTextarea(container);
  assert.ok(ta !== null, 'expected an active textarea');
  assert.equal(
    ta.style.height,
    '200px',
    'autoresize must set style.height to scrollHeight + "px" on activation'
  );
});

test('input event recalculates textarea height when scrollHeight grows', () => {
  const { container, doc } = makeDOM();
  const hw = new HybridWriteView(container, {});
  doc._nextScrollHeight = 60;
  hw.setText('short');
  blockSegs(container)[0]._fire('click');
  const ta = activeTextarea(container);
  assert.equal(ta.style.height, '60px', 'sanity: initial height set');

  // User types more content; scrollHeight grows.
  ta.value = 'short\nmore\nand more lines';
  ta.scrollHeight = 320;
  ta._fire('input');

  assert.equal(
    ta.style.height,
    '320px',
    'input must trigger autoresize using the new scrollHeight'
  );
});

test('input event shrinks textarea: height resets to "auto" before remeasuring', () => {
  const { container, doc } = makeDOM();
  const hw = new HybridWriteView(container, {});
  doc._nextScrollHeight = 320;
  hw.setText('a\nb\nc\nd\ne');
  blockSegs(container)[0]._fire('click');
  const ta = activeTextarea(container);
  assert.equal(ta.style.height, '320px', 'sanity: initial tall height set');

  // Reset the recorder so we only inspect the writes from this input event.
  ta._styleWrites.length = 0;

  // User deletes content; scrollHeight shrinks.
  ta.value = 'a';
  ta.scrollHeight = 80;
  ta._fire('input');

  // Final pixel value must be the smaller scrollHeight.
  assert.equal(
    ta.style.height,
    '80px',
    'shrink: final height must be the new (smaller) scrollHeight'
  );

  // Order of writes: 'auto' (to clear cached height) MUST appear before the
  // final '80px' value, otherwise scrollHeight is locked to the old size and
  // the textarea cannot shrink in real browsers.
  const heightWrites = ta._styleWrites.filter(w => w.prop === 'height');
  const autoIdx  = heightWrites.findIndex(w => w.value === 'auto');
  const finalIdx = heightWrites.findIndex(w => w.value === '80px');
  assert.ok(autoIdx  !== -1, 'expected style.height = "auto" reset before shrink remeasure');
  assert.ok(finalIdx !== -1, 'expected style.height = "80px" final write');
  assert.ok(autoIdx < finalIdx, '"auto" reset must come before the final pixel value');
});

test('compositionend recalculates textarea height', () => {
  const { container, doc } = makeDOM();
  const hw = new HybridWriteView(container, {});
  doc._nextScrollHeight = 60;
  hw.setText('paragraph');
  blockSegs(container)[0]._fire('click');
  const ta = activeTextarea(container);

  ta._fire('compositionstart');
  // Simulate IME-composed text growing the textarea content.
  ta.value = 'paragraph 你好\n世界';
  ta.scrollHeight = 240;
  ta._fire('compositionend');

  assert.equal(
    ta.style.height,
    '240px',
    'compositionend must trigger autoresize so IME-finalized text fits'
  );
});

// ── Blank-note + tail-affordance editing ──────────────────────────────────────
// Reviewer requirement: blank notes must be immediately editable; existing
// notes must support clicking below the last block to start a new paragraph.
// LF-only separator policy: file IO normalizes CRLF→LF before reaching here.

test('empty document renders one active empty textarea', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('');
  const ta = activeTextarea(container);
  assert.ok(ta !== null, 'expected an active textarea after setText("")');
  assert.equal(ta.value, '', 'textarea must start empty');
});

test('typing in the empty-document textarea updates getText() and fires onChange', () => {
  const { container } = makeDOM();
  const received = [];
  const hw = new HybridWriteView(container, { onChange: t => received.push(t) });
  hw.setText('');
  const ta = activeTextarea(container);
  ta.value = '# My New Note';
  ta._fire('input');
  assert.equal(hw.getText(), '# My New Note');
  assert.equal(received.length, 1);
  assert.equal(received[0], '# My New Note');
});

test('whitespace-only document renders an editable textarea and getText() is unchanged before typing', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('   ');
  const ta = activeTextarea(container);
  assert.ok(ta !== null, 'expected an active textarea for whitespace-only source');
  assert.equal(hw.getText(), '   ', 'whitespace must be preserved verbatim before typing');
});

test('non-empty source renders exactly one tail affordance after the last block', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nExisting paragraph.');
  assert.equal(tailAffordances(container).length, 1, 'exactly one affordance');
  const innerChildren = inner(container)._children;
  assert.equal(
    innerChildren[innerChildren.length - 1].className,
    'hybrid-tail-affordance',
    'affordance must be the last child of the inner container'
  );
});

test('non-empty source: zero affordances while tail mode is active', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nExisting paragraph.');
  tailAffordance(container)._fire('click');
  assert.equal(tailAffordances(container).length, 0,
    'affordance must be replaced by the tail textarea while in tail mode');
});

test('clicking the tail affordance produces one active empty textarea, prior blocks remain inactive', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nExisting paragraph.');
  tailAffordance(container)._fire('click');
  const blocks = blockSegs(container);
  const actives   = blocks.filter(b => b.className === 'hybrid-block-active');
  const inactives = blocks.filter(b => b.className === 'hybrid-block-inactive');
  assert.equal(actives.length,   1, 'exactly one active block (the tail)');
  assert.equal(inactives.length, 2, 'both prior blocks remain inactive');
  const ta = activeTextarea(container);
  assert.equal(ta.value, '', 'tail textarea starts empty');
});

test('typing into the tail appends with \\n\\n separator', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nExisting paragraph.');
  tailAffordance(container)._fire('click');
  const ta = activeTextarea(container);
  ta.value = 'New paragraph.';
  ta._fire('input');
  assert.equal(hw.getText(), '# Title\n\nExisting paragraph.\n\nNew paragraph.');
});

test('source ending with single \\n appends with one extra newline', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('A\n');
  tailAffordance(container)._fire('click');
  const ta = activeTextarea(container);
  ta.value = 'B';
  ta._fire('input');
  assert.equal(hw.getText(), 'A\n\nB');
});

test('source ending with \\n\\n appends with no extra separator', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('A\n\n');
  tailAffordance(container)._fire('click');
  const ta = activeTextarea(container);
  ta.value = 'B';
  ta._fire('input');
  assert.equal(hw.getText(), 'A\n\nB');
});

test('tail click + no typing + exitWriteMode leaves source unchanged', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nExisting paragraph.');
  tailAffordance(container)._fire('click');
  // Do NOT type
  hw.exitWriteMode();
  assert.equal(hw.getText(), '# Title\n\nExisting paragraph.', 'no orphan separator');
});

test('tail click + no typing + clicking an existing block leaves source unchanged and activates that block', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nExisting paragraph.');
  tailAffordance(container)._fire('click');
  // Click the heading (first inactive block) without typing
  const headingEl = blockSegs(container).filter(b => b.className === 'hybrid-block-inactive')[0];
  headingEl._fire('click');
  assert.equal(hw.getText(), '# Title\n\nExisting paragraph.', 'source unchanged');
  const ta = activeTextarea(container);
  assert.equal(ta.value, '# Title', 'heading is now the active block');
});

test('tail typing then clearing the textarea back to empty returns getText() to base source', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('A');
  tailAffordance(container)._fire('click');
  const ta = activeTextarea(container);
  ta.value = 'X';
  ta._fire('input');
  assert.equal(hw.getText(), 'A\n\nX');
  ta.value = '';
  ta._fire('input');
  assert.equal(hw.getText(), 'A', 'orphan separator must be removed when tail is cleared');
});

test('repeated tail clicks do not duplicate textareas or duplicate separators', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('A');
  const aff = tailAffordance(container);
  aff._fire('click');
  aff._fire('click'); // second click on the same (now-detached) affordance
  const actives = blockSegs(container).filter(b => b.className === 'hybrid-block-active');
  assert.equal(actives.length, 1, 'exactly one tail textarea');
  const ta = activeTextarea(container);
  ta.value = 'B';
  ta._fire('input');
  assert.equal(hw.getText(), 'A\n\nB', 'no duplicate separator');
});

test('tail textarea autoresize: pre-set scrollHeight is applied on activation', () => {
  const { container, doc } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('A');
  doc._nextScrollHeight = 200;
  tailAffordance(container)._fire('click');
  const ta = activeTextarea(container);
  assert.equal(ta.style.height, '200px',
    'tail textarea must use the existing autoresize helper');
});

test('getText() after setText("") and before any typing returns empty string (placeholder safety)', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('');
  assert.equal(hw.getText(), '', 'no placeholder text leaks into source');
});

test('tail commit then exitWriteMode produces source where appended content parses as a separate block', () => {
  const { splitMarkdownIntoBlocks } = require('../lib/live-editor');
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('# Title\n\nExisting paragraph.');
  const priorCount = splitMarkdownIntoBlocks(hw.getText()).length;
  tailAffordance(container)._fire('click');
  const ta = activeTextarea(container);
  ta.value = 'New paragraph.';
  ta._fire('input');
  hw.exitWriteMode();
  const finalCount = splitMarkdownIntoBlocks(hw.getText()).length;
  assert.equal(finalCount, priorCount + 1, 'tail content must parse as one new block');
});

test('blank-note save path: setText("") + type + exitWriteMode + getText() returns typed content', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  hw.setText('');
  const ta = activeTextarea(container);
  ta.value = 'Hello, world!';
  ta._fire('input');
  hw.exitWriteMode();
  assert.equal(hw.getText(), 'Hello, world!',
    'blank-note typed content must survive exitWriteMode');
});

test('HybridWriteView internal wrapper has the hybrid-write-inner class', () => {
  const { container } = makeDOM();
  const hw = new HybridWriteView(container, {});
  // Constructor creates the inner wrapper; class must be set so scoped CSS
  // can stretch it to full height and let the tail affordance fill the rest.
  assert.equal(inner(container).className, 'hybrid-write-inner');
});
