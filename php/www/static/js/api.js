// API du système de fichiers virtuel — VERSION EN LIGNE (leschevin.com).
//
// Mêmes fonctions et mêmes réponses que la version Python/Flask (fichier
// api.js d'origine, qui appelait /api/...), mais tout est fait DANS LE
// NAVIGATEUR : fichiers dans IndexedDB (localfs.js), bases SQLite avec sql.js
// (db.js), .wapp décompressés en JavaScript (wapp.js), en-têtes PE (peinfo.js).
// Aucune donnée du visiteur n'est envoyée au serveur.
import * as db from './db.js';
import * as fs from './localfs.js';
import { analyzeBlob } from './peinfo.js';
import { install } from './wapp.js';

/** Les erreurs gardent leur message (affiché tel quel par l'interface). */
const wrap = (fn) => (...args) => Promise.resolve().then(() => fn(...args)).catch((err) => {
  throw err instanceof Error ? err : new Error(String(err));
});

const listPaths = (paths) => {
  if (!Array.isArray(paths) || !paths.length || paths.length > 1000) throw new fs.FsError('Liste de chemins invalide');
  return paths.map(fs.normalize);
};

export const api = {
  list: wrap((path) => fs.list(path)),
  stat: wrap((path) => fs.stat(path)),
  read: wrap((path) => fs.readText(path)),
  search: wrap((text) => fs.search(text)),
  write: wrap((path, content) => fs.writeText(path, content)),
  create: wrap((parent, name, kind = 'file', content = '') => fs.create(parent, name, kind === 'dir' ? 'dir' : 'file', content)),
  rename: wrap((path, name) => fs.rename(path, name)),
  move: wrap((paths, dest) => fs.move(listPaths(paths), dest)),
  copy: wrap((paths, dest) => fs.copy(listPaths(paths), dest)),
  remove: wrap((paths, permanent = false) => fs.remove(listPaths(paths), Boolean(permanent))),
  restore: wrap((paths) => fs.restore(listPaths(paths))),
  emptyTrash: wrap(() => fs.emptyTrash()),
  positions: wrap(() => fs.getPositions()),
  savePositions: wrap((positions) => fs.setPositions(positions)),
  pe: wrap(async (path) => {
    const p = fs.normalize(path);
    const info = await analyzeBlob(await fs.readBlob(p));
    info.path = p;
    return info;
  }),
  openWapp: wrap((path) => install(fs.normalize(path))),
  dbSchema: wrap((path) => db.schema(path)), // {path, objects}, comme GET /api/db/schema
  dbExec: wrap(async (path, sql, params) => (await db.exec(path, sql, params)).results),

  /** Téléchargement d'une ressource web : sans serveur mandataire, seuls les
   *  sites qui l'autorisent (CORS) peuvent être enregistrés depuis le navigateur. */
  webDownload: wrap(async (url, dest = '/Téléchargements') => {
    let u;
    try { u = new URL(url); } catch { throw new fs.FsError('Adresse invalide'); }
    if (!/^https?:$/.test(u.protocol)) throw new fs.FsError('Seules les adresses http(s) peuvent être téléchargées');
    let resp;
    try {
      resp = await fetch(u.href, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch {
      throw new fs.FsError('Ce site n\'autorise pas le téléchargement depuis WinWeb : utilisez « Ouvrir dans le navigateur de l\'ordinateur ».');
    }
    if (!resp.ok) throw new fs.FsError(`Le site a répondu : erreur ${resp.status}`);
    const blob = await resp.blob();
    let name = '';
    try { name = decodeURIComponent(u.pathname.split('/').pop() || ''); } catch { name = ''; }
    name = name || u.hostname;
    if (!name.includes('.') && /html/.test(resp.headers.get('content-type') || '')) name += '.html';
    const paths = await fs.upload(dest || '/Téléchargements', [{ file: blob, relpath: fs.sanitizeName(name, 'page.html') }]);
    return { paths, size: blob.size, url: resp.url || u.href };
  }),

  system: wrap(() => ({
    max_upload_mb: fs.MAX_UPLOAD_MB, version: '1.1-web', web_proxy: false, storage: 'navigateur',
  })),

  /** items : [{file: File, relpath: 'dossier/a.txt'}] ; onProgress(0..1) */
  upload: wrap((dest, items, onProgress) => fs.upload(dest, items, onProgress)),
};
