/* Unified live editor — renders Markdown blocks inline.
   Click a block to edit it; blur to return to the rendered view.
   Works in both Node.js (for tests) and the browser (plain <script> tag). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./live-editor'));
  } else {
    root.LiveEditorComponent = factory(root.LiveEditorCore);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (liveEditorCore) {

  const { parseBlocks, replaceBlock } = liveEditorCore;

  /* Render raw Markdown to HTML. Falls back to basic rendering in test environments. */
  function renderMarkdown(raw) {
    if (typeof marked !== 'undefined' && marked.parse) {
      return marked.parse(raw);
    }
    return raw
      .split('\n')
      .map((line) => {
        const m = line.match(/^(#{1,6})\s+(.*)/);
        if (m) return `<h${m[1].length}>${m[2]}</h${m[1].length}>`;
        return `<p>${line}</p>`;
      })
      .join('');
  }

  class LiveEditor {
    /**
     * @param {Element} container  — the div that holds the editor
     * @param {{ initialText?: string, onChange?: (text: string) => void }} options
     */
    constructor(container, options = {}) {
      this._container = container;
      this._onChange = options.onChange || null;
      this._text = options.initialText || '';
      this._blocks = [];
      this._activeIndex = -1;    // which block is currently being edited (-1 = none)
      this._pointerDown = null;  // tracks where the mouse was pressed
      this._hadSelectionOnMouseUp = false; // was text selected when the mouse was released?
      this._render();
    }

    /* Return the current full Markdown text, flushing any active textarea first. */
    getText() {
      const ta = this._container.querySelector('textarea[data-active-block]');
      if (ta && this._activeIndex >= 0) {
        return replaceBlock(this._text, this._blocks[this._activeIndex], ta.value);
      }
      return this._text;
    }

    /* Load new text and re-render from scratch (used when switching notes). */
    setText(text) {
      this._text = text;
      this._activeIndex = -1;
      this._render();
    }

    // ─── private methods ─────────────────────────────────────────────────────

    /* Rebuild the entire editor DOM from the current text. */
    _render() {
      this._blocks = parseBlocks(this._text);
      this._container.innerHTML = '';

      if (this._blocks.length === 0) {
        // Empty note — show a single blank textarea so the user can start typing
        this._container.appendChild(this._makeEmptyTextarea());
        return;
      }

      this._blocks.forEach((block, index) => {
        if (index === this._activeIndex) {
          this._container.appendChild(this._makeTextarea(block, index));
        } else {
          this._container.appendChild(this._makeBlockDiv(block, index));
        }
      });
    }

    /* The textarea shown when the note is completely empty. */
    _makeEmptyTextarea() {
      const doc = this._container.ownerDocument;
      const ta = doc.createElement('textarea');
      ta.className = 'live-editor-active-textarea';
      ta.dataset.activeBlock = 'empty';
      ta.value = '';
      ta.rows = 3;
      ta.placeholder = 'Start writing your note…';

      ta.addEventListener('blur', () => {
        const newRaw = ta.value.trim();
        if (newRaw) {
          this._text = newRaw;
          if (this._onChange) this._onChange(this._text);
        }
        this._activeIndex = -1;
        this._render();
      });

      return ta;
    }

    /* A rendered HTML block. Clicking it (without selecting text) activates editing. */
    _makeBlockDiv(block, index) {
      const div = this._container.ownerDocument.createElement('div');
      div.className = 'live-editor-block preview-markdown';
      div.dataset.blockIndex = String(index);
      div.innerHTML = renderMarkdown(block.raw);

      /* Record where the mouse was pressed so we can tell drags from clicks. */
      div.addEventListener('mousedown', (event) => {
        this._pointerDown = { x: event.clientX, y: event.clientY, button: event.button };
        this._hadSelectionOnMouseUp = false;
      });

      /* At mouseup the browser has finalized the selection — capture it now.
         This is more reliable than checking inside the click event. */
      div.addEventListener('mouseup', () => {
        const view = div.ownerDocument.defaultView;
        const sel = view && typeof view.getSelection === 'function' ? view.getSelection() : null;
        this._hadSelectionOnMouseUp = !!(sel && !sel.isCollapsed);
      });

      /* Activate edit mode only for a plain, deliberate click — not a drag, not a selection. */
      div.addEventListener('click', (event) => {
        const dragged =
          this._pointerDown &&
          this._pointerDown.button === event.button &&
          (Math.abs(event.clientX - this._pointerDown.x) > 4 ||
            Math.abs(event.clientY - this._pointerDown.y) > 4);
        this._pointerDown = null;

        if (dragged) return;
        if (this._hadSelectionOnMouseUp) return;

        this._activeIndex = index;
        this._render();
        const ta = this._container.querySelector('textarea[data-active-block]');
        if (ta) ta.focus();
      });

      return div;
    }

    /* The textarea shown when a block is being edited. */
    _makeTextarea(block, index) {
      const doc = this._container.ownerDocument;
      const ta = doc.createElement('textarea');
      ta.className = 'live-editor-active-textarea';
      ta.dataset.activeBlock = String(index);
      ta.value = block.raw;
      ta.rows = Math.max(3, block.raw.split('\n').length + 1);

      ta.addEventListener('blur', () => {
        const newRaw = ta.value;
        const changed = newRaw !== block.raw;

        if (changed) {
          this._text = replaceBlock(this._text, block, newRaw);
          if (this._onChange) this._onChange(this._text);
        }

        this._activeIndex = -1;
        this._render();
      });

      return ta;
    }
  }

  return { LiveEditor };
});
