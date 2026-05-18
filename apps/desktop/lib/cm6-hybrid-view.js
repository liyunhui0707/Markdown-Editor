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

  // Stage 14.5: an inline image is an Image node with a URL child (the
  // image source). Reference-style images "![alt][1]" have a LinkLabel
  // child instead and are intentionally NOT styled (non-goal).
  function isInlineImageNode(imageNode) {
    if (!imageNode || imageNode.name !== 'Image') return false;
    for (let child = imageNode.firstChild; child; child = child.nextSibling) {
      if (child.name === 'URL') return true;
    }
    return false;
  }

  // Stage 14.5: alt-text range = between the closing of the first LinkMark
  // ("![") and the start of the second LinkMark ("]"). Mirrors
  // inlineLinkLabelRange. The range can be empty (e.g., "![](url)") and
  // callers should guard with from < to before emitting a decoration.
  function inlineImageAltRange(imageNode) {
    let first = null;
    let second = null;
    for (let child = imageNode.firstChild; child; child = child.nextSibling) {
      if (child.name !== 'LinkMark') continue;
      if (!first) {
        first = child;
      } else if (!second) {
        second = child;
        break;
      }
    }
    if (!first || !second) return null;
    return { from: first.to, to: second.from };
  }

  // Stage 14.6: a reference link is a Link node with a LinkLabel child
  // (full "[text][ref]" or collapsed "[text][]" forms). Inline links
  // (with URL child) and shortcut links "[shortcut]" (no LinkLabel,
  // no URL — same parser shape as plain bracketed text) both return
  // false. Shortcut references are deferred because the parser cannot
  // distinguish them from plain text without a document-wide scan.
  function isReferenceLinkNode(linkNode) {
    if (!linkNode || linkNode.name !== 'Link') return false;
    for (let child = linkNode.firstChild; child; child = child.nextSibling) {
      if (child.name === 'LinkLabel') return true;
    }
    return false;
  }

  // Stage 14.9: detect a top-of-file YAML frontmatter region. Returns
  // { from: 0, to: <end-of-closing-line> } when the doc begins with a
  // strict "---" line and a later strict "---" line exists, otherwise
  // null. The CommonMark parser does not recognize frontmatter as a
  // structural construct: the leading "---" is parsed as HorizontalRule,
  // and the closing "---" (when it follows a non-blank metadata line)
  // is parsed as SetextHeading2's HeaderMark. Without intervention the
  // metadata region picks up cm-md-hr, cm-md-h2, cm-md-heading-mark,
  // AND any inline classes (cm-md-bold, cm-md-autolink-url, etc.) of
  // constructs nested inside the metadata text. buildHeadingDecorations
  // uses this region to suppress ALL decoration emission inside it, so
  // frontmatter renders as plain text. Strict equality on "---" matches
  // typical YAML conventions and avoids false positives on lines like
  // "--- " (HR with trailing whitespace) or "----" (longer rule).
  function detectFrontmatter(state) {
    const doc = state.doc;
    // Tolerate the minimal fake-doc backend used by adapter-contract tests,
    // which exposes only toString() / length and never reaches the
    // syntaxTree branch — return null so suppression is a no-op there.
    if (!doc || typeof doc.line !== 'function') return null;
    if (doc.lines < 2) return null;
    if (doc.line(1).text !== '---') return null;
    for (let i = 2; i <= doc.lines; i++) {
      if (doc.line(i).text === '---') {
        return { from: 0, to: doc.line(i).to };
      }
    }
    return null;
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
    const frontmatter = detectFrontmatter(state);

    if (cm6 && typeof cm6.syntaxTree === 'function') {
      const tree = cm6.syntaxTree(state);
      if (tree && typeof tree.iterate === 'function') {
        tree.iterate({
          enter(node) {
            // Stage 14.9: suppress all decoration emission inside top-of-file
            // YAML frontmatter so metadata renders as plain text. Returning
            // here still lets the iterator descend into child nodes — each
            // child also satisfies node.from < frontmatter.to and is therefore
            // suppressed by the same check, which is how this single guard
            // catches HR, Setext, AND every inline construct nested inside
            // the metadata text (bold, autolinks, etc.).
            if (frontmatter && node.from < frontmatter.to) {
              return;
            }
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

            // Stage 14.7 — Setext headings. Lezer Markdown emits
            // SetextHeading1 / SetextHeading2 container nodes whose text
            // spans the first line and whose HeaderMark child spans the
            // "=====" or "-----" underline run on the next line. Reuse the
            // existing .cm-md-h1 / .cm-md-h2 / .cm-md-heading-mark CSS so
            // Setext H1/H2 visually align with their ATX counterparts. The
            // text mark MUST exclude the trailing newline before the
            // underline so cm-md-h{1,2} typography does not bleed into the
            // underline line. The walker descends so inline emphasis /
            // inline-code / strikethrough inside the heading text still
            // reach their own enter() branches (mirrors the ATX comment).
            if (name === 'SetextHeading1' || name === 'SetextHeading2') {
              const level = name === 'SetextHeading1' ? '1' : '2';
              let headerMark = null;
              for (let child = node.node.firstChild; child; child = child.nextSibling) {
                if (child.name === 'HeaderMark') { headerMark = child; break; }
              }
              let textTo = headerMark ? headerMark.from : node.to;
              if (
                textTo > node.from
                && state.doc.sliceString(textTo - 1, textTo) === '\n'
              ) {
                textTo -= 1;
              }
              if (node.from < textTo) {
                decorations.push(
                  cm6.Decoration.mark({ class: 'cm-md-h' + level }).range(node.from, textTo)
                );
              }
              if (headerMark) {
                decorations.push(
                  cm6.Decoration.mark({ class: 'cm-md-heading-mark' })
                    .range(headerMark.from, headerMark.to)
                );
              }
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
              // Two shapes are styled here:
              //   - Stage 11.7: inline "[text](url)" — Link with URL child.
              //     Label gets cm-md-link-text.
              //   - Stage 14.6: full "[text][ref]" or collapsed "[text][]"
              //     reference link — Link with LinkLabel child. Label gets
              //     cm-md-reflink-text. The same label-range helper applies
              //     because both shapes have "[" and "]" as the first two
              //     LinkMark children.
              // Shortcut references "[shortcut]" remain deferred because the
              // parser cannot distinguish them from plain bracketed text
              // without a document-wide cross-reference scan.
              // The iterator descends in either case so LinkMark / LinkLabel
              // / URL / LinkTitle children and nested emphasis reach their
              // own enter() branches.
              if (isInlineLinkNode(node.node)) {
                const labelRange = inlineLinkLabelRange(node.node);
                if (labelRange && labelRange.from < labelRange.to) {
                  decorations.push(
                    cm6.Decoration.mark({ class: 'cm-md-link-text' })
                      .range(labelRange.from, labelRange.to)
                  );
                }
              } else if (isReferenceLinkNode(node.node)) {
                // Reuse inlineLinkLabelRange — full and collapsed reference
                // links have the same "[" / "]" first-two-LinkMark structure
                // as inline links.
                const labelRange = inlineLinkLabelRange(node.node);
                if (labelRange && labelRange.from < labelRange.to) {
                  decorations.push(
                    cm6.Decoration.mark({ class: 'cm-md-reflink-text' })
                      .range(labelRange.from, labelRange.to)
                  );
                }
              }
            } else if (name === 'Image') {
              // Stage 14.5: visual styling for inline images "![alt](url)".
              // Reference-style images "![alt][1]" (no URL child) are NOT
              // styled — non-goal. NO <img>, NO src, NO clicks, NO fetch —
              // purely Decoration.mark styling. The walker descends so
              // nested emphasis inside alt text and the LinkMark / URL /
              // LinkTitle children all reach their own enter() branches.
              if (isInlineImageNode(node.node)) {
                const altRange = inlineImageAltRange(node.node);
                if (altRange && altRange.from < altRange.to) {
                  decorations.push(
                    cm6.Decoration.mark({ class: 'cm-md-image-alt' })
                      .range(altRange.from, altRange.to)
                  );
                }
              }
            } else if (name === 'LinkMark' || name === 'URL' || name === 'LinkTitle') {
              const parent = node.node.parent;
              // Stage 11.7 — hide brackets, parens, URL, and title for
              // inline [text](url) links. Excludes Image, Autolink, bare
              // URL, LinkReference, and reference-style Link nodes without
              // URL (those are handled below or intentionally left raw).
              if (isInlineLinkNode(parent)) {
                decorations.push(
                  cm6.Decoration.mark({ class: 'cm-md-syntax cm-md-link-mark' })
                    .range(node.from, node.to)
                );
              // Stage 14.4 — angle autolink "<" / ">" delimiters. Hidden
              // via the shared cm-md-syntax class; revealed dimmed on the
              // active line.
              } else if (name === 'LinkMark' && parent && parent.name === 'Autolink') {
                decorations.push(
                  cm6.Decoration.mark({ class: 'cm-md-syntax cm-md-autolink-mark' })
                    .range(node.from, node.to)
                );
              // Stage 14.4 — URL inside an Autolink, OR a bare URL detected
              // by the base parser (parent = Paragraph / ATXHeading* / etc.).
              // URLs inside an inline Link are handled above. URLs inside
              // Image and LinkReference are explicitly excluded — those are
              // non-goals for Stage 14.4 (no images, no reference-style
              // links). URLs do not appear inside InlineCode or fenced
              // CodeText per the parser, so no extra exclusion is needed.
              } else if (
                name === 'URL'
                && parent
                && parent.name !== 'Image'
                && parent.name !== 'LinkReference'
              ) {
                decorations.push(
                  cm6.Decoration.mark({ class: 'cm-md-autolink-url' })
                    .range(node.from, node.to)
                );
              // Stage 14.5 — image syntax markers ("![", "]", "(", URL,
              // optional LinkTitle, ")") parented by an inline Image.
              // Reference-style images (no URL child) are excluded by
              // isInlineImageNode. Hidden via the shared cm-md-syntax class.
              } else if (
                parent
                && parent.name === 'Image'
                && isInlineImageNode(parent)
              ) {
                decorations.push(
                  cm6.Decoration.mark({ class: 'cm-md-syntax cm-md-image-mark' })
                    .range(node.from, node.to)
                );
              // Stage 14.6 — "[" and "]" markers of full and collapsed
              // reference links. Shortcut links have no LinkLabel child
              // and are excluded by isReferenceLinkNode. LinkMark inside
              // a LinkReference definition is excluded because the parent
              // there is LinkReference, not Link.
              } else if (
                name === 'LinkMark'
                && parent
                && parent.name === 'Link'
                && isReferenceLinkNode(parent)
              ) {
                decorations.push(
                  cm6.Decoration.mark({ class: 'cm-md-syntax cm-md-reflink-mark' })
                    .range(node.from, node.to)
                );
              }
            } else if (name === 'LinkLabel') {
              // Stage 14.6 — LinkLabel "[ref]" or "[]" inside a reference
              // Link gets reflink-mark (hidden via cm-md-syntax). LinkLabel
              // inside an Image (image reference) is intentionally not
              // styled. LinkLabel inside a LinkReference (the definition
              // itself) is covered by the parent's cm-md-link-def — no
              // separate decoration emitted here.
              const labelParent = node.node.parent;
              if (
                labelParent
                && labelParent.name === 'Link'
                && isReferenceLinkNode(labelParent)
              ) {
                decorations.push(
                  cm6.Decoration.mark({ class: 'cm-md-syntax cm-md-reflink-mark' })
                    .range(node.from, node.to)
                );
              }
            } else if (name === 'LinkReference') {
              // Stage 14.6 — entire link definition line "[ref]: url"
              // (with optional title) is dimmed via cm-md-link-def. The
              // single mark on the LinkReference container covers all
              // child nodes (LinkLabel, LinkMark ":", URL, optional
              // LinkTitle), so individual children get no separate
              // decoration. URL inside LinkReference is already excluded
              // from cm-md-autolink-url by the Stage 14.4 guard.
              decorations.push(
                cm6.Decoration.mark({ class: 'cm-md-link-def' })
                  .range(node.from, node.to)
              );
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
      // Stage 23: optional task-toggle extension hook. The toggle module
      // (cm6-task-toggle.js) loads via a separate script tag in
      // index.html and exposes itself as globalThis.Cm6TaskToggle. When
      // present, append the extension array it returns; when absent, the
      // walker behaves exactly as before. This hook adds zero Section H
      // tokens; the named, narrow event-surface exception lives entirely
      // inside cm6-task-toggle.js (see cm6-task-toggle-invariants.test.js).
      const taskToggle =
        (typeof globalThis !== 'undefined') ? globalThis.Cm6TaskToggle : null;
      if (taskToggle && typeof taskToggle.createTaskToggleExtension === 'function') {
        const ext = taskToggle.createTaskToggleExtension(cm6);
        if (ext != null) extensions.push(ext);
      }
      // Stage 25: optional link-click extension hook. Same shape as the
      // Stage 23 task-toggle hook above. The link-click module
      // (cm6-link-click.js) loads via its own script tag in index.html and
      // exposes itself as globalThis.Cm6LinkClick. The peer contract test
      // (cm6-link-click-invariants.test.js) pins the narrow event-surface
      // exception inside the link-click module; this hook adds zero
      // Section H tokens.
      const linkClick =
        (typeof globalThis !== 'undefined') ? globalThis.Cm6LinkClick : null;
      if (linkClick && typeof linkClick.createLinkClickExtension === 'function') {
        const ext = linkClick.createLinkClickExtension(cm6);
        if (ext != null) extensions.push(ext);
      }
      // Stage 26: optional active-range extension hook. Same shape as the
      // Stage 25 link-click hook above. The active-range module
      // (cm6-active-range.js) loads via its own script tag in index.html
      // and exposes itself as globalThis.Cm6ActiveRange. The peer contract
      // test (cm6-active-range-invariants.test.js) pins the source-file
      // invariants. This hook adds zero Section H tokens.
      const activeRange =
        (typeof globalThis !== 'undefined') ? globalThis.Cm6ActiveRange : null;
      if (activeRange && typeof activeRange.createActiveRangeExtension === 'function') {
        const ext = activeRange.createActiveRangeExtension(cm6);
        if (ext != null) extensions.push(ext);
      }
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
