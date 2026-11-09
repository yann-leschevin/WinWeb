// Briques partagées par la suite bureautique : gestion du document (ouvrir,
// enregistrer, modifications non enregistrées), ruban, sélecteurs de couleur.
import { api } from '../../api.js';
import { fsChanged } from '../../bus.js';
import { choiceDialog, fileDialog } from '../../dialogs.js';
import { toast, toastError } from '../../notify.js';
import {
  basename, dirname, extname, h, rawUrl,
} from '../../utils.js';
import { readAsDataUrl } from './sanitize.js';

const stem = (name) => name.replace(/\.[^.]+$/, '');

/**
 * Contrôleur de document.
 * opts : { win, appName, icon, ext, defaultName, openFilter,
 *          serialize(): string, load(content, path): void (lève une erreur si invalide),
 *          reset(): void }
 * Un fichier importé dans un autre format (ex. .csv dans le tableur) est
 * enregistré au format natif via « Enregistrer sous ».
 */
export function docController(opts) {
  const state = { path: null, name: opts.defaultName, dirty: false };

  function updateTitle() {
    opts.win.setTitle(`${state.dirty ? '*' : ''}${state.name} - ${opts.appName}`);
  }
  function touch() {
    if (!state.dirty) {
      state.dirty = true;
      updateTitle();
    }
  }
  function markSaved() {
    state.dirty = false;
    updateTitle();
  }

  async function load(path) {
    try {
      const data = await api.read(path);
      if (!data.content.trim() && extname(data.path) === opts.ext) opts.reset();
      else opts.load(data.content, data.path);
      if (extname(data.path) === opts.ext) {
        state.path = data.path;
        state.name = basename(data.path);
      } else {
        state.path = null;
        state.name = `${stem(basename(data.path))}.${opts.ext}`;
        state.importedFrom = data.path;
      }
      markSaved();
      return true;
    } catch (err) {
      toastError(err.message, opts.appName);
      return false;
    }
  }

  async function saveAs() {
    const target = await fileDialog({
      mode: 'save', title: 'Enregistrer sous',
      startDir: state.path ? dirname(state.path) : (state.importedFrom ? dirname(state.importedFrom) : '/Documents'),
      defaultName: state.name,
    });
    if (!target) return false;
    const fixed = extname(target) === opts.ext ? target : `${target}.${opts.ext}`;
    return save(fixed);
  }

  async function save(target = state.path) {
    if (!target) return saveAs();
    try {
      const entry = await api.write(target, opts.serialize());
      state.path = entry.path;
      state.name = entry.name;
      markSaved();
      fsChanged([dirname(entry.path)]);
      toast(opts.appName, `Enregistré : ${entry.name}`, { icon: '💾', timeout: 1800 });
      return true;
    } catch (err) {
      toastError(err.message, 'Enregistrement impossible');
      return false;
    }
  }

  async function confirmDiscard() {
    if (!state.dirty) return true;
    const choice = await choiceDialog(`Voulez-vous enregistrer les modifications de ${state.name} ?`,
      ['Enregistrer', 'Ne pas enregistrer', 'Annuler'], { title: opts.appName, icon: opts.icon });
    if (choice === 0) return save();
    return choice === 1;
  }

  async function open() {
    if (!(await confirmDiscard())) return;
    const target = await fileDialog({
      mode: 'open', startDir: state.path ? dirname(state.path) : '/Documents', filter: opts.openFilter || null,
    });
    if (target) load(target);
  }

  async function newDoc() {
    if (!(await confirmDiscard())) return;
    opts.reset();
    state.path = null;
    state.importedFrom = null;
    state.name = opts.defaultName;
    markSaved();
  }

  /** Exporte un contenu dans un autre fichier du VFS (HTML, CSV, TXT...). */
  async function exportAs(ext, content, label = ext.toUpperCase()) {
    const target = await fileDialog({
      mode: 'save', title: `Exporter (${label})`,
      startDir: state.path ? dirname(state.path) : '/Documents', defaultName: `${stem(state.name)}.${ext}`,
    });
    if (!target) return null;
    try {
      const entry = await api.write(target, typeof content === 'function' ? content() : content);
      fsChanged([dirname(entry.path)]);
      toast(opts.appName, `Exporté : ${entry.name}`, { icon: '📤', timeout: 2200 });
      return entry;
    } catch (err) {
      toastError(err.message, 'Export impossible');
      return null;
    }
  }

  opts.win.onClose = confirmDiscard;
  updateTitle();
  return {
    state, touch, markSaved, load, save: () => save(), saveAs, open, newDoc, confirmDiscard, exportAs, updateTitle,
  };
}

/** Raccourcis Fichier communs (Ctrl+N/O/S, Ctrl+Maj+S). Retourne true si géré. */
export function fileShortcuts(e, doc) {
  if (!(e.ctrlKey || e.metaKey)) return false;
  const key = e.key.toLowerCase();
  if (key === 's') { e.preventDefault(); if (e.shiftKey) doc.saveAs(); else doc.save(); return true; }
  if (key === 'o') { e.preventDefault(); doc.open(); return true; }
  if (key === 'n' && !e.shiftKey) { e.preventDefault(); doc.newDoc(); return true; }
  return false;
}

