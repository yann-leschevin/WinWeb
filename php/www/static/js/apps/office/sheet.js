// Tableur (format .wcalc) : plusieurs feuilles, formules (SOMME, SI, RECHERCHEV...),
// mise en forme, insertion/suppression de lignes et colonnes, tri, recopie,
// copier/coller compatible avec les autres tableurs (TSV), graphiques, CSV.
import { showMenu } from '../../contextMenu.js';
import { confirmDialog, promptDialog } from '../../dialogs.js';
import { escapeHtml, extname, h } from '../../utils.js';
import { createWindow } from '../../windowManager.js';
import {
  docController, escapeCsv, fileShortcuts, parseCsv, rbBtn, rbColor, rbSelect, ribbon,
} from './common.js';
import {
  cellKey, ERR, evaluate, FErr, indexToCol, parseFormula, parseKey, rewriteRefs, translateFormula,
} from './formula.js';

const DEF_W = 92;
const ROW_H = 24;
const MAX_ROWS = 5000;
const MAX_COLS = 200;
const FORMATS = [['gen', 'Standard'], ['num2', 'Nombre (2 déc.)'], ['int', 'Entier'], ['pct', 'Pourcentage'],
  ['eur', 'Monétaire (€)'], ['txt', 'Texte']];

const newSheet = (name) => ({ name, cells: {}, colW: {}, rows: 100, cols: 26 });

