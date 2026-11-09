// Système de fichiers virtuel stocké DANS LE NAVIGATEUR (IndexedDB).
//
// Version en ligne de WinWeb (leschevin.com) : chaque visiteur a son propre
// « PC », conservé dans son navigateur. Rien n'est envoyé au serveur.
// Portage fidèle de vfs.py (version Python/Flask) : mêmes chemins virtuels,
// même corbeille, mêmes règles de noms et mêmes réponses que l'API REST.
//
// Organisation de la base « winweb » :
//   nodes : métadonnées {path, parent, name, type, size, modified, created}
//   blobs : contenu des fichiers (Blob), clé = chemin
//   meta  : 'trash' (origine des éléments supprimés) et 'positions' (icônes)
//   apps  : applications .wapp décompressées (clé "<id>/<fichier>") et manifests
// Les métadonnées sont gardées en mémoire ; chaque opération est écrite dans
// une seule transaction. Un BroadcastChannel synchronise les autres onglets.

export const DB_NAME = 'winweb';
const DB_VERSION = 1;

const DEFAULT_DIRS = ['Bureau', 'Documents', 'Images', 'Téléchargements', 'Programmes'];
export const TRASH_PATH = '/Corbeille';
const PROTECTED = new Set(['/', ...DEFAULT_DIRS.map((d) => `/${d}`), TRASH_PATH]);
const INVALID_NAME_CHARS = new Set('<>:"/\\|?*');
const MAX_NAME_LEN = 255;
const MAX_TEXT_READ = 5 * 1024 * 1024;
export const MAX_UPLOAD_MB = 100;

const WELCOME_TEXT = `Bienvenue dans WinWeb !

Ce PC virtuel est enregistré dans VOTRE navigateur : vos fichiers ne sont
envoyés nulle part et restent sur cet appareil (effacer les données du site
dans le navigateur les supprime).

Quelques idées pour commencer :
- Glissez-déposez des fichiers depuis votre ordinateur dans la fenêtre du navigateur.
- Double-cliquez sur un fichier .wapp ou .html pour le lancer dans une fenêtre.
- Un fichier .js s'exécute dans un bac à sable et affiche sa console.
- Un fichier .exe n'est jamais exécuté : ses en-têtes PE sont analysés.
- Clic droit sur le bureau pour créer un dossier ou personnaliser l'affichage.

Le dossier « Programmes\\Exemples » contient des applications prêtes à lancer.
`;

// Exemples copiés au premier démarrage (servis par le site, dossier exemples/)
const EXAMPLES = ['horloge.wapp', 'serpent.wapp', 'bonjour.html', 'demo.js'];

export class FsError extends Error {}
const fail = (message) => { throw new FsError(message); };

// ---------------------------------------------------------------- chemins
export function normalize(vpath) {
  if (vpath === null || vpath === undefined) vpath = '/';
  if (typeof vpath !== 'string') fail('Chemin invalide');
  if (vpath.includes('\0') || vpath.length > 4096) fail('Chemin invalide');
  const parts = [];
  for (const seg of vpath.replace(/\\/g, '/').normalize('NFC').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') fail('Les chemins contenant « .. » sont interdits');
    if (/[\x00-\x1f]/.test(seg)) fail('Chemin invalide');
    parts.push(seg);
  }
  return `/${parts.join('/')}`;
}
export function parentOf(vpath) {
  const p = normalize(vpath);
  if (p === '/') return '/';
  return normalize(p.slice(0, p.lastIndexOf('/')) || '/');
}
export function baseName(vpath) {
  const p = normalize(vpath);
  return p.slice(p.lastIndexOf('/') + 1);
}
export function join(parent, name) {
  return normalize(`${normalize(parent).replace(/\/$/, '')}/${name}`);
}
export function isWithin(child, parent) {
  const c = normalize(child);
  const p = normalize(parent);
  return p === '/' || c === p || c.startsWith(`${p}/`);
}
function validateName(name) {
  if (typeof name !== 'string') fail('Nom invalide');
  const n = name.normalize('NFC').trim().replace(/\.+$/, '');
  if (!n || n === '.' || n === '..') fail('Le nom ne peut pas être vide');
  if (n.length > MAX_NAME_LEN) fail('Nom trop long');
  for (const c of n) {
    if (INVALID_NAME_CHARS.has(c) || c.charCodeAt(0) < 32) {
      fail('Un nom de fichier ne peut pas contenir : \\ / : * ? " < > |');
    }
  }
  return n;
}
export function sanitizeName(name, fallback = 'fichier') {
  let n = typeof name === 'string' ? name : '';
  n = n.replace(/\\/g, '/').split('/').pop().normalize('NFC');
  n = [...n].map((c) => (INVALID_NAME_CHARS.has(c) || c.charCodeAt(0) < 32 ? '_' : c)).join('');
  n = n.trim().replace(/\.+$/, '').slice(0, MAX_NAME_LEN);
  if (!n || n === '.' || n === '..') n = fallback;
  return n;
}
const now = () => Date.now() / 1000;
const casefold = (s) => s.toLocaleLowerCase('fr');

