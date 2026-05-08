'use strict';

/* Experimental CM6 hybrid live-styling Write-mode adapter (Stage 11.4).
   Feature-flagged as ?writeEngine=hybrid-cm6 — NOT the default.

   Live-styling approach:
     - syntaxTree(state) provides Markdown structure (no custom regex parsing).
     - Decoration.mark applies CSS classes to heading nodes and HeaderMark ranges.
     - Hidden / dimmed visibility of `#` markers is controlled by CSS keyed off
       the .cm-activeLine class added by the bundled highlightActiveLine.
     - Underlying text is never replaced; the cursor traverses real characters,
       and getText() returns raw Markdown verbatim.

   Adapter contract (same shape as cm6-write-view.js):
     getText() / setText(text) / getState() / setState(state) / exitWriteMode()
     focus()  / destroy()  /  view (the underlying CM6 EditorView) */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Cm6HybridView = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // True only for an inline Markdown link — a Link node with a direct URL
  // child. Reference-style Link nodes (which have a LinkLabel instead of a
  // URL) and non-Link constructs (Image, Autolink, LinkReference, bare URL)
  // all return false. Used by both the Link branch and the parent-guard for
  // LinkMark / URL / LinkTitle children.
  function isInlineLinkNode(linkNode) {
    if (!linkNode || linkNode.name !== 'Link') return false;
    for (let child = linkNode.firstChild; child; child = child.nextSibling) {
      if (child.name === 'URL') return true;
    }
    return false;
  }

  // For an inline Link, return the label range — the text between the first
  // "[" LinkMark and the first "]" LinkMark. Returns null if the structure
  // is unexpected. The range can be empty (e.g., "[](url)") and callers
  // should guard against that before emitting a decoration.
  function inlineLinkLabelRange(linkNode) {
    let openBracket = null;
    let closeBracket = null;
    for (let child = linkNode.firstChild; child; child = child.nextSibling) {
      if (child.name !== 'LinkMark') continue;
      if (!openBracket) {
        openBracket = child;
      } else if (!closeBracket) {
        closeBracket = child;
        break;
      }
    }
    if (!openBracket || !closeBracket) return null;
    return { from: openBracket.to, to: closeBracket.from };
  }

  // Walk the Markdown syntax tree and emit Decoration.mark ranges for live
  // styling: ATX headings (h1–h6), inline emphasis / inline code, and
  // inline Markdown links. Returns a DecorationSet (or an equivalent shape
  // from the fake backend used by adapter-contract tests) — empty when no
  // syntaxTree is available.
  //
  // Container nodes are marked with style classes (cm-md-h<N>, cm-md-bold,
  // cm-md-italic, cm-md-inline-code). Their delimiter children (HeaderMark,
  // EmphasisMark, CodeMark) are marked with hide/reveal classes. The shared
  // cm-md-syntax base class on inline markers lets one CSS rule control all
  // of them; cm-md-heading-mark stays separate so Stage 11.4 styling is
  // preserved verbatim.
  function buildHeadingDecorations(state, cm6) {
    const decorations = [];

    if (cm6 && typeof cm6.syntaxTree === 'function') {
      const tree = cm6.syntaxTree(state);
      if (tree && typeof tree.iterate === 'function') {
        tree.iterate({
          enter(node) {
            const name = node.name;
            if (!name) return;

            const h = name.match(/^ATXHeading([1-6])$/);
            if (h) {
              const level = h[1];
              decorations.push(
                cm6.Decoration.mark({ class: 'cm-md-h' + level }).range(node.from, node.to)
              );
              // HeaderMark child = the "#"…"######" run at the start of the line.
              for (let child = node.node.firstChild; child; child = child.nextSibling) {
                if (child.name === 'HeaderMark') {
                  decorations.push(
                    cm6.Decoration.mark({ class: 'cm-md-heading-mark' }).range(child.from, child.to)
                  );
                }
              }
              // Do NOT return false — let the iterator descend so inline
              // Markdown inside the heading (StrongEmphasis / Emphasis /
              // InlineCode and their *Mark children) reaches its own
              // enter() branch below. The HeaderMark child has no inline
              // branch that matches, so it silently falls through and is
              // not double-emitted.
              return;
            }

            // Inline live styling. Descend into these so nested children
            // (e.g., Emphasis inside StrongEmphasis, EmphasisMark/CodeMark)
            // are reached on their own enter() calls.
            if (name === 'StrongEmphasis') {
              decorations.push(
                cm6.Decoration.mark({ class: 'cm-md-bold' }).range(node.from, node.to)
              );
            } else if (name === 'Emphasis') {
              decorations.push(
                cm6.Decoration.mark({ class: 'cm-md-italic' }).range(node.from, node.to)
              );
            } else if (name === 'InlineCode') {
              decorations.push(
                cm6.Decoration.mark({ class: 'cm-md-inline-code' }).range(node.from, node.to)
              );
            } else if (name === 'EmphasisMark') {
              decorations.push(
                cm6.Decoration.mark({ class: 'cm-md-syntax cm-md-emphasis-mark' })
                  .range(node.from, node.to)
              );
            } else if (name === 'CodeMark') {
              // Lezer reuses CodeMark for InlineCode delimiters AND for
              // FencedCode block delimiters. They get different decorations:
              //   - InlineCode  → hidden via cm-md-syntax (revealed on active line)
              //   - FencedCode  → dimmed but always visible (Stage 11.9)
              const parent = node.node.parent;
              if (parent && parent.name === 'InlineCode') {
                decorations.push(
                  cm6.Decoration.mark({ class: 'cm-md-syntax cm-md-code-mark' })
                    .range(node.from, node.to)
                );
              } else if (parent && parent.name === 'FencedCode') {
                decorations.push(
                  cm6.Decoration.mark({ class: 'cm-md-fenced-code-mark' })
                    .range(node.from, node.to)
                );
              }
            } else if (name === 'CodeInfo') {
              // Stage 11.9: dim the language info string after an opening
              // fence (e.g., "js" in "```js"). CodeInfo only appears inside
              // FencedCode per the parser, so no parent guard is needed.
              decorations.push(
                cm6.Decoration.mark({ class: 'cm-md-fenced-code-info' })
                  .range(node.from, node.to)
              );
            } else if (name === 'Link') {
              // Stage 11.7: inline [text](url) only. Reference-style links
              // (no URL child) are deferred. Style the label range with
              // cm-md-link-text; the iterator descends to handle LinkMark/
              // URL/LinkTitle children plus any nested emphasis in the label.
              if (isInlineLinkNode(node.node)) {
                const labelRange = inlineLinkLabelRange(node.node);
                if (labelRange && labelRange.from < labelRange.to) {
                  decorations.push(
                    cm6.Decoration.mark({ class: 'cm-md-link-text' })
                      .range(labelRange.from, labelRange.to)
                  );
                }
              }
            } else if (name === 'LinkMark' || name === 'URL' || name === 'LinkTitle') {
              // Hide brackets, parens, URL, and title — but only when they
              // belong to an inline Link (excludes Image, Autolink, bare URL,
              // LinkReference, and reference-style Link nodes without URL).
              if (isInlineLinkNode(node.node.parent)) {
                decorations.push(
                  cm6.Decoration.mark({ class: 'cm-md-syntax cm-md-link-mark' })
                    .range(node.from, node.to)
                );
              }
            } else if (name === 'ListMark') {
              // Stage 11.8: dim "-", "*", "+", "1.", "1)" markers. ListMark
              // appears only inside ListItem per the parser, so no parent
              // guard is needed. Markers stay visible (not hidden) so the
              // visual structure of lists is preserved.
              decorations.push(
                cm6.Decoration.mark({ class: 'cm-md-list-mark' })
                  .range(node.from, node.to)
              );
            } else if (name === 'QuoteMark') {
              // Stage 11.8: dim ">" markers. QuoteMark appears only inside
              // Blockquote (or its spanning Paragraph for multi-line cases),
              // so no parent guard is needed. Like ListMark, the marker stays
              // visible so the quoted-block character remains scannable.
              decorations.push(
                cm6.Decoration.mark({ class: 'cm-md-quote-mark' })
                  .range(node.from, node.to)
              );
            } else if (name === 'HorizontalRule') {
              // Stage 14.1: dim CommonMark thematic breaks (---, ***, ___).
              // The parser disambiguates Setext H2 underlines (--- after
              // non-blank text) as SetextHeading2 and never emits them as
              // HorizontalRule, so no parent guard is needed. Source chars
              // stay in the document — only their visual presentation
              // changes via the cm-md-hr CSS rule.
              decorations.push(
                cm6.Decoration.mark({ class: 'cm-md-hr' })
                  .range(node.from, node.to)
              );
            } else if (name === 'Strikethrough') {
              // Stage 14.2: GFM ~~strike~~. The Strikethrough node only
              // exists when @lezer/markdown's Strikethrough extension is
              // registered in the markdown() call (see lib/cm6-entry.js).
              // Descend into the node so StrikethroughMark children reach
              // their own enter() branch below.
              decorations.push(
                cm6.Decoration.mark({ class: 'cm-md-strikethrough' })
                  .range(node.from, node.to)
              );
            } else if (name === 'StrikethroughMark') {
              // Stage 14.2: hide the "~~" delimiters via the shared
              // cm-md-syntax hide/reveal class. Active-line CSS reveals
              // them when the caret is on the line.
              decorations.push(
                cm6.Decoration.mark({ class: 'cm-md-syntax cm-md-strikethrough-mark' })
                  .range(node.from, node.to)
              );
            } else if (name === 'TaskMarker') {
              // Stage 14.3: dim the "[ ]", "[x]", "[X]" task markers.
              // TaskMarker appears only inside a Task node (which itself
              // only appears inside a ListItem) per the parser, so no
              // parent guard is needed. Like ListMark and QuoteMark, the
              // marker stays visible (not hidden) so task list structure
              // remains scannable. NOT clickable — purely Decoration.mark
              // styling, no document mutation, no widget.
              decorations.push(
                cm6.Decoration.mark({ class: 'cm-md-task-marker' })
                  .range(node.from, node.to)
              );
            }
          },
        });
      }
    }

    // Decoration.set(arr, true) sorts internally so callers don't have to
    // worry about parent-vs-child ordering coming out of tree iteration.
    if (cm6 && cm6.Decoration && typeof cm6.Decoration.set === 'function') {
      return cm6.Decoration.set(decorations, true);
    }
    // Fake-backend fallback: tests that don't supply syntaxTree never read
    // these ranges, so the shape is irrelevant beyond "not crashing".
    return { _ranges: decorations };
  }

  function createCm6HybridView(parent, opts) {
    const o          = opts || {};
    const initialDoc = o.initialDoc != null ? String(o.initialDoc) : '';
    const onChange   = typeof o.onChange === 'function' ? o.onChange : null;
    const cm6        = o.cm6;

    if (!cm6 || !cm6.EditorState || !cm6.EditorView) {
      throw new Error('cm6 backend missing (pass opts.cm6 from the bundled namespace)');
    }
    if (!cm6.ViewPlugin || !cm6.Decoration) {
      throw new Error('cm6 hybrid live-styling missing required primitives (ViewPlugin, Decoration)');
    }

    // ViewPlugin: rebuild heading decorations whenever the doc or viewport
    // changes. Selection-only updates do NOT rebuild — the active/inactive
    // visibility flip is driven by CSS (.cm-activeLine), so the decoration
    // set itself is selection-independent.
    const headingMarkPlugin = cm6.ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.decorations = buildHeadingDecorations(view.state, cm6);
        }
        update(update) {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = buildHeadingDecorations(update.state, cm6);
          }
        }
      },
      { decorations: (v) => v.decorations }
    );

    function buildState(doc) {
      const extensions = [
        cm6.history(),
        cm6.markdown ? cm6.markdown() : null,
        cm6.EditorView.lineWrapping,
        cm6.EditorView.updateListener.of(function (update) {
          if (!update.docChanged) return;
          if (!onChange) return;
          onChange(update.state.doc.toString());
        }),
        headingMarkPlugin,
        Array.isArray(cm6.chrome) ? cm6.chrome : null,
      ].filter(function (e) { return e != null; });
      return cm6.EditorState.create({ doc: doc, extensions: extensions });
    }

    const view = new cm6.EditorView({
      state:  buildState(initialDoc),
      parent: parent,
    });

    return {
      view: view,
      getText:       function ()       { return view.state.doc.toString(); },
      setText:       function (text)   { view.setState(buildState(text == null ? '' : String(text))); },
      getState:      function ()       { return view.state; },
      setState:      function (state)  { view.setState(state); },
      exitWriteMode: function ()       { /* no-op: CM6 has no inactive-block mode */ },
      focus:         function ()       { view.focus(); },
      destroy:       function ()       { view.destroy(); },
    };
  }

  return { createCm6HybridView, buildHeadingDecorations };
});
