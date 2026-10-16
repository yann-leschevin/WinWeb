// Registre des applications et associations extension -> application.
import { api } from './api.js';
import { toastError } from './notify.js';
import { extname } from './utils.js';

const apps = new Map();

/** def : { id, name, icon, launch(args), description, hidden } */
export function registerApp(def) {
  apps.set(def.id, def);
}

export function getApp(id) {
  return apps.get(id);
}

export function getApps({ includeHidden = false } = {}) {
  return [...apps.values()]
    .filter((a) => includeHidden || !a.hidden)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export const PINNED = ['explorer', 'browser', 'notepad', 'editorpp', 'writer', 'sheet', 'calculator', 'cmd', 'settings', 'taskmgr'];

export function launchApp(id, args = {}) {
  const app = apps.get(id);
  if (!app) {
    toastError(`Application inconnue : ${id}`);
    return null;
  }
  try {
    return app.launch(args);
  } catch (err) {
    console.error(err);
    toastError(err.message || String(err), app.name);
    return null;
  }
}

/** Associations extension -> identifiant d'application. */
export const ASSOCIATIONS = {
  txt: 'notepad', md: 'notepad', log: 'notepad',
  ini: 'editorpp', cfg: 'editorpp', conf: 'editorpp', toml: 'editorpp', json: 'editorpp', xml: 'editorpp', css: 'editorpp',
  py: 'editorpp', bat: 'editorpp', cmd: 'editorpp', ps1: 'editorpp', sh: 'editorpp', yml: 'editorpp', yaml: 'editorpp',
  c: 'editorpp', h: 'editorpp', cpp: 'editorpp', hpp: 'editorpp', java: 'editorpp', cs: 'editorpp', go: 'editorpp',
  rs: 'editorpp', php: 'editorpp', ts: 'editorpp', tsx: 'editorpp', jsx: 'editorpp', mjs: 'editorpp', sql: 'editorpp',
  scss: 'editorpp', less: 'editorpp', vue: 'editorpp', kt: 'editorpp', swift: 'editorpp', dart: 'editorpp',
  csv: 'sheet', tsv: 'sheet',
  wdoc: 'writer', wcalc: 'sheet', wpres: 'slides', wdb: 'database', wnote: 'notes',
  png: 'imageviewer', jpg: 'imageviewer', jpeg: 'imageviewer', gif: 'imageviewer', webp: 'imageviewer',
  svg: 'imageviewer', bmp: 'imageviewer', ico: 'imageviewer', avif: 'imageviewer',
  html: 'htmlapp', htm: 'htmlapp',
  js: 'jsrunner',
  wapp: 'wapp',
  exe: 'exeinfo', dll: 'exeinfo',
};

export function appIdForPath(path) {
  return ASSOCIATIONS[extname(path)] || null;
}

/** Ouvre un chemin du VFS avec l'application associée. */
export async function openPath(path, entry = null) {
  try {
    const info = entry || await api.stat(path);
    if (info.type === 'dir') return launchApp('explorer', { path: info.path });
    const appId = appIdForPath(info.path);
    if (appId) return launchApp(appId, { path: info.path });
    return launchApp('openwith', { path: info.path });
  } catch (err) {
    toastError(err.message);
    return null;
  }
}

/** Applications proposées dans « Ouvrir avec ». */
export function openWithChoices(path) {
  const ext = extname(path);
  const choices = [['notepad', 'Bloc-notes'], ['editorpp', 'Éditeur++']];
  const binary = ['wdb', 'exe', 'dll', 'wapp', 'zip', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'pdf'];
  if (binary.includes(ext)) choices.length = 0;
  const assoc = ASSOCIATIONS[ext];
  if (assoc && !choices.some(([id]) => id === assoc)) {
    const app = apps.get(assoc);
    if (app) choices.unshift([app.id, app.name]);
  }
  const extra = {
    html: [['browser', 'Navigateur web'], ['writer', 'Traitement de texte']], htm: [['browser', 'Navigateur web']],
    txt: [['writer', 'Traitement de texte']], md: [['writer', 'Traitement de texte']],
    svg: [['browser', 'Navigateur web']], pdf: [['browser', 'Navigateur web']],
  }[ext] || [];
  for (const [id, label] of extra) if (!choices.some(([c]) => c === id)) choices.push([id, label]);
  if (!['html', 'htm'].includes(ext) && !binary.includes(ext)) choices.push(['htmlapp', 'Page HTML (bac à sable)']);
  return choices;
}
