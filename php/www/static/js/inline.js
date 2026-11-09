// Prépare une page HTML de l'utilisateur pour une iframe sandbox="allow-scripts".
//
// Dans la version en ligne, les fichiers sont dans le navigateur (IndexedDB) :
// une iframe sandboxée (origine opaque) ne peut pas les demander au serveur.
// On construit donc un « srcdoc » autonome : les ressources relatives
// (scripts, feuilles de style, images, sons, polices) sont intégrées sous
// forme d'URL data:. Les adresses absolues (https:, data:...) sont laissées.
// Aucun code n'est exécuté ici : la page est seulement analysée (DOMParser).

import { readBlob as vfsBlob } from './localfs.js';
import { appFile } from './wapp.js';

const MAX_INLINE = 25 * 1024 * 1024; // garde-fou : 25 Mo de ressources par page

const isRelative = (url) => {
  const u = (url || '').trim();
  return u !== '' && !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);
};

function resolveRel(baseDir, url) {
  const clean = url.split('#')[0].split('?')[0];
  let decoded = clean;
  try { decoded = decodeURIComponent(clean); } catch { /* garde la forme brute */ }
  const parts = decoded.startsWith('/') ? [] : baseDir.split('/').filter(Boolean);
  for (const seg of decoded.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (parts.length) parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = () => reject(fr.error);
  fr.readAsDataURL(blob);
});

/**
 * html      : texte de la page
 * baseDir   : dossier de la page (chemin relatif, sans « / » final)
 * getFile   : async (chemin) => Blob | null
 */
export async function buildSrcdoc(html, baseDir, getFile) {
  let budget = MAX_INLINE;
  const cache = new Map();

  async function dataUrlFor(url, dir = baseDir, mimeHint = '') {
    if (!isRelative(url)) return null;
    const path = resolveRel(dir, url);
    if (cache.has(path)) return cache.get(path);
    let result = null;
    try {
      const blob = await getFile(path);
      if (blob && blob.size <= budget) {
        budget -= blob.size;
        const typed = mimeHint && !blob.type ? new Blob([blob], { type: mimeHint }) : blob;
        result = await toDataUrl(typed);
      }
    } catch { result = null; }
    cache.set(path, result);
    return result;
  }

  async function fixCss(css, dir) {
    const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    const found = [...css.matchAll(re)];
    let out = css;
    for (const m of found) {
      const data = await dataUrlFor(m[2], dir);
      if (data) out = out.split(m[0]).join(`url("${data}")`);
    }
    return out;
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Feuilles de style externes -> <style> (avec leurs url() intégrées)
  for (const link of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
    const href = link.getAttribute('href');
    if (!isRelative(href)) continue;
    const path = resolveRel(baseDir, href);
    try {
      const blob = await getFile(path);
      if (blob && blob.size <= budget) {
        budget -= blob.size;
        const style = doc.createElement('style');
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        style.textContent = await fixCss(await blob.text(), dir);
        link.replaceWith(style);
      }
    } catch { /* ressource absente : on laisse le lien */ }
  }
  for (const style of doc.querySelectorAll('style')) {
    style.textContent = await fixCss(style.textContent, baseDir);
  }
  for (const el of doc.querySelectorAll('[style]')) {
    el.setAttribute('style', await fixCss(el.getAttribute('style'), baseDir));
  }

  // Scripts classiques : contenu intégré (garde l'ordre et le comportement)
  for (const script of doc.querySelectorAll('script[src]')) {
    const src = script.getAttribute('src');
    if (!isRelative(src)) continue;
    try {
      const blob = await getFile(resolveRel(baseDir, src));
      if (blob && blob.size <= budget) {
        budget -= blob.size;
        script.removeAttribute('src');
        // « </script » dans le code fermerait la balise une fois sérialisée
        const code = (await blob.text()).replace(/<\/(script)/gi, '<\\/$1');
        script.textContent = `${code}\n//# sourceURL=${encodeURIComponent(src)}`;
      }
    } catch { /* ignore */ }
  }

  // Médias et icônes
  const attrs = [
    ['img[src]', 'src'], ['audio[src]', 'src'], ['video[src]', 'src'], ['source[src]', 'src'],
    ['video[poster]', 'poster'], ['input[type="image"][src]', 'src'], ['link[rel~="icon"][href]', 'href'],
    ['image[href]', 'href'], ['use[href]', 'href'],
  ];
  for (const [sel, attr] of attrs) {
    for (const el of doc.querySelectorAll(sel)) {
      const data = await dataUrlFor(el.getAttribute(attr));
      if (data) el.setAttribute(attr, data);
    }
  }
  for (const img of doc.querySelectorAll('img[srcset]')) img.removeAttribute('srcset');

  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

// ---------------------------------------------------------------- raccourcis

/** srcdoc d'une page .html du PC virtuel (ressources relatives à son dossier). */
export async function srcdocForVfs(vpath) {
  const html = await (await vfsBlob(vpath)).text();
  const dir = vpath.slice(0, vpath.lastIndexOf('/'));
  return buildSrcdoc(html, dir, async (p) => {
    try { return await vfsBlob(`/${p}`); } catch { return null; }
  });
}

/** srcdoc du point d'entrée d'une application .wapp installée. */
export async function srcdocForWapp(appId, entry) {
  const page = await appFile(appId, entry);
  if (!page) throw new Error('Page d\'entrée de l\'application introuvable');
  const dir = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/')) : '';
  return buildSrcdoc(await page.text(), dir, (p) => appFile(appId, p));
}