// ---------------------------------------------------------------- IndexedDB
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('nodes')) db.createObjectStore('nodes', { keyPath: 'path' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('apps')) db.createObjectStore('apps');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Base de données bloquée par un autre onglet'));
  });
}
const reqP = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('Transaction annulée'));
    tx.onerror = () => reject(tx.error);
  });
}
function storageError(err) {
  if (err && (err.name === 'QuotaExceededError' || /quota/i.test(String(err.message)))) {
    return new FsError('Espace de stockage du navigateur plein : supprimez des fichiers (et videz la corbeille).');
  }
  return err instanceof Error ? err : new Error(String(err));
}

// ---------------------------------------------------------------- état
let dbPromise = null;
let nodes = new Map(); // path -> node
let meta = { trash: {}, positions: {} };
let queue = Promise.resolve(); // sérialise les opérations
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('winweb-fs') : null;
const listeners = new Set();

/** Appelé quand un AUTRE onglet a modifié les fichiers. */
export function onExternalChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

async function loadAll(db) {
  const tx = db.transaction(['nodes', 'meta'], 'readonly');
  const [list, trash, positions] = await Promise.all([
    reqP(tx.objectStore('nodes').getAll()),
    reqP(tx.objectStore('meta').get('trash')),
    reqP(tx.objectStore('meta').get('positions')),
  ]);
  nodes = new Map(list.map((n) => [n.path, n]));
  meta = { trash: trash || {}, positions: positions || {} };
}

function db() {
  if (!dbPromise) {
    dbPromise = (async () => {
      if (typeof indexedDB === 'undefined') {
        throw new FsError('Ce navigateur ne permet pas d\'enregistrer des fichiers (IndexedDB indisponible, navigation privée ?).');
      }
      const d = await idbOpen();
      await loadAll(d);
      await ensureDefaults(d);
      if (channel) {
        channel.onmessage = async () => {
          await loadAll(d);
          listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
        };
      }
      return d;
    })();
  }
  return dbPromise;
}

/** Écrit un lot de changements en une transaction, puis met à jour la mémoire. */
async function commit({ put = [], del = [], blobs = [], blobDel = [], metaChanged = false }) {
  const d = await db();
  const tx = d.transaction(['nodes', 'blobs', 'meta'], 'readwrite');
  const done = txDone(tx);
  const ns = tx.objectStore('nodes');
  const bs = tx.objectStore('blobs');
  del.forEach((p) => ns.delete(p));
  blobDel.forEach((p) => bs.delete(p));
  put.forEach((n) => ns.put(n));
  blobs.forEach(([p, b]) => bs.put(b, p));
  if (metaChanged) {
    tx.objectStore('meta').put(meta.trash, 'trash');
    tx.objectStore('meta').put(meta.positions, 'positions');
  }
  try {
    await done;
  } catch (err) {
    await loadAll(d); // la mémoire redevient fidèle à la base
    throw storageError(err);
  }
  del.forEach((p) => nodes.delete(p));
  put.forEach((n) => nodes.set(n.path, n));
  channel?.postMessage('change');
}

/** Exécute fn() après les opérations en cours (une seule à la fois). */
function exclusive(fn) {
  const run = queue.then(() => db()).then(fn);
  queue = run.catch(() => {});
  return run;
}

async function readBlobRaw(path) {
  const d = await db();
  const tx = d.transaction('blobs', 'readonly');
  return reqP(tx.objectStore('blobs').get(path));
}

function mkNode(path, type, size = 0, created = now()) {
  return { path, parent: path === '/' ? '' : parentOf(path), name: path === '/' ? '' : baseName(path), type, size, modified: now(), created };
}

