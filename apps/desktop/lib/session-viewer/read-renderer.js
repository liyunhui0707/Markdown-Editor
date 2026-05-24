// Stage S3 — Read-mode Markdown renderer for AI session transcripts.
// Verbatim port of Local-Web-Server/public/read-renderer.js lines 1-322.
// Untrusted input — render only the importer's Markdown subset via
// document.createElement / createTextNode. NEVER innerHTML (including for
// clearing — callers must use a removeChild loop).
//
// CJS-loadable + window.SessionViewer.renderMarkdown attachment so both
// the test harness and the browser renderer use the same code.

'use strict';

(function () {

const {
  appendInline,
  leadingBacktickRun,
  splitCells,
  isTableSeparator,
} = (typeof require !== 'undefined'
  ? require('./read-inline.js')
  : (typeof window !== 'undefined' && window.SessionViewer && window.SessionViewer._readInline) || {});

const { preprocessUserLine } = (typeof require !== 'undefined'
  ? require('./read-user-preprocess.js')
  : (typeof window !== 'undefined' && window.SessionViewer && window.SessionViewer._readUserPreprocess) || {});

function renderMarkdown(text, opts) {
  const doc = (opts && opts.document) || (typeof document !== 'undefined' ? document : null);
  if (!doc) throw new Error('renderMarkdown: document is required');
  const fragment = doc.createDocumentFragment();
  const lines = String(text == null ? '' : text).split('\n');

  let currentSection = null;
  let currentRole = null;
  let inToolBlock = false;
  let inFence = false;
  let fenceMarker = 0;
  let fenceLines = [];
  let paraLines = [];
  let pendingSlashCommand = null;
  let inSlashArgs = false;
  let inDropTag = null;
  let currentSectionAttached = false;
  let inSkillBody = false;

  function attachSection() {
    if (currentSection && !currentSectionAttached) {
      fragment.appendChild(currentSection);
      currentSectionAttached = true;
    }
  }

  function emitPendingSlash() {
    if (pendingSlashCommand && currentSection && currentRole === 'user') {
      const p = doc.createElement('p');
      p.setAttribute('class', 'user-typed');
      p.appendChild(doc.createTextNode(pendingSlashCommand));
      attachSection();
      currentSection.appendChild(p);
    }
    pendingSlashCommand = null;
  }

  function flushPara() {
    emitPendingSlash();
    if (paraLines.length === 0 || !currentSection || inToolBlock) {
      paraLines = [];
      return;
    }
    if (paraLines.every((l) => /^[-*+]\s+/.test(l))) {
      renderList(paraLines, 'ul', /^[-*+]\s+/);
      paraLines = [];
      return;
    }
    if (paraLines.every((l) => /^\d+\.\s+/.test(l))) {
      renderList(paraLines, 'ol', /^\d+\.\s+/);
      paraLines = [];
      return;
    }
    if (paraLines.length >= 2 && /^\s*\|.*\|\s*$/.test(paraLines[0]) && isTableSeparator(paraLines[0], paraLines[1])) {
      let tableEnd = 2;
      while (tableEnd < paraLines.length && /^\s*\|.*\|\s*$/.test(paraLines[tableEnd])) tableEnd += 1;
      renderTable(paraLines.slice(0, tableEnd));
      const tail = paraLines.slice(tableEnd);
      paraLines = [];
      if (tail.length > 0) {
        paraLines = tail;
        flushPara();
      }
      return;
    }
    const p = doc.createElement('p');
    if (currentRole === 'user') p.setAttribute('class', 'user-typed');
    appendInline(p, paraLines.join('\n'), doc);
    attachSection();
    currentSection.appendChild(p);
    paraLines = [];
  }

  function renderList(items, tagName, markerRegex) {
    attachSection();
    const kids = currentSection.children;
    const last = kids.length > 0 ? kids[kids.length - 1] : null;
    const lastTag = last && (last.tag || (last.tagName && last.tagName.toLowerCase()));
    let list;
    if (lastTag === tagName) {
      list = last;
    } else {
      list = doc.createElement(tagName);
      currentSection.appendChild(list);
    }
    for (const raw of items) {
      const li = doc.createElement('li');
      appendInline(li, raw.replace(markerRegex, ''), doc);
      list.appendChild(li);
    }
  }

  function renderTable(rows) {
    const table = doc.createElement('table');
    const thead = doc.createElement('thead');
    const headTr = doc.createElement('tr');
    for (const cell of splitCells(rows[0])) {
      const th = doc.createElement('th');
      appendInline(th, cell, doc);
      headTr.appendChild(th);
    }
    thead.appendChild(headTr);
    table.appendChild(thead);
    if (rows.length > 2) {
      const tbody = doc.createElement('tbody');
      for (let r = 2; r < rows.length; r += 1) {
        const tr = doc.createElement('tr');
        for (const cell of splitCells(rows[r])) {
          const td = doc.createElement('td');
          appendInline(td, cell, doc);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
    }
    attachSection();
    currentSection.appendChild(table);
  }

  function flushFence() {
    if (!currentSection || inToolBlock) {
      fenceLines = [];
      return;
    }
    const pre = doc.createElement('pre');
    if (currentRole === 'user') pre.setAttribute('class', 'user-typed');
    const code = doc.createElement('code');
    code.appendChild(doc.createTextNode(fenceLines.join('\n')));
    pre.appendChild(code);
    attachSection();
    currentSection.appendChild(pre);
    fenceLines = [];
  }

  for (const rawLine of lines) {
    let line = rawLine;
    if (inFence) {
      const run = leadingBacktickRun(line);
      if (run >= fenceMarker && line.slice(run).trim() === '') {
        flushFence();
        inFence = false;
        fenceMarker = 0;
      } else {
        fenceLines.push(line);
      }
      continue;
    }

    if (currentRole === 'user' && !inToolBlock) {
      const preState = { inDropTag, inSlashArgs, inSkillBody };
      const res = preprocessUserLine(line, preState);
      inDropTag = preState.inDropTag;
      inSlashArgs = preState.inSlashArgs;
      inSkillBody = preState.inSkillBody;
      if (res.emitSlash) emitPendingSlash();
      if (res.captureSlash !== undefined) pendingSlashCommand = res.captureSlash;
      if (res.drop) continue;
      line = res.line;
    }

    const h1Match = /^#\s+(.+)$/.exec(line);
    if (h1Match && currentSection && !inToolBlock) {
      flushPara();
      attachSection();
      const h1 = doc.createElement('h1');
      appendInline(h1, h1Match[1], doc);
      currentSection.appendChild(h1);
      continue;
    }

    const headingMatch = /^##\s+(.+)$/.exec(line);
    if (headingMatch) {
      flushPara();
      inToolBlock = false;
      const headingText = headingMatch[1];
      const role = headingText.startsWith('User —')
        ? 'user-turn'
        : headingText.startsWith('Assistant —')
          ? 'assistant-turn'
          : null;
      if (role) {
        inSlashArgs = false;
        inDropTag = null;
        inSkillBody = false;
        const section = doc.createElement('section');
        section.setAttribute('class', `read-section ${role}`);
        const h2 = doc.createElement('h2');
        appendInline(h2, headingText, doc);
        section.appendChild(h2);
        currentSection = section;
        currentRole = role === 'user-turn' ? 'user' : 'assistant';
        currentSectionAttached = false;
      } else if (currentSection) {
        attachSection();
        const h2 = doc.createElement('h2');
        appendInline(h2, headingText, doc);
        currentSection.appendChild(h2);
      }
      continue;
    }

    const h3Match = /^###\s+(.+)$/.exec(line);
    if (h3Match) {
      flushPara();
      const h3Text = h3Match[1];
      const isToolH3 =
        h3Text.startsWith('Tool use') || h3Text.startsWith('Tool result');
      if (isToolH3) {
        inToolBlock = true;
        continue;
      }
      inToolBlock = false;
      if (!currentSection) continue;
      const h3 = doc.createElement('h3');
      appendInline(h3, h3Text, doc);
      attachSection();
      currentSection.appendChild(h3);
      continue;
    }

    const openRun = leadingBacktickRun(line);
    if (openRun >= 3) {
      flushPara();
      if (!currentSection) {
        inFence = true;
        fenceMarker = openRun;
        fenceLines = [];
        continue;
      }
      inFence = true;
      fenceMarker = openRun;
      continue;
    }

    if (line.trim() === '') {
      flushPara();
      continue;
    }

    if (!currentSection) continue;
    paraLines.push(line);
  }

  if (inFence) flushFence();
  flushPara();

  return fragment;
}

const api = { renderMarkdown };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}

if (typeof window !== 'undefined') {
  window.SessionViewer = Object.assign(window.SessionViewer || {}, api);
}

})();
