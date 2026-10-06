/**
 * ARAHAS PPE — smart stock-sheet reader.
 * Turns the rows of an uploaded spreadsheet (any layout with a header row:
 * the "PPE STOCK REGISTER" with merged item cells and TOTAL rows, the
 * downloadable template, or a plain Item/Size/Qty list) into count lines
 * matched to catalogue items and sizes. Anything it is not sure about is
 * flagged for a person to fix in the review screen — it never guesses silently.
 *
 * Runs in the browser (window.StockImport) and in Node (require) for the self-test.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StockImport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STOP = new Set('a an and the of for with to in on type brand standard size sizes made ea pcs pc pieces piece pairs pair no item'.split(' '));
  const norm = (s) => String(s ?? '').toLowerCase().replace(/™|®/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const squash = (s) => norm(s).replace(/ /g, '');
  const stem = (t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t); // boots ~ boot, hats ~ hat
  const tokens = (s) => norm(s).split(' ').filter(t => t && !STOP.has(t)).map(stem);

  // ---------- header detection ----------
  const RX = {
    code: /^(item\s*(code|id)|code|sku)$/i,
    item: /item|description|ppe|product|name|material/i,
    size: /size|variant/i,
    defective: /defect|damag|faulty|unusable|bad/i,
    qty: /avail|qty|quantity|count|on\s*hand|balance|stock|received|delivered/i
  };
  function findHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 40); r++) {
      const cells = (rows[r] || []).map(c => String(c ?? '').trim());
      const col = { code: -1, item: -1, size: -1, qty: -1, defective: -1 };
      cells.forEach((c, i) => {
        if (!c || c.length > 40) return;
        if (col.code < 0 && RX.code.test(c)) col.code = i;
        else if (col.defective < 0 && RX.defective.test(c)) col.defective = i;
        else if (col.size < 0 && RX.size.test(c)) col.size = i;
        else if (col.qty < 0 && RX.qty.test(c)) col.qty = i;
        else if (col.item < 0 && RX.item.test(c)) col.item = i;
      });
      // prefer an explicit "available" column over a generic "stock"/"qty" one
      const avail = cells.findIndex(c => /avail/i.test(c) && !RX.defective.test(c));
      if (avail > -1) col.qty = avail;
      if ((col.item > -1 || col.code > -1) && (col.qty > -1 || col.defective > -1)) return { row: r, col };
    }
    return null;
  }

  // ---------- item matching (rare words count most) ----------
  function buildIndex(catalog) {
    const docs = catalog.map(it => {
      const text = `${it.category} ${it.description} ${String(it.item_id).replace(/_/g, ' ')}`;
      return { it, toks: new Set(tokens(text)), sq: squash(text) };
    });
    const df = new Map();
    docs.forEach(d => d.toks.forEach(t => df.set(t, (df.get(t) || 0) + 1)));
    const idf = (t) => Math.log(1 + docs.length / (df.get(t) || docs.length));
    return { docs, idf, byId: new Map(catalog.map(it => [String(it.item_id).toLowerCase(), it])) };
  }
  function matchItem(index, text, context) {
    const raw = String(text ?? '').trim();
    const direct = index.byId.get(raw.toLowerCase());
    if (direct) return { item: direct, sure: true, alternatives: [] };
    const rowToks = new Set(tokens(raw)), rowSq = squash(raw), ctxToks = new Set(tokens(context));
    const scored = index.docs.map(d => {
      let s = 0;
      d.toks.forEach(t => {
        if (rowToks.has(t)) s += index.idf(t);
        else if (t.length >= 5 && rowSq.includes(t)) s += index.idf(t) * 0.8;   // "Redwings" / "V-gard" written without spaces
        else if (ctxToks.has(t)) s += index.idf(t) * 0.3;                         // section heading, e.g. "SAFETY BOOTS"
      });
      rowToks.forEach(t => { if (t.length >= 5 && !d.toks.has(t) && d.sq.includes(t)) s += 0.8; }); // "raincoat" vs "Rain Coat"
      return { item: d.it, s };
    }).sort((a, b) => b.s - a.s);
    const [best, second] = scored;
    if (!best || best.s < 1.2) return { item: null, sure: false, alternatives: scored.filter(x => x.s > 0).slice(0, 3).map(x => x.item.item_id) };
    // sure = clearly ahead: at least one distinguishing word (e.g. "Joggers" vs "Redwings") or well ahead overall
    const sure = !second || best.s - second.s >= 1.2 || best.s >= second.s * 1.5;
    return { item: best.item, sure, alternatives: sure ? [] : scored.slice(0, 3).filter(x => x.s > 0).map(x => x.item.item_id) };
  }

  // ---------- size matching ----------
  const LETTER = { '2XL': 'XXL', '3XL': 'XXXL', '4XL': 'XXXXL', XXXXXL: '5XL', SMALL: 'S', MEDIUM: 'M', LARGE: 'L', 'EXTRA LARGE': 'XL', 'X LARGE': 'XL' };
  function matchSize(sizes, cell) {
    const raw = cell === null || cell === undefined ? '' : String(cell).trim();
    if (!raw) return sizes.length === 1 ? { size: sizes[0] } : { size: null, problem: 'Size missing' };
    let v = raw;
    if (/^\d+(\.0+)?$/.test(v)) v = String(parseInt(v, 10));            // 50.0 -> "50"
    const up = norm(v).toUpperCase(), alias = LETTER[up] || LETTER[up.replace(/ /g, '')];
    const exact = sizes.find(s => s.toUpperCase() === v.toUpperCase() || s.toUpperCase() === up || (alias && s.toUpperCase() === alias));
    if (exact) return { size: exact };
    const cellToks = new Set(tokens(raw));
    const hits = sizes.filter(s => { const st = tokens(s); return st.length && st.every(t => cellToks.has(t)); });
    if (hits.length === 1) return { size: hits[0] };
    if (hits.length > 1) return { size: null, several: hits, problem: `Size unclear — matches ${hits.join(' and ')}` };
    if (sizes.length === 1) return { size: sizes[0], note: `"${raw}" read as ${sizes[0]}` };
    return { size: null, problem: `Unknown size "${raw}"` };
  }

  // ---------- figures ----------
  function readQty(cell) {
    if (cell === null || cell === undefined) return { v: null };
    if (typeof cell === 'number') return Number.isInteger(cell) && cell >= 0 ? { v: cell } : { v: null, problem: `Can't use "${cell}" — whole numbers only` };
    const s = String(cell).trim().replace(/,/g, '');
    if (!s || s === '-' || s === '—') return { v: null };
    if (/^\d+(\.0+)?$/.test(s)) return { v: parseInt(s, 10) };
    if (/^-?\d*\.?\d+$/.test(s)) return { v: null, problem: `Can't use "${s}" — whole numbers only` };
    return { v: null, problem: `Can't read quantity "${String(cell).trim()}"` };
  }

  /** "51/82" for two sizes -> [51, 82]; a single 0/blank defective applies to each. */
  function splitFigures(qCell, dCell, n) {
    const parts = (c) => { const m = String(c ?? '').trim(); return /^\d+(\s*\/\s*\d+)+$/.test(m) ? m.split('/').map(x => parseInt(x, 10)) : null; };
    const qty = parts(qCell);
    if (!qty || qty.length !== n) return null;
    let def = parts(dCell);
    if (!def) { const d = readQty(dCell); if (d.problem || (d.v !== null && d.v !== 0)) return null; def = Array(n).fill(d.v); }
    if (def.length !== n) return null;
    return { qty, def };
  }

  /**
   * rows: array of arrays of cell values (row 0 = first sheet row).
   * catalog: [{ item_id, category, description, uom, sizes: [..] }]
   * Returns { header, lines, skipped } — or { error } when no header row is found.
   */
  function parse(rows, catalog, opts) {
    const rowOffset = (opts && opts.rowOffset) || 0; // sheet row number of rows[0], minus 1
    const header = findHeader(rows);
    if (!header) return { error: 'Could not find a header row. The sheet needs columns such as "Item", "Size" and "Available" (or download the template).' };
    const index = buildIndex(catalog);
    const { col } = header;
    const cell = (r, i) => (i < 0 ? null : r[i]);
    const text = (r, i) => String(cell(r, i) ?? '').trim();
    const lines = [];
    let current = null, context = '', skipped = 0;
    for (let r = header.row + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const itemText = text(row, col.code) || text(row, col.item);
      const sizeCell = cell(row, col.size), q = readQty(cell(row, col.qty)), d = readQty(cell(row, col.defective));
      const hasFigure = q.v !== null || d.v !== null || q.problem || d.problem;
      const hasSize = String(sizeCell ?? '').trim() !== '';
      if (!itemText && !hasSize && !hasFigure) continue;                                  // blank row
      if (/^(sub\s*-?\s*)?total\b|grand total/i.test(itemText)) { current = null; skipped++; continue; } // TOTAL rows
      if (itemText && !hasSize && !hasFigure) { context = itemText; current = null; continue; }         // section heading
      if (itemText) current = { text: itemText, ...matchItem(index, itemText, context) };
      const line = { row: r + 1 + rowOffset, source: current ? current.text : '', sizeText: String(sizeCell ?? '').trim(), item_id: null, size: null, qty: q.v, defective: d.v, problems: [], notes: [] };
      if (!current) line.problems.push('No item on this row');
      else if (!current.item) line.problems.push('Item not recognised');
      else {
        let item = current.item, sure = current.sure;
        if (!sure && hasSize) { // unsure between similar items: the size often settles it (Redwings boot 43 vs Red Wing coverall)
          const fits = current.alternatives.map(id => catalog.find(c => c.item_id === id)).filter(c => c && matchSize(c.sizes || [], sizeCell).size);
          if (fits.length === 1) { item = fits[0]; if (item !== current.item || current.alternatives.length > 1) line.notes.push(`Matched by size ${String(sizeCell).trim()} — check`); sure = true; }
        }
        line.item_id = item.item_id;
        if (!sure) line.problems.push('Item uncertain — please confirm');
        const sz = matchSize(item.sizes || [], sizeCell);
        // "Clear and Dark" with "51/82": one figure per size, in the order written
        const split = sz.several && splitFigures(cell(row, col.qty), cell(row, col.defective), sz.several.length);
        if (split) {
          sz.several.forEach((size, k) => lines.push({ ...line, size, qty: split.qty[k], defective: split.def[k], blank: false, problems: [...line.problems],
            notes: [`Split "${String(cell(row, col.qty) ?? '').trim()}" across ${sz.several.join(' / ')} — check`] }));
          continue;
        }
        line.size = sz.size; if (sz.problem) line.problems.push(sz.problem); if (sz.note) line.notes.push(sz.note);
      }
      if (q.problem) line.problems.push(q.problem);
      if (d.problem) line.problems.push(d.problem);
      line.blank = !hasFigure;
      lines.push(line);
    }
    return { header, lines, skipped };
  }

  /** Flag figures that look like typing mistakes (informational, never blocking). */
  function unusual(current, counted) {
    if (counted === null || counted === undefined) return '';
    if (counted >= 1000 && counted > current * 3) return 'Much higher than usual — check for a typo';
    if (current >= 20 && counted > current * 10) return 'Over 10× the current stock — check for a typo';
    return '';
  }

  /** Minimal RFC 4180 CSV reader (quoted fields, "" escapes, CRLF) -> array of row arrays. */
  function parseCSV(text) {
    const rows = []; let row = [], f = '', q = false;
    text = String(text).replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.map(r => r.map(v => (v === '' ? null : v)));
  }

  return { parse, parseCSV, findHeader, matchItem: (catalog, text, ctx) => matchItem(buildIndex(catalog), text, ctx), matchSize, readQty, unusual };
});
