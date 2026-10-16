// Bureau : icônes déplaçables (positions mémorisées côté serveur), sélection
// au lasso, menus contextuels et raccourcis clavier.
import { api } from './api.js';
import { on } from './bus.js';
import { showMenu } from './contextMenu.js';
import {
  copyToClipboard, deleteEntries, emptyTrash, entryMenuItems, hasClipboard, newFolder, newTextFile, officeNewItems, paste,
  renameEntry, TRASH,
} from './fileOps.js';
import { iconForEntry } from './icons.js';
import { toastError } from './notify.js';
import { launchApp, openPath } from './registry.js';
import { setInternalDrag } from './dragdrop.js';
import { h } from './utils.js';
import { blurAll } from './windowManager.js';

const DESK = '/Bureau';
const TRASH_KEY = '::corbeille';
const CELL_W = 88;
const CELL_H = 104;
const MARGIN = 6;

let desktopEl;
let iconsEl;
let lassoEl;
let entries = [];
let positions = {};
let trashFull = false;
const selected = new Set();
let dragOrigin = null;

const trashEntry = () => ({ name: 'Corbeille', path: TRASH, type: 'dir', special: 'trash', protected: true, key: TRASH_KEY });
const keyOf = (entry) => entry.key || entry.path;

function snap(x, y) {
  const rows = Math.max(1, Math.floor((desktopEl.clientHeight - MARGIN) / CELL_H));
  const col = Math.max(0, Math.round((x - MARGIN) / CELL_W));
  const row = Math.max(0, Math.min(rows - 1, Math.round((y - MARGIN) / CELL_H)));
  return { x: MARGIN + col * CELL_W, y: MARGIN + row * CELL_H };
}

function cellKey(pos) {
  return `${Math.round((pos.x - MARGIN) / CELL_W)}:${Math.round((pos.y - MARGIN) / CELL_H)}`;
}

/** Calcule la position de chaque icône ; les icônes sans position prennent la première case libre. */
function layout(items) {
  const rows = Math.max(1, Math.floor((desktopEl.clientHeight - MARGIN) / CELL_H));
  const occupied = new Set();
  const result = {};
  for (const item of items) {
    const pos = positions[keyOf(item)];
    // Position mémorisée sur un écran plus grand (ex. PC → téléphone) : hors champ ici,
    // l'icône est replacée dans une case libre (la position enregistrée n'est pas modifiée).
    const visible = pos && pos.x + CELL_W <= desktopEl.clientWidth + MARGIN && pos.y + CELL_H <= desktopEl.clientHeight + MARGIN;
    if (visible) {
      result[keyOf(item)] = pos;
      occupied.add(cellKey(pos));
    }
  }
  let cell = 0;
  for (const item of items) {
    if (result[keyOf(item)]) continue;
    let pos;
    do {
      pos = { x: MARGIN + Math.floor(cell / rows) * CELL_W, y: MARGIN + (cell % rows) * CELL_H };
      cell += 1;
    } while (occupied.has(cellKey(pos)));
    occupied.add(cellKey(pos));
    result[keyOf(item)] = pos;
  }
  return result;
}

function updateSelectionClasses() {
  for (const node of iconsEl.children) node.classList.toggle('selected', selected.has(node.dataset.key));
}

function selectedEntries() {
  return allItems().filter((e) => selected.has(keyOf(e)));
}

function allItems() {
  return [trashEntry(), ...entries];
}

function render() {
  const items = allItems();
  const placed = layout(items);
  iconsEl.replaceChildren();
  for (const entry of items) {
    const key = keyOf(entry);
    const pos = placed[key];
    const node = h('div', {
      class: 'desk-icon', tabindex: '0', draggable: 'true', title: entry.name,
      dataset: { key, path: entry.path },
      style: { left: `${pos.x}px`, top: `${pos.y}px` },
    }, h('div', { class: 'di-ico', html: iconForEntry(entry, { trashFull }) }),
    h('div', { class: 'di-label', text: entry.name }));
    if (entry.type === 'dir') node.dataset.dropPath = entry.path;
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        if (selected.has(key)) selected.delete(key);
        else selected.add(key);
      } else {
        selected.clear();
        selected.add(key);
      }
      updateSelectionClasses();
      // Au doigt, un seul toucher ouvre (comme le mode tablette de Windows)
      if (e.pointerType === 'touch' && !e.ctrlKey && !e.metaKey) openPath(entry.path, entry);
    });
    node.addEventListener('dblclick', () => openPath(entry.path, entry));
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') openPath(entry.path, entry);
    });
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selected.has(key)) {
        selected.clear();
        selected.add(key);
        updateSelectionClasses();
      }
      showIconMenu(e.clientX, e.clientY);
    });
    node.addEventListener('dragstart', (e) => {
      if (!selected.has(key)) {
        selected.clear();
        selected.add(key);
        updateSelectionClasses();
      }
      const sel = selectedEntries();
      const paths = sel.filter((s) => !s.special).map((s) => s.path);
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('application/x-winweb', JSON.stringify({ paths }));
      e.dataTransfer.setData('text/plain', paths.join('\n'));
      dragOrigin = { x: e.clientX, y: e.clientY, keys: sel.map(keyOf), placed };
      setInternalDrag(paths);
    });
    node.addEventListener('dragend', () => {
      dragOrigin = null;
      setInternalDrag(null);
    });
    iconsEl.append(node);
  }
  updateSelectionClasses();
}

