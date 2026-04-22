/* Unified live editor — two explicit modes:
     VIEW mode  : renders Markdown as HTML, fully selectable, no text boxes
     EDIT mode  : one single textarea for the whole note body

   Works in both Node.js (for tests) and the browser (plain <script> tag). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./live-editor'));
  } else {
    root.LiveEditorComponent = factory(root.LiveEditorCore);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (liveEditorCore) {

  const { parseBlocks } = liveEditorCore;

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
     * @param {Element} container
     * @param {{ initialText?: string, onChange?: (text: string) => void }} options
     */
    constructor(container, options = {}) {
      this._container = container;
      this._onChange  = options.onChange || null;
      this._text      = options.initialText || '';
      this._editMode  = false;
      this._render();
    }

    /* Return the current text, flushing the textarea if it is open. */
    getText() {
      const ta = this._container.querySelector('textarea[data-live-edit]');
      return ta ? ta.value : this._text;
    }

    /* Load new text and switch back to view mode (used when switching notes). */
    setText(text) {
      this._text     = text;
      this._editMode = false;
      this._render();
    }

    /* Switch to edit mode — called by the Edit button in the toolbar. */
    enterEditMode() {
      this._text     = this.getText(); // flush any in-flight changes
      this._editMode = true;
      this._render();
      const ta = this._container.querySelector('textarea[data-live-edit]');
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length); // cursor at end
      }
    }

    /* Switch back to view mode — called by the Done button. */
    exitEditMode() {
      const ta = this._container.querySelector('textarea[data-live-edit]');
      if (ta) {
        this._text = ta.value;
        if (this._onChange) this._onChange(this._text);
      }
      this._editMode = false;
      this._render();
    }

    // ─── private ─────────────────────────────────────────────────────────────

    _render() {
      this._container.innerHTML = '';

      if (this._editMode) {
        this._container.appendChild(this._makeTextarea());
      } else {
        this._renderViewMode();
      }
    }

    /* VIEW MODE: render each block as formatted HTML — nothing is clickable. */
    _renderViewMode() {
      const blocks = parseBlocks(this._text);

      if (blocks.length === 0) {
        const hint = this._container.ownerDocument.createElement('div');
        hint.className   = 'live-editor-empty-hint';
        hint.textContent = 'Empty note — click Edit to start writing.';
        this._container.appendChild(hint);
        return;
      }

      blocks.forEach((block) => {
        const div = this._container.ownerDocument.createElement('div');
        div.className = 'live-editor-block preview-markdown';
        div.innerHTML = renderMarkdown(block.raw);
        this._container.appendChild(div);
      });
    }

    /* EDIT MODE: one textarea for the whole note body. */
    _makeTextarea() {
      const doc = this._container.ownerDocument;
      const ta  = doc.createElement('textarea');
      ta.className        = 'live-editor-active-textarea';
      ta.dataset.liveEdit = 'true';
      ta.value            = this._text;
      ta.rows             = Math.max(8, this._text.split('\n').length + 2);
      ta.placeholder      = 'Start writing your note…';

      /* Fire onChange on every keystroke so the note list stays in sync. */
      ta.addEventListener('input', () => {
        if (this._onChange) this._onChange(ta.value);
      });

      return ta;
    }
  }

  return { LiveEditor };
});
