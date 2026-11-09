// Éditeur++ : éditeur de texte et de code façon Notepad++.
// Onglets, numéros de ligne, coloration syntaxique, rechercher/remplacer
// (casse, mot entier, expressions régulières, tous les onglets), aller à la
// ligne, opérations sur les lignes, symboles invisibles, fins de ligne
// Windows/Unix, zoom, session et fichiers récents. Instance unique.
import { api } from '../api.js';
import { fsChanged } from '../bus.js';
import { showMenu } from '../contextMenu.js';
import {
  alertDialog, choiceDialog, fileDialog, promptDialog,
} from '../dialogs.js';
import { toast, toastError } from '../notify.js';
import { launchApp } from '../registry.js';
import {
  basename, dirname, extname, h, toWinPath,
} from '../utils.js';
import { createWindow } from '../windowManager.js';
import { menuBar } from './common.js';
import { highlightLines, langForExt, LANGS } from './syntax.js';

const KEY = 'winweb.editorpp';
const BASE_FONT = 14;
let instance = null;

function loadPrefs() {
  const defaults = {
    wrap: false, symbols: false, lineNumbers: true, zoom: 0, dark: false, spaces: false, tabSize: 4, recent: [], session: [],
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return defaults;
  }
}
function savePrefs(prefs) {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* stockage indisponible */ }
}