async function ensureDefaults(d) {
  if (nodes.has('/Documents')) return;
  const put = [];
  const blobs = [];
  if (!nodes.has('/')) put.push(mkNode('/', 'dir'));
  for (const name of [...DEFAULT_DIRS, 'Corbeille']) {
    if (!nodes.has(`/${name}`)) put.push(mkNode(`/${name}`, 'dir'));
  }
  const welcome = new Blob([WELCOME_TEXT], { type: 'text/plain' });
  put.push(mkNode('/Documents/Bienvenue.txt', 'file', welcome.size));
  blobs.push(['/Documents/Bienvenue.txt', welcome]);
  // Exemples livrés avec le site (ignorés s'ils sont introuvables)
  const examples = await Promise.all(EXAMPLES.map(async (name) => {
    try {
      const r = await fetch(new URL(`../../exemples/${encodeURIComponent(name)}`, import.meta.url));
      return r.ok ? [name, await r.blob()] : null;
    } catch { return null; }
  }));
  if (examples.some(Boolean)) put.push(mkNode('/Programmes/Exemples', 'dir'));
  for (const ex of examples.filter(Boolean)) {
    const p = `/Programmes/Exemples/${ex[0]}`;
    put.push(mkNode(p, 'file', ex[1].size));
    blobs.push([p, ex[1]]);
  }
  const tx = d.transaction(['nodes', 'blobs', 'meta'], 'readwrite');
  const done = txDone(tx);
  put.forEach((n) => tx.objectStore('nodes').put(n));
  blobs.forEach(([p, b]) => tx.objectStore('blobs').put(b, p));
  tx.objectStore('meta').put(meta.trash, 'trash');
  tx.objectStore('meta').put(meta.positions, 'positions');
  await done;
  put.forEach((n) => nodes.set(n.path, n));
}

// ---------------------------------------------------------------- outils
function existing(vpath, kind) {
  const p = normalize(vpath);
  const n = nodes.get(p);
  if (!n) fail(`Élément introuvable : ${p}`);
  if (kind === 'dir' && n.type !== 'dir') fail(`Ce n'est pas un dossier : ${p}`);
  if (kind === 'file' && n.type !== 'file') fail(`Ce n'est pas un fichier : ${p}`);
  return n;
}
function checkMutable(vpath) {
  const p = normalize(vpath);
  if (PROTECTED.has(p)) fail('Ce dossier système ne peut pas être modifié');
  return p;
}
function children(dir) {
  const out = [];
  for (const n of nodes.values()) if (n.parent === dir && n.path !== '/') out.push(n);
  return out;
}
function subtree(p) {
  const out = [];
  for (const n of nodes.values()) if (n.path === p || n.path.startsWith(`${p}/`)) out.push(n);
  return out;
}
function unique(dir, name, copySuffix = false) {
  if (!nodes.has(join(dir, name))) return name;
  const isDir = nodes.get(join(dir, name)).type === 'dir';
  let stem = name;
  let ext = '';
  const dot = name.lastIndexOf('.');
  if (!isDir && dot > 0) { stem = name.slice(0, dot); ext = name.slice(dot); }
  if (copySuffix) {
    const candidate = `${stem} - Copie${ext}`;
    if (!nodes.has(join(dir, candidate))) return candidate;
    stem = `${stem} - Copie`;
  }
  let i = 2;
  while (nodes.has(join(dir, `${stem} (${i})${ext}`))) i += 1;
  return `${stem} (${i})${ext}`;
}
function entry(n) {
  const name = n.path === '/' ? 'Ce PC' : n.name;
  const isDir = n.type === 'dir';
  const e = {
    name,
    path: n.path,
    type: n.type,
    ext: isDir || !name.includes('.') ? '' : name.slice(name.lastIndexOf('.') + 1).toLowerCase(),
    size: isDir ? 0 : n.size,
    modified: n.modified,
    created: n.created,
    protected: PROTECTED.has(n.path),
  };
  if (n.path === TRASH_PATH) e.special = 'trash';
  if (n.parent === TRASH_PATH) {
    const rec = meta.trash[n.name];
    if (rec) { e.original = rec.original; e.deleted = rec.deleted; }
  }
  return e;
}
/** Nouveau chemin de chaque nœud d'un sous-arbre déplacé de src vers dst. */
function remap(src, dst, ops, keepBlobs = true) {
  for (const n of subtree(src)) {
    const np = dst + n.path.slice(src.length);
    const copy = { ...n, path: np, parent: parentOf(np), name: baseName(np) };
    ops.del.push(n.path);
    ops.put.push(copy);
    if (n.type === 'file' && keepBlobs) ops.moves.push([n.path, np]);
  }
  for (const k of Object.keys(meta.positions)) {
    if (k === src || k.startsWith(`${src}/`)) {
      meta.positions[dst + k.slice(src.length)] = meta.positions[k];
      delete meta.positions[k];
    }
  }
}
async function applyMoves(ops) {
  // Déplacement des contenus : lecture des Blob puis réécriture sous le nouveau chemin
  const blobs = [];
  for (const [from, to] of ops.moves) {
    const b = await readBlobRaw(from);
    if (b !== undefined) blobs.push([to, b]);
  }
  const blobDel = ops.moves.map(([from]) => from).filter((f) => !ops.put.some((n) => n.path === f));
  return { blobs, blobDel };
}
function dropPositions(p) {
  for (const k of Object.keys(meta.positions)) {
    if (k === p || k.startsWith(`${p}/`)) delete meta.positions[k];
  }
}

