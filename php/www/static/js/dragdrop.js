// Glisser-déposer global : fichiers venant du système hôte (upload Flask) et
// déplacements internes (bureau <-> explorateur <-> dossiers <-> corbeille).
import { api } from './api.js';
import { emit, fsChanged } from './bus.js';
import { moveEntries, TRASH } from './fileOps.js';
import { toast, toastError } from './notify.js';
import { basename, formatSize, toWinPath } from './utils.js';

const INTERNAL_TYPE = 'application/x-winweb';
let internalPaths = null;
let depth = 0;
let hoverEl = null;
let overlay;
let overlayLabel;

/** Appelé par le bureau / l'explorateur au début et à la fin d'un glisser interne. */
export function setInternalDrag(paths) {
  internalPaths = paths;
}

const isExternal = (e) => !internalPaths && [...(e.dataTransfer?.types || [])].includes('Files');
const isInternal = (e) => internalPaths || [...(e.dataTransfer?.types || [])].includes(INTERNAL_TYPE);

function dropTarget(e) {
  const el = e.target instanceof Element ? e.target.closest('[data-drop-path]') : null;
  if (el) return { el, path: el.dataset.dropPath, surface: el.dataset.dropSurface || 'folder' };
  return { el: null, path: '/Bureau', surface: 'other' };
}

function setHover(el) {
  if (hoverEl === el) return;
  hoverEl?.classList.remove('drop-hover');
  hoverEl = el;
  hoverEl?.classList.add('drop-hover');
}

function reset() {
  depth = 0;
  setHover(null);
  overlay.classList.add('hidden');
  document.body.classList.remove('dnd-active');
}

function describe(path) {
  if (path === '/Bureau') return 'sur le Bureau';
  if (path === TRASH) return 'dans la Corbeille';
  return `dans ${toWinPath(path)}`;
}

// ------------------------------------------------------------- lecture des dossiers déposés
function readAllEntries(reader) {
  return new Promise((resolve) => {
    const all = [];
    const next = () => reader.readEntries((batch) => {
      if (!batch.length) resolve(all);
      else {
        all.push(...batch);
        next();
      }
    }, () => resolve(all));
    next();
  });
}

async function walkEntry(entry, prefix, out) {
  if (entry.isFile) {
    const file = await new Promise((resolve) => entry.file(resolve, () => resolve(null)));
    if (file) out.push({ file, relpath: prefix + file.name });
  } else if (entry.isDirectory) {
    const children = await readAllEntries(entry.createReader());
    for (const child of children) await walkEntry(child, `${prefix}${entry.name}/`, out);
  }
}

async function collectFiles(dataTransfer) {
  const items = [...(dataTransfer.items || [])];
  // webkitGetAsEntry doit être appelé de façon synchrone pendant l'événement drop.
  const entries = items.map((it) => (it.kind === 'file' && it.webkitGetAsEntry ? it.webkitGetAsEntry() : null));
  const files = [...(dataTransfer.files || [])];
  if (!entries.some(Boolean)) return files.map((file) => ({ file, relpath: file.name }));
  const out = [];
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i]) await walkEntry(entries[i], '', out);
    else if (files[i]) out.push({ file: files[i], relpath: files[i].name });
  }
  return out;
}

// ------------------------------------------------------------- dépôt
async function uploadTo(dest, items, point) {
  if (!items.length) {
    toastError('Aucun fichier exploitable (dossier vide ?)');
    return;
  }
  const total = items.reduce((n, it) => n + it.file.size, 0);
  const maxMb = Number(document.body.dataset.maxUpload || 200);
  if (total > maxMb * 1024 * 1024) {
    toastError(`Le dépôt fait ${formatSize(total)} : la limite est de ${maxMb} Mo.`);
    return;
  }
  const label = items.length === 1 ? items[0].file.name : `${items.length} fichiers`;
  const t = toast('Copie en cours…', `${label} → ${describe(dest)}`, { icon: '📥', timeout: 0, progress: true });
  try {
    const paths = await api.upload(dest, items, (ratio) => t.update(undefined, ratio));
    t.update(`${paths.map(basename).join(', ')} ${describe(dest)}`, 1);
    t.later(3000);
    fsChanged([dest]);
    emit('dropped', { dest, paths, ...point });
  } catch (err) {
    t.close();
    toastError(err.message, 'Échec du dépôt');
  }
}

async function onDrop(e) {
  e.preventDefault();
  const { path: dest, surface } = dropTarget(e);
  const point = { x: e.clientX, y: e.clientY, surface };
  const external = isExternal(e);
  let paths = internalPaths;
  if (!paths) {
    try {
      paths = JSON.parse(e.dataTransfer.getData(INTERNAL_TYPE) || 'null')?.paths || null;
    } catch {
      paths = null;
    }
  }
  const copy = e.ctrlKey;
  reset();
  internalPaths = null;
  if (paths) {
    if (!paths.length || paths.includes(dest)) return;
    const moved = await moveEntries(paths, dest, copy);
    if (moved.length) emit('dropped', { dest, paths: moved, ...point });
    return;
  }
  if (external) {
    const items = await collectFiles(e.dataTransfer);
    await uploadTo(dest, items, point);
  }
}

export function initDragDrop() {
  overlay = document.getElementById('drop-overlay');
  overlayLabel = overlay.querySelector('.drop-target-label');

  document.addEventListener('dragenter', (e) => {
    if (!isExternal(e) && !isInternal(e)) return;
    depth += 1;
    document.body.classList.add('dnd-active');
    if (isExternal(e)) overlay.classList.remove('hidden');
  });
  document.addEventListener('dragover', (e) => {
    if (!isExternal(e) && !isInternal(e)) return;
    e.preventDefault();
    const { el, path } = dropTarget(e);
    if (isExternal(e)) {
      e.dataTransfer.dropEffect = 'copy';
      overlayLabel.textContent = describe(path);
      overlay.classList.remove('hidden');
    } else {
      e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
    }
    setHover(el);
  });
  document.addEventListener('dragleave', (e) => {
    if (!isExternal(e) && !isInternal(e)) return;
    depth -= 1;
    if (depth <= 0 || (e.clientX <= 0 && e.clientY <= 0)) {
      depth = 0;
      setHover(null);
      overlay.classList.add('hidden');
      if (!internalPaths) document.body.classList.remove('dnd-active');
    }
  });
  document.addEventListener('drop', onDrop);
  document.addEventListener('dragend', reset);
  document.addEventListener('winweb:drop-handled', reset);
}
