// Explorateur de fichiers.
import { api } from '../api.js';
import { fsChanged, on } from '../bus.js';
import { showMenu } from '../contextMenu.js';
import {
  copyToClipboard, deleteEntries, emptyTrash, entryMenuItems, hasClipboard, newFolder, newTextFile, officeNewItems, paste,
  renameEntry, restoreEntries, TRASH,
} from '../fileOps.js';
import { setInternalDrag } from '../dragdrop.js';
import { iconForEntry } from '../icons.js';
import { toast, toastError } from '../notify.js';
import { launchApp, openPath } from '../registry.js';
import {
  basename, dirname, formatDate, formatSize, h, isWithin, normPath, toWinPath,
} from '../utils.js';
import { createWindow } from '../windowManager.js';

const PLACES = [
  ['🖥️', 'Bureau', '/Bureau'],
  ['📄', 'Documents', '/Documents'],
  ['🖼️', 'Images', '/Images'],
  ['⬇️', 'Téléchargements', '/Téléchargements'],
  ['🧰', 'Programmes', '/Programmes'],
  ['💻', 'Ce PC', '/'],
  ['🗑️', 'Corbeille', TRASH],
];

const TYPE_NAMES = {
  txt: 'Document texte', md: 'Document Markdown', json: 'Fichier JSON', html: 'Page HTML', htm: 'Page HTML',
  js: 'Script JavaScript', wapp: 'Application WinWeb', exe: 'Application Windows', dll: 'Bibliothèque Windows',
  png: 'Image PNG', jpg: 'Image JPEG', jpeg: 'Image JPEG', gif: 'Image GIF', svg: 'Image SVG', webp: 'Image WebP',
  zip: 'Archive ZIP', pdf: 'Document PDF', css: 'Feuille de style', py: 'Script Python', csv: 'Fichier CSV',
  wdoc: 'Document de traitement de texte', wcalc: 'Classeur', wpres: 'Présentation', wdb: 'Base de données',
  wnote: 'Bloc-notes Notes', sql: 'Script SQL',
};

export function typeName(entry) {
  if (entry.special === 'trash') return 'Corbeille';
  if (entry.type === 'dir') return 'Dossier de fichiers';
  return TYPE_NAMES[entry.ext] || (entry.ext ? `Fichier ${entry.ext.toUpperCase()}` : 'Fichier');
}

const placeName = (path) => (path === '/' ? 'Ce PC' : basename(path));