async function savePositions(patch) {
  Object.assign(positions, patch);
  try {
    await api.savePositions(patch);
  } catch (err) {
    toastError(err.message);
  }
}

export async function refreshDesktop() {
  try {
    const [list, trash] = await Promise.all([api.list(DESK), api.list(TRASH)]);
    entries = list;
    trashFull = trash.length > 0;
    const keys = new Set(allItems().map(keyOf));
    for (const k of [...selected]) if (!keys.has(k)) selected.delete(k);
    render();
  } catch (err) {
    toastError(`Bureau : ${err.message}`);
  }
}

function showIconMenu(x, y) {
  const sel = selectedEntries();
  if (sel.length === 1 && sel[0].special === 'trash') {
    showMenu(x, y, [
      { label: 'Ouvrir', icon: '📂', action: () => openPath(TRASH, sel[0]) },
      { separator: true },
      { label: 'Vider la corbeille', icon: '🗑️', disabled: !trashFull, action: () => emptyTrash() },
    ]);
    return;
  }
  showMenu(x, y, entryMenuItems(sel.filter((s) => !s.special)));
}

function showDesktopMenu(x, y) {
  showMenu(x, y, [
    {
      label: 'Affichage', icon: '🔳',
      submenu: [
        { label: 'Réorganiser automatiquement', icon: '🔀', action: () => resetPositions() },
        { label: 'Aligner les icônes sur la grille', icon: '#️⃣', action: () => alignToGrid() },
      ],
    },
    {
      label: 'Trier par', icon: '↕️',
      submenu: [
        { label: 'Nom', action: () => resetPositions() },
        { label: 'Type', action: () => sortBy((e) => (e.type === 'dir' ? '' : e.ext)) },
        { label: 'Date de modification', action: () => sortBy((e) => -e.modified) },
      ],
    },
    { label: 'Actualiser', icon: '🔄', action: () => refreshDesktop() },
    { separator: true },
    { label: 'Coller', icon: '📋', disabled: !hasClipboard(), action: () => paste(DESK) },
    {
      label: 'Nouveau', icon: '➕',
      submenu: [
        { label: 'Dossier', icon: '📁', action: () => newFolder(DESK) },
        { label: 'Document texte', icon: '📝', action: () => newTextFile(DESK) },
        ...officeNewItems(DESK),
      ],
    },
    { separator: true },
    { label: 'Ouvrir l\'invite de commandes ici', icon: '⬛', action: () => launchApp('cmd', { cwd: DESK }) },
    { label: 'Personnaliser', icon: '🎨', action: () => launchApp('settings', { page: 'perso' }) },
    { label: 'Propriétés', icon: 'ℹ️', action: () => launchApp('settings', { page: 'system' }) },
  ]);
}

async function resetPositions() {
  const patch = {};
  for (const item of allItems()) patch[keyOf(item)] = null;
  positions = {};
  await savePositions(patch);
  positions = {};
  render();
}

async function sortBy(keyFn) {
  entries.sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    return ka < kb ? -1 : ka > kb ? 1 : a.name.localeCompare(b.name, 'fr');
  });
  await resetPositions();
}

async function alignToGrid() {
  const placed = layout(allItems());
  const patch = {};
  for (const [k, p] of Object.entries(placed)) patch[k] = snap(p.x, p.y);
  await savePositions(patch);
  render();
}