// ---------------------------------------------------------------- API publique
export function list(vpath) {
  return exclusive(() => {
    const p = normalize(vpath);
    existing(p, 'dir');
    return children(p).map(entry).sort((a, b) => (a.type !== 'dir') - (b.type !== 'dir')
      || casefold(a.name).localeCompare(casefold(b.name)));
  });
}

export function stat(vpath) {
  return exclusive(() => {
    const p = normalize(vpath);
    const e = entry(existing(p));
    if (e.type === 'dir') {
      let files = 0; let dirs = 0; let size = 0;
      for (const n of subtree(p)) {
        if (n.path === p) continue;
        if (n.type === 'dir') dirs += 1; else { files += 1; size += n.size; }
      }
      Object.assign(e, { files, dirs, size });
    }
    return e;
  });
}

export function create(parent, name, kind = 'file', content = '') {
  return exclusive(async () => {
    const par = normalize(parent);
    if (isWithin(par, TRASH_PATH)) fail('Impossible de créer un élément dans la corbeille');
    existing(par, 'dir');
    if (typeof content !== 'string') fail('Contenu invalide');
    const nm = unique(par, validateName(name));
    const p = join(par, nm);
    if (kind === 'dir') {
      const n = mkNode(p, 'dir');
      await commit({ put: [n] });
      return entry(n);
    }
    const blob = new Blob([content || ''], { type: 'text/plain' });
    const n = mkNode(p, 'file', blob.size);
    await commit({ put: [n], blobs: [[p, blob]] });
    return entry(n);
  });
}