function launch({ path = '/' } = {}) {
  const state = {
    path: normPath(path), history: [], index: -1, entries: [], selected: new Set(), anchor: null,
    view: 'icons', filter: '', sortKey: 'name', sortAsc: true,
  };

  const backBtn = h('button', { class: 'btn icon flat', type: 'button', title: 'Précédent (Alt+←)', text: '←' });
  const fwdBtn = h('button', { class: 'btn icon flat', type: 'button', title: 'Suivant (Alt+→)', text: '→' });
  const upBtn = h('button', { class: 'btn icon flat', type: 'button', title: 'Dossier parent', text: '↑' });
  const refreshBtn = h('button', { class: 'btn icon flat', type: 'button', title: 'Actualiser (F5)', text: '⟳' });
  const crumbs = h('div', { class: 'ex-crumbs' });
  const addressInput = h('input', { class: 'ex-address-input hidden', type: 'text', spellcheck: 'false' });
  const address = h('div', { class: 'ex-address' }, crumbs, addressInput);
  const search = h('input', { class: 'ex-search', type: 'search', placeholder: 'Rechercher' });
  const toolbar = h('div', { class: 'ex-toolbar' });
  const sidebar = h('div', { class: 'ex-sidebar' });
  const content = h('div', { class: 'ex-content view-icons', tabindex: '0' });
  const status = h('div', { class: 'ex-status' });
  const fileInput = h('input', { type: 'file', multiple: true, class: 'hidden' });
  const root = h('div', { class: 'explorer' },
    h('div', { class: 'ex-nav' }, backBtn, fwdBtn, upBtn, refreshBtn, address, search),
    toolbar,
    h('div', { class: 'ex-main' }, sidebar, content),
    status, fileInput);

  const win = createWindow({
    appId: 'explorer', title: placeName(state.path), icon: '📁', width: 860, height: 540,
    minWidth: 480, minHeight: 300, content: root,
  });

  // ------------------------------------------------------------------ données
  const inTrash = () => state.path === TRASH;
  const visibleEntries = () => {
    const f = state.filter.trim().toLowerCase();
    const list = state.entries.filter((e) => !f || e.name.toLowerCase().includes(f));
    const dir = state.sortAsc ? 1 : -1;
    const key = state.sortKey;
    return list.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      let va = a[key];
      let vb = b[key];
      if (key === 'type') { va = typeName(a); vb = typeName(b); }
      if (typeof va === 'string') return dir * va.localeCompare(vb, 'fr', { numeric: true });
      return dir * ((va || 0) - (vb || 0));
    });
  };
  const selectedEntries = () => state.entries.filter((e) => state.selected.has(e.path));

  async function navigate(path, { push = true } = {}) {
    const target = normPath(path);
    try {
      const entries = await api.list(target);
      state.path = target;
      state.entries = entries;
      state.selected.clear();
      state.filter = '';
      search.value = '';
      if (push) {
        state.history = state.history.slice(0, state.index + 1);
        state.history.push(target);
        state.index = state.history.length - 1;
      }
      win.setTitle(placeName(target));
      render();
    } catch (err) {
      toastError(err.message, 'Explorateur');
    }
  }

  async function reload() {
    if (!win.el.isConnected) return;
    try {
      state.entries = await api.list(state.path);
      const existing = new Set(state.entries.map((e) => e.path));
      for (const p of [...state.selected]) if (!existing.has(p)) state.selected.delete(p);
      render();
    } catch {
      // Le dossier a disparu (supprimé / déplacé) : on remonte jusqu'à un parent existant.
      let p = dirname(state.path);
      while (p !== '/') {
        try {
          await api.list(p);
          break;
        } catch {
          p = dirname(p);
        }
      }
      navigate(p);
    }
  }

  // ------------------------------------------------------------------ rendu
  function renderCrumbs() {
    crumbs.replaceChildren();
    const parts = state.path.split('/').filter(Boolean);
    const pcBtn = h('button', { class: 'ex-crumb', type: 'button', text: '💻 Ce PC', onclick: () => navigate('/') });
    crumbs.append(pcBtn);
    let acc = '';
    for (const part of parts) {
      acc += `/${part}`;
      const target = acc;
      crumbs.append(h('span', { class: 'ex-crumb-sep', text: '›' }),
        h('button', { class: 'ex-crumb', type: 'button', text: part, onclick: () => navigate(target) }));
    }
  }

  function renderSidebar() {
    sidebar.replaceChildren(...PLACES.map(([icon, label, p]) => h('button', {
      class: `ex-place${state.path === p ? ' active' : ''}`, type: 'button',
      dataset: { dropPath: p }, onclick: () => navigate(p),
    }, h('span', { text: icon }), h('span', { text: label }))));
  }

  function toolButton(icon, label, action, { disabled = false, title = label } = {}) {
    return h('button', {
      class: 'ex-tool', type: 'button', title, disabled, onclick: action,
    }, h('span', { class: 'ex-tool-ico', text: icon }), h('span', { class: 'ex-tool-label', text: label }));
  }

  function renderToolbar() {
    const sel = selectedEntries();
    const paths = sel.map((e) => e.path);
    const locked = !sel.length || sel.some((e) => e.protected);
    const tools = [];
    if (inTrash()) {
      tools.push(
        toolButton('♻️', 'Restaurer', () => restoreEntries(paths.length ? paths : state.entries.map((e) => e.path)),
          { disabled: !state.entries.length, title: sel.length ? 'Restaurer la sélection' : 'Restaurer tous les éléments' }),
        toolButton('🗑️', 'Supprimer', () => deleteEntries(paths), { disabled: !sel.length }),
        toolButton('🧹', 'Vider la corbeille', () => emptyTrash(), { disabled: !state.entries.length }),
      );
    } else {
      const canCreate = state.path !== '/';
      tools.push(
        toolButton('📁', 'Nouveau dossier', () => newFolder(state.path), { disabled: !canCreate }),
        toolButton('📝', 'Nouveau fichier', () => newTextFile(state.path), { disabled: !canCreate }),
        h('span', { class: 'ex-tool-sep' }),
        toolButton('✂️', 'Couper', () => copyToClipboard(paths, true), { disabled: locked }),
        toolButton('📋', 'Copier', () => copyToClipboard(paths), { disabled: !sel.length }),
        toolButton('📌', 'Coller', () => paste(state.path), { disabled: !hasClipboard() || !canCreate }),
        toolButton('✏️', 'Renommer', () => renameEntry(paths[0]), { disabled: sel.length !== 1 || locked }),
        toolButton('🗑️', 'Supprimer', () => deleteEntries(paths), { disabled: locked }),
        h('span', { class: 'ex-tool-sep' }),
        toolButton('⬆️', 'Importer', () => fileInput.click(), { disabled: !canCreate, title: 'Importer des fichiers depuis votre ordinateur' }),
      );
    }
    tools.push(h('span', { class: 'ex-tool-spacer' }),
      toolButton(state.view === 'icons' ? '☰' : '▦', state.view === 'icons' ? 'Détails' : 'Icônes', () => {
        state.view = state.view === 'icons' ? 'details' : 'icons';
        render();
      }, { title: 'Changer la disposition' }));
    toolbar.replaceChildren(...tools);
  }

  function itemNode(entry) {
    const node = h('div', {
      class: `ex-item${state.selected.has(entry.path) ? ' selected' : ''}`,
      draggable: 'true', dataset: { path: entry.path }, title: entry.name,
    });
    if (entry.type === 'dir') node.dataset.dropPath = entry.path;
    const icon = h('span', { class: 'ex-ico', html: iconForEntry(entry) });
    if (state.view === 'icons') {
      node.append(icon, h('span', { class: 'ex-name', text: entry.name }));
    } else {
      const cols = inTrash()
        ? [toWinPath(dirname(entry.original || '/')), formatDate(entry.deleted), typeName(entry), entry.type === 'dir' ? '' : formatSize(entry.size)]
        : [formatDate(entry.modified), typeName(entry), entry.type === 'dir' ? '' : formatSize(entry.size)];
      node.append(h('span', { class: 'ex-cell ex-cell-name' }, icon, h('span', { class: 'ex-name', text: entry.name })),
        ...cols.map((c) => h('span', { class: 'ex-cell', text: c })));
    }
    const open = () => {
      if (inTrash()) launchApp('properties', { path: entry.path });
      else if (entry.type === 'dir') navigate(entry.path);
      else openPath(entry.path, entry);
    };
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      select(entry, e);
      // Au doigt, un seul toucher ouvre
      if (e.pointerType === 'touch' && !e.ctrlKey && !e.metaKey && !e.shiftKey) open();
    });
    node.addEventListener('dblclick', open);
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!state.selected.has(entry.path)) {
        state.selected = new Set([entry.path]);
        refreshSelection();
      }
      showMenu(e.clientX, e.clientY, entryMenuItems(selectedEntries(), {
        extra: entry.type === 'dir' && !inTrash()
          ? [{ label: 'Ouvrir dans une nouvelle fenêtre', icon: '🗗', action: () => launch({ path: entry.path }) }]
          : [],
      }));
    });
    node.addEventListener('dragstart', (e) => {
      if (!state.selected.has(entry.path)) {
        state.selected = new Set([entry.path]);
        refreshSelection();
      }
      const paths = [...state.selected];
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('application/x-winweb', JSON.stringify({ paths }));
      e.dataTransfer.setData('text/plain', paths.join('\n'));
      setInternalDrag(paths);
    });
    node.addEventListener('dragend', () => setInternalDrag(null));
    return node;
  }

  function header() {
    const cols = inTrash()
      ? [['name', 'Nom'], ['original', 'Emplacement d\'origine'], ['deleted', 'Date de suppression'], ['type', 'Type'], ['size', 'Taille']]
      : [['name', 'Nom'], ['modified', 'Modifié le'], ['type', 'Type'], ['size', 'Taille']];
    return h('div', { class: 'ex-header' }, cols.map(([key, label]) => h('button', {
      class: 'ex-cell', type: 'button',
      onclick: () => {
        state.sortAsc = state.sortKey === key ? !state.sortAsc : true;
        state.sortKey = key;
        render();
      },
    }, label, state.sortKey === key ? (state.sortAsc ? ' ▴' : ' ▾') : '')));
  }

  function render() {
    renderCrumbs();
    renderSidebar();
    renderToolbar();
    backBtn.disabled = state.index <= 0;
    fwdBtn.disabled = state.index >= state.history.length - 1;
    upBtn.disabled = state.path === '/';
    content.className = `ex-content view-${state.view}${inTrash() ? ' is-trash' : ''}`;
    content.dataset.dropPath = state.path;
    if (state.path === '/') delete content.dataset.dropPath;
    const list = visibleEntries();
    content.replaceChildren();
    if (state.view === 'details') content.append(header());
    if (!list.length) {
      content.append(h('div', {
        class: 'ex-empty',
        text: state.filter ? 'Aucun élément ne correspond à votre recherche.'
          : inTrash() ? 'La corbeille est vide.' : 'Ce dossier est vide. Glissez-déposez des fichiers ici.',
      }));
    }
    list.forEach((e) => content.append(itemNode(e)));
    renderStatus();
  }

  function renderStatus() {
    const n = state.selected.size;
    const size = selectedEntries().reduce((s, e) => s + (e.size || 0), 0);
    const count = visibleEntries().length;
    status.textContent = `${count} élément(s)${n ? `   |   ${n} élément(s) sélectionné(s)${size ? ` (${formatSize(size)})` : ''}` : ''}`;
  }

  /** Met à jour la sélection sans reconstruire la liste (préserve le double-clic). */
  function refreshSelection() {
    for (const node of content.querySelectorAll('.ex-item')) {
      node.classList.toggle('selected', state.selected.has(node.dataset.path));
    }
    renderToolbar();
    renderStatus();
  }

  function select(entry, e) {
    const list = visibleEntries();
    if (e.shiftKey && state.anchor) {
      const a = list.findIndex((x) => x.path === state.anchor);
      const b = list.findIndex((x) => x.path === entry.path);
      if (a >= 0 && b >= 0) {
        state.selected = new Set(list.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.path));
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (state.selected.has(entry.path)) state.selected.delete(entry.path);
      else state.selected.add(entry.path);
      state.anchor = entry.path;
    } else {
      state.selected = new Set([entry.path]);
      state.anchor = entry.path;
    }
    refreshSelection();
    content.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ événements
  backBtn.addEventListener('click', () => {
    if (state.index > 0) {
      state.index -= 1;
      navigate(state.history[state.index], { push: false });
    }
  });
  fwdBtn.addEventListener('click', () => {
    if (state.index < state.history.length - 1) {
      state.index += 1;
      navigate(state.history[state.index], { push: false });
    }
  });
  upBtn.addEventListener('click', () => navigate(dirname(state.path)));
  refreshBtn.addEventListener('click', () => reload());
  search.addEventListener('input', () => {
    state.filter = search.value;
    render();
  });
  crumbs.addEventListener('click', (e) => {
    if (e.target === crumbs) {
      crumbs.classList.add('hidden');
      addressInput.classList.remove('hidden');
      addressInput.value = toWinPath(state.path);
      addressInput.select();
      addressInput.focus();
    }
  });
  const closeAddress = () => {
    addressInput.classList.add('hidden');
    crumbs.classList.remove('hidden');
  };
  addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const raw = addressInput.value.trim().replace(/^[a-z]:/i, '').replace(/\\/g, '/');
      closeAddress();
      navigate(raw || '/');
    } else if (e.key === 'Escape') closeAddress();
  });
  addressInput.addEventListener('blur', closeAddress);

  content.addEventListener('click', (e) => {
    if (e.target === content) {
      state.selected.clear();
      refreshSelection();
    }
  });
  content.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.ex-item')) return;
    e.preventDefault();
    if (inTrash()) {
      showMenu(e.clientX, e.clientY, [
        { label: 'Vider la corbeille', icon: '🧹', disabled: !state.entries.length, action: () => emptyTrash() },
        { label: 'Actualiser', icon: '🔄', action: () => reload() },
      ]);
      return;
    }
    const canCreate = state.path !== '/';
    showMenu(e.clientX, e.clientY, [
      {
        label: 'Affichage', icon: '🔳',
        submenu: [
          { label: 'Grandes icônes', checked: state.view === 'icons', action: () => { state.view = 'icons'; render(); } },
          { label: 'Détails', checked: state.view === 'details', action: () => { state.view = 'details'; render(); } },
        ],
      },
      { label: 'Actualiser', icon: '🔄', action: () => reload() },
      { separator: true },
      { label: 'Coller', icon: '📋', disabled: !hasClipboard() || !canCreate, action: () => paste(state.path) },
      {
        label: 'Nouveau', icon: '➕', disabled: !canCreate,
        submenu: [
          { label: 'Dossier', icon: '📁', action: () => newFolder(state.path) },
          { label: 'Document texte', icon: '📝', action: () => newTextFile(state.path) },
          ...officeNewItems(state.path),
        ],
      },
      { label: 'Importer des fichiers…', icon: '⬆️', disabled: !canCreate, action: () => fileInput.click() },
      { separator: true },
      { label: 'Ouvrir l\'invite de commandes ici', icon: '⬛', action: () => launchApp('cmd', { cwd: state.path }) },
      { label: 'Propriétés', icon: 'ℹ️', action: () => launchApp('properties', { path: state.path }) },
    ]);
  });
  content.addEventListener('keydown', (e) => {
    const sel = selectedEntries();
    const paths = sel.map((x) => x.path);
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (e.key === 'Delete' && sel.length) deleteEntries(paths, { permanent: e.shiftKey });
    else if (e.key === 'F2' && sel.length === 1 && !inTrash()) renameEntry(paths[0]);
    else if (e.key === 'Enter' && sel.length) sel.forEach((x) => (x.type === 'dir' ? navigate(x.path) : openPath(x.path, x)));
    else if (e.key === 'Backspace') navigate(dirname(state.path));
    else if (e.key === 'F5') { e.preventDefault(); reload(); }
    else if (ctrl && key === 'a') {
      e.preventDefault();
      state.selected = new Set(visibleEntries().map((x) => x.path));
      refreshSelection();
    } else if (ctrl && key === 'c' && sel.length) copyToClipboard(paths);
    else if (ctrl && key === 'x' && sel.length) copyToClipboard(paths, true);
    else if (ctrl && key === 'v' && state.path !== '/' && !inTrash()) paste(state.path);
  });
  root.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'ArrowLeft') backBtn.click();
    else if (e.altKey && e.key === 'ArrowRight') fwdBtn.click();
  });
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (!files.length) return;
    const t = toast('Importation…', `${files.length} fichier(s)`, { icon: '⬆️', timeout: 0, progress: true });
    try {
      await api.upload(state.path, files.map((file) => ({ file, relpath: file.name })), (r) => t.update(undefined, r));
      t.update('Terminé', 1);
      t.later(2000);
      fsChanged([state.path]);
    } catch (err) {
      t.close();
      toastError(err.message);
    }
  });

  const off = on('fs-changed', ({ dirs }) => {
    if (!dirs.length || dirs.some((d) => isWithin(state.path, d) || isWithin(d, state.path) || d === state.path)) reload();
  });
  win.onDestroy = off;
  navigate(state.path);
  return win;
}

export default {
  id: 'explorer', name: 'Explorateur de fichiers', icon: '📁', launch,
  description: 'Parcourir les fichiers et dossiers',
};

