'use strict';

/* Stage E — hybrid-cm6-lp engine: GFM table widget.

   This module owns the lp engine's table-rendering behavior. It exports:

     parseTableNode(tableNode, doc) → {headers, alignments, rows} | null
        Pure function. Walks a Lezer Table node's children, extracting:
          - headers:    array of header cell text strings (from TableHeader's
                        TableCell children).
          - alignments: array of per-column alignment strings, one per
                        column. Values: 'left' | 'center' | 'right' | null.
                        Parsed from the delimiter row (parent=Table
                        TableDelimiter). null = no alignment hint.
          - rows:       array of body rows. Each row is an array of cell
                        text strings (one per column).
        Returns null when the Table node is malformed (no header, no
        delimiter row, or column-count mismatch).

     TableWidget extends WidgetType
        Renders the parsed payload as an HTML <table>. toDOM builds the
        DOM via document.createElement + textContent (XSS-safe escaping
        for cell content). Applies per-column alignment via inline style.
        eq(other) compares the parsed payload by deep equality.

   Cell text is rendered as PLAIN TEXT. Inline markdown inside cells
   (**bold**, [link](url), `code`, etc.) appears as raw source — Stage E
   does NOT render inline markdown inside cells. Deferred to a focused
   follow-on.

   No new dependencies. No bundle rebuild. Pure JS using Lezer's tree
   traversal from the lp-block caller.

   Public exports:
     parseTableNode  — pure (tableNode, doc) → {...} | null.
     TableWidget     — WidgetType subclass.

   The UMD wrapper requires WidgetType from @codemirror/view on the CJS
   path, or reads it from globalThis.CM6Production.WidgetType on the
   browser path. Mirrors cm6-lp-image-widget.js. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const view = require('@codemirror/view');
    module.exports = factory(view.WidgetType);
  } else {
    const widgetType =
      (root.CM6Production && root.CM6Production.WidgetType) ||
      (root.codemirror && root.codemirror.WidgetType) || null;
    root.Cm6LpTableWidget = factory(widgetType);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (WidgetType) {

  // ── parseAlignmentCell ─────────────────────────────────────────────────
  // Given the delimiter cell text (e.g., ":---:", ":--", "---:", "---"),
  // return one of 'left', 'center', 'right', or null.
  function parseAlignmentCell(cellText) {
    const t = (cellText || '').trim();
    if (t.length < 3) return null;  // must be at least "---"
    const startsColon = t.charAt(0) === ':';
    const endsColon   = t.charAt(t.length - 1) === ':';
    if (startsColon && endsColon) return 'center';
    if (startsColon)              return 'left';
    if (endsColon)                return 'right';
    return null;
  }

  // ── parseTableNode(tableNode, doc) ─────────────────────────────────────
  // Walk the Table node's children to extract structured payload.
  // The Lezer GFM Table grammar:
  //   Table
  //     TableHeader            (the "| a | b |" header row)
  //       TableCell (one per column)
  //       TableDelimiter (parent=TableHeader for the "|" pipes)
  //     TableDelimiter         (parent=Table for the "|---|---|" separator row)
  //     TableRow*              (zero or more body rows)
  //       TableCell (one per column)
  //       TableDelimiter (parent=TableRow for the "|" pipes)
  function parseTableNode(tableNode, doc) {
    if (!tableNode || tableNode.name !== 'Table') return null;
    if (!doc || typeof doc.sliceString !== 'function') return null;

    let header = null;     // node ref
    let delimRow = null;   // node ref (the |---|---| line)
    const bodyRows = [];   // node refs

    for (let child = tableNode.firstChild; child; child = child.nextSibling) {
      if (child.name === 'TableHeader') {
        if (!header) header = child;
      } else if (child.name === 'TableDelimiter') {
        // Only the Table-parented TableDelimiter (the "|---|---|" row)
        // reaches us here. TableDelimiters parented by TableHeader/TableRow
        // are siblings of TableCell INSIDE the header/row, not direct
        // Table children.
        if (!delimRow) delimRow = child;
      } else if (child.name === 'TableRow') {
        bodyRows.push(child);
      }
    }

    if (!header || !delimRow) return null;

    // Extract cells from a row node (TableHeader or TableRow). Splits the
    // row's RAW source on "|" rather than walking TableCell children —
    // Lezer's GFM parser silently drops empty/whitespace-only TableCell
    // nodes, which would mis-align columns. Splitting on "|" preserves
    // empty cells in the correct positions. Discard the leading/trailing
    // empty pieces from the leading/trailing "|".
    function extractCells(rowNode) {
      const rowText = doc.sliceString(rowNode.from, rowNode.to);
      const parts = rowText.split('|');
      // For a row like "| 1 |   | 3 |", split produces ["", " 1 ", "   ", " 3 ", ""].
      // Discard the first part if the row starts with "|" (or is empty).
      // Discard the last part if the row ends with "|".
      let start = 0;
      let end   = parts.length;
      if (parts.length > 0 && parts[0]  === '') start = 1;
      if (parts.length > 0 && parts[parts.length - 1] === '') end = parts.length - 1;
      const out = [];
      for (let i = start; i < end; i++) {
        out.push(parts[i].trim());
      }
      return out;
    }

    const headers = extractCells(header);
    if (headers.length === 0) return null;

    // Parse alignments from the delimiter row. The delimiter row's text
    // looks like "|:---|:---:|---:|"; split on "|" and parse each piece.
    // The first and last splits may be empty (leading/trailing "|").
    const delimText = doc.sliceString(delimRow.from, delimRow.to);
    const delimParts = delimText.split('|').map(function (p) { return p.trim(); });
    // Discard empty first/last (from leading/trailing "|").
    const filteredParts = delimParts.filter(function (p, i, arr) {
      if (p === '' && (i === 0 || i === arr.length - 1)) return false;
      return true;
    });
    const alignments = filteredParts.map(parseAlignmentCell);

    // Body rows: extract cells, pad short rows with empty strings so all
    // rows have headers.length columns. Extra cells beyond the header
    // count are dropped.
    const rows = bodyRows.map(function (rn) {
      const cells = extractCells(rn);
      const result = new Array(headers.length);
      for (let i = 0; i < headers.length; i++) {
        result[i] = i < cells.length ? cells[i] : '';
      }
      return result;
    });

    return { headers: headers, alignments: alignments, rows: rows };
  }

  // ── TableWidget (extends WidgetType) ───────────────────────────────────
  // Renders the parsed table as an HTML <table>. Cell text is set via
  // textContent (XSS-safe). Per-column alignment applied via inline style.
  let TableWidget = null;

  function getTableWidgetClass() {
    if (TableWidget) return TableWidget;
    if (!WidgetType) return null;

    class _TableWidget extends WidgetType {
      constructor(payload) {
        super();
        this.headers    = payload.headers;
        this.alignments = payload.alignments;
        this.rows       = payload.rows;
        // Stage G.7 — CM6 reserves layout space based on widget.lineBreaks
        // for block widgets. Without it CM6 thinks the widget occupies
        // ONE line, but our source range spans many lines, causing tile-
        // map drift and "No tile at position X" errors. Passed in by the
        // caller from the source range's newline count.
        this._lineBreaks = (payload && typeof payload.lineBreaks === 'number')
          ? payload.lineBreaks
          : 0;
      }

      // Stage G.4 — block-widget contract. CM6's tile system reads
      // widget.block to know whether to treat the widget as block-
      // level. Without this getter the default `false` propagates and
      // CM6 throws "No tile at position X" / "Cannot destructure
      // property 'tile' of 'parents.pop(...)'" when computing coords.
      get block() { return true; }

      // Stage G.7 — see constructor.
      get lineBreaks() { return this._lineBreaks; }

      eq(other) {
        if (!(other instanceof _TableWidget)) return false;
        if (this.headers.length !== other.headers.length) return false;
        if (this.rows.length    !== other.rows.length)    return false;
        for (let i = 0; i < this.headers.length; i++) {
          if (this.headers[i]    !== other.headers[i])    return false;
          if (this.alignments[i] !== other.alignments[i]) return false;
        }
        for (let r = 0; r < this.rows.length; r++) {
          if (this.rows[r].length !== other.rows[r].length) return false;
          for (let c = 0; c < this.rows[r].length; c++) {
            if (this.rows[r][c] !== other.rows[r][c]) return false;
          }
        }
        return true;
      }

      toDOM() {
        if (typeof document === 'undefined') {
          // Test-environment fallback. Tests inspect the widget via the
          // payload directly; toDOM not called.
          return { nodeType: 1 };
        }
        const table = document.createElement('table');
        table.className = 'cm-md-lp-table';
        const colCount = this.headers.length;

        function alignStyle(idx, self) {
          const a = self.alignments[idx];
          return a ? ('text-align: ' + a + ';') : '';
        }

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (let i = 0; i < colCount; i++) {
          const th = document.createElement('th');
          th.textContent = this.headers[i];
          const style = alignStyle(i, this);
          if (style) th.setAttribute('style', style);
          headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);

        if (this.rows.length > 0) {
          const tbody = document.createElement('tbody');
          for (let r = 0; r < this.rows.length; r++) {
            const tr = document.createElement('tr');
            for (let c = 0; c < colCount; c++) {
              const td = document.createElement('td');
              td.textContent = this.rows[r][c];
              const style = alignStyle(c, this);
              if (style) td.setAttribute('style', style);
              tr.appendChild(td);
            }
            tbody.appendChild(tr);
          }
          table.appendChild(tbody);
        }

        return table;
      }

      ignoreEvent() { return false; }
    }

    TableWidget = _TableWidget;
    return TableWidget;
  }

  return {
    parseTableNode:      parseTableNode,
    getTableWidgetClass: getTableWidgetClass,
    _parseAlignmentCell: parseAlignmentCell,
  };
});
