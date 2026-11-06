// Read-only presentation of the existing confirmed snapshot. No file/clipboard IPC.
export function sourceSummary({ source, bom }) {
  const endings = source.match(/\r\n|\r|\n/g) || [];
  const kinds = ['\r\n','\n','\r'].filter(value => endings.includes(value));
  const names = kinds.map(value => ({ '\r\n':'CRLF', '\n':'LF', '\r':'CR' })[value]);
  return `${endings.length + 1} 行 · ${names.join(' / ') || '无换行'} · ${bom ? 'UTF-8 BOM' : '无 BOM'}`;
}

export function createSourceView({ byId, context }) {
  const button = byId('show-source'), dialog = byId('source-dialog'), text = byId('source-text');
  const doc = dialog.ownerDocument;
  let enabled = false, snapshot = null, wrapped = true;
  const ready = () => {
    const { state:s, editor, loading, invalid } = context();
    return enabled && !!s?.confirmed && !!editor && !loading && !invalid && !s.locked
      && !s.pending && !s.historyPending && !s.composing && !s.compositionInvalid
      && !editor.view.composing && s.source === s.confirmed.source;
  };
  function close() { if (dialog.open) dialog.close(); }
  function sync() {
    button.disabled = !ready();
    const current = context().state?.confirmed;
    if (dialog.open && (!ready() || current.sessionId !== snapshot?.sessionId
        || current.revision !== snapshot.revision || current.source !== snapshot.source)) close();
  }
  function selectAll() {
    sync(); if (!dialog.open) return;
    const range = doc.createRange(); range.selectNodeContents(text);
    const selection = doc.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    text.focus({ preventScroll:true });
  }
  button.onpointerdown = event => { if (!ready()) event.preventDefault(); };
  button.onclick = () => {
    if (!ready() || doc.querySelector('dialog[open]')) return;
    snapshot = { ...context().state.confirmed };
    byId('source-name').textContent = snapshot.label;
    byId('source-metadata').textContent = sourceSummary(snapshot);
    // textContent preserves the raw source string and cannot interpret HTML or URLs.
    text.textContent = snapshot.source;
    dialog.showModal(); button.setAttribute('aria-expanded','true');
    text.scrollTop = 0; text.scrollLeft = 0; text.focus({ preventScroll:true });
  };
  byId('close-source').onclick = close;
  byId('select-source').onclick = selectAll;
  byId('source-wrap').onclick = () => {
    wrapped = !wrapped; text.dataset.wrap = String(wrapped);
    byId('source-wrap').setAttribute('aria-pressed',String(wrapped));
  };
  text.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault(); selectAll();
    }
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return; // An earlier asynchronous close must not clear a reopened snapshot.
    snapshot = null; text.textContent = ''; byId('source-name').textContent = '';
    byId('source-metadata').textContent = ''; button.setAttribute('aria-expanded','false');
    // Return to the trigger without moving the article or its PM selection.
    if (!button.disabled) button.focus({ preventScroll:true });
  });
  return { sync, close, configure() { enabled = true; sync(); } };
}
