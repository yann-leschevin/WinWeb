// Service worker de WinWeb (version en ligne).
// Sert les adresses « vfs/<chemin> » et « wapp/<id>/<fichier> » à partir des
// fichiers stockés dans le navigateur (IndexedDB), pour la page principale :
// images, fonds d'écran, téléchargements, images des documents...
// Tout le reste passe normalement par le réseau.
const DB_NAME = 'winweb';

const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif', mp3: 'audio/mpeg',
  wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', pdf: 'application/pdf',
  csv: 'text/csv; charset=utf-8', xml: 'application/xml', woff: 'font/woff', woff2: 'font/woff2',
};
// Contenu utilisateur : même s'il est ouvert seul dans un onglet, il reste
// dans une origine opaque, sans accès à WinWeb (comme la version Python).
const SANDBOX_CSP = 'sandbox allow-scripts';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function idbGet(store, key) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(store)) { db.close(); resolve(undefined); return; }
      const req = db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); reject(req.error); };
    };
  });
}

const notFound = () => new Response('Fichier introuvable', {
  status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
});

async function serve(blob, name, download) {
  if (!(blob instanceof Blob)) return notFound();
  const ext = (name.split('.').pop() || '').toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || blob.type || 'application/octet-stream',
    'Content-Security-Policy': SANDBOX_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
  };
  if (download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
  return new Response(blob, { headers });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const rel = url.pathname.slice(scope.pathname.length);

  if (rel.startsWith('vfs/')) {
    event.respondWith((async () => {
      let path;
      try {
        path = `/${rel.slice(4).split('/').map(decodeURIComponent).join('/')}`.normalize('NFC');
      } catch { return notFound(); }
      if (path.split('/').includes('..')) return notFound();
      const blob = await idbGet('blobs', path).catch(() => undefined);
      return serve(blob, path.slice(path.lastIndexOf('/') + 1), url.searchParams.get('download') === '1');
    })());
  } else if (rel.startsWith('wapp/')) {
    event.respondWith((async () => {
      const m = /^wapp\/([0-9a-f]{32})\/(.+)$/.exec(rel);
      if (!m) return notFound();
      let file;
      try { file = m[2].split('/').map(decodeURIComponent).join('/'); } catch { return notFound(); }
      if (file.split('/').includes('..')) return notFound();
      const blob = await idbGet('apps', `${m[1]}/${file}`).catch(() => undefined);
      return serve(blob, file, false);
    })());
  }
});
