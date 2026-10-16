// Opérations sur les fichiers partagées par le bureau et l'explorateur.
import { api } from './api.js';
import { fsChanged } from './bus.js';
import { confirmDialog, promptDialog } from './dialogs.js';
import { toast, toastError } from './notify.js';
import { launchApp, openPath, openWithChoices } from './registry.js';
import { basename, dirname, isWithin } from './utils.js';

export const TRASH = '/Corbeille';
const clipboard = { mode: null, paths: [] };

export const hasClipboard = () => clipboard.paths.length > 0;

export function copyToClipboard(paths, cut = false) {
  clipboard.mode = cut ? 'cut' : 'copy';
  clipboard.paths = [...paths];
  toast(cut ? 'Couper' : 'Copier', `${paths.length} élément(s) dans le presse-papiers`, { icon: '📋', timeout: 1800 });
}

export async function paste(dest) {
  if (!clipboard.paths.length) return [];
  try {
    const result = clipboard.mode === 'cut'
      ? await api.move(clipboard.paths, dest)
      : await api.copy(clipboard.paths, dest);
    const dirs = [dest, ...clipboard.paths.map(dirname)];
    if (clipboard.mode === 'cut') clipboard.paths = [];
    fsChanged(dirs);
    return result;
  } catch (err) {
    toastError(err.message);
    return [];
  }
}

export async function newFolder(dir) {
  const name = await promptDialog('Nom du nouveau dossier :', 'Nouveau dossier', { title: 'Nouveau dossier', icon: '📁' });
  if (name === null) return null;
  try {
    const entry = await api.create(dir, name.trim() || 'Nouveau dossier', 'dir');
    fsChanged([dir]);
    return entry;
  } catch (err) {
    toastError(err.message);
    return null;
  }
}

/** Modèles vides des documents de la suite bureautique (« Nouveau » du menu contextuel). */
const OFFICE_TEMPLATES = [
  { ext: 'wdoc', label: 'Document de traitement de texte', icon: '📘', name: 'Nouveau document',
    content: '{"format":"winweb-doc","version":1,"html":"<p><br></p>"}' },
  { ext: 'wcalc', label: 'Classeur', icon: '📗', name: 'Nouveau classeur',
    content: '{"format":"winweb-sheet","version":1,"sheets":[{"name":"Feuil1","cells":{},"colW":{},"rows":100,"cols":26}],"active":0}' },
  { ext: 'wpres', label: 'Présentation', icon: '📙', name: 'Nouvelle présentation',
    content: '{"format":"winweb-slides","version":1,"theme":"clair","slides":[]}' },
  { ext: 'wdb', label: 'Base de données', icon: '🗄️', name: 'Nouvelle base de données', content: '' },
  { ext: 'wnote', label: 'Bloc-notes Notes', icon: '📓', name: 'Nouveau bloc-notes',
    content: '{"format":"winweb-notes","version":1,"sections":[]}' },
];

export async function newOfficeFile(dir, ext) {
  const tpl = OFFICE_TEMPLATES.find((t) => t.ext === ext);
  if (!tpl) return null;
  const name = await promptDialog('Nom du nouveau document :', `${tpl.name}.${tpl.ext}`,
    { title: tpl.label, icon: tpl.icon, selectStem: true });
  if (name === null) return null;
  let finalName = name.trim() || `${tpl.name}.${tpl.ext}`;
  if (!finalName.toLowerCase().endsWith(`.${tpl.ext}`)) finalName += `.${tpl.ext}`;
  try {
    const entry = await api.create(dir, finalName, 'file', tpl.content);
    fsChanged([dir]);
    return entry;
  } catch (err) {
    toastError(err.message);
    return null;
  }
}

/** Éléments « Nouveau > ... » pour la suite bureautique. */
export function officeNewItems(dir) {
  return [{ separator: true }, ...OFFICE_TEMPLATES.map((t) => ({ label: t.label, icon: t.icon, action: () => newOfficeFile(dir, t.ext) }))];
}

export async function newTextFile(dir) {
  const name = await promptDialog('Nom du nouveau document :', 'Nouveau document texte.txt',
    { title: 'Nouveau document texte', icon: '📝', selectStem: true });
  if (name === null) return null;
  try {
    const entry = await api.create(dir, name.trim() || 'Nouveau document texte.txt', 'file', '');
    fsChanged([dir]);
    return entry;
  } catch (err) {
    toastError(err.message);
    return null;
  }
}

export async function renameEntry(path) {
  const name = await promptDialog('Nouveau nom :', basename(path), { title: 'Renommer', icon: '✏️', selectStem: true });
  if (name === null || name === basename(path)) return null;
  try {
    const entry = await api.rename(path, name);
    fsChanged([dirname(path)]);
    return entry;
  } catch (err) {
    toastError(err.message);
    return null;
  }
}

