import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const FIND_LIMIT = 1000;
export const FIND_QUERY_LIMIT = 256;
// Search rendered text, preserving PM offsets across inline marks. Never join blocks
// or inline non-text nodes. Regex metacharacters are always literal user text.
export function findDocumentText(doc, query, matchCase = false) {
  const matches = []; let total = 0;
  if (!query || query.length > FIND_QUERY_LIMIT) return { matches, total };
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'gu' : 'giu');
  function scan(text, start) {
    pattern.lastIndex = 0;
    for (const hit of text.matchAll(pattern)) {
      total++;
      if (matches.length < FIND_LIMIT) matches.push({ from: start + hit.index, to: start + hit.index + hit[0].length });
    }
  }
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    let text = '', start = pos + 1;
    node.forEach((child, offset) => {
      if (child.isText) {
        if (!text) start = pos + 1 + offset;
        text += child.text;
      } else { scan(text, start); text = ''; }
    });
    scan(text, start); return false;
  });
  return { matches, total };
}
const key = new PluginKey('documentFind');
export function createFindPlugin() {
  return new Plugin({ key, state: {
    init: () => DecorationSet.empty,
    apply: (tr, previous) => tr.getMeta(key) ?? (tr.docChanged ? previous.map(tr.mapping, tr.doc) : previous),
  }, props: { decorations: state => key.getState(state) } });
}

// Window-local presentation only: no source, history, IPC or file mutations.
export function createFindView({ byId, context }) {
  const bar = byId('document-find'), input = byId('find-query'), doc = bar.ownerDocument;
  const button = byId('show-document-find'), scroll = byId('document-scroll');
  let enabled = false, opened = false, queryComposing = false, mapped = null;
  let matches = [], total = 0, active = -1;
  const ready = () => {
    const { state: s, editor, loading, invalid } = context();
    return enabled && !!editor && !!s?.confirmed && !loading && !invalid && !s.locked
      && !s.pending && !s.historyPending && !s.composing && !s.compositionInvalid
      && !editor.view.composing && s.source === s.confirmed.source;
  };
  const modal = () => doc.querySelector('dialog[open]');
  function publish() {
    const { editor } = context();
    const decorations = matches.map((m, i) => Decoration.inline(m.from, m.to,
      { class: 'document-find-hit' + (i === active ? ' is-current' : ''), 'data-find-index': String(i) }));
    editor.view.dispatch(editor.state.tr.setMeta(key, DecorationSet.create(editor.state.doc, decorations)).setMeta('addToHistory', false));
  }
  function controls(paused = false) {
    for (const id of ['find-previous', 'find-next']) byId(id).disabled = paused || !matches.length;
    byId('find-case').disabled = paused;
    input.disabled = !ready();
    bar.dataset.paused = String(paused);
    byId('editor').dataset.findPaused = String(paused);
    byId('find-count').textContent = paused ? '等待输入完成' : !input.value ? '' : total === 0 ? '无匹配'
      : `${active + 1} / ${total}` + (total > FIND_LIMIT ? ` · 仅定位前 ${FIND_LIMIT} 处` : '');
  }
  function sync() {
    button.disabled = !ready();
    if (!opened) return;
    if (!ready() || queryComposing) { controls(true); return; }
    const { editor, state } = context(), current = { doc: editor.state.doc, session: state.confirmed.sessionId,
      query: input.value, matchCase: byId('find-case').checked };
    if (!mapped || Object.keys(current).some(k => current[k] !== mapped[k])) {
      const position = mapped?.session === current.session && mapped?.query === current.query ? matches[active]?.from : null;
      ({ matches, total } = findDocumentText(current.doc, current.query, current.matchCase));
      active = matches.length ? Math.max(0, position == null ? 0 : matches.findIndex(m => m.from >= position)) : -1;
      mapped = current; publish();
    }
    controls();
  }
  function jump() {
    const { editor, state } = context();
    if (!opened || !ready() || queryComposing || modal() || !matches[active]
        || mapped?.doc !== editor.state.doc || mapped.session !== state.confirmed.sessionId) return;
    const rect = editor.view.coordsAtPos(matches[active].from), bounds = scroll.getBoundingClientRect();
    // Scroll only. Do not alter selection, including in read-only/opaque blocks.
    scroll.scrollTo({ top: Math.max(0, scroll.scrollTop + rect.top - bounds.top - scroll.clientHeight / 3), behavior: 'auto' });
  }
  function move(direction) {
    if (!ready() || queryComposing || modal()) return;
    sync(); if (!matches.length) return;
    active = (active + direction + matches.length) % matches.length; publish(); controls(); jump();
  }
  function open() {
    if (!ready() || queryComposing || modal()) return;
    opened = true; bar.hidden = false; button.setAttribute('aria-expanded', 'true');
    byId('document-info').open = false; sync(); input.focus(); input.select();
  }
  function close() {
    if (!opened || !ready() || queryComposing || modal()) return;
    opened = false; bar.hidden = true; button.setAttribute('aria-expanded', 'false');
    matches = []; total = 0; active = -1; mapped = null; publish();
    // PM focuses its DOM only when editable. Read-only text needs an explicit
    // focus target too; this changes no edit permission or document selection.
    const { editor } = context(), view = editor.view;
    view.dom.focus({ preventScroll: true });
    if (!view.editable) {
      // With focus previously in the search input, readonly PM no longer owns
      // the DOM selection. Restore from its unchanged current selection, not
      // from a cached range that could belong to another document/revision.
      const { anchor, head } = editor.state.selection;
      const a = view.domAtPos(anchor), h = view.domAtPos(head);
      doc.getSelection()?.setBaseAndExtent(a.node, a.offset, h.node, h.offset);
    }
    view.focus();
  }
  const guard = event => { if (!ready() || queryComposing) event.preventDefault(); };
  for (const id of ['show-document-find', 'find-previous', 'find-next', 'find-close', 'find-case']) byId(id).onpointerdown = guard;
  input.onpointerdown = event => { if (!ready()) event.preventDefault(); };
  input.addEventListener('compositionstart', () => { queryComposing = true; controls(true); });
  input.addEventListener('compositionend', () => { queryComposing = false; sync(); jump(); });
  input.oninput = event => { if (!event.isComposing && !queryComposing) { sync(); jump(); } };
  byId('find-case').onchange = () => { sync(); jump(); };
  button.onclick = open;
  byId('find-previous').onclick = () => move(-1);
  byId('find-next').onclick = () => move(1);
  byId('find-close').onclick = close;
  doc.addEventListener('keydown', event => {
    if (!enabled || event.defaultPrevented || event.isComposing || event.keyCode === 229 || queryComposing || modal()) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault(); open();
    } else if (opened && event.key === 'Escape' && ready()) {
      event.preventDefault(); event.stopPropagation(); close();
    } else if (opened && bar.contains(event.target) && event.key === 'Enter' && ready()) {
      event.preventDefault(); move(event.shiftKey ? -1 : 1);
    }
  }, true);
  return { sync, configure() { enabled = true; sync(); } };
}
