// Applications .wapp (archive zip + manifest.json), décompressées DANS LE NAVIGATEUR.
// Portage de wapp.py : mêmes contrôles (pas de chemin absolu, pas de « .. »,
// pas de lien symbolique, 2 000 fichiers et 100 Mo décompressés au plus).
// La décompression utilise DecompressionStream('deflate-raw') du navigateur.
// Rien n'est exécuté ici : les fichiers sont seulement stockés, puis affichés
// dans une iframe sandboxée (voir inline.js).

import { appsGet, appsPutAll, baseName, FsError, readBlob } from './localfs.js';

const MAX_MEMBERS = 2000;
const MAX_TOTAL_SIZE = 100 * 1024 * 1024;
const MAX_MANIFEST_SIZE = 64 * 1024;
const ICON_EXTS = ['.png', '.svg', '.jpg', '.jpeg', '.gif', '.webp', '.ico'];

const fail = (m) => { throw new FsError(m); };

function safeMemberPath(name) {
  const n = String(name).replace(/\\/g, '/');
  if (n.startsWith('/') || n.includes('\0')) return null;
  const parts = n.split('/').filter((p) => p !== '' && p !== '.');
  if (!parts.length || parts.includes('..')) return null;
  if (parts[0].includes(':')) return null; // lettre de lecteur Windows
  return parts.join('/');
}