/** Supprime (vers la corbeille, ou définitivement si déjà dans la corbeille / permanent). */
export async function deleteEntries(paths, { permanent = false } = {}) {
  if (!paths.length) return false;
  const inTrash = paths.every((p) => isWithin(p, TRASH));
  const definitive = permanent || inTrash;
  const label = paths.length === 1 ? `« ${basename(paths[0])} »` : `ces ${paths.length} éléments`;
  if (definitive) {
    const ok = await confirmDialog(`Voulez-vous vraiment supprimer définitivement ${label} ?`,
      { title: 'Supprimer', icon: '🗑️', danger: true });
    if (!ok) return false;
  }
  try {
    await api.remove(paths, definitive);
    fsChanged([...paths.map(dirname), TRASH]);
    return true;
  } catch (err) {
    toastError(err.message);
    return false;
  }
}

export async function restoreEntries(paths) {
  try {
    const restored = await api.restore(paths);
    fsChanged([TRASH, ...restored.map(dirname)]);
    toast('Corbeille', `${restored.length} élément(s) restauré(s)`, { icon: '♻️', timeout: 2500 });
  } catch (err) {
    toastError(err.message);
  }
}

export async function emptyTrash() {
  const ok = await confirmDialog('Voulez-vous vraiment supprimer définitivement tous les éléments de la corbeille ?',
    { title: 'Vider la corbeille', icon: '🗑️', danger: true });
  if (!ok) return;
  try {
    await api.emptyTrash();
    fsChanged([TRASH]);
  } catch (err) {
    toastError(err.message);
  }
}

export async function moveEntries(paths, dest, copy = false) {
  const sources = paths.filter((p) => p !== dest && !isWithin(dest, p));
  if (!sources.length) return [];
  try {
    let result;
    if (!copy && dest === TRASH) result = await api.remove(sources);
    else result = copy ? await api.copy(sources, dest) : await api.move(sources, dest);
    fsChanged([dest, ...sources.map(dirname)]);
    return dest === TRASH ? [] : result;
  } catch (err) {
    toastError(err.message);
    return [];
  }
}

/** Éléments de menu contextuel communs pour une sélection d'entrées. */
export function entryMenuItems(entries, { onRename, extra = [] } = {}) {
  const paths = entries.map((e) => e.path);
  const single = entries.length === 1 ? entries[0] : null;
  const inTrash = paths.every((p) => dirname(p) === TRASH);
  if (inTrash) {
    return [
      { label: 'Restaurer', icon: '♻️', action: () => restoreEntries(paths) },
      { separator: true },
      { label: 'Supprimer définitivement', icon: '🗑️', action: () => deleteEntries(paths, { permanent: true }) },
      { separator: true },
      { label: 'Propriétés', icon: 'ℹ️', disabled: !single, action: () => launchApp('properties', { path: single.path }) },
    ];
  }
  const items = [
    { label: 'Ouvrir', icon: '📂', hint: 'Entrée', action: () => entries.forEach((e) => openPath(e.path, e)) },
  ];
  if (single && single.type === 'file') {
    items.push({
      label: 'Ouvrir avec', icon: '🧭',
      submenu: openWithChoices(single.path).map(([id, name]) => ({ label: name, action: () => launchApp(id, { path: single.path }) })),
    });
    if (['exe', 'dll'].includes(single.ext)) {
      items.push({ label: 'Analyser l\'exécutable', icon: '🔬', action: () => launchApp('exeinfo', { path: single.path }) });
    }
    items.push({ label: 'Télécharger', icon: '⬇️', action: () => launchApp('download', { path: single.path }) });
  }
  items.push(...extra);
  items.push(
    { separator: true },
    { label: 'Couper', icon: '✂️', hint: 'Ctrl+X', disabled: entries.some((e) => e.protected), action: () => copyToClipboard(paths, true) },
    { label: 'Copier', icon: '📋', hint: 'Ctrl+C', action: () => copyToClipboard(paths) },
    { separator: true },
    { label: 'Renommer', icon: '✏️', hint: 'F2', disabled: !single || single.protected, action: () => (onRename ? onRename(single) : renameEntry(single.path)) },
    { label: 'Supprimer', icon: '🗑️', hint: 'Suppr', disabled: entries.some((e) => e.protected), action: () => deleteEntries(paths) },
    { separator: true },
    { label: 'Propriétés', icon: 'ℹ️', disabled: !single, action: () => launchApp('properties', { path: single.path }) },
  );
  return items;
}
