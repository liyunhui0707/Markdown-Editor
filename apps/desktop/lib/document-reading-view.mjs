// Window-local presentation. No document mutation, IPC, file path or storage authority.
export const defaultReading = Object.freeze({ theme: 'light', font: 'sans', size: '17', width: '680', spacing: '1.95' });
const choices = Object.freeze({ theme: ['light', 'dark', 'system'], font: ['sans', 'serif'],
  size: ['16', '17', '19', '21'], width: ['580', '680', '800'], spacing: ['1.65', '1.95', '2.2'] });
export function changeReading(current, name, value) {
  return Object.hasOwn(choices, name) && choices[name].includes(value) ? { ...current, [name]: value } : current;
}
export function documentHeadings(doc) {
  const headings = [];
  // Match the current source projection: only top-level rendered heading nodes.
  // Fenced code, opaque syntax and nested structures never become outline entries.
  doc?.forEach((node, position) => {
    if (node.type.name === 'heading' && Number.isInteger(node.attrs.level) && node.attrs.level >= 1 && node.attrs.level <= 6)
      headings.push({ position, level: node.attrs.level, title: node.textContent || '无标题' });
  });
  return headings;
}

export function createReadingView({ byId, context }) {
  let enabled = false, preferences = { ...defaultReading }, opened = false;
  let mappedDoc = null, mappedSession = null, rows = [], scheduled = false;
  const system = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  const narrow = globalThis.matchMedia?.('(max-width: 1179px)');
  const app = byId('writing-app'), doc = app.ownerDocument, scroll = byId('document-scroll');
  const dialog = byId('reading-settings-dialog');
  const busy = () => {
    const { state: s, loading } = context();
    return loading || s?.pending > 0 || s?.historyPending || s?.composing || s?.compositionInvalid;
  };
  const navigable = () => {
    const { state: s, editor, invalid } = context();
    return enabled && !busy() && !invalid && !s?.locked && !!s?.confirmed && !!editor
      && s.source === s.confirmed.source;
  };
  function showOutline(value) {
    opened = value;
    const visible = opened && !!context().state?.confirmed;
    app.dataset.outline = visible ? 'open' : 'closed';
    byId('document-outline').hidden = !visible;
    byId('toggle-document-outline').setAttribute('aria-expanded', String(visible));
    if (visible) updateActive();
  }
  function apply() {
    const dark = preferences.theme === 'dark' || preferences.theme === 'system' && system?.matches;
    doc.body.dataset.readingTheme = dark ? 'dark' : 'light';
    doc.body.dataset.readingFont = preferences.font;
    for (const [name, value] of [['--body-size', preferences.size + 'px'], ['--reading-width', preferences.width + 'px'], ['--body-spacing', preferences.spacing]])
      doc.body.style.setProperty(name, value);
    for (const theme of choices.theme) byId('reading-theme-' + theme).setAttribute('aria-pressed', String(preferences.theme === theme));
    for (const name of ['font', 'size', 'width', 'spacing']) byId('reading-' + name).value = preferences[name];
    scheduleActive();
  }
  const guardPointer = event => { if (busy()) event.preventDefault(); };
  function openSettings() {
    if (!enabled || busy() || doc.querySelector('dialog[open]')) return;
    dialog.showModal(); byId('show-reading-settings').setAttribute('aria-expanded', 'true');
  }
  byId('show-reading-settings').onpointerdown = guardPointer;
  byId('show-reading-settings').onclick = openSettings;
  byId('close-reading-settings').onclick = () => dialog.close();
  dialog.addEventListener('close', () => byId('show-reading-settings').setAttribute('aria-expanded', 'false'));
  for (const theme of choices.theme) byId('reading-theme-' + theme).onclick = () => {
    if (!enabled || busy() || !dialog.open) return;
    preferences = changeReading(preferences, 'theme', theme); apply();
  };
  for (const name of ['font', 'size', 'width', 'spacing']) byId('reading-' + name).onchange = () => {
    if (!enabled || busy() || !dialog.open) return;
    preferences = changeReading(preferences, name, byId('reading-' + name).value); apply();
  };
  byId('reset-reading-settings').onclick = () => {
    if (!enabled || busy() || !dialog.open) return;
    preferences = { ...defaultReading }; apply();
  };
  for (const id of ['toggle-document-outline', 'close-document-outline']) {
    byId(id).onpointerdown = guardPointer;
    byId(id).onclick = () => {
      if (!enabled || busy() || !context().state?.confirmed) return;
      showOutline(id === 'toggle-document-outline' && !opened);
      if (!opened) byId('toggle-document-outline').focus();
    };
  }
  function target(item) {
    const { editor, state } = context();
    if (!navigable() || state.confirmed.sessionId !== mappedSession || editor.state.doc !== mappedDoc) return null;
    const node = editor.view.nodeDOM(item.position);
    return node?.nodeName === 'H' + item.level && editor.view.dom.contains(node) ? node : null;
  }
  function jump(item) {
    const node = target(item);
    if (!node) return;
    // Scroll only: preserve editor selection, main-owned revision and Undo history.
    scroll.scrollTo({ top: Math.max(0, scroll.scrollTop + node.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 28), behavior: 'auto' });
    if (narrow?.matches) { showOutline(false); byId('toggle-document-outline').focus(); }
    else updateActive();
  }
  function updateActive() {
    if (!enabled || !opened || !navigable()) return;
    let active = rows[0];
    for (const row of rows) {
      const node = target(row.item);
      if (node && node.getBoundingClientRect().top <= scroll.getBoundingClientRect().top + 32) active = row;
    }
    if (scroll.scrollTop > 0 && scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2) active = rows.at(-1);
    for (const row of rows) row.button.setAttribute('aria-current', row === active ? 'location' : 'false');
  }
  function scheduleActive() {
    if (!enabled || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; updateActive(); });
  }
  scroll.addEventListener('scroll', scheduleActive, { passive: true });
  system?.addEventListener('change', () => { if (enabled && preferences.theme === 'system') apply(); });
  narrow?.addEventListener('change', () => { if (enabled) { showOutline(false); scheduleActive(); } });
  doc.addEventListener('keydown', event => {
    if (!enabled) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === ',') { event.preventDefault(); openSettings(); }
    else if (event.key === 'Escape' && opened && narrow?.matches && !doc.querySelector('dialog[open]') && !busy()) {
      event.preventDefault(); showOutline(false); byId('toggle-document-outline').focus();
    }
  });
  function sync() {
    if (!enabled) return;
    const { state: s, editor } = context();
    byId('show-reading-settings').disabled = !!busy();
    byId('toggle-document-outline').disabled = !!busy() || !s?.confirmed;
    byId('close-document-outline').disabled = !!busy();
    if (!s?.confirmed) {
      rows = []; mappedDoc = null; mappedSession = null;
      byId('outline-list').replaceChildren();
    }
    const ready = navigable();
    if (ready && (mappedDoc !== editor.state.doc || mappedSession !== s.confirmed.sessionId)) {
      mappedDoc = editor.state.doc; mappedSession = s.confirmed.sessionId;
      rows = documentHeadings(mappedDoc).map(item => {
        const button = doc.createElement('button');
        button.type = 'button'; button.textContent = item.title; button.title = item.title;
        button.dataset.level = String(item.level); button.setAttribute('aria-label', '标题 ' + item.level + '：' + item.title);
        button.onpointerdown = event => event.preventDefault();
        // Capture the projection identity as well as the position; old rows cannot target a new document.
        const origin = mappedDoc, session = mappedSession;
        button.onclick = () => { if (mappedDoc === origin && mappedSession === session) jump(item); };
        return { item, button };
      });
      byId('outline-list').replaceChildren(...rows.map(r => r.button));
    }
    for (const row of rows) row.button.disabled = !ready;
    byId('outline-empty').hidden = rows.length > 0;
    byId('outline-count').textContent = String(rows.length);
    showOutline(opened); scheduleActive();
  }
  return { sync, configure() {
    enabled = true; opened = !narrow?.matches; apply(); sync();
  }, close() {
    if (dialog.open) dialog.close();
    if (narrow?.matches) showOutline(false);
  } };
}