// ---------------------------------------------------------------- lecture zip
function readZipDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Fin du répertoire central : signature 0x06054b50, cherchée depuis la fin
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) fail('Ce fichier .wapp n\'est pas une archive zip valide (ou est chiffré)');
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) fail('Archive zip64 non prise en charge');
  if (count > MAX_MEMBERS) fail('Archive .wapp trop volumineuse (trop de fichiers)');
  const decoder = new TextDecoder();
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) {
      fail('Ce fichier .wapp n\'est pas une archive zip valide (ou est chiffré)');
    }
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const externalAttr = view.getUint32(p + 38, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, flags, method, compSize, size, externalAttr, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflate(bytes, method, expected) {
  if (method === 0) return bytes;
  if (method !== 8) fail('Méthode de compression non prise en charge dans l\'archive');
  if (typeof DecompressionStream !== 'function') fail('Ce navigateur ne sait pas décompresser les .wapp (navigateur trop ancien)');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const chunks = [];
  let total = 0;
  const rd = stream.getReader();
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    total += value.length;
    if (total > MAX_TOTAL_SIZE || total > expected + 1024) {
      await rd.cancel();
      fail('Archive .wapp trop volumineuse une fois décompressée');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  chunks.forEach((c) => { out.set(c, o); o += c.length; });
  return out;
}

async function extract(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const members = [];
  let declared = 0;
  for (const e of readZipDirectory(bytes)) {
    if (e.name.endsWith('/')) continue; // dossier
    if (((e.externalAttr >>> 16) & 0o170000) === 0o120000) continue; // lien symbolique ignoré
    if (e.flags & 1) fail('Archive .wapp chiffrée : non prise en charge');
    const rel = safeMemberPath(e.name);
    if (rel === null) fail(`Chemin interdit dans l'archive : ${e.name.slice(0, 120)}`);
    declared += e.size;
    if (declared > MAX_TOTAL_SIZE) fail('Archive .wapp trop volumineuse une fois décompressée');
    members.push({ ...e, rel });
  }
  // Tout dans un unique dossier racine contenant le manifest : on l'aplatit
  const rels = members.map((m) => m.rel);
  let prefix = '';
  if (!rels.includes('manifest.json')) {
    const tops = new Set(rels.filter((r) => r.includes('/')).map((r) => r.split('/')[0]));
    if (tops.size === 1 && rels.every((r) => r.includes('/'))) {
      const top = [...tops][0];
      if (rels.includes(`${top}/manifest.json`)) prefix = `${top}/`;
    }
  }
  const files = new Map();
  let written = 0;
  for (const m of members) {
    let rel = m.rel;
    if (prefix) {
      if (!rel.startsWith(prefix)) continue;
      rel = rel.slice(prefix.length);
    }
    const lh = m.localOffset;
    if (lh + 30 > bytes.length || view.getUint32(lh, true) !== 0x04034b50) {
      fail('Ce fichier .wapp n\'est pas une archive zip valide (ou est chiffré)');
    }
    const start = lh + 30 + view.getUint16(lh + 26, true) + view.getUint16(lh + 28, true);
    const data = await inflate(bytes.subarray(start, start + m.compSize), m.method, m.size);
    written += data.length;
    if (written > MAX_TOTAL_SIZE) fail('Archive .wapp trop volumineuse une fois décompressée');
    files.set(rel, data);
  }
  return files;
}

// ---------------------------------------------------------------- manifest
function sanitizeManifest(raw, fallbackName, files) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const text = (key, def = '', limit = 120) => {
    const v = r[key];
    return ['string', 'number'].includes(typeof v) ? String(v).slice(0, limit) : def;
  };
  const win = r.window && typeof r.window === 'object' ? r.window : {};
  const number = (key, def, lo, hi) => {
    const v = parseInt(r[key] ?? def, 10);
    return Number.isNaN(v) ? def : Math.max(lo, Math.min(v, hi));
  };
  let entry = safeMemberPath(r.entry || r.main || 'index.html');
  if (!entry || !files.has(entry)) entry = files.has('index.html') ? 'index.html' : null;
  if (!entry) {
    const htmls = [...files.keys()].filter((f) => /\.html?$/i.test(f)).sort();
    if (!htmls.length) fail('L\'archive .wapp ne contient aucune page HTML à lancer');
    [entry] = htmls;
  }
  let iconText = '📦';
  let iconPath = null;
  if (typeof r.icon === 'string' && r.icon) {
    const rel = safeMemberPath(r.icon);
    if (rel && ICON_EXTS.some((e) => rel.toLowerCase().endsWith(e)) && files.has(rel)) iconPath = rel;
    else if ([...r.icon].length <= 8) iconText = r.icon;
  }
  return {
    name: text('name', fallbackName, 80) || fallbackName,
    description: text('description', '', 400),
    version: text('version', '', 40),
    author: text('author', '', 80),
    entry,
    icon: iconText,
    icon_path: iconPath,
    width: number('width', win.width || 800, 240, 2000),
    height: number('height', win.height || 600, 160, 1400),
    resizable: r.resizable !== false,
  };
}

const MIME = {
  html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
  json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', mp3: 'audio/mpeg', wav: 'audio/wav',
  ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', txt: 'text/plain', woff: 'font/woff', woff2: 'font/woff2',
};
export const mimeOf = (name) => MIME[(name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

/**
 * Décompresse une seule fois (mise en cache par empreinte SHA-256) et
 * renvoie le manifest, comme POST /api/wapp/open de la version Python.
 */
export async function install(vpath) {
  if (!vpath.toLowerCase().endsWith('.wapp')) fail('Ce n\'est pas un fichier .wapp');
  const blob = await readBlob(vpath);
  const buf = await blob.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  const appId = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  let manifest = await appsGet(`${appId}.json`);
  if (!manifest) {
    const files = await extract(new Uint8Array(buf));
    let raw = {};
    const man = files.get('manifest.json');
    if (man) {
      if (man.length > MAX_MANIFEST_SIZE) fail('manifest.json trop volumineux');
      try {
        raw = JSON.parse(new TextDecoder().decode(man).replace(/^﻿/, ''));
      } catch {
        fail('manifest.json invalide (JSON mal formé)');
      }
    }
    const fallback = baseName(vpath).replace(/\.[^.]*$/, '');
    manifest = sanitizeManifest(raw, fallback, files);
    const entries = [...files].map(([rel, data]) => [`${appId}/${rel}`, new Blob([data], { type: mimeOf(rel) })]);
    entries.push([`${appId}.json`, manifest]);
    await appsPutAll(entries);
  }
  return {
    ...manifest,
    id: appId,
    url: `wapp/${appId}/${manifest.entry}`,
    icon_url: manifest.icon_path ? `wapp/${appId}/${manifest.icon_path}` : null,
  };
}

/** Fichier d'une application installée (Blob), ou null. */
export async function appFile(appId, rel) {
  if (!/^[0-9a-f]{32}$/.test(appId || '')) return null;
  const clean = safeMemberPath(rel || '');
  if (!clean) return null;
  const b = await appsGet(`${appId}/${clean}`);
  return b instanceof Blob ? b : null;
}