/** Interprète une saisie qui n'est pas une formule. */
function literal(raw, fmt) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (fmt === 'txt') return raw;
  const s = raw.trim();
  if (/^[-+]?\d+([.,]\d+)?([eE][-+]?\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  if (/^[-+]?\d{1,3}( \d{3})+([.,]\d+)?$/.test(s)) return Number(s.replace(/ /g, '').replace(',', '.'));
  if (/^[-+]?\d+([.,]\d+)?\s?%$/.test(s)) return Number(s.replace('%', '').replace(',', '.').trim()) / 100;
  const up = s.toUpperCase();
  if (up === 'VRAI' || up === 'TRUE') return true;
  if (up === 'FAUX' || up === 'FALSE') return false;
  return raw;
}

function display(value, fmt) {
  if (value === null || value === undefined) return '';
  if (value instanceof FErr) return value.code;
  if (typeof value === 'boolean') return value ? 'VRAI' : 'FAUX';
  if (typeof value === 'number') {
    switch (fmt) {
      case 'num2': return value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      case 'int': return value.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
      case 'pct': return `${(value * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
      case 'eur': return value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
      default:
        if (Math.abs(value) >= 1e15 || (value !== 0 && Math.abs(value) < 1e-9)) return value.toExponential(4).replace('.', ',');
        return value.toLocaleString('fr-FR', { maximumFractionDigits: 10 });
    }
  }
  return String(value);
}

function launch({ path = null } = {}) {
  const book = { sheets: [newSheet('Feuil1')], active: 0 };
  const sel = { r: 0, c: 0, ar: 0, ac: 0 };
  let cache = new Map();
  const astCache = new Map();
  let tds = [];
  let undoStack = [];
  let redoStack = [];
  let editing = null; // { r, c, input, fromBar }
  let clip = null; // { text, cells: [[raw]], r, c, cut }
  let tabCol = null; // colonne de départ d'une saisie au clavier avec Tab (Entrée y revient, comme Excel)

  const sheet = () => book.sheets[book.active];
  const win = createWindow({
    appId: 'sheet', title: 'Tableur', icon: '📗', width: 1040, height: 680, minWidth: 520, minHeight: 340,
  });

  // ---------------------------------------------------------------- calcul
  function findSheet(name) {
    if (!name) return -1;
    return book.sheets.findIndex((s) => s.name.toLowerCase() === name.toLowerCase());
  }
  function valueAt(si, r, c, stack) {
    const key = `${si}:${r}:${c}`;
    if (cache.has(key)) return cache.get(key);
    const cell = book.sheets[si].cells[cellKey(r, c)];
    const raw = cell?.v;
    let value;
    if (typeof raw === 'string' && raw.startsWith('=') && raw.length > 1) {
      if (stack.has(key)) return ERR.circ;
      stack.add(key);
      let ast = astCache.get(raw);
      if (ast === undefined) {
        try { ast = parseFormula(raw.slice(1)); } catch (err) { ast = err instanceof FErr ? err : ERR.parse; }
        astCache.set(raw, ast);
      }
      value = ast instanceof FErr ? ast : evaluate(ast, {
        sheetExists: (name) => findSheet(name) >= 0,
        getCell: (name, rr, cc) => {
          const target = name ? findSheet(name) : si;
          if (target < 0) return ERR.ref;
          return valueAt(target, rr, cc, stack);
        },
      });
      stack.delete(key);
    } else {
      value = literal(raw, cell?.s?.fmt);
    }
    cache.set(key, value);
    return value;
  }
  const value = (r, c) => valueAt(book.active, r, c, new Set());

  // ---------------------------------------------------------------- historique
  function snapshot() {
    return JSON.stringify({ sheets: book.sheets, active: book.active });
  }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
  }
  function restore(json) {
    const data = JSON.parse(json);
    book.sheets = data.sheets;
    book.active = Math.min(data.active, book.sheets.length - 1);
    buildGrid();
    renderTabs();
    changed(false);
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
  }

  function changed(touch = true) {
    cache = new Map();
    renderCells();
    updateBar();
    if (touch) doc.touch();
  }

  // ---------------------------------------------------------------- modification
  function setRaw(r, c, raw, { record = true } = {}) {
    if (record) pushUndo();
    const key = cellKey(r, c);
    const cells = sheet().cells;
    if (raw === '' || raw === null || raw === undefined) {
      if (cells[key]?.s) delete cells[key].v;
      else delete cells[key];
    } else {
      cells[key] = { ...(cells[key] || {}), v: String(raw) };
    }
    ensureSize(r + 1, c + 1);
  }

  function ensureSize(rows, cols) {
    const s = sheet();
    let grow = false;
    if (rows > s.rows) { s.rows = Math.min(MAX_ROWS, Math.max(rows, s.rows + 50)); grow = true; }
    if (cols > s.cols) { s.cols = Math.min(MAX_COLS, Math.max(cols, s.cols + 5)); grow = true; }
    if (grow) buildGrid();
  }

  const rangeBounds = () => ({
    r1: Math.min(sel.r, sel.ar), r2: Math.max(sel.r, sel.ar), c1: Math.min(sel.c, sel.ac), c2: Math.max(sel.c, sel.ac),
  });

  function forRange(fn) {
    const { r1, r2, c1, c2 } = rangeBounds();
    for (let r = r1; r <= r2; r += 1) for (let c = c1; c <= c2; c += 1) fn(r, c);
  }

  function setStyle(patch) {
    pushUndo();
    const cells = sheet().cells;
    forRange((r, c) => {
      const key = cellKey(r, c);
      const cell = cells[key] || {};
      const s = { ...(cell.s || {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === false) delete s[k];
        else s[k] = v;
      }
      cells[key] = { ...cell, s };
      if (!Object.keys(s).length) delete cells[key].s;
      if (!cells[key].s && cells[key].v === undefined) delete cells[key];
    });
    changed();
  }
  function toggleStyle(prop) {
    const cur = sheet().cells[cellKey(sel.r, sel.c)]?.s?.[prop];
    setStyle({ [prop]: cur ? null : true });
  }

  function clearRange(what = 'values') {
    pushUndo();
    const cells = sheet().cells;
    forRange((r, c) => {
      const key = cellKey(r, c);
      if (!cells[key]) return;
      if (what === 'all') delete cells[key];
      else if (what === 'format') { delete cells[key].s; if (cells[key].v === undefined) delete cells[key]; }
      else { delete cells[key].v; if (!cells[key].s) delete cells[key]; }
    });
    changed();
  }

  /** Décale cellules et références lors d'une insertion/suppression. */
  function shiftStructure(axis, at, delta) {
    pushUndo();
    const target = sheet();
    const targetName = target.name.toLowerCase();
    const moved = {};
    for (const [key, cell] of Object.entries(target.cells)) {
      const p = parseKey(key);
      const idx = axis === 'row' ? p.r : p.c;
      if (delta < 0 && idx >= at && idx < at - delta) continue; // supprimée
      const nidx = idx >= at ? idx + delta : idx;
      moved[axis === 'row' ? cellKey(nidx, p.c) : cellKey(p.r, nidx)] = cell;
    }
    target.cells = moved;
    if (axis === 'col') {
      const widths = {};
      for (const [c, w] of Object.entries(target.colW)) {
        const ci = Number(c);
        if (delta < 0 && ci >= at && ci < at - delta) continue;
        widths[ci >= at ? ci + delta : ci] = w;
      }
      target.colW = widths;
    }
    for (const s of book.sheets) {
      for (const cell of Object.values(s.cells)) {
        if (typeof cell.v !== 'string' || !cell.v.startsWith('=')) continue;
        cell.v = rewriteRefs(cell.v, ({ sheet: name, r, c }) => {
          const refSheet = name ? name.toLowerCase() : s.name.toLowerCase();
          if (refSheet !== targetName) return undefined;
          const idx = axis === 'row' ? r : c;
          if (delta < 0 && idx >= at && idx < at - delta) return null;
          const nidx = idx >= at ? idx + delta : idx;
          return axis === 'row' ? { r: nidx, c } : { r, c: nidx };
        });
      }
    }
    if (axis === 'row') target.rows = Math.max(1, target.rows + delta);
    else target.cols = Math.max(1, Math.min(MAX_COLS, target.cols + delta));
    buildGrid();
    changed();
  }

  function fill(direction) {
    const { r1, r2, c1, c2 } = rangeBounds();
    pushUndo();
    const cells = sheet().cells;
    if (direction === 'down') {
      if (r1 === r2) return;
      for (let c = c1; c <= c2; c += 1) {
        const src = cells[cellKey(r1, c)];
        for (let r = r1 + 1; r <= r2; r += 1) copyCell(src, r - r1, 0, r, c);
      }
    } else {
      if (c1 === c2) return;
      for (let r = r1; r <= r2; r += 1) {
        const src = cells[cellKey(r, c1)];
        for (let c = c1 + 1; c <= c2; c += 1) copyCell(src, 0, c - c1, r, c);
      }
    }
    changed();
  }
  function copyCell(src, dr, dc, r, c) {
    const key = cellKey(r, c);
    if (!src) { delete sheet().cells[key]; return; }
    const v = typeof src.v === 'string' && src.v.startsWith('=') ? translateFormula(src.v, dr, dc) : src.v;
    sheet().cells[key] = JSON.parse(JSON.stringify({ ...src, v }));
    if (v === undefined) delete sheet().cells[key].v;
  }

  function usedBounds() {
    let maxR = -1;
    let maxC = -1;
    for (const key of Object.keys(sheet().cells)) {
      const p = parseKey(key);
      if (sheet().cells[key].v === undefined) continue;
      maxR = Math.max(maxR, p.r);
      maxC = Math.max(maxC, p.c);
    }
    return { maxR, maxC };
  }

  function sortRange(desc) {
    let { r1, r2, c1, c2 } = rangeBounds();
    if (r1 === r2) {
      const { maxR, maxC } = usedBounds();
      if (maxR < 1) return;
      const header = [...Array(maxC + 1).keys()].every((c) => typeof value(0, c) !== 'number');
      r1 = header ? 1 : 0;
      r2 = maxR;
      c1 = 0;
      c2 = maxC;
    }
    pushUndo();
    const col = sel.c;
    const cells = sheet().cells;
    const rows = [];
    for (let r = r1; r <= r2; r += 1) {
      const row = [];
      for (let c = c1; c <= c2; c += 1) row.push(cells[cellKey(r, c)]);
      rows.push({ row, key: value(r, col) });
    }
    rows.sort((a, b) => {
      const x = a.key;
      const y = b.key;
      if (x === null || x === undefined || x === '') return 1;
      if (y === null || y === undefined || y === '') return -1;
      let d;
      if (typeof x === 'number' && typeof y === 'number') d = x - y;
      else if (typeof x === 'number') d = -1;
      else if (typeof y === 'number') d = 1;
      else d = String(x).localeCompare(String(y), 'fr', { numeric: true });
      return desc ? -d : d;
    });
    rows.forEach(({ row }, i) => row.forEach((cell, j) => {
      const key = cellKey(r1 + i, c1 + j);
      if (cell) cells[key] = cell;
      else delete cells[key];
    }));
    changed();
  }

  function autoSum() {
    const { r1, c1 } = rangeBounds();
    let top = r1 - 1;
    while (top >= 0 && typeof value(top, c1) === 'number') top -= 1;
    const formula = top + 1 <= r1 - 1 ? `=SOMME(${cellKey(top + 1, c1)}:${cellKey(r1 - 1, c1)})` : '=SOMME()';
    if (formula === '=SOMME()') { startEdit(formula); return; }
    setRaw(r1, c1, formula);
    changed();
  }

  // ---------------------------------------------------------------- copier / coller
  function rangeTsv() {
    const { r1, r2, c1, c2 } = rangeBounds();
    const lines = [];
    const raws = [];
    for (let r = r1; r <= r2; r += 1) {
      const vals = [];
      const rawRow = [];
      for (let c = c1; c <= c2; c += 1) {
        vals.push(display(value(r, c), sheet().cells[cellKey(r, c)]?.s?.fmt).replace(/[\t\n]/g, ' '));
        const cell = sheet().cells[cellKey(r, c)];
        rawRow.push(cell ? JSON.parse(JSON.stringify(cell)) : null);
      }
      lines.push(vals.join('\t'));
      raws.push(rawRow);
    }
    return { text: lines.join('\n'), cells: raws, r: r1, c: c1 };
  }

  function onCopy(e, cut = false) {
    if (editing || !grid.contains(document.activeElement)) return;
    e.preventDefault();
    clip = { ...rangeTsv(), cut };
    e.clipboardData.setData('text/plain', clip.text);
    if (cut) clearRange('all');
  }

  function onPaste(e) {
    if (editing || !grid.contains(document.activeElement)) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    pushUndo();
    if (clip && text === clip.text) {
      clip.cells.forEach((row, i) => row.forEach((cell, j) => {
        const r = sel.r + i;
        const c = sel.c + j;
        ensureSize(r + 1, c + 1);
        if (clip.cut) {
          if (cell) sheet().cells[cellKey(r, c)] = cell;
          else delete sheet().cells[cellKey(r, c)];
        } else copyCell(cell, r - (clip.r + i), c - (clip.c + j), r, c);
      }));
      if (clip.cut) clip = null;
    } else {
      const rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
      rows.forEach((row, i) => row.forEach((v, j) => setRaw(sel.r + i, sel.c + j, v, { record: false })));
    }
    changed();
  }

  // ---------------------------------------------------------------- grille
  const colgroup = h('colgroup');
  const table = h('table', { class: 'ss-table' });
  const grid = h('div', { class: 'ss-grid', tabindex: '0' }, table);
  const nameBox = h('input', { class: 'ss-name', spellcheck: 'false', title: 'Zone Nom (ex. B12)' });
  const fx = h('input', { class: 'ss-fx', spellcheck: 'false', placeholder: 'Saisissez une valeur ou une formule (=SOMME(A1:A5))' });
  const tabsBar = h('div', { class: 'ss-tabs' });
  const statusInfo = h('span', { class: 'ss-status-info' });

  function buildGrid() {
    const s = sheet();
    colgroup.replaceChildren(h('col', { style: { width: '46px' } }),
      ...Array.from({ length: s.cols }, (_, c) => h('col', { style: { width: `${s.colW[c] || DEF_W}px` } })));
    const headRow = h('tr', {}, h('th', { class: 'ss-corner', title: 'Tout sélectionner', onmousedown: (e) => { e.preventDefault(); selectAll(); } }));
    for (let c = 0; c < s.cols; c += 1) {
      const th = h('th', { class: 'ss-colh', dataset: { c } }, indexToCol(c), h('span', { class: 'ss-resize', dataset: { c } }));
      headRow.append(th);
    }
    const body = h('tbody');
    tds = [];
    for (let r = 0; r < s.rows; r += 1) {
      const tr = h('tr', { style: { height: `${ROW_H}px` } }, h('th', { class: 'ss-rowh', dataset: { r }, text: String(r + 1) }));
      const rowTds = [];
      for (let c = 0; c < s.cols; c += 1) {
        const td = h('td', { dataset: { r, c } });
        rowTds.push(td);
        tr.append(td);
      }
      tds.push(rowTds);
      body.append(tr);
    }
    table.replaceChildren(colgroup, h('thead', {}, headRow), body);
    sel.r = Math.min(sel.r, s.rows - 1);
    sel.c = Math.min(sel.c, s.cols - 1);
    sel.ar = Math.min(sel.ar, s.rows - 1);
    sel.ac = Math.min(sel.ac, s.cols - 1);
    renderCells();
    renderSelection();
  }

  function renderCells() {
    const s = sheet();
    for (let r = 0; r < tds.length; r += 1) {
      for (let c = 0; c < tds[r].length; c += 1) {
        const td = tds[r][c];
        const cell = s.cells[cellKey(r, c)];
        const st = cell?.s || {};
        const v = cell ? value(r, c) : null;
        td.textContent = display(v, st.fmt);
        td.className = '';
        if (v instanceof FErr) td.classList.add('err');
        else if (typeof v === 'number' || typeof v === 'boolean') td.classList.add('num');
        if (st.b) td.classList.add('b');
        if (st.i) td.classList.add('i');
        if (st.u) td.classList.add('u');
        if (st.wrap) td.classList.add('wrap');
        td.style.textAlign = st.al || '';
        td.style.background = st.bg || '';
        td.style.color = st.fg || '';
        td.style.fontSize = st.fs ? `${st.fs}px` : '';
        if (st.bd) td.classList.add('bd');
      }
    }
    renderSelection();
  }

  let lastSel = [];
  function renderSelection() {
    lastSel.forEach((td) => td.classList.remove('in-sel', 'active'));
    lastSel = [];
    const { r1, r2, c1, c2 } = rangeBounds();
    for (let r = r1; r <= Math.min(r2, tds.length - 1); r += 1) {
      for (let c = c1; c <= Math.min(c2, (tds[r] || []).length - 1); c += 1) {
        const td = tds[r][c];
        td.classList.add('in-sel');
        lastSel.push(td);
      }
    }
    const active = tds[sel.r]?.[sel.c];
    if (active) {
      active.classList.add('active');
      lastSel.push(active);
    }
    table.querySelectorAll('.ss-colh.hl, .ss-rowh.hl').forEach((th) => th.classList.remove('hl'));
    table.querySelectorAll('.ss-colh').forEach((th) => { const c = Number(th.dataset.c); if (c >= c1 && c <= c2) th.classList.add('hl'); });
    for (let r = r1; r <= Math.min(r2, tds.length - 1); r += 1) tds[r][0]?.parentElement.firstChild.classList.add('hl');
    updateBar();
  }

  function updateBar() {
    const { r1, r2, c1, c2 } = rangeBounds();
    nameBox.value = r1 === r2 && c1 === c2 ? cellKey(sel.r, sel.c) : `${cellKey(r1, c1)}:${cellKey(r2, c2)}`;
    if (!editing || !editing.fromBar) fx.value = sheet().cells[cellKey(sel.r, sel.c)]?.v ?? '';
    // Statistiques de la sélection, comme dans la barre d'état d'Excel.
    let count = 0;
    let sum = 0;
    let nums = 0;
    if ((r2 - r1 + 1) * (c2 - c1 + 1) <= 100000) {
      forRange((r, c) => {
        const v = sheet().cells[cellKey(r, c)] ? value(r, c) : null;
        if (v === null || v === '') return;
        count += 1;
        if (typeof v === 'number') { sum += v; nums += 1; }
      });
    }
    statusInfo.textContent = count > 1
      ? `Moyenne : ${nums ? display(sum / nums) : '—'}    Nb (non vides) : ${count}    Somme : ${display(sum)}`
      : '';
    const st = sheet().cells[cellKey(sel.r, sel.c)]?.s || {};
    fmtSel.value = st.fmt || 'gen';
    boldBtn.classList.toggle('on', !!st.b);
    italBtn.classList.toggle('on', !!st.i);
    undBtn.classList.toggle('on', !!st.u);
  }

  function select(r, c, extend = false) {
    tabCol = null;
    const s = sheet();
    if (r >= s.rows - 1 && s.rows < MAX_ROWS) ensureSize(r + 2, 0);
    if (c >= s.cols - 1 && s.cols < MAX_COLS) ensureSize(0, c + 2);
    sel.r = Math.max(0, Math.min(r, sheet().rows - 1));
    sel.c = Math.max(0, Math.min(c, sheet().cols - 1));
    if (!extend) { sel.ar = sel.r; sel.ac = sel.c; }
    renderSelection();
    scrollIntoView(sel.r, sel.c);
  }
  function selectAll() {
    sel.r = 0; sel.c = 0; sel.ar = sheet().rows - 1; sel.ac = sheet().cols - 1;
    renderSelection();
  }
  function scrollIntoView(r, c) {
    const td = tds[r]?.[c];
    if (!td) return;
    const top = td.offsetTop;
    const left = td.offsetLeft;
    const headH = ROW_H;
    const headW = 46;
    if (top - headH < grid.scrollTop) grid.scrollTop = top - headH;
    else if (top + td.offsetHeight > grid.scrollTop + grid.clientHeight) grid.scrollTop = top + td.offsetHeight - grid.clientHeight;
    if (left - headW < grid.scrollLeft) grid.scrollLeft = left - headW;
    else if (left + td.offsetWidth > grid.scrollLeft + grid.clientWidth) grid.scrollLeft = left + td.offsetWidth - grid.clientWidth;
  }

  // ---------------------------------------------------------------- édition
  function startEdit(initial = null) {
    const td = tds[sel.r]?.[sel.c];
    if (!td) return;
    const raw = sheet().cells[cellKey(sel.r, sel.c)]?.v ?? '';
    const input = h('input', { class: 'ss-editor', spellcheck: 'false' });
    input.value = initial !== null ? initial : raw;
    input.style.left = `${td.offsetLeft}px`;
    input.style.top = `${td.offsetTop}px`;
    input.style.minWidth = `${td.offsetWidth}px`;
    input.style.height = `${td.offsetHeight}px`;
    grid.append(input);
    editing = { r: sel.r, c: sel.c, input, fromBar: false };
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener('input', () => { fx.value = input.value; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(); enterMove(e.shiftKey); grid.focus(); }
      else if (e.key === 'Tab') { e.preventDefault(); commitEdit(); tabMove(e.shiftKey); grid.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); grid.focus(); }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => { if (editing?.input === input) commitEdit(); });
  }
  function tabMove(back) {
    if (tabCol === null) tabCol = sel.c;
    const keep = tabCol;
    select(sel.r, sel.c + (back ? -1 : 1));
    tabCol = keep;
  }
  function enterMove(back) {
    const col = tabCol ?? sel.c;
    select(sel.r + (back ? -1 : 1), back ? sel.c : col);
  }

  function commitEdit() {
    if (!editing) return;
    const { r, c, input, fromBar } = editing;
    const val = fromBar ? fx.value : input.value;
    editing = null;
    input?.remove();
    const old = sheet().cells[cellKey(r, c)]?.v ?? '';
    if (val !== old) {
      setRaw(r, c, val);
      changed();
    } else updateBar();
  }
  function cancelEdit() {
    if (!editing) return;
    editing.input?.remove();
    editing = null;
    updateBar();
  }

  /** Mode « pointage » : clic sur une cellule pendant la saisie d'une formule. */
  function pointingInput() {
    const input = editing?.fromBar ? fx : editing?.input;
    if (!input || !input.value.startsWith('=')) return null;
    const before = input.value.slice(0, input.selectionStart).trimEnd();
    return /[=(;,+\-*/^&<>:]$/.test(before) ? input : null;
  }

  // ---------------------------------------------------------------- souris
  let dragging = false;
  grid.addEventListener('mousedown', (e) => {
    const resize = e.target.closest('.ss-resize');
    if (resize) { startColResize(e, Number(resize.dataset.c)); return; }
    const td = e.target.closest('td');
    const colh = e.target.closest('.ss-colh');
    const rowh = e.target.closest('.ss-rowh');
    if (td && e.target.classList.contains('ss-editor')) return;
    if (td) {
      const r = Number(td.dataset.r);
      const c = Number(td.dataset.c);
      const pin = pointingInput();
      if (pin) {
        e.preventDefault();
        const ref = cellKey(r, c);
        pin.setRangeText(ref, pin.selectionStart, pin.selectionEnd, 'end');
        pin.dispatchEvent(new Event('input'));
        pin.focus();
        return;
      }
      if (editing) commitEdit();
      if (e.button === 2) {
        const { r1, r2, c1, c2 } = rangeBounds();
        if (r >= r1 && r <= r2 && c >= c1 && c <= c2) return;
      }
      select(r, c, e.shiftKey);
      dragging = e.button === 0;
      e.preventDefault();
      grid.focus();
    } else if (colh) {
      e.preventDefault();
      if (editing) commitEdit();
      const c = Number(colh.dataset.c);
      if (!e.shiftKey) sel.ac = c;
      sel.c = c; sel.r = 0; sel.ar = sheet().rows - 1;
      renderSelection();
      grid.focus();
    } else if (rowh) {
      e.preventDefault();
      if (editing) commitEdit();
      const r = Number(rowh.dataset.r);
      if (!e.shiftKey) sel.ar = r;
      sel.r = r; sel.c = 0; sel.ac = sheet().cols - 1;
      renderSelection();
      grid.focus();
    }
  });
  grid.addEventListener('mouseover', (e) => {
    if (!dragging) return;
    const td = e.target.closest('td');
    if (!td) return;
    sel.r = Number(td.dataset.r);
    sel.c = Number(td.dataset.c);
    renderSelection();
  });
  const stopDrag = () => { dragging = false; };
  window.addEventListener('mouseup', stopDrag);
  grid.addEventListener('dblclick', (e) => { if (e.target.closest('td')) startEdit(); });
  grid.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('td, .ss-colh, .ss-rowh')) return;
    e.preventDefault();
    showMenu(e.clientX, e.clientY, cellMenu());
  });

  function startColResize(e, c) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const start = sheet().colW[c] || DEF_W;
    const col = colgroup.children[c + 1];
    const move = (ev) => { col.style.width = `${Math.max(24, start + ev.clientX - startX)}px`; };
    const up = (ev) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      sheet().colW[c] = Math.max(24, start + ev.clientX - startX);
      doc.touch();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  // ---------------------------------------------------------------- clavier
  grid.addEventListener('keydown', (e) => {
    if (editing) return;
    if (fileShortcuts(e, doc)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[key]) {
      e.preventDefault();
      const [dr, dc] = moves[key];
      if (ctrl) {
        // Saut jusqu'au bord de la zone de données.
        let r = sel.r;
        let c = sel.c;
        const filled = (rr, cc) => sheet().cells[cellKey(rr, cc)]?.v !== undefined;
        const s = sheet();
        while (r + dr >= 0 && c + dc >= 0 && r + dr < s.rows && c + dc < s.cols) {
          r += dr; c += dc;
          if (filled(r, c) && (!filled(r + dr, c + dc))) break;
        }
        select(r, c, e.shiftKey);
      } else if (e.shiftKey) {
        sel.r = Math.max(0, sel.r + dr); sel.c = Math.max(0, sel.c + dc);
        select(sel.r, sel.c, true);
      } else select(sel.r + dr, sel.c + dc);
      return;
    }
    if (key === 'Enter') { e.preventDefault(); enterMove(e.shiftKey); return; }
    if (key === 'Tab') { e.preventDefault(); tabMove(e.shiftKey); return; }
    if (key === 'Home') { e.preventDefault(); select(ctrl ? 0 : sel.r, 0); return; }
    if (key === 'PageDown') { e.preventDefault(); select(sel.r + 20, sel.c, e.shiftKey); return; }
    if (key === 'PageUp') { e.preventDefault(); select(sel.r - 20, sel.c, e.shiftKey); return; }
    if (key === 'F2') { e.preventDefault(); startEdit(); return; }
    if (key === 'Delete' || key === 'Backspace') { e.preventDefault(); clearRange(); return; }
    if (ctrl) {
      const k = key.toLowerCase();
      if (k === 'z') { e.preventDefault(); undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
      else if (k === 'b') { e.preventDefault(); toggleStyle('b'); }
      else if (k === 'i') { e.preventDefault(); toggleStyle('i'); }
      else if (k === 'u') { e.preventDefault(); toggleStyle('u'); }
      else if (k === 'd') { e.preventDefault(); fill('down'); }
      else if (k === 'r') { e.preventDefault(); fill('right'); }
      else if (k === 'a') { e.preventDefault(); selectAll(); }
      return;
    }
    if (key.length === 1 && !e.altKey) {
      e.preventDefault();
      startEdit(key);
    }
  });
  const copyHandler = (e) => onCopy(e, false);
  const cutHandler = (e) => onCopy(e, true);
  document.addEventListener('copy', copyHandler);
  document.addEventListener('cut', cutHandler);
  document.addEventListener('paste', onPaste);

  // Barre de formule
  fx.addEventListener('focus', () => {
    if (editing && !editing.fromBar) commitEdit();
    editing = { r: sel.r, c: sel.c, input: null, fromBar: true };
  });
  fx.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); select(sel.r + 1, sel.c); grid.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); grid.focus(); }
  });
  fx.addEventListener('blur', () => { if (editing?.fromBar) commitEdit(); });
  nameBox.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const [a, b] = nameBox.value.trim().toUpperCase().split(':').map(parseKey);
    if (!a) { updateBar(); return; }
    select(a.r, a.c);
    if (b) { sel.ar = a.r; sel.ac = a.c; sel.r = b.r; sel.c = b.c; renderSelection(); }
    grid.focus();
  });

  // ---------------------------------------------------------------- feuilles
  function renderTabs() {
    tabsBar.replaceChildren(...book.sheets.map((s, i) => h('button', {
      class: `ss-tab${i === book.active ? ' active' : ''}`, type: 'button', text: s.name,
      onclick: () => switchSheet(i),
      ondblclick: () => renameSheet(i),
      oncontextmenu: (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, [
          { label: 'Renommer…', icon: '✏️', action: () => renameSheet(i) },
          { label: 'Dupliquer', icon: '⧉', action: () => duplicateSheet(i) },
          { label: 'Supprimer', icon: '🗑️', disabled: book.sheets.length < 2, action: () => deleteSheet(i) },
        ]);
      },
    })), h('button', { class: 'ss-tab add', type: 'button', title: 'Nouvelle feuille', text: '+', onclick: addSheet }));
  }
  function switchSheet(i) {
    if (editing) commitEdit();
    book.active = i;
    sel.r = 0; sel.c = 0; sel.ar = 0; sel.ac = 0;
    buildGrid();
    renderTabs();
    cache = new Map();
    renderCells();
  }
  function addSheet() {
    pushUndo();
    let n = book.sheets.length + 1;
    while (findSheet(`Feuil${n}`) >= 0) n += 1;
    book.sheets.push(newSheet(`Feuil${n}`));
    switchSheet(book.sheets.length - 1);
    doc.touch();
  }
  function duplicateSheet(i) {
    pushUndo();
    const copy = JSON.parse(JSON.stringify(book.sheets[i]));
    let n = 2;
    while (findSheet(`${copy.name} (${n})`) >= 0) n += 1;
    copy.name = `${copy.name} (${n})`;
    book.sheets.splice(i + 1, 0, copy);
    switchSheet(i + 1);
    doc.touch();
  }
  async function renameSheet(i) {
    const name = await promptDialog('Nom de la feuille :', book.sheets[i].name, { title: 'Renommer la feuille', icon: '📗' });
    const clean = name?.trim().replace(/[!'[\]*?/\\:]/g, '').slice(0, 31);
    if (!clean || findSheet(clean) >= 0) return;
    pushUndo();
    const old = book.sheets[i].name.toLowerCase();
    for (const s of book.sheets) {
      for (const cell of Object.values(s.cells)) {
        if (typeof cell.v === 'string' && cell.v.startsWith('=')) {
          cell.v = cell.v.replace(/(?<![\wÀ-ÿ.])('[^']+'|[A-Za-z_À-ÿ][\wÀ-ÿ.]*)!/g, (m, sh) => (
            sh.replace(/^'|'$/g, '').toLowerCase() === old ? (/^[A-Za-z_À-ÿ][\wÀ-ÿ.]*$/.test(clean) ? `${clean}!` : `'${clean}'!`) : m));
        }
      }
    }
    book.sheets[i].name = clean;
    renderTabs();
    changed();
  }
  async function deleteSheet(i) {
    if (book.sheets.length < 2) return;
    if (!(await confirmDialog(`Supprimer la feuille « ${book.sheets[i].name} » ?`, { title: 'Tableur', icon: '🗑️', danger: true }))) return;
    pushUndo();
    book.sheets.splice(i, 1);
    switchSheet(Math.max(0, i - 1));
    doc.touch();
  }

  // ---------------------------------------------------------------- graphique
  function insertChart() {
    const { r1, r2, c1, c2 } = rangeBounds();
    if (r1 === r2 && c1 === c2) {
      import('../../notify.js').then(({ toast }) => toast('Graphique', 'Sélectionnez d\'abord une plage de données (étiquettes + valeurs).', { icon: '📊' }));
      return;
    }
    const grid2 = [];
    for (let r = r1; r <= r2; r += 1) {
      const row = [];
      for (let c = c1; c <= c2; c += 1) row.push(value(r, c));
      grid2.push(row);
    }
    const hasHeader = grid2[0].slice(1).some((v) => typeof v === 'string') || (grid2[0].length === 1 && typeof grid2[0][0] === 'string');
    const hasLabels = grid2.slice(hasHeader ? 1 : 0).some((row) => typeof row[0] === 'string');
    const body = grid2.slice(hasHeader ? 1 : 0);
    const labels = body.map((row, i) => (hasLabels ? display(row[0]) : String(i + 1)));
    const firstCol = hasLabels ? 1 : 0;
    const series = [];
    for (let j = firstCol; j < grid2[0].length; j += 1) {
      series.push({
        name: hasHeader ? display(grid2[0][j]) : `Série ${j - firstCol + 1}`,
        values: body.map((row) => (typeof row[j] === 'number' ? row[j] : 0)),
      });
    }
    if (!series.length) return;
    openChart(labels, series);
  }

  function openChart(labels, series) {
    const typeSel = h('select', { class: 'rb-select' },
      [['bar', 'Histogramme'], ['line', 'Courbes'], ['pie', 'Secteurs']].map(([v, l]) => h('option', { value: v, text: l })));
    const area = h('div', { class: 'ss-chart-area' });
    const cw = createWindow({
      appId: 'sheet', title: 'Graphique', icon: '📊', width: 640, height: 460, minWidth: 360, minHeight: 280,
      content: h('div', { class: 'ss-chart' }, h('div', { class: 'ss-chart-bar' }, h('label', { text: 'Type : ' }), typeSel), area),
    });
    const draw = () => { area.innerHTML = chartSvg(typeSel.value, labels, series); };
    typeSel.addEventListener('change', draw);
    cw.onResize = draw;
    draw();
  }

  // ---------------------------------------------------------------- menus
  function cellMenu() {
    const { r1, r2, c1, c2 } = rangeBounds();
    return [
      { label: 'Couper', hint: 'Ctrl+X', icon: '✂️', action: () => { grid.focus(); document.execCommand('cut'); } },
      { label: 'Copier', hint: 'Ctrl+C', icon: '📄', action: () => { grid.focus(); document.execCommand('copy'); } },
      { label: 'Coller', hint: 'Ctrl+V', icon: '📋', disabled: true },
      { separator: true },
      { label: `Insérer ${r2 - r1 + 1} ligne(s) au-dessus`, icon: '⤒', action: () => shiftStructure('row', r1, r2 - r1 + 1) },
      { label: `Insérer ${c2 - c1 + 1} colonne(s) à gauche`, icon: '⇤', action: () => shiftStructure('col', c1, c2 - c1 + 1) },
      { label: 'Supprimer les lignes', icon: '🗑️', action: () => shiftStructure('row', r1, -(r2 - r1 + 1)) },
      { label: 'Supprimer les colonnes', icon: '🗑️', action: () => shiftStructure('col', c1, -(c2 - c1 + 1)) },
      { separator: true },
      { label: 'Effacer le contenu', hint: 'Suppr', action: () => clearRange('values') },
      { label: 'Effacer la mise en forme', action: () => clearRange('format') },
      { label: 'Trier de A à Z', icon: '↓', action: () => sortRange(false) },
      { label: 'Trier de Z à A', icon: '↑', action: () => sortRange(true) },
    ];
  }

  const fileMenu = () => [
    { label: 'Nouveau', hint: 'Ctrl+N', icon: '📄', action: doc.newDoc },
    { label: 'Nouvelle fenêtre', action: () => launch() },
    { label: 'Ouvrir…', hint: 'Ctrl+O', icon: '📂', action: doc.open },
    { label: 'Enregistrer', hint: 'Ctrl+S', icon: '💾', action: doc.save },
    { label: 'Enregistrer sous…', hint: 'Ctrl+Maj+S', action: doc.saveAs },
    { separator: true },
    { label: 'Exporter la feuille en CSV…', icon: '📤', action: () => doc.exportAs('csv', exportCsv, 'CSV') },
    { label: 'Exporter la feuille en HTML…', icon: '🌐', action: () => doc.exportAs('html', exportHtml, 'HTML') },
    { separator: true },
    { label: 'Fermer', action: () => win.close() },
  ];

  function exportCsv() {
    const { maxR, maxC } = usedBounds();
    const lines = [];
    for (let r = 0; r <= maxR; r += 1) {
      const row = [];
      for (let c = 0; c <= maxC; c += 1) {
        const v = value(r, c);
        row.push(escapeCsv(typeof v === 'number' ? String(v).replace('.', ',') : display(v), ';'));
      }
      lines.push(row.join(';'));
    }
    return lines.join('\r\n');
  }
  function exportHtml() {
    const { maxR, maxC } = usedBounds();
    let rows = '';
    for (let r = 0; r <= maxR; r += 1) {
      rows += '<tr>';
      for (let c = 0; c <= maxC; c += 1) {
        const st = sheet().cells[cellKey(r, c)]?.s || {};
        const v = value(r, c);
        const style = [st.b && 'font-weight:bold', st.i && 'font-style:italic', st.bg && `background:${st.bg}`,
          st.fg && `color:${st.fg}`, `text-align:${st.al || (typeof v === 'number' ? 'right' : 'left')}`].filter(Boolean).join(';');
        rows += `<td style="${escapeHtml(style)}">${escapeHtml(display(v, st.fmt))}</td>`;
      }
      rows += '</tr>\n';
    }
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(sheet().name)}</title>
<style>body{font:13px "Segoe UI",Arial,sans-serif}table{border-collapse:collapse}td{border:1px solid #ccc;padding:3px 8px}</style>
</head><body><table>${rows}</table></body></html>`;
  }

  // ---------------------------------------------------------------- ruban
  const boldBtn = rbBtn('<b>G</b>', 'Gras (Ctrl+B)', () => toggleStyle('b'));
  const italBtn = rbBtn('<i>I</i>', 'Italique (Ctrl+I)', () => toggleStyle('i'));
  const undBtn = rbBtn('<u>S</u>', 'Souligné (Ctrl+U)', () => toggleStyle('u'));
  const fmtSel = rbSelect(FORMATS, 'Format de nombre', (v) => setStyle({ fmt: v === 'gen' ? null : v }), { width: 130 });
  const sizeSel = rbSelect([['', 'Taille'], ...[10, 11, 12, 13, 14, 16, 18, 20, 24].map((s) => [String(s), String(s)])],
    'Taille du texte', (v) => setStyle({ fs: v ? Number(v) : null }), { width: 70 });

  const rb = ribbon([
    {
      label: 'Accueil',
      groups: [
        { label: 'Annuler', items: [rbBtn('↶', 'Annuler (Ctrl+Z)', undo), rbBtn('↷', 'Rétablir (Ctrl+Y)', redo)] },
        {
          label: 'Police',
          items: [h('div', { class: 'rb-row' }, sizeSel, boldBtn, italBtn, undBtn),
            h('div', { class: 'rb-row' },
              rbColor('A', 'Couleur du texte', '#c00000', (c) => setStyle({ fg: c })),
              rbColor('🪣', 'Couleur de remplissage', '#fff2cc', (c) => setStyle({ bg: c })),
              rbBtn('▦', 'Bordures', () => setStyle({ bd: !sheet().cells[cellKey(sel.r, sel.c)]?.s?.bd })),
              rbBtn('🧹', 'Effacer la mise en forme', () => clearRange('format')))],
        },
        {
          label: 'Alignement',
          items: [h('div', { class: 'rb-row' },
            rbBtn('⯇≡', 'Aligner à gauche', () => setStyle({ al: 'left' })),
            rbBtn('≡', 'Centrer', () => setStyle({ al: 'center' })),
            rbBtn('≡⯈', 'Aligner à droite', () => setStyle({ al: 'right' }))),
          h('div', { class: 'rb-row' }, rbBtn('↵ Renvoyer à la ligne', 'Renvoyer à la ligne automatiquement', () => toggleStyle('wrap')))],
        },
        { label: 'Nombre', items: [fmtSel] },
        {
          label: 'Cellules',
          items: [h('div', { class: 'rb-row' },
            rbBtn('⤒ Ligne', 'Insérer une ligne', () => shiftStructure('row', rangeBounds().r1, 1)),
            rbBtn('⇤ Colonne', 'Insérer une colonne', () => shiftStructure('col', rangeBounds().c1, 1))),
          h('div', { class: 'rb-row' },
            rbBtn('✖ Ligne', 'Supprimer la ligne', () => shiftStructure('row', rangeBounds().r1, -1)),
            rbBtn('✖ Colonne', 'Supprimer la colonne', () => shiftStructure('col', rangeBounds().c1, -1)))],
        },
        {
          label: 'Édition',
          items: [h('div', { class: 'rb-row' },
            rbBtn('Σ Somme', 'Somme automatique', autoSum),
            rbBtn('⬇ Recopier', 'Recopier vers le bas (Ctrl+D)', () => fill('down'))),
          h('div', { class: 'rb-row' },
            rbBtn('A→Z', 'Trier par ordre croissant', () => sortRange(false)),
            rbBtn('Z→A', 'Trier par ordre décroissant', () => sortRange(true)))],
        },
      ],
    },
    {
      label: 'Insertion',
      groups: [
        { label: 'Graphiques', items: [rbBtn('📊<br>Graphique', 'Graphique à partir de la sélection', insertChart, { big: true })] },
        {
          label: 'Fonctions',
          items: [rbSelect([['', 'ƒx Insérer une fonction…'], ...['SOMME', 'MOYENNE', 'MIN', 'MAX', 'NB', 'SI', 'NB.SI', 'SOMME.SI',
            'RECHERCHEV', 'ARRONDI', 'CONCATENER', 'AUJOURDHUI', 'SIERREUR', 'MEDIANE', 'ECARTYPE'].map((f) => [f, f])],
          'Fonctions', (v) => { if (v) startEdit(`=${v}(`); }, { width: 190 })],
        },
        {
          label: 'Feuille',
          items: [rbBtn('➕ Feuille', 'Nouvelle feuille', addSheet), rbBtn('➕ 100 lignes', 'Ajouter 100 lignes', () => {
            sheet().rows = Math.min(MAX_ROWS, sheet().rows + 100);
            buildGrid();
            doc.touch();
          })],
        },
      ],
    },
  ], { fileMenu, showMenu, accent: '#107c41' });

  // ---------------------------------------------------------------- document
  const doc = docController({
    win, appName: 'Tableur', icon: '📗', ext: 'wcalc', defaultName: 'Classeur1.wcalc', openFilter: ['wcalc', 'csv', 'tsv', 'txt'],
    serialize: () => JSON.stringify({ format: 'winweb-sheet', version: 1, sheets: book.sheets, active: book.active }),
    load(content, p) {
      if (extname(p) === 'wcalc') {
        const data = JSON.parse(content || '{}');
        if (data.format !== 'winweb-sheet' || !Array.isArray(data.sheets) || !data.sheets.length) {
          throw new Error('Ce fichier n\'est pas un classeur valide');
        }
        book.sheets = data.sheets.map((s, i) => ({
          name: String(s.name || `Feuil${i + 1}`), cells: s.cells && typeof s.cells === 'object' ? s.cells : {},
          colW: s.colW || {}, rows: Math.min(MAX_ROWS, Number(s.rows) || 100), cols: Math.min(MAX_COLS, Number(s.cols) || 26),
        }));
        book.active = Math.min(Number(data.active) || 0, book.sheets.length - 1);
      } else {
        const { rows } = parseCsv(content);
        const s = newSheet(p.split('/').pop().replace(/\.[^.]+$/, '').slice(0, 31) || 'Feuil1');
        rows.forEach((row, r) => row.forEach((v, c) => { if (v !== '') s.cells[cellKey(r, c)] = { v }; }));
        s.rows = Math.min(MAX_ROWS, Math.max(100, rows.length + 20));
        s.cols = Math.min(MAX_COLS, Math.max(26, ...rows.map((r) => r.length + 2)));
        book.sheets = [s];
        book.active = 0;
      }
      undoStack = [];
      redoStack = [];
      sel.r = 0; sel.c = 0; sel.ar = 0; sel.ac = 0;
      buildGrid();
      renderTabs();
      cache = new Map();
      renderCells();
    },
    reset() {
      book.sheets = [newSheet('Feuil1')];
      book.active = 0;
      undoStack = [];
      redoStack = [];
      buildGrid();
      renderTabs();
      changed(false);
    },
  });

  const fxBar = h('div', { class: 'ss-fxbar' }, nameBox, h('span', { class: 'ss-fx-label', text: 'ƒx' }), fx);
  win.body.append(h('div', { class: 'office-app sheet' }, rb, fxBar, grid,
    h('div', { class: 'ss-bottom' }, tabsBar, statusInfo)));
  win.onDestroy = () => {
    window.removeEventListener('mouseup', stopDrag);
    document.removeEventListener('copy', copyHandler);
    document.removeEventListener('cut', cutHandler);
    document.removeEventListener('paste', onPaste);
  };

  buildGrid();
  renderTabs();
  if (path) doc.load(path);
  setTimeout(() => grid.focus(), 60);
  return win;
}

// ------------------------------------------------------------------ graphiques SVG
const PALETTE = ['#2a7ab9', '#e07b39', '#3fa34d', '#c0392b', '#8e44ad', '#16a085', '#d4ac0d', '#7f8c8d'];

export function chartSvg(type, labels, series) {
  const W = 600;
  const H = 360;
  const esc = escapeHtml;
  const legend = series.map((s, i) => `<g transform="translate(${70 + i * 130},${H - 16})"><rect width="12" height="12" fill="${PALETTE[i % 8]}"/>
    <text x="16" y="10" font-size="12" fill="currentColor">${esc(s.name.slice(0, 16))}</text></g>`).join('');
  if (type === 'pie') {
    const vals = series[0].values.map((v) => Math.max(0, v));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    let angle = -Math.PI / 2;
    const cx = 210;
    const cy = 170;
    const rad = 140;
    const parts = vals.map((v, i) => {
      const a2 = angle + (v / total) * Math.PI * 2;
      const large = a2 - angle > Math.PI ? 1 : 0;
      const p = vals.length === 1 || v === total
        ? `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${PALETTE[i % 8]}"/>`
        : `<path d="M${cx},${cy} L${cx + rad * Math.cos(angle)},${cy + rad * Math.sin(angle)} A${rad},${rad} 0 ${large} 1 ${cx + rad * Math.cos(a2)},${cy + rad * Math.sin(a2)} Z" fill="${PALETTE[i % 8]}" stroke="#fff" stroke-width="1.5"/>`;
      angle = a2;
      return p;
    }).join('');
    const keys = labels.map((l, i) => `<g transform="translate(400,${40 + i * 22})"><rect width="12" height="12" fill="${PALETTE[i % 8]}"/>
      <text x="18" y="11" font-size="12" fill="currentColor">${esc(String(l).slice(0, 18))} (${Math.round((vals[i] / total) * 100)} %)</text></g>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="ss-svg">${parts}${keys}</svg>`;
  }
  const all = series.flatMap((s) => s.values);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const x0 = 60;
  const y0 = 20;
  const pw = W - 80;
  const ph = H - 80;
  const y = (v) => y0 + ph - ((v - min) / span) * ph;
  let axes = '';
  for (let k = 0; k <= 5; k += 1) {
    const v = min + (span * k) / 5;
    axes += `<line x1="${x0}" x2="${x0 + pw}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" opacity=".12"/>
      <text x="${x0 - 6}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="currentColor">${esc(display(Math.round(v * 100) / 100))}</text>`;
  }
  const n = labels.length || 1;
  const slot = pw / n;
  const xl = labels.map((l, i) => `<text x="${x0 + slot * i + slot / 2}" y="${y0 + ph + 16}" font-size="11" text-anchor="middle" fill="currentColor">${esc(String(l).slice(0, 12))}</text>`).join('');
  let marks = '';
  if (type === 'line') {
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => `${x0 + slot * i + slot / 2},${y(v)}`);
      marks += `<polyline points="${pts.join(' ')}" fill="none" stroke="${PALETTE[si % 8]}" stroke-width="2.5"/>`;
      marks += pts.map((p) => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3.5" fill="${PALETTE[si % 8]}"/>`).join('');
    });
  } else {
    const bw = (slot * 0.75) / series.length;
    series.forEach((s, si) => s.values.forEach((v, i) => {
      const x = x0 + slot * i + slot * 0.125 + bw * si;
      marks += `<rect x="${x}" y="${Math.min(y(v), y(0))}" width="${Math.max(1, bw - 2)}" height="${Math.abs(y(v) - y(0))}" fill="${PALETTE[si % 8]}" rx="2"><title>${esc(String(labels[i]))} : ${esc(display(v))}</title></rect>`;
    }));
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="ss-svg">${axes}<line x1="${x0}" x2="${x0 + pw}" y1="${y(0)}" y2="${y(0)}" stroke="currentColor" opacity=".5"/>${marks}${xl}${legend}</svg>`;
}

export default {
  id: 'sheet', name: 'Tableur', icon: '📗', launch, description: 'Classeurs et calculs (.wcalc, .csv)',
};
