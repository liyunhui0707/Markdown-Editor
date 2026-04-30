'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const { Marked } = require('marked');
    const { splitMarkdownIntoBlocks } = require('./live-editor');
    module.exports = factory(Marked, splitMarkdownIntoBlocks);
  } else {
    const { splitMarkdownIntoBlocks } = root.LiveEditorCore;
    root.HybridWriteView = factory(root.Marked, splitMarkdownIntoBlocks).HybridWriteView;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Marked, splitMarkdownIntoBlocks) {

  // Aggressive escape for raw HTML token contents — also escapes `=` so
  // attribute-name patterns (e.g. `onclick=`) cannot survive as substrings.
  function escapeHtmlText(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/=/g, '&#61;');
  }

  // Standard escape for attribute values inside renderer-emitted tags.
  function escapeAttr(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Whitelist of URL schemes considered safe for href/src.
  // Anything else (javascript:, data:, vbscript:, file:, etc.) is rejected.
  // URLs without a scheme are treated as relative and allowed.
  function isSafeUrl(href) {
    if (typeof href !== 'string') return false;
    const trimmed = href.trim();
    if (trimmed === '') return false;
    const m = /^([a-z][a-z0-9+.\-]*):/i.exec(trimmed);
    if (!m) return true; // relative URL
    const scheme = m[1].toLowerCase();
    return scheme === 'http' || scheme === 'https' || scheme === 'mailto';
  }

  const safeMarked = new Marked({
    breaks: true,
    renderer: {
      html(token) {
        return escapeHtmlText(token.text || '');
      },
      link(token) {
        const href = String(token.href || '');
        const text = String(token.text || '');
        if (!isSafeUrl(href)) {
          return escapeAttr(text);
        }
        const titlePart = token.title ? ` title="${escapeAttr(String(token.title))}"` : '';
        return `<a href="${escapeAttr(href)}"${titlePart}>${escapeAttr(text)}</a>`;
      },
      image(token) {
        const href = String(token.href || '');
        const text = String(token.text || '');
        if (!isSafeUrl(href)) {
          return escapeAttr(text);
        }
        const titlePart = token.title ? ` title="${escapeAttr(String(token.title))}"` : '';
        return `<img src="${escapeAttr(href)}" alt="${escapeAttr(text)}"${titlePart}>`;
      },
    },
  });

  // LF-only line-ending policy: HybridWriteView assumes LF-normalized input.
  // The file IO layer is responsible for any CRLF→LF normalization on load.
  // Compute the separator needed to make `s` end with exactly one blank line
  // so a tail-appended block is parsed as its own paragraph.
  function computeTailSep(s) {
    if (s === '')             return '';
    if (s.endsWith('\n\n'))   return '';
    if (s.endsWith('\n'))     return '\n';
    return '\n\n';
  }

  function HybridWriteView(container, opts) {
    this._container         = container;
    this._onChange          = (opts && opts.onChange) || null;
    this._sourceText        = '';
    this._activeStart       = -1;
    this._activeEnd         = -1;
    this._activeTextareaEl  = null;
    this._segmentRefs       = [];
    this._isComposing       = false;
    this._pendingSwapCompute = null;
    this._isTailActive      = false;
    this._tailBaseSource    = '';
    this._tailSep           = '';

    this._inner = container.ownerDocument.createElement('div');
    this._inner.className = 'hybrid-write-inner';
    container.appendChild(this._inner);
  }

  HybridWriteView.prototype.getText = function () {
    return this._sourceText;
  };

  HybridWriteView.prototype.setText = function (raw) {
    raw = (raw == null) ? '' : String(raw);
    this._sourceText        = raw;
    this._activeStart       = -1;
    this._activeEnd         = -1;
    this._activeTextareaEl  = null;
    this._isTailActive      = false;
    this._tailBaseSource    = '';
    this._tailSep           = '';
    this._render();
  };

  HybridWriteView.prototype.exitWriteMode = function () {
    this._flushAny();
    this._activeStart       = -1;
    this._activeEnd         = -1;
    this._activeTextareaEl  = null;
    this._isTailActive      = false;
    this._tailBaseSource    = '';
    this._tailSep           = '';
    this._render();
  };

  // ── Internal ──────────────────────────────────────────────────────────────

  HybridWriteView.prototype._flushActive = function () {
    if (this._activeTextareaEl === null) return;
    // Safety: never run normal slice logic against a tail textarea, where
    // _activeStart points past the last real block. Tail commits go through
    // _flushTailActive instead.
    if (this._isTailActive) return;
    const newRaw = this._activeTextareaEl.value;
    const before = this._sourceText.slice(0, this._activeStart);
    const after  = this._sourceText.slice(this._activeEnd);
    this._sourceText = before + newRaw + after;
    this._activeEnd  = this._activeStart + newRaw.length;
  };

  // Idempotent tail commit: derive source from snapshotted base + sep + value.
  // Empty value means "no commit" — base is restored so no orphan separator
  // pollutes the source if the user clicked the tail but never typed.
  HybridWriteView.prototype._flushTailActive = function () {
    if (this._activeTextareaEl === null) return;
    if (!this._isTailActive) return;
    const newRaw = this._activeTextareaEl.value;
    if (newRaw === '') {
      this._sourceText = this._tailBaseSource;
    } else {
      this._sourceText = this._tailBaseSource + this._tailSep + newRaw;
    }
  };

  HybridWriteView.prototype._flushAny = function () {
    if (this._isTailActive) this._flushTailActive();
    else                    this._flushActive();
  };

  HybridWriteView.prototype._activateTail = function () {
    if (this._isTailActive) return; // idempotent: repeated clicks are no-ops
    this._flushAny();
    this._isTailActive   = true;
    this._tailBaseSource = this._sourceText;
    this._tailSep        = computeTailSep(this._sourceText);
    this._activeStart    = this._tailBaseSource.length + this._tailSep.length;
    this._activeEnd      = this._activeStart;
    this._render();
  };

  HybridWriteView.prototype._render = function () {
    const inner = this._inner;
    for (let i = 0; i < this._segmentRefs.length; i++) {
      inner.removeChild(this._segmentRefs[i]);
    }
    this._segmentRefs      = [];
    this._activeTextareaEl = null;

    const blocks = splitMarkdownIntoBlocks(this._sourceText);
    const doc    = this._container.ownerDocument;
    const self   = this;

    // Auto-tail: empty or whitespace-only source produces zero blocks, so
    // open an editable tail textarea immediately — otherwise blank notes
    // would have no place for the user to type.
    if (blocks.length === 0 && !this._isTailActive) {
      this._isTailActive   = true;
      this._tailBaseSource = this._sourceText;
      this._tailSep        = computeTailSep(this._sourceText);
      this._activeStart    = this._tailBaseSource.length + this._tailSep.length;
      this._activeEnd      = this._activeStart;
    }

    // Pre-resolve the active block's end so inactive-block closures rendered
    // BEFORE the active block in source order still capture the correct
    // renderActiveEnd. In tail mode no real block is active.
    const renderActiveStart = this._isTailActive ? -1 : this._activeStart;
    let   renderActiveEnd   = -1;
    if (renderActiveStart >= 0) {
      const ab = blocks.find(b => b.start === renderActiveStart);
      if (ab) renderActiveEnd = ab.end;
    }
    if (!this._isTailActive) {
      this._activeEnd = renderActiveEnd;
    }

    let pos = 0;

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];

      if (pos < b.start) {
        const gap = doc.createElement('div');
        gap.className = 'hybrid-gap';
        inner.appendChild(gap);
        this._segmentRefs.push(gap);
      }

      const isActive = !this._isTailActive && (b.start === this._activeStart);
      const blockEl  = doc.createElement('div');

      if (isActive) {
        blockEl.className = 'hybrid-block-active';
        const ta = doc.createElement('textarea');
        ta.className   = 'hybrid-active-textarea';
        ta.value       = b.raw;
        ta.placeholder = '';

        this._activeTextareaEl = ta;

        ta.addEventListener('input', function () {
          const newRaw = ta.value;
          const before = self._sourceText.slice(0, self._activeStart);
          const after  = self._sourceText.slice(self._activeEnd);
          self._sourceText = before + newRaw + after;
          self._activeEnd  = self._activeStart + newRaw.length;
          self._autoresizeTextarea(ta);
          if (self._onChange) self._onChange(self._sourceText);
        });

        ta.addEventListener('compositionstart', function () {
          self._isComposing = true;
        });

        ta.addEventListener('compositionend', function () {
          self._isComposing = false;
          self._autoresizeTextarea(ta);
          if (self._pendingSwapCompute !== null) {
            const compute = self._pendingSwapCompute;
            self._pendingSwapCompute = null;
            self._activateBlockByStart(compute());
          }
        });

        blockEl.appendChild(ta);
      } else {
        blockEl.className = 'hybrid-block-inactive';
        blockEl.innerHTML = safeMarked.parse(b.raw);

        const renderClickStart = b.start;
        const computeCurrentStart = function () {
          if (renderActiveStart >= 0 && renderClickStart >= renderActiveEnd) {
            return renderClickStart + (self._activeEnd - renderActiveEnd);
          }
          return renderClickStart;
        };

        blockEl.addEventListener('click', function () {
          if (self._isComposing) {
            self._pendingSwapCompute = computeCurrentStart;
            return;
          }
          self._activateBlockByStart(computeCurrentStart());
        });
      }

      inner.appendChild(blockEl);
      this._segmentRefs.push(blockEl);
      pos = b.end;
    }

    if (pos < this._sourceText.length) {
      const gap = doc.createElement('div');
      gap.className = 'hybrid-gap';
      inner.appendChild(gap);
      this._segmentRefs.push(gap);
    }

    // Tail surface: while in tail mode, an empty editable textarea takes the
    // last slot. Otherwise, a click affordance occupies the area below the
    // last block so the user can start a new paragraph.
    if (this._isTailActive) {
      const tailBlock = doc.createElement('div');
      tailBlock.className = 'hybrid-block-active';
      const ta = doc.createElement('textarea');
      ta.className   = 'hybrid-active-textarea';
      const baseSepLen = this._tailBaseSource.length + this._tailSep.length;
      ta.value = this._sourceText.length > baseSepLen
        ? this._sourceText.slice(baseSepLen)
        : '';
      ta.placeholder = '';

      this._activeTextareaEl = ta;

      ta.addEventListener('input', function () {
        const newRaw = ta.value;
        if (newRaw === '') {
          self._sourceText = self._tailBaseSource;
        } else {
          self._sourceText = self._tailBaseSource + self._tailSep + newRaw;
        }
        self._autoresizeTextarea(ta);
        if (self._onChange) self._onChange(self._sourceText);
      });

      ta.addEventListener('compositionstart', function () {
        self._isComposing = true;
      });

      ta.addEventListener('compositionend', function () {
        self._isComposing = false;
        self._autoresizeTextarea(ta);
        if (self._pendingSwapCompute !== null) {
          const compute = self._pendingSwapCompute;
          self._pendingSwapCompute = null;
          self._activateBlockByStart(compute());
        }
      });

      tailBlock.appendChild(ta);
      inner.appendChild(tailBlock);
      this._segmentRefs.push(tailBlock);
    } else {
      const affordance = doc.createElement('div');
      affordance.className = 'hybrid-tail-affordance';
      affordance.addEventListener('click', function () {
        if (self._isComposing) return;
        self._activateTail();
      });
      inner.appendChild(affordance);
      this._segmentRefs.push(affordance);
    }

    // Place caret and focus AFTER the active textarea is attached to the
    // real DOM. Calling these before appendChild is a no-op in browsers
    // for an unattached element and was causing focus to fail in practice.
    if (this._activeTextareaEl !== null) {
      this._activeTextareaEl.setSelectionRange(0, 0);
      this._activeTextareaEl.focus();
      this._autoresizeTextarea(this._activeTextareaEl);
    }
  };

  // Resize the active textarea to fit its current content. The 'auto' reset
  // is required so scrollHeight reflects the SHRUNK content size when the
  // user deletes lines — otherwise scrollHeight stays clamped to the prior
  // (taller) layout and the textarea cannot shrink.
  HybridWriteView.prototype._autoresizeTextarea = function (ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  };

  HybridWriteView.prototype._activateBlockByStart = function (start) {
    this._flushAny();
    this._isTailActive   = false;
    this._tailBaseSource = '';
    this._tailSep        = '';
    const blocks = splitMarkdownIntoBlocks(this._sourceText);
    const found  = blocks.find(b => b.start === start);
    if (!found) return;
    this._activeStart = found.start;
    this._render();
  };

  return { HybridWriteView };
});
