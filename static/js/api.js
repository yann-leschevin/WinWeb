// Accès à l'API REST Flask du système de fichiers virtuel.
const HEADERS = { 'X-WinWeb': '1' };

async function request(method, url, payload) {
  const options = { method, headers: { ...HEADERS } };
  if (payload !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(payload);
  }
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error('Serveur injoignable');
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) throw new Error(data?.error || `Erreur ${response.status}`);
  return data;
}

const q = (path) => encodeURIComponent(path);

export const api = {
  list: (path) => request('GET', `/api/fs/list?path=${q(path)}`).then((d) => d.entries),
  stat: (path) => request('GET', `/api/fs/stat?path=${q(path)}`),
  read: (path) => request('GET', `/api/fs/read?path=${q(path)}`),
  search: (text) => request('GET', `/api/fs/search?q=${q(text)}`).then((d) => d.results),
  write: (path, content) => request('POST', '/api/fs/write', { path, content }),
  create: (parent, name, kind = 'file', content = '') =>
    request('POST', '/api/fs/create', { parent, name, kind, content }),
  rename: (path, name) => request('POST', '/api/fs/rename', { path, name }),
  move: (paths, dest) => request('POST', '/api/fs/move', { paths, dest }).then((d) => d.paths),
  copy: (paths, dest) => request('POST', '/api/fs/copy', { paths, dest }).then((d) => d.paths),
  remove: (paths, permanent = false) =>
    request('POST', '/api/fs/delete', { paths, permanent }).then((d) => d.paths),
  restore: (paths) => request('POST', '/api/fs/restore', { paths }).then((d) => d.paths),
  emptyTrash: () => request('POST', '/api/fs/empty-trash', {}),
  positions: () => request('GET', '/api/positions'),
  savePositions: (positions) => request('POST', '/api/positions', positions),
  pe: (path) => request('GET', `/api/pe?path=${q(path)}`),
  openWapp: (path) => request('POST', '/api/wapp/open', { path }),
  dbSchema: (path) => request('GET', `/api/db/schema?path=${q(path)}`),
  dbExec: (path, sql, params) => request('POST', '/api/db/exec', { path, sql, params }).then((d) => d.results),
  webDownload: (url, dest) => request('POST', '/api/web/download', { url, dest }),
  system: () => request('GET', '/api/system'),

  /** items : [{file: File, relpath: 'dossier/a.txt'}] ; onProgress(0..1) */
  upload(dest, items, onProgress) {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('dest', dest);
      for (const { file, relpath } of items) {
        form.append('files', file, file.name);
        form.append('relpaths', relpath || file.name);
      }
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/fs/upload');
      xhr.setRequestHeader('X-WinWeb', '1');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { data = null; }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data.paths);
        else reject(new Error(data?.error || `Erreur ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Envoi interrompu'));
      xhr.send(form);
    });
  },
};
