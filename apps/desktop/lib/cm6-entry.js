/* CodeMirror 6 — production IIFE bundle entry.
   Built with: npm run build:cm6
   Output:     lib/cm6-bundle.js  (committed; load via <script src>)

   Exposes window.CM6Production with the minimal API surface that
   lib/cm6-write-view.js consumes. The adapter is loaded as a separate
   script and constructs Cm6WriteView({ cm6: window.CM6Production }).

   This entry is production-only. The throwaway spike entry
   (lib/spike-cm6-entry.js) and its bundle remain in place for spike
   reproducibility but are not consumed at runtime by the production app. */
import { EditorState, Annotation, RangeSetBuilder } from '@codemirror/state';
import {
  EditorView,
  ViewPlugin,
  Decoration,
  WidgetType,
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
  syntaxTree,
} from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';

// The adapter calls cm6.markdown() and cm6.history(); also reads
// EditorView.lineWrapping and EditorView.updateListener. Re-export the
// extras (line numbers, default highlight style, etc.) as a `chrome`
// extension array so the host can compose a "full" extension set without
// the adapter having to know about every editor decoration.

const chrome = [
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  drawSelection(),
  bracketMatching(),
  indentOnInput(),
  highlightSelectionMatches(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
];

window.CM6Production = {
  EditorState,
  EditorView,
  Annotation,
  ViewPlugin,
  Decoration,
  WidgetType,
  RangeSetBuilder,
  syntaxTree,
  history,
  markdown: () => markdown({ base: markdownLanguage, codeLanguages: [] }),
  chrome,
};