// ------------------------------------------------------------------ ruban
/**
 * Ruban à onglets. tabs : [{ label, groups: [{ label, items: [Node...] }] }]
 * fileMenu : fonction retournant les éléments du menu « Fichier ».
 */
export function ribbon(tabs, { fileMenu, showMenu, accent = 'var(--accent)' } = {}) {
  const head = h('div', { class: 'rb-tabs' });
  const body = h('div', { class: 'rb-body' });
  const root = h('div', { class: 'ribbon' }, head, body);
  root.style.setProperty('--rb-accent', accent);
  if (fileMenu) {
    head.append(h('button', {
      class: 'rb-tab rb-file', type: 'button', text: 'Fichier',
      onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        showMenu(r.left, r.bottom + 2, fileMenu());
      },
    }));
  }
  const panels = tabs.map((tab, i) => {
    const panel = h('div', { class: `rb-panel${i ? ' hidden' : ''}` }, tab.groups.map((g) => h('div', { class: 'rb-group' },
      h('div', { class: 'rb-group-items' }, g.items), h('div', { class: 'rb-group-label', text: g.label }))));
    const btn = h('button', {
      class: `rb-tab${i ? '' : ' active'}`, type: 'button', text: tab.label,
      onclick: () => {
        head.querySelectorAll('.rb-tab').forEach((b) => b.classList.toggle('active', b === btn));
        panels.forEach((p) => p.classList.toggle('hidden', p !== panel));
      },
    });
    head.append(btn);
    body.append(panel);
    return panel;
  });
  return root;
}

/** Bouton de ruban. Ne vole pas le focus (préserve la sélection dans l'éditeur). */
export function rbBtn(label, title, action, { big = false, cls = '' } = {}) {
  return h('button', {
    class: `rb-btn${big ? ' big' : ''} ${cls}`, type: 'button', title, html: label,
    onmousedown: (e) => e.preventDefault(),
    onclick: (e) => action(e),
  });
}

export function rbSelect(options, title, onChange, { width = 0 } = {}) {
  const sel = h('select', { class: 'rb-select', title, style: width ? { width: `${width}px` } : undefined },
    options.map(([value, label]) => h('option', { value, text: label ?? value })));
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

/** Sélecteur de couleur compact : bouton + palette. */
export function rbColor(label, title, initial, onPick) {
  const input = h('input', { type: 'color', value: initial, class: 'rb-color-input', title });
  const swatch = h('span', { class: 'rb-swatch', style: { background: initial } });
  const apply = h('button', {
    class: 'rb-btn rb-color-apply', type: 'button', title, html: label,
    onmousedown: (e) => e.preventDefault(),
    onclick: () => onPick(input.value),
  }, swatch);
  input.addEventListener('input', () => { swatch.style.background = input.value; });
  input.addEventListener('change', () => { swatch.style.background = input.value; onPick(input.value); });
  return h('span', { class: 'rb-color' }, apply, input);
}

export const rbSep = () => h('span', { class: 'rb-sep' });

// ------------------------------------------------------------------ images
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'];

/** Choisit une image du VFS ; retourne son URL /vfs/... ou null. */
export async function pickVfsImage() {
  const path = await fileDialog({ mode: 'open', title: 'Insérer une image', startDir: '/Images', filter: IMAGE_EXTS });
  if (!path) return null;
  if (!IMAGE_EXTS.includes(extname(path))) {
    toastError('Format d\'image non pris en charge');
    return null;
  }
  return rawUrl(path);
}

/** Choisit une image de l'ordinateur ; retourne une URL data: ou null. */
export function pickLocalImage() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp,image/bmp' });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) { resolve(null); return; }
      if (file.size > 4 * 1024 * 1024) {
        toastError('Image trop volumineuse (4 Mo maximum)');
        resolve(null);
        return;
      }
      resolve(await readAsDataUrl(file));
    });
    input.click();
  });
}

/** Imprime un fragment HTML (déjà assaini) dans une iframe sans scripts. */
export function printHtml(title, bodyHtml, css = '') {
  const frame = h('iframe', { sandbox: 'allow-same-origin allow-modals', style: { position: 'fixed', width: '0', height: '0', border: '0', right: '0', bottom: '0' } });
  document.body.append(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title></title><style>
    body{font:12pt Calibri,Carlito,"Segoe UI",Arial,sans-serif;margin:0} img{max-width:100%}
    table{border-collapse:collapse} td,th{border:1px solid #999;padding:4px 6px}
    .wo-page-break{page-break-after:always;border:0;margin:0}${css}</style></head><body></body></html>`);
  doc.close();
  doc.title = title;
  doc.body.innerHTML = bodyHtml;
  setTimeout(() => {
    try { frame.contentWindow.print(); } finally { setTimeout(() => frame.remove(), 1000); }
  }, 250);
}

/** Téléchargement direct (navigateur de l'ordinateur) d'un contenu texte. */
export function downloadText(name, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function escapeCsv(value, sep) {
  const s = value === null || value === undefined ? '' : String(value);
  return /["\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Analyse un CSV (séparateur détecté : ; , ou tabulation). Retourne un tableau de lignes. */
export function parseCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const counts = [';', ',', '\t'].map((s) => [s, firstLine.split(s).length]);
  const sep = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"' && cur === '') quoted = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return { rows, sep };
}
