/* CodeMirror 6 spike — IIFE bundle entry.
   Built with: npm run build:spike-cm6
   Output:     lib/spike-cm6-bundle.js  (committed; load via <script src>)

   Exposes window.SpikeCM6 with createSpikeEditor(parent, opts).
   Adapter shape mirrors the existing liveEditorInstance contract so a
   later production migration can swap engines without changing call sites:
     getText(), setText(text), destroy(), focus(), view
*/
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
} from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';

function createSpikeEditor(parent, opts) {
  const initialDoc = (opts && opts.initialDoc) != null ? String(opts.initialDoc) : '';
  const onChange = (opts && opts.onChange) || null;

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && onChange) {
      onChange(update.state.doc.toString());
    }
  });

  const state = EditorState.create({
    doc: initialDoc,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      bracketMatching(),
      indentOnInput(),
      highlightSelectionMatches(),
      history(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      markdown({ base: markdownLanguage, codeLanguages: [] }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.lineWrapping,
      updateListener,
    ],
  });

  const view = new EditorView({ state, parent });

  return {
    view,
    getText() {
      return view.state.doc.toString();
    },
    setText(text) {
      const value = text == null ? '' : String(text);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    },
    focus() {
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}

window.SpikeCM6 = { createSpikeEditor };