export function readText(vpath) {
  return exclusive(async () => {
    const p = normalize(vpath);
    const n = existing(p, 'file');
    if (n.size > MAX_TEXT_READ) fail('Fichier trop volumineux pour être ouvert comme texte');
    const blob = await readBlobRaw(p);
    let bytes = new Uint8Array(blob ? await blob.arrayBuffer() : new ArrayBuffer(0));
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
    try {
      return { path: p, content: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
    } catch {
      return { path: p, content: new TextDecoder('iso-8859-1').decode(bytes), encoding: 'latin-1' };
    }
  });
}

/** Contenu brut d'un fichier (Blob) — utilisé par les visionneuses et le bac à sable. */
export function readBlob(vpath) {
  return exclusive(async () => {
    const p = normalize(vpath);
    existing(p, 'file');
    return (await readBlobRaw(p)) || new Blob([]);
  });
}

function writeBlobUnlocked(vpath, blob) {
  const p = checkMutable(vpath);
  if (isWithin(p, TRASH_PATH)) fail('Impossible d\'écrire dans la corbeille');
  validateName(baseName(p));
  existing(parentOf(p), 'dir');
  const old = nodes.get(p);
  if (old && old.type === 'dir') fail('Un dossier porte déjà ce nom');
  const n = old ? { ...old, size: blob.size, modified: now() } : mkNode(p, 'file', blob.size);
  return commit({ put: [n], blobs: [[p, blob]] }).then(() => entry(n));
}

export function writeText(vpath, content) {
  if (typeof content !== 'string') return Promise.reject(new FsError('Contenu invalide'));
  return exclusive(() => writeBlobUnlocked(vpath, new Blob([content], { type: 'text/plain' })));
}

/** Écrit un contenu binaire (bases SQLite, téléchargements...). */
export function writeBlob(vpath, blob) {
  return exclusive(() => writeBlobUnlocked(vpath, blob));
}

export function rename(vpath, newName) {
  return exclusive(async () => {
    const p = checkMutable(vpath);
    if (parentOf(p) === TRASH_PATH) fail('Restaurez l\'élément avant de le renommer');
    const n = existing(p);
    const np = join(parentOf(p), validateName(newName));
    if (np === p) return entry(n);
    if (nodes.has(np)) fail('Un élément portant ce nom existe déjà');
    const ops = { put: [], del: [], moves: [] };
    remap(p, np, ops);
    const { blobs, blobDel } = await applyMoves(ops);
    await commit({ put: ops.put, del: ops.del, blobs, blobDel, metaChanged: true });
    return entry(nodes.get(np));
  });
}

async function deleteUnlocked(paths, permanent) {
  const done = [];
  for (const raw of paths) {
    const p = checkMutable(raw);
    existing(p);
    const inTrash = isWithin(p, TRASH_PATH);
    if (permanent || inTrash) {
      const sub = subtree(p);
      if (parentOf(p) === TRASH_PATH) delete meta.trash[baseName(p)];
      dropPositions(p);
      await commit({
        del: sub.map((n) => n.path),
        blobDel: sub.filter((n) => n.type === 'file').map((n) => n.path),
        metaChanged: true,
      });
    } else {
      const name = unique(TRASH_PATH, baseName(p));
      const np = join(TRASH_PATH, name);
      const ops = { put: [], del: [], moves: [] };
      remap(p, np, ops);
      dropPositions(np);
      meta.trash[name] = { original: p, deleted: now() };
      const { blobs, blobDel } = await applyMoves(ops);
      await commit({ put: ops.put, del: ops.del, blobs, blobDel, metaChanged: true });
    }
    done.push(p);
  }
  return done;
}

async function transfer(paths, dest, copy) {
  const d = normalize(dest);
  if (d === TRASH_PATH && !copy) return deleteUnlocked(paths, false);
  if (isWithin(d, TRASH_PATH)) fail('Destination invalide');
  existing(d, 'dir');
  const results = [];
  for (const raw of paths) {
    const src = copy ? normalize(raw) : checkMutable(raw);
    if (src === '/') fail('Opération impossible sur la racine');
    existing(src);
    if (isWithin(d, src)) fail('Impossible de placer un dossier dans lui-même');
    if (!copy && parentOf(src) === d) { results.push(src); continue; }
    const name = unique(d, baseName(src), copy && parentOf(src) === d);
    const np = join(d, name);
    if (copy) {
      const put = [];
      const blobs = [];
      for (const n of subtree(src)) {
        const cp = dst(np, src, n);
        put.push({ ...n, path: cp, parent: parentOf(cp), name: baseName(cp), created: now() });
        if (n.type === 'file') {
          const b = await readBlobRaw(n.path);
          blobs.push([cp, b || new Blob([])]);
        }
      }
      await commit({ put, blobs });
    } else {
      const ops = { put: [], del: [], moves: [] };
      if (parentOf(src) === TRASH_PATH) delete meta.trash[baseName(src)];
      remap(src, np, ops);
      const { blobs, blobDel } = await applyMoves(ops);
      await commit({ put: ops.put, del: ops.del, blobs, blobDel, metaChanged: true });
    }
    results.push(np);
  }
  return results;
}
const dst = (np, src, n) => np + n.path.slice(src.length);

export const move = (paths, dest) => exclusive(() => transfer(paths, dest, false));
export const copy = (paths, dest) => exclusive(() => transfer(paths, dest, true));
export const remove = (paths, permanent = false) => exclusive(() => deleteUnlocked(paths, permanent));

export function restore(paths) {
  return exclusive(async () => {
    const restored = [];
    for (const raw of paths) {
      const p = normalize(raw);
      if (parentOf(p) !== TRASH_PATH) fail('Seuls les éléments de la corbeille peuvent être restaurés');
      existing(p);
      const rec = meta.trash[baseName(p)] || {};
      let original;
      try { original = normalize(rec.original || `/Bureau/${baseName(p)}`); } catch { original = `/Bureau/${baseName(p)}`; }
      let target = parentOf(original);
      if (isWithin(target, TRASH_PATH)) target = '/Bureau';
      // Recrée les dossiers parents disparus entre-temps
      const put = [];
      let cur = target;
      const missing = [];
      while (cur !== '/' && !nodes.has(cur)) { missing.unshift(cur); cur = parentOf(cur); }
      missing.forEach((m) => put.push(mkNode(m, 'dir')));
      if (put.length) await commit({ put });
      const np = join(target, unique(target, baseName(original)));
      const ops = { put: [], del: [], moves: [] };
      remap(p, np, ops);
      delete meta.trash[baseName(p)];
      const { blobs, blobDel } = await applyMoves(ops);
      await commit({ put: ops.put, del: ops.del, blobs, blobDel, metaChanged: true });
      restored.push(np);
    }
    return restored;
  });
}

export function emptyTrash() {
  return exclusive(async () => {
    const top = children(TRASH_PATH);
    const sub = top.flatMap((n) => subtree(n.path));
    meta.trash = {};
    await commit({
      del: sub.map((n) => n.path),
      blobDel: sub.filter((n) => n.type === 'file').map((n) => n.path),
      metaChanged: true,
    });
    return { count: top.length };
  });
}

export function search(query, limit = 60) {
  return exclusive(() => {
    const q = casefold((query || '').trim());
    if (!q) return [];
    const out = [];
    const all = [...nodes.values()]
      .filter((n) => n.path !== '/' && !isWithin(n.path, TRASH_PATH))
      .sort((a, b) => a.path.localeCompare(b.path));
    for (const n of all) {
      if (casefold(n.name).includes(q)) {
        out.push(entry(n));
        if (out.length >= limit) break;
      }
    }
    return out;
  });
}

/** items : [{file: Blob|File, relpath}] — dépôt de fichiers ou de dossiers entiers. */
export function upload(dest, items, onProgress) {
  return exclusive(async () => {
    const d = normalize(dest);
    if (isWithin(d, TRASH_PATH)) fail('Impossible de déposer des fichiers dans la corbeille');
    existing(d, 'dir');
    const total = items.reduce((s, it) => s + (it.file.size || 0), 0);
    if (total > MAX_UPLOAD_MB * 1024 * 1024) fail(`Dépôt trop volumineux (maximum ${MAX_UPLOAD_MB} Mo à la fois)`);
    const topMap = {};
    const created = [];
    let sent = 0;
    for (const { file, relpath } of items) {
      const rel = (relpath || file.name || '').replace(/\\/g, '/');
      let segs = rel.split('/').filter((s) => s && s !== '.' && s !== '..').map((s) => sanitizeName(s));
      if (!segs.length) segs = [sanitizeName(file.name)];
      const top = segs[0];
      if (!(top in topMap)) { topMap[top] = unique(d, top); created.push(topMap[top]); }
      segs[0] = topMap[top];
      const p = normalize(`${d}/${segs.join('/')}`);
      if (!isWithin(p, d)) fail('Chemin de dépôt invalide');
      if (nodes.get(p)?.type === 'dir') continue;
      const put = [];
      let cur = parentOf(p);
      const missing = [];
      while (cur !== d && isWithin(cur, d) && !nodes.has(cur)) { missing.unshift(cur); cur = parentOf(cur); }
      missing.forEach((m) => put.push(mkNode(m, 'dir')));
      put.push(mkNode(p, 'file', file.size));
      await commit({ put, blobs: [[p, file]] });
      sent += file.size || 0;
      if (onProgress && total) onProgress(sent / total);
    }
    return created.map((n) => join(d, n));
  });
}

export const getPositions = () => exclusive(() => ({ ...meta.positions }));

export function setPositions(positions) {
  return exclusive(async () => {
    if (!positions || typeof positions !== 'object') fail('Positions invalides');
    for (const [key, pos] of Object.entries(positions)) {
      if (typeof key !== 'string' || key.length > 4096) continue;
      if (pos === null) { delete meta.positions[key]; continue; }
      const x = parseInt(pos?.x, 10);
      const y = parseInt(pos?.y, 10);
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
      meta.positions[key] = { x: Math.max(0, Math.min(x, 10000)), y: Math.max(0, Math.min(y, 10000)) };
    }
    await commit({ metaChanged: true });
    return { ...meta.positions };
  });
}

// ---------------------------------------------------------------- applications .wapp
export async function appsGet(key) {
  const d = await db();
  return reqP(d.transaction('apps', 'readonly').objectStore('apps').get(key));
}
export async function appsPutAll(entries) {
  const d = await db();
  const tx = d.transaction('apps', 'readwrite');
  const done = txDone(tx);
  entries.forEach(([k, v]) => tx.objectStore('apps').put(v, k));
  try { await done; } catch (err) { throw storageError(err); }
}

/** Espace utilisé / disponible (estimation du navigateur). */
export async function usage() {
  try {
    const est = await navigator.storage?.estimate?.();
    return est ? { used: est.usage, quota: est.quota } : null;
  } catch { return null; }
}

/** Ouvre la base dès maintenant (création des dossiers au premier lancement). */
export const ready = () => db().then(() => true);