// ---------------------------------------------------------------- lasso
function startLasso(e) {
  if (e.button !== 0) return;
  if (e.target !== desktopEl && e.target !== iconsEl) return;
  desktopEl.focus({ preventScroll: true });
  const additive = e.ctrlKey || e.metaKey;
  if (!additive) {
    selected.clear();
    updateSelectionClasses();
  }
  const base = new Set(selected);
  const origin = desktopEl.getBoundingClientRect();
  const sx = e.clientX - origin.left;
  const sy = e.clientY - origin.top;
  desktopEl.setPointerCapture(e.pointerId);
  let active = false;

  const onMove = (ev) => {
    const cx = ev.clientX - origin.left;
    const cy = ev.clientY - origin.top;
    if (!active && Math.hypot(cx - sx, cy - sy) < 4) return;
    active = true;
    const r = { left: Math.min(sx, cx), top: Math.min(sy, cy), right: Math.max(sx, cx), bottom: Math.max(sy, cy) };
    Object.assign(lassoEl.style, {
      left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px`,
    });
    lassoEl.classList.remove('hidden');
    selected.clear();
    base.forEach((k) => selected.add(k));
    for (const node of iconsEl.children) {
      const b = node.getBoundingClientRect();
      const nl = b.left - origin.left;
      const nt = b.top - origin.top;
      if (nl < r.right && nl + b.width > r.left && nt < r.bottom && nt + b.height > r.top) selected.add(node.dataset.key);
    }
    updateSelectionClasses();
  };
  const onUp = () => {
    desktopEl.removeEventListener('pointermove', onMove);
    desktopEl.removeEventListener('pointerup', onUp);
    desktopEl.removeEventListener('pointercancel', onUp);
    lassoEl.classList.add('hidden');
  };
  desktopEl.addEventListener('pointermove', onMove);
  desktopEl.addEventListener('pointerup', onUp);
  desktopEl.addEventListener('pointercancel', onUp);
}

// ---------------------------------------------------------------- dépôt
/** Repositionnement local : icônes du bureau lâchées sur le bureau (hors dossier). */
function onLocalDrop(e) {
  if (!dragOrigin) return;
  const targetIcon = e.target.closest('.desk-icon');
  const targetKey = targetIcon?.dataset.key;
  if (targetIcon && targetIcon.dataset.dropPath && !dragOrigin.keys.includes(targetKey)) return; // vers un dossier
  e.preventDefault();
  e.stopPropagation();
  const dx = e.clientX - dragOrigin.x;
  const dy = e.clientY - dragOrigin.y;
  const patch = {};
  const taken = new Set();
  for (const item of allItems()) {
    if (!dragOrigin.keys.includes(keyOf(item))) taken.add(cellKey(dragOrigin.placed[keyOf(item)]));
  }
  for (const key of dragOrigin.keys) {
    const start = dragOrigin.placed[key];
    if (!start) continue;
    let pos = snap(start.x + dx, start.y + dy);
    while (taken.has(cellKey(pos))) pos = snap(pos.x, pos.y + CELL_H);
    taken.add(cellKey(pos));
    patch[key] = pos;
  }
  dragOrigin = null;
  setInternalDrag(null);
  savePositions(patch).then(render);
  document.dispatchEvent(new CustomEvent('winweb:drop-handled'));
}

/** Éléments arrivés sur le bureau depuis l'extérieur : on les place au point de dépôt. */
async function placeDropped({ dest, paths, x, y, surface }) {
  if (dest !== DESK || surface !== 'desktop' || !paths?.length) return;
  const rect = desktopEl.getBoundingClientRect();
  const placed = layout(allItems().filter((item) => !paths.includes(keyOf(item))));
  const taken = new Set(Object.values(placed).map(cellKey));
  const patch = {};
  let pos = snap(x - rect.left - CELL_W / 2, y - rect.top - CELL_H / 3);
  for (const path of paths) {
    let guard = 0;
    while (taken.has(cellKey(pos)) && guard < 200) {
      pos = snap(pos.x, pos.y + CELL_H);
      if (pos.y + CELL_H > desktopEl.clientHeight) pos = snap(pos.x + CELL_W, MARGIN);
      guard += 1;
    }
    taken.add(cellKey(pos));
    patch[path] = pos;
  }
  await savePositions(patch);
  await refreshDesktop();
}

function onKeyDown(e) {
  if (e.target.closest('input, textarea')) return;
  const sel = selectedEntries().filter((s) => !s.special);
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'Delete' && sel.length) deleteEntries(sel.map((s) => s.path), { permanent: e.shiftKey });
  else if (e.key === 'F2' && sel.length === 1) renameEntry(sel[0].path);
  else if (ctrl && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    allItems().forEach((i) => selected.add(keyOf(i)));
    updateSelectionClasses();
  } else if (ctrl && e.key.toLowerCase() === 'c' && sel.length) copyToClipboard(sel.map((s) => s.path));
  else if (ctrl && e.key.toLowerCase() === 'x' && sel.length) copyToClipboard(sel.map((s) => s.path), true);
  else if (ctrl && e.key.toLowerCase() === 'v') paste(DESK);
  else if (e.key === 'F5') {
    e.preventDefault();
    refreshDesktop();
  }
}

export async function initDesktop() {
  desktopEl = document.getElementById('desktop');
  iconsEl = document.getElementById('desktop-icons');
  lassoEl = document.getElementById('lasso');
  try {
    positions = await api.positions();
  } catch {
    positions = {};
  }
  desktopEl.addEventListener('pointerdown', (e) => {
    blurAll();
    startLasso(e);
  });
  desktopEl.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.desk-icon')) return;
    e.preventDefault();
    selected.clear();
    updateSelectionClasses();
    showDesktopMenu(e.clientX, e.clientY);
  });
  desktopEl.addEventListener('drop', onLocalDrop);
  desktopEl.addEventListener('keydown', onKeyDown);
  on('fs-changed', () => refreshDesktop());
  on('dropped', placeDropped);
  window.addEventListener('resize', () => render());
  await refreshDesktop();
}