function launch({ path = null } = {}) {
  if (instance && !instance.closed) {
    instance.win.focus();
    if (path) instance.openPath(path);
    else instance.newTab();
    return instance.win;
  }
  const prefs = loadPrefs();
  const tabs = [];
  let active = null;
  let untitledCount = 0;
  let overwrite = false;

  const tabBar = h('div', { class: 'ce-tabs' });
  const docs = h('div', { class: 'ce-docs' });
  const status = h('div', { class: 'ce-status' });
  const findPanel = h('div', { class: 'ce-find hidden' });

  const win = createWindow({
    appId: 'editorpp', title: 'Éditeur++', icon: '🦎', width: 980, height: 660, minWidth: 480, minHeight: 300,
  });

  // ---------------------------------------------------------------- onglets
  function createTab({ path: p = null, text = '', encoding = 'utf-8', eol = 'LF' } = {}) {
    untitledCount += p ? 0 : 1;
    const ta = h('textarea', { class: 'ce-input', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', wrap: 'off' });
    const pre = h('pre', { class: 'ce-hl', 'aria-hidden': 'true' });
    const gutter = h('div', { class: 'ce-gutter', 'aria-hidden': 'true' });
    const area = h('div', { class: 'ce-area' }, pre, ta);
    const el = h('div', { class: 'ce-doc hidden' }, gutter, area);
    const tab = {
      id: `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      path: p, name: p ? basename(p) : `nouveau ${untitledCount}`, saved: text, encoding, eol,
      lang: langForExt(p ? extname(p) : 'txt'), ta, pre, gutter, area, el, lineCount: 0, curLine: -1,
    };
    ta.value = text;
    ta.addEventListener('input', () => { scheduleRender(tab); updateTab(tab); });
    ta.addEventListener('scroll', () => syncScroll(tab));
    ta.addEventListener('keydown', (e) => onKey(e, tab));
    for (const ev of ['keyup', 'click', 'select', 'focus']) ta.addEventListener(ev, () => { updateCursor(tab); });
    ta.addEventListener('mouseup', () => updateCursor(tab));
    ta.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    docs.append(el);
    tabs.push(tab);
    applyView(tab);
    renderTabs();
    return tab;
  }

  const isDirty = (tab) => tab.ta.value !== tab.saved;

  function renderTabs() {
    tabBar.replaceChildren(...tabs.map((tab) => h('div', {
      class: `ce-tab${tab === active ? ' active' : ''}${isDirty(tab) ? ' dirty' : ''}`, title: tab.path ? toWinPath(tab.path) : tab.name,
      onmousedown: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab); } },
      onclick: () => activate(tab),
      oncontextmenu: (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, [
          { label: 'Fermer', hint: 'Ctrl+W', action: () => closeTab(tab) },
          { label: 'Fermer les autres', action: () => closeOthers(tab) },
          { label: 'Enregistrer', action: () => save(tab) },
          { label: 'Enregistrer sous…', action: () => saveAs(tab) },
          { separator: true },
          { label: 'Copier le chemin complet', disabled: !tab.path, action: () => navigator.clipboard?.writeText(toWinPath(tab.path)) },
          { label: 'Ouvrir le dossier dans l\'explorateur', disabled: !tab.path, action: () => launchApp('explorer', { path: dirname(tab.path) }) },
        ]);
      },
    }, h('span', { class: 'ce-tab-ico', text: isDirty(tab) ? '💾' : '📄' }), h('span', { class: 'ce-tab-name', text: tab.name }),
    h('button', { class: 'ce-tab-x', type: 'button', text: '✕', title: 'Fermer', onclick: (e) => { e.stopPropagation(); closeTab(tab); } }))),
    h('button', { class: 'ce-tab-new', type: 'button', text: '+', title: 'Nouveau (Ctrl+N)', onclick: () => newTab() }));
  }
  function updateTab(tab) {
    const node = tabBar.children[tabs.indexOf(tab)];
    if (!node) return;
    const dirty = isDirty(tab);
    if (node.classList.contains('dirty') !== dirty) renderTabs();
    updateTitle();
  }

  function activate(tab) {
    if (!tab) return;
    active = tab;
    for (const t of tabs) t.el.classList.toggle('hidden', t !== tab);
    renderTabs();
    renderNow(tab);
    updateTitle();
    updateCursor(tab);
    setTimeout(() => { tab.ta.focus(); fitLayer(tab); syncScroll(tab); }, 0);
    persistSession();
  }

  function updateTitle() {
    if (!active) { win.setTitle('Éditeur++'); return; }
    win.setTitle(`${isDirty(active) ? '*' : ''}${active.path ? toWinPath(active.path) : active.name} - Éditeur++`);
  }

  function newTab() {
    const tab = createTab();
    activate(tab);
    return tab;
  }

  async function openPath(p) {
    const existing = tabs.find((t) => t.path === p);
    if (existing) { activate(existing); return existing; }
    try {
      const data = await api.read(p);
      const eol = /\r\n/.test(data.content) ? 'CRLF' : 'LF';
      const text = data.content.replace(/\r\n?/g, '\n');
      // Remplace un onglet « nouveau » vide et intact.
      if (active && !active.path && !active.ta.value && tabs.length === 1) {
        active.el.remove();
        tabs.splice(tabs.indexOf(active), 1);
      }
      const tab = createTab({ path: data.path, text, encoding: data.encoding, eol });
      addRecent(data.path);
      activate(tab);
      return tab;
    } catch (err) {
      toastError(err.message, 'Éditeur++');
      return null;
    }
  }

  async function openDialog() {
    const target = await fileDialog({ mode: 'open', startDir: active?.path ? dirname(active.path) : '/Documents' });
    if (target) openPath(target);
  }

  function openLocal() {
    const input = h('input', { type: 'file', multiple: true });
    input.addEventListener('change', async () => {
      for (const file of input.files) {
        if (file.size > 5 * 1024 * 1024) { toastError(`${file.name} : fichier trop volumineux`); continue; }
        const text = (await file.text()).replace(/\r\n?/g, '\n');
        const tab = createTab({ text: '' });
        tab.ta.value = text;
        tab.name = file.name;
        tab.lang = langForExt(extname(file.name));
        activate(tab);
      }
    });
    input.click();
  }

  async function reload(tab = active) {
    if (!tab?.path) return;
    if (isDirty(tab)) {
      const c = await choiceDialog(`Recharger « ${tab.name} » et perdre les modifications ?`, ['Recharger', 'Annuler'], { title: 'Éditeur++', icon: '🔄' });
      if (c !== 0) return;
    }
    try {
      const data = await api.read(tab.path);
      tab.saved = data.content.replace(/\r\n?/g, '\n');
      tab.ta.value = tab.saved;
      tab.eol = /\r\n/.test(data.content) ? 'CRLF' : 'LF';
      renderNow(tab);
      renderTabs();
      updateTitle();
    } catch (err) { toastError(err.message); }
  }

  async function save(tab = active) {
    if (!tab) return false;
    if (!tab.path) return saveAs(tab);
    try {
      const text = tab.eol === 'CRLF' ? tab.ta.value.replace(/\n/g, '\r\n') : tab.ta.value;
      const entry = await api.write(tab.path, text);
      tab.saved = tab.ta.value;
      tab.encoding = 'utf-8';
      renderTabs();
      updateTitle();
      updateCursor(tab);
      fsChanged([dirname(entry.path)]);
      return true;
    } catch (err) {
      toastError(err.message, 'Enregistrement impossible');
      return false;
    }
  }
  async function saveAs(tab = active) {
    if (!tab) return false;
    const target = await fileDialog({
      mode: 'save', startDir: tab.path ? dirname(tab.path) : '/Documents', defaultName: tab.path ? tab.name : `${tab.name}.txt`,
    });
    if (!target) return false;
    const other = tabs.find((t) => t !== tab && t.path === target);
    if (other) closeTab(other, true);
    tab.path = target;
    tab.name = basename(target);
    if (tab.lang === 'text') tab.lang = langForExt(extname(target));
    const ok = await save(tab);
    if (ok) { addRecent(target); renderNow(tab); persistSession(); }
    return ok;
  }
  async function saveAll() {
    for (const tab of tabs) if (isDirty(tab)) await save(tab);
  }

  async function confirmTab(tab) {
    if (!isDirty(tab)) return true;
    activate(tab);
    const choice = await choiceDialog(`Enregistrer les modifications de « ${tab.name} » ?`, ['Enregistrer', 'Ne pas enregistrer', 'Annuler'], { title: 'Éditeur++', icon: '🦎' });
    if (choice === 0) return save(tab);
    return choice === 1;
  }
  async function closeTab(tab, force = false) {
    if (!force && !(await confirmTab(tab))) return false;
    const idx = tabs.indexOf(tab);
    if (idx < 0) return true;
    tabs.splice(idx, 1);
    tab.el.remove();
    if (!tabs.length) { untitledCount = 0; newTab(); } else if (active === tab) activate(tabs[Math.min(idx, tabs.length - 1)]);
    else renderTabs();
    persistSession();
    return true;
  }
  async function closeOthers(keep) {
    for (const tab of [...tabs]) if (tab !== keep && !(await closeTab(tab))) return;
  }

  function addRecent(p) {
    prefs.recent = [p, ...prefs.recent.filter((x) => x !== p)].slice(0, 10);
    savePrefs(prefs);
  }
  function persistSession() {
    prefs.session = tabs.filter((t) => t.path).map((t) => t.path);
    prefs.activePath = active?.path || null;
    savePrefs(prefs);
  }

  // ---------------------------------------------------------------- rendu
  const pending = new Set();
  let raf = null;
  function scheduleRender(tab) {
    pending.add(tab);
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      for (const t of pending) renderNow(t);
      pending.clear();
    });
  }

  function renderNow(tab) {
    const lines = highlightLines(tab.ta.value, tab.lang, { whitespace: prefs.symbols });
    const eolMark = prefs.symbols ? `<span class="ws-eol">${tab.eol === 'CRLF' ? 'CRLF' : 'LF'}</span>` : '';
    tab.pre.innerHTML = lines.map((l, i) => `<div class="ce-line${i === tab.curLine ? ' cur' : ''}">${l}${i < lines.length - 1 ? eolMark : ''}${l ? '' : '​'}</div>`).join('');
    tab.lineCount = lines.length;
    renderGutter(tab);
    fitLayer(tab);
    syncScroll(tab);
  }

  function renderGutter(tab) {
    if (!prefs.lineNumbers) { tab.gutter.replaceChildren(); return; }
    const digits = String(tab.lineCount).length;
    tab.gutter.style.width = `${Math.max(3, digits) + 1.6}ch`;
    if (prefs.wrap) {
      const lineEls = tab.pre.children;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < lineEls.length; i += 1) {
        frag.append(h('div', { class: `ce-num${i === tab.curLine ? ' cur' : ''}`, style: { height: `${lineEls[i].offsetHeight}px` }, text: String(i + 1) }));
      }
      tab.gutter.replaceChildren(frag);
    } else {
      let html = '';
      for (let i = 0; i < tab.lineCount; i += 1) html += `<div class="ce-num${i === tab.curLine ? ' cur' : ''}">${i + 1}</div>`;
      tab.gutter.innerHTML = html;
    }
  }

  /** La couche colorée prend exactement la zone de contenu du textarea (hors barres de défilement). */
  function fitLayer(tab) {
    tab.pre.style.width = `${tab.ta.clientWidth}px`;
    tab.pre.style.height = `${tab.ta.clientHeight}px`;
  }
  function syncScroll(tab) {
    tab.pre.scrollTop = tab.ta.scrollTop;
    tab.pre.scrollLeft = tab.ta.scrollLeft;
    tab.gutter.scrollTop = tab.ta.scrollTop;
  }

  function applyView(tab) {
    const size = Math.round(BASE_FONT * (1 + prefs.zoom * 0.1));
    tab.el.style.setProperty('--ce-font', `${Math.max(7, size)}px`);
    tab.el.style.setProperty('--ce-tab', String(prefs.tabSize));
    tab.el.classList.toggle('wrap', prefs.wrap);
    tab.el.classList.toggle('no-numbers', !prefs.lineNumbers);
    tab.ta.wrap = prefs.wrap ? 'soft' : 'off';
  }
  function applyAll() {
    root.classList.toggle('dark', prefs.dark);
    for (const tab of tabs) { applyView(tab); renderNow(tab); }
    savePrefs(prefs);
    if (active) updateCursor(active);
  }
  function zoom(delta) {
    prefs.zoom = delta === 0 ? 0 : Math.max(-5, Math.min(15, prefs.zoom + delta));
    applyAll();
  }

  function lineInfo(tab) {
    const { value, selectionStart: s, selectionEnd: e } = tab.ta;
    const before = value.slice(0, s);
    const line = before.split('\n').length - 1;
    const col = s - before.lastIndexOf('\n');
    return { line, col, sel: e - s, selLines: e > s ? value.slice(s, e).split('\n').length : 0 };
  }

  function updateCursor(tab) {
    if (tab !== active) return;
    const { line, col, sel, selLines } = lineInfo(tab);
    if (line !== tab.curLine) {
      tab.pre.children[tab.curLine]?.classList.remove('cur');
      tab.gutter.children[tab.curLine]?.classList.remove('cur');
      tab.curLine = line;
      tab.pre.children[line]?.classList.add('cur');
      tab.gutter.children[line]?.classList.add('cur');
    }
    const len = tab.ta.value.length;
    status.replaceChildren(
      h('span', { class: 'ce-st-lang', text: LANGS[tab.lang]?.name || 'Texte' }),
      h('span', { text: `longueur : ${len.toLocaleString('fr-FR')}    lignes : ${tab.lineCount.toLocaleString('fr-FR')}` }),
      h('span', { text: `Ln : ${line + 1}    Col : ${col}    Sél : ${sel} | ${selLines}` }),
      h('button', { class: 'ce-st-btn', type: 'button', title: 'Changer les fins de ligne', text: tab.eol === 'CRLF' ? 'Windows (CR LF)' : 'Unix (LF)', onclick: () => setEol(tab.eol === 'CRLF' ? 'LF' : 'CRLF') }),
      h('span', { text: tab.encoding === 'utf-8' ? 'UTF-8' : 'ANSI → UTF-8' }),
      h('span', { text: overwrite ? 'RFP' : 'INS', title: overwrite ? 'Mode refrappe (Inser)' : 'Mode insertion (Inser)' }),
    );
  }

  // ---------------------------------------------------------------- édition
  /** Remplace une plage en conservant l'historique d'annulation natif. */
  function replaceRange(tab, start, end, text, selStart = null, selEnd = null) {
    const { ta } = tab;
    ta.focus();
    ta.setSelectionRange(start, end);
    if (!document.execCommand('insertText', false, text)) {
      ta.setRangeText(text, start, end, 'end');
      ta.dispatchEvent(new Event('input'));
    }
    if (selStart !== null) ta.setSelectionRange(selStart, selEnd ?? selStart);
    updateCursor(tab);
  }

  /** Bornes des lignes complètes couvertes par la sélection. */
  function lineBlock(tab) {
    const { value, selectionStart: s, selectionEnd: e } = tab.ta;
    const start = value.lastIndexOf('\n', s - 1) + 1;
    let endAt = e;
    if (e > s && value[e - 1] === '\n') endAt = e - 1;
    let end = value.indexOf('\n', endAt);
    if (end < 0) end = value.length;
    return { start, end, text: value.slice(start, end) };
  }

  function transformLines(tab, fn, { keepSel = true } = {}) {
    const { start, end, text } = lineBlock(tab);
    const out = fn(text.split('\n')).join('\n');
    if (out === text) return;
    replaceRange(tab, start, end, out, keepSel ? start : start + out.length, start + out.length);
  }

  const indentUnit = () => (prefs.spaces ? ' '.repeat(prefs.tabSize) : '\t');

  function indent(tab, back = false) {
    const { selectionStart: s, selectionEnd: e, value } = tab.ta;
    if (!back && s === e) { replaceRange(tab, s, e, indentUnit()); return; }
    if (!back && !value.slice(s, e).includes('\n')) { replaceRange(tab, s, e, indentUnit()); return; }
    transformLines(tab, (lines) => lines.map((l) => {
      if (!back) return l ? indentUnit() + l : l;
      if (l.startsWith('\t')) return l.slice(1);
      const m = /^ {1,8}/.exec(l);
      return m ? l.slice(Math.min(m[0].length, prefs.tabSize)) : l;
    }));
  }

  function toggleComment(tab) {
    const spec = LANGS[tab.lang]?.comment;
    if (!spec) { toast('Éditeur++', 'Pas de commentaire défini pour ce langage', { icon: 'ℹ️', timeout: 2000 }); return; }
    if (spec.line) {
      const mark = spec.line;
      transformLines(tab, (lines) => {
        const all = lines.filter((l) => l.trim()).every((l) => l.trimStart().startsWith(mark));
        return lines.map((l) => {
          if (!l.trim()) return l;
          if (all) return l.replace(new RegExp(`^(\\s*)${mark.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} ?`), '$1');
          return l.replace(/^(\s*)/, `$1${mark} `);
        });
      });
    } else {
      const [a, b] = spec.block;
      const { start, end, text } = lineBlock(tab);
      const trimmed = text.trim();
      let out = `${a}${text}${b}`;
      if (trimmed.startsWith(a) && trimmed.endsWith(b)) {
        const inner = text.replace(a, '');
        const cut = inner.lastIndexOf(b);
        out = inner.slice(0, cut) + inner.slice(cut + b.length);
      }
      replaceRange(tab, start, end, out, start, start + out.length);
    }
  }

  function duplicateLine(tab) {
    const { start, end, text } = lineBlock(tab);
    const { selectionStart: s, selectionEnd: e } = tab.ta;
    if (s !== e && !tab.ta.value.slice(s, e).includes('\n')) {
      const sel = tab.ta.value.slice(s, e);
      replaceRange(tab, e, e, sel, e, e + sel.length);
      return;
    }
    replaceRange(tab, end, end, `\n${text}`, end + 1 + (s - start), end + 1 + (e - start));
  }
  function deleteLine(tab) {
    const { start, end } = lineBlock(tab);
    const { value } = tab.ta;
    const from = end < value.length ? start : Math.max(0, start - 1);
    const to = end < value.length ? end + 1 : end;
    replaceRange(tab, from, to, '', from);
  }
  function moveLines(tab, dir) {
    const { value } = tab.ta;
    const { start, end, text } = lineBlock(tab);
    const { selectionStart: s, selectionEnd: e } = tab.ta;
    if (dir < 0) {
      if (start === 0) return;
      const prevStart = value.lastIndexOf('\n', start - 2) + 1;
      const prev = value.slice(prevStart, start - 1);
      replaceRange(tab, prevStart, end, `${text}\n${prev}`, s - (start - prevStart), e - (start - prevStart));
    } else {
      if (end >= value.length) return;
      let nextEnd = value.indexOf('\n', end + 1);
      if (nextEnd < 0) nextEnd = value.length;
      const next = value.slice(end + 1, nextEnd);
      replaceRange(tab, start, nextEnd, `${next}\n${text}`, s + next.length + 1, e + next.length + 1);
    }
  }
  function changeCase(tab, upper) {
    const { selectionStart: s, selectionEnd: e, value } = tab.ta;
    if (s === e) return;
    const t = value.slice(s, e);
    replaceRange(tab, s, e, upper ? t.toUpperCase() : t.toLowerCase(), s, e);
  }
  function wholeDoc(tab, fn) {
    const { value } = tab.ta;
    const out = fn(value);
    if (out !== value) replaceRange(tab, 0, value.length, out, 0);
  }
  function setEol(eol) {
    if (!active || active.eol === eol) return;
    active.eol = eol;
    active.saved = `${active.saved}\u0000`; // force l'état « modifié »
    renderTabs();
    renderNow(active);
    updateTitle();
    updateCursor(active);
  }


  function onKey(e, tab) {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    const k = key.toLowerCase();
    if (key === 'Tab') { e.preventDefault(); indent(tab, e.shiftKey); return; }
    if (key === 'Insert') { overwrite = !overwrite; updateCursor(tab); return; }
    if (overwrite && key.length === 1 && !ctrl && !e.altKey) {
      // Mode refrappe : le caractère tapé remplace le suivant (hors fin de ligne).
      const { selectionStart: s, selectionEnd: en, value } = tab.ta;
      if (s === en && s < value.length && value[s] !== '\n') {
        e.preventDefault();
        replaceRange(tab, s, s + 1, key, s + 1);
        return;
      }
    }
    if (key === 'Enter' && !ctrl && !e.altKey) {
      // Indentation automatique.
      e.preventDefault();
      const { value, selectionStart: s, selectionEnd: en } = tab.ta;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const cur = value.slice(lineStart, s);
      let lead = /^[\t ]*/.exec(cur)[0];
      if (/[{[(:]\s*$/.test(cur) && !['text', 'markdown'].includes(tab.lang)) lead += indentUnit();
      replaceRange(tab, s, en, `\n${lead}`);
      return;
    }
    if (ctrl && e.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) { e.preventDefault(); moveLines(tab, key === 'ArrowUp' ? -1 : 1); return; }
    if (e.altKey && !ctrl && (key === 'ArrowUp' || key === 'ArrowDown')) { e.preventDefault(); moveLines(tab, key === 'ArrowUp' ? -1 : 1); return; }
    if (key === 'F3') { e.preventDefault(); find(e.shiftKey ? -1 : 1); return; }
    if (key === 'F5' && !ctrl) { e.preventDefault(); insertDate(tab); return; }
    if (key === 'Escape' && !findPanel.classList.contains('hidden')) { findPanel.classList.add('hidden'); return; }
    if (!ctrl) return;
    if (k === 'd') { e.preventDefault(); duplicateLine(tab); }
    else if (k === 'l' || (e.shiftKey && k === 'k')) { e.preventDefault(); deleteLine(tab); }
    else if (k === 'q' || key === '/') { e.preventDefault(); toggleComment(tab); }
    else if (k === 'u') { e.preventDefault(); changeCase(tab, e.shiftKey); }
    else if (k === 'g') { e.preventDefault(); goToLine(); }
    else if (k === 'f') { e.preventDefault(); showFind(false); }
    else if (k === 'h') { e.preventDefault(); showFind(true); }
    else if (k === 'w') { e.preventDefault(); closeTab(tab); }
    else if (k === 'tab') { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); }
    else if (key === 'PageDown') { e.preventDefault(); cycleTab(1); }
    else if (key === 'PageUp') { e.preventDefault(); cycleTab(-1); }
    else if (key === '+' || key === '=') { e.preventDefault(); zoom(1); }
    else if (key === '-') { e.preventDefault(); zoom(-1); }
    else if (key === '0') { e.preventDefault(); zoom(0); }
    else if (k === 's' && e.shiftKey) { e.preventDefault(); saveAll(); }
    else if (k === 's') { e.preventDefault(); save(tab); }
    else if (k === 'o') { e.preventDefault(); openDialog(); }
    else if (k === 'n') { e.preventDefault(); newTab(); }
    else if (k === 'j') { e.preventDefault(); transformLines(tab, (lines) => [lines.map((l, i) => (i ? l.trim() : l.trimEnd())).join(' ')]); }
  }
  function cycleTab(dir) {
    if (tabs.length < 2) return;
    activate(tabs[(tabs.indexOf(active) + dir + tabs.length) % tabs.length]);
  }
  function insertDate(tab) {
    const { selectionStart: s, selectionEnd: e } = tab.ta;
    const stamp = new Date().toLocaleString('fr-FR');
    replaceRange(tab, s, e, stamp, s + stamp.length);
  }

  async function goToLine() {
    if (!active) return;
    const { line } = lineInfo(active);
    const answer = await promptDialog(`Aller à la ligne (1 - ${active.lineCount}) :`, String(line + 1), { title: 'Atteindre', icon: '↧' });
    const n = Number(answer);
    if (!answer || !Number.isInteger(n)) return;
    const lines = active.ta.value.split('\n');
    const target = Math.max(1, Math.min(lines.length, n));
    let pos = 0;
    for (let i = 0; i < target - 1; i += 1) pos += lines[i].length + 1;
    active.ta.focus();
    active.ta.setSelectionRange(pos, pos);
    scrollToCaret(active);
    updateCursor(active);
  }
  function scrollToCaret(tab) {
    const { line } = lineInfo(tab);
    const lineEl = tab.pre.children[line];
    if (!lineEl) return;
    const top = lineEl.offsetTop;
    if (top < tab.ta.scrollTop || top > tab.ta.scrollTop + tab.ta.clientHeight - 40) tab.ta.scrollTop = Math.max(0, top - tab.ta.clientHeight / 3);
    syncScroll(tab);
  }

  // ---------------------------------------------------------------- rechercher / remplacer
  const fInput = h('input', { class: 'input', placeholder: 'Rechercher', spellcheck: 'false' });
  const rInput = h('input', { class: 'input', placeholder: 'Remplacer par', spellcheck: 'false' });
  const optCase = h('input', { type: 'checkbox' });
  const optWord = h('input', { type: 'checkbox' });
  const optRegex = h('input', { type: 'checkbox' });
  const optWrap = h('input', { type: 'checkbox', checked: true });
  const findMsg = h('span', { class: 'ce-find-msg' });
  const replRow = h('div', { class: 'ce-find-row' }, rInput,
    h('button', { class: 'btn', type: 'button', text: 'Remplacer', onclick: () => replaceOne() }),
    h('button', { class: 'btn', type: 'button', text: 'Remplacer tout', onclick: () => replaceAll(false) }),
    h('button', { class: 'btn', type: 'button', text: 'Dans tous les onglets', onclick: () => replaceAll(true) }));
  findPanel.append(
    h('div', { class: 'ce-find-row' }, fInput,
      h('button', { class: 'btn', type: 'button', text: '◀ Précédent', onclick: () => find(-1) }),
      h('button', { class: 'btn primary', type: 'button', text: 'Suivant ▶', onclick: () => find(1) }),
      h('button', { class: 'btn', type: 'button', text: 'Compter', onclick: count }),
      h('button', { class: 'btn icon flat', type: 'button', text: '✕', title: 'Fermer (Échap)', onclick: () => { findPanel.classList.add('hidden'); active?.ta.focus(); } })),
    replRow,
    h('div', { class: 'ce-find-row opts' },
      h('label', {}, optCase, ' Respecter la casse'), h('label', {}, optWord, ' Mot entier'),
      h('label', {}, optRegex, ' Expression régulière'), h('label', {}, optWrap, ' Boucler'), findMsg),
  );
  fInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); find(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { findPanel.classList.add('hidden'); active?.ta.focus(); }
  });
  rInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } });

  function showFind(replace) {
    findPanel.classList.remove('hidden');
    replRow.classList.toggle('hidden', !replace);
    const t = active?.ta;
    if (t && t.selectionEnd > t.selectionStart) {
      const sel = t.value.slice(t.selectionStart, t.selectionEnd);
      if (!sel.includes('\n') && sel.length < 200) fInput.value = sel;
    }
    fInput.focus();
    fInput.select();
  }

  function buildRegex() {
    const needle = fInput.value;
    if (!needle) return null;
    let src = optRegex.checked ? needle : needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (optWord.checked) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
    try {
      findMsg.classList.remove('err');
      return new RegExp(src, `gu${optCase.checked ? '' : 'i'}m`);
    } catch (err) {
      findMsg.textContent = `Expression invalide : ${err.message}`;
      findMsg.classList.add('err');
      return null;
    }
  }

  function find(dir = 1) {
    const tab = active;
    const re = buildRegex();
    if (!tab || !re) return false;
    const { value, selectionStart: s, selectionEnd: e } = tab.ta;
    const matches = [];
    let m;
    while ((m = re.exec(value)) !== null) {
      if (m[0] === '') { re.lastIndex += 1; continue; }
      matches.push([m.index, m.index + m[0].length]);
      if (matches.length > 100000) break;
    }
    if (!matches.length) { findMsg.textContent = 'Aucune occurrence trouvée'; return false; }
    let hit;
    if (dir > 0) hit = matches.find(([a]) => a >= e) || (optWrap.checked ? matches[0] : null);
    else hit = [...matches].reverse().find(([, b]) => b <= s) || (optWrap.checked ? matches[matches.length - 1] : null);
    if (!hit) { findMsg.textContent = 'Fin du document atteinte'; return false; }
    tab.ta.focus();
    tab.ta.setSelectionRange(hit[0], hit[1]);
    scrollToCaret(tab);
    updateCursor(tab);
    findMsg.textContent = `Occurrence ${matches.findIndex(([a]) => a === hit[0]) + 1} sur ${matches.length}`;
    fInput.focus();
    return true;
  }
  function count() {
    const re = buildRegex();
    if (!active || !re) return;
    const n = (active.ta.value.match(re) || []).length;
    findMsg.textContent = `${n} occurrence(s)`;
  }
  function replacement(match) {
    if (!optRegex.checked) return rInput.value;
    const re = buildRegex();
    re.lastIndex = 0;
    return match.replace(new RegExp(`^(?:${re.source})$`, re.flags.replace('g', '')), rInput.value);
  }
  function replaceOne() {
    const tab = active;
    const re = buildRegex();
    if (!tab || !re) return;
    const { value, selectionStart: s, selectionEnd: e } = tab.ta;
    const sel = value.slice(s, e);
    const exact = new RegExp(`^(?:${re.source})$`, re.flags.replace('g', ''));
    if (sel && exact.test(sel)) {
      const rep = replacement(sel);
      replaceRange(tab, s, e, rep, s + rep.length);
    }
    find(1);
  }
  function replaceAll(everywhere) {
    const re = buildRegex();
    if (!re) return;
    let total = 0;
    for (const tab of everywhere ? tabs : [active]) {
      if (!tab) continue;
      const value = tab.ta.value;
      const n = (value.match(re) || []).length;
      if (!n) continue;
      total += n;
      const out = value.replace(re, optRegex.checked ? rInput.value : () => rInput.value);
      replaceRange(tab, 0, value.length, out, 0);
      updateTab(tab);
    }
    renderTabs();
    findMsg.textContent = `${total} remplacement(s)`;
  }

  // ---------------------------------------------------------------- exécution
  async function run(where) {
    const tab = active;
    if (!tab) return;
    if (!tab.path || isDirty(tab)) {
      if (!(await save(tab))) return;
    }
    const ext = extname(tab.path);
    if (where === 'browser') launchApp('browser', { path: tab.path });
    else if (ext === 'html' || ext === 'htm') launchApp('htmlapp', { path: tab.path });
    else if (ext === 'js') launchApp('jsrunner', { path: tab.path });
    else alertDialog('Seuls les fichiers .html et .js peuvent être exécutés (dans un bac à sable).', { title: 'Exécution', icon: '▶' });
  }

  // ---------------------------------------------------------------- menus
  const check = (on) => (on ? '✔' : '');
  const toggle = (prop) => () => { prefs[prop] = !prefs[prop]; applyAll(); };
  const t = () => active;
  const bar = menuBar([
    {
      label: 'Fichier',
      items: () => [
        { label: 'Nouveau', hint: 'Ctrl+N', icon: '📄', action: newTab },
        { label: 'Ouvrir…', hint: 'Ctrl+O', icon: '📂', action: openDialog },
        { label: 'Ouvrir depuis l\'ordinateur…', icon: '💻', action: openLocal },
        { label: 'Recharger depuis le disque', disabled: !t()?.path, action: () => reload() },
        {
          label: 'Fichiers récents', icon: '🕘',
          submenu: prefs.recent.length ? prefs.recent.map((p) => ({ label: toWinPath(p), action: () => openPath(p) })) : [{ label: '(aucun)', disabled: true }],
        },
        { separator: true },
        { label: 'Enregistrer', hint: 'Ctrl+S', icon: '💾', action: () => save() },
        { label: 'Enregistrer sous…', action: () => saveAs() },
        { label: 'Enregistrer tout', hint: 'Ctrl+Maj+S', action: saveAll },
        { separator: true },
        { label: 'Fermer', hint: 'Ctrl+W', action: () => active && closeTab(active) },
        { label: 'Fermer tout', action: async () => { for (const tab of [...tabs]) if (!(await closeTab(tab))) return; } },
        { label: 'Quitter', action: () => win.close() },
      ],
    },
    {
      label: 'Édition',
      items: () => [
        { label: 'Annuler', hint: 'Ctrl+Z', action: () => { t()?.ta.focus(); document.execCommand('undo'); } },
        { label: 'Rétablir', hint: 'Ctrl+Y', action: () => { t()?.ta.focus(); document.execCommand('redo'); } },
        { separator: true },
        { label: 'Tout sélectionner', hint: 'Ctrl+A', action: () => { t()?.ta.focus(); t()?.ta.select(); } },
        { label: 'Dupliquer la ligne', hint: 'Ctrl+D', action: () => t() && duplicateLine(t()) },
        { label: 'Supprimer la ligne', hint: 'Ctrl+L', action: () => t() && deleteLine(t()) },
        { label: 'Monter la ligne', hint: 'Ctrl+Maj+↑', action: () => t() && moveLines(t(), -1) },
        { label: 'Descendre la ligne', hint: 'Ctrl+Maj+↓', action: () => t() && moveLines(t(), 1) },
        { label: 'Joindre les lignes', hint: 'Ctrl+J', action: () => t() && transformLines(t(), (l) => [l.map((x, i) => (i ? x.trim() : x.trimEnd())).join(' ')]) },
        { separator: true },
        { label: 'Commenter / décommenter', hint: 'Ctrl+Q', action: () => t() && toggleComment(t()) },
        { label: 'Indenter', hint: 'Tab', action: () => t() && indent(t()) },
        { label: 'Désindenter', hint: 'Maj+Tab', action: () => t() && indent(t(), true) },
        {
          label: 'Casse', submenu: [
            { label: 'MAJUSCULES', hint: 'Ctrl+Maj+U', action: () => t() && changeCase(t(), true) },
            { label: 'minuscules', hint: 'Ctrl+U', action: () => t() && changeCase(t(), false) },
          ],
        },
        {
          label: 'Opérations sur les lignes', submenu: [
            { label: 'Trier (croissant)', action: () => t() && transformLines(t(), (l) => [...l].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))) },
            { label: 'Trier (décroissant)', action: () => t() && transformLines(t(), (l) => [...l].sort((a, b) => b.localeCompare(a, 'fr', { numeric: true }))) },
            { label: 'Supprimer les doublons', action: () => t() && transformLines(t(), (l) => [...new Set(l)]) },
            { label: 'Supprimer les lignes vides', action: () => t() && wholeDoc(t(), (v) => v.split('\n').filter((l) => l.trim()).join('\n')) },
            { label: 'Inverser l\'ordre', action: () => t() && transformLines(t(), (l) => [...l].reverse()) },
          ],
        },
        {
          label: 'Espaces', submenu: [
            { label: 'Supprimer les espaces de fin', action: () => t() && wholeDoc(t(), (v) => v.replace(/[ \t]+$/gm, '')) },
            { label: 'Tabulations → espaces', action: () => t() && wholeDoc(t(), (v) => v.replace(/\t/g, ' '.repeat(prefs.tabSize))) },
            { label: `Espaces → tabulations (${prefs.tabSize})`, action: () => t() && wholeDoc(t(), (v) => v.replace(new RegExp(`^((?: {${prefs.tabSize}})+)`, 'gm'), (m) => '\t'.repeat(m.length / prefs.tabSize))) },
          ],
        },
        {
          label: 'Fins de ligne', submenu: [
            { label: 'Windows (CR LF)', icon: check(t()?.eol === 'CRLF'), action: () => setEol('CRLF') },
            { label: 'Unix (LF)', icon: check(t()?.eol === 'LF'), action: () => setEol('LF') },
          ],
        },
        { label: 'Insérer date et heure', hint: 'F5', action: () => t() && insertDate(t()) },
      ],
    },
    {
      label: 'Recherche',
      items: () => [
        { label: 'Rechercher…', hint: 'Ctrl+F', icon: '🔍', action: () => showFind(false) },
        { label: 'Remplacer…', hint: 'Ctrl+H', action: () => showFind(true) },
        { label: 'Suivant', hint: 'F3', action: () => find(1) },
        { label: 'Précédent', hint: 'Maj+F3', action: () => find(-1) },
        { separator: true },
        { label: 'Atteindre la ligne…', hint: 'Ctrl+G', action: goToLine },
      ],
    },
    {
      label: 'Affichage',
      items: () => [
        { label: 'Retour automatique à la ligne', icon: check(prefs.wrap), action: toggle('wrap') },
        { label: 'Afficher les symboles (espaces, tabulations, fins de ligne)', icon: check(prefs.symbols), action: toggle('symbols') },
        { label: 'Numéros de ligne', icon: check(prefs.lineNumbers), action: toggle('lineNumbers') },
        { label: 'Thème sombre', icon: check(prefs.dark), action: toggle('dark') },
        { separator: true },
        { label: 'Zoom avant', hint: 'Ctrl++', action: () => zoom(1) },
        { label: 'Zoom arrière', hint: 'Ctrl+-', action: () => zoom(-1) },
        { label: 'Zoom par défaut', hint: 'Ctrl+0', action: () => zoom(0) },
      ],
    },
    {
      label: 'Langage',
      items: () => Object.entries(LANGS).map(([id, lang]) => ({
        label: lang.name, icon: check(t()?.lang === id),
        action: () => { if (t()) { t().lang = id; renderNow(t()); updateCursor(t()); } },
      })),
    },
    {
      label: 'Paramètres',
      items: () => [
        { label: 'Insérer des espaces au lieu des tabulations', icon: check(prefs.spaces), action: toggle('spaces') },
        {
          label: `Largeur de tabulation : ${prefs.tabSize}`, submenu: [2, 4, 8].map((n) => ({
            label: String(n), icon: check(prefs.tabSize === n), action: () => { prefs.tabSize = n; applyAll(); },
          })),
        },
      ],
    },
    {
      label: 'Exécution',
      items: () => [
        { label: 'Lancer (.html / .js en bac à sable)', icon: '▶', action: () => run('sandbox') },
        { label: 'Ouvrir dans le navigateur web', icon: '🌐', action: () => run('browser') },
      ],
    },
    {
      label: '?',
      items: () => [{
        label: 'À propos d\'Éditeur++', icon: '🦎',
        action: () => alertDialog('Éditeur++ 1.0 — éditeur de texte et de code de WinWeb.\n\nRaccourcis : Ctrl+D dupliquer, Ctrl+L supprimer la ligne, Ctrl+Q commenter, Ctrl+Maj+↑/↓ déplacer, Ctrl+G atteindre, Ctrl+F/H rechercher/remplacer, Ctrl+molette zoom, Inser refrappe.', { title: 'À propos', icon: '🦎' }),
      }],
    },
  ]);

  const quick = h('div', { class: 'ce-toolbar' }, [
    ['📄', 'Nouveau (Ctrl+N)', newTab], ['📂', 'Ouvrir (Ctrl+O)', openDialog], ['💾', 'Enregistrer (Ctrl+S)', () => save()],
    ['🗂️', 'Enregistrer tout', saveAll], ['✖', 'Fermer (Ctrl+W)', () => active && closeTab(active)], null,
    ['↶', 'Annuler', () => { active?.ta.focus(); document.execCommand('undo'); }], ['↷', 'Rétablir', () => { active?.ta.focus(); document.execCommand('redo'); }], null,
    ['🔍', 'Rechercher (Ctrl+F)', () => showFind(false)], ['⇄', 'Remplacer (Ctrl+H)', () => showFind(true)], null,
    ['🔎+', 'Zoom avant', () => zoom(1)], ['🔎−', 'Zoom arrière', () => zoom(-1)], null,
    ['↩', 'Retour à la ligne', toggle('wrap')], ['¶', 'Afficher les symboles', toggle('symbols')], null,
    ['▶', 'Exécuter', () => run('sandbox')],
  ].map((b) => (b ? h('button', {
    class: 'ce-tool', type: 'button', title: b[1], text: b[0], onmousedown: (e) => e.preventDefault(), onclick: b[2],
  }) : h('span', { class: 'ce-tool-sep' }))));

  const root = h('div', { class: 'editorpp' }, bar, quick, tabBar, findPanel, docs, status);
  win.body.append(root);

  const ro = new ResizeObserver(() => {
    if (!active) return;
    fitLayer(active);
    if (prefs.wrap) renderGutter(active);
    syncScroll(active);
  });
  ro.observe(docs);

  win.onClose = async () => {
    for (const tab of [...tabs]) if (isDirty(tab) && !(await confirmTab(tab))) return false;
    persistSession();
    return true;
  };
  win.onDestroy = () => { ro.disconnect(); instance.closed = true; };

  instance = { win, openPath, newTab, closed: false };
  root.classList.toggle('dark', prefs.dark);

  // Restauration de la session précédente (comme Notepad++).
  (async () => {
    const restore = prefs.session.filter((p) => p !== path);
    for (const p of restore) {
      try {
        const data = await api.read(p);
        createTab({ path: data.path, text: data.content.replace(/\r\n?/g, '\n'), encoding: data.encoding, eol: /\r\n/.test(data.content) ? 'CRLF' : 'LF' });
      } catch { /* fichier supprimé depuis */ }
    }
    if (path) await openPath(path);
    else if (tabs.length) activate(tabs.find((x) => x.path === prefs.activePath) || tabs[tabs.length - 1]);
    else newTab();
  })();
  return win;
}

export default {
  id: 'editorpp', name: 'Éditeur++', icon: '🦎', launch, description: 'Éditeur de code avec onglets et coloration syntaxique',
};
