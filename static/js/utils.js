// Petites fonctions utilitaires partagées.

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Crée un élément : h('div', {class: 'x', onclick: fn}, enfant1, 'texte'...) */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// ---------------------------------------------------------------- chemins virtuels
export function normPath(path) {
  const parts = [];
  for (const seg of String(path || '/').replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}
export const joinPath = (dir, name) => normPath(`${dir}/${name}`);
export function dirname(path) {
  const p = normPath(path);
  return p === '/' ? '/' : normPath(p.slice(0, p.lastIndexOf('/')) || '/');
}
export function basename(path) {
  const p = normPath(path);
  return p === '/' ? '' : p.slice(p.lastIndexOf('/') + 1);
}
export function extname(name) {
  const base = String(name || '');
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}
export function isWithin(child, parent) {
  const c = normPath(child);
  const p = normPath(parent);
  return p === '/' || c === p || c.startsWith(p + '/');
}

/** Chemin virtuel -> affichage façon Windows (C:\Documents\a.txt) */
export function toWinPath(path) {
  return 'C:' + (normPath(path) === '/' ? '\\' : normPath(path).replace(/\//g, '\\'));
}

/** URL du contenu brut d'un fichier du VFS. */
export function rawUrl(path, download = false) {
  const url = '/vfs' + normPath(path).split('/').map(encodeURIComponent).join('/');
  return download ? `${url}?download=1` : url;
}

// ---------------------------------------------------------------- formats
export function formatSize(bytes) {
  if (bytes === undefined || bytes === null) return '';
  const units = ['octets', 'Ko', 'Mo', 'Go'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return i === 0 ? `${n} ${units[0]}` : `${n.toFixed(n < 10 ? 1 : 0).replace('.', ',')} ${units[i]}`;
}

export function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function debounce(fn, delay = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
