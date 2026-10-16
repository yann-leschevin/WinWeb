// Assainissement du HTML riche (traitement de texte, diaporama, notes).
// Les documents et le presse-papiers sont des données non fiables : ils sont
// analysés dans un document inerte (DOMParser : aucun script, aucun chargement)
// puis reconstruits avec une liste blanche de balises, d'attributs et de styles.

const ALLOWED_TAGS = new Set([
  'p', 'div', 'span', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
  'a', 'img', 'font', 'mark', 'small', 'big', 'figure', 'figcaption', 'center', 'kbd', 'q', 'abbr',
]);
// Balises supprimées avec tout leur contenu.
const DROP_TAGS = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'noscript', 'template', 'svg', 'math',
  'form', 'input', 'textarea', 'select', 'button', 'link', 'meta', 'title', 'head', 'base', 'audio', 'video',
  'canvas', 'applet', 'portal', 'xmp', 'noembed', 'noframes', 'plaintext',
]);
const ATTRS = {
  '*': ['style', 'class', 'align', 'title', 'dir'],
  a: ['href'],
  img: ['src', 'alt', 'width', 'height'],
  font: ['color', 'face', 'size'],
  td: ['colspan', 'rowspan', 'width'],
  th: ['colspan', 'rowspan', 'width'],
  col: ['span', 'width'],
  ol: ['start', 'type'],
  li: ['data-done'],
  table: ['width', 'border', 'cellpadding', 'cellspacing'],
};
const STYLE_PROPS = new Set([
  'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'text-decoration', 'text-decoration-line', 'text-align', 'text-indent', 'text-transform', 'line-height',
  'letter-spacing', 'word-spacing', 'white-space', 'vertical-align', 'list-style-type',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'border-color', 'border-style',
  'border-width', 'border-collapse', 'border-radius', 'width', 'height', 'max-width', 'min-width',
  'float', 'clear', 'page-break-before', 'page-break-after', 'break-before', 'break-after',
]);
const CLASS_RE = /^wo-[a-z0-9-]+$/;

/** URL d'image acceptée : data:image (hors SVG) ou fichier du VFS servi par /vfs/. */
export function safeImageSrc(src) {
  const value = String(src || '').trim();
  if (/^data:image\/(png|jpe?g|gif|webp|bmp|avif);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
  if (/^\/vfs\/[^\s"'<>\\]*$/.test(value) && !value.includes('/../')) return value;
  return null;
}

export function safeHref(href) {
  const value = String(href || '').trim();
  if (/^(https?:|mailto:)/i.test(value) || value.startsWith('#')) return value;
  return null;
}

function cleanStyle(source, target) {
  const out = [];
  for (let i = 0; i < source.style.length; i += 1) {
    const prop = source.style[i];
    if (!STYLE_PROPS.has(prop)) continue;
    const value = source.style.getPropertyValue(prop);
    if (/url\s*\(|expression|javascript:|@import|[<>]/i.test(value)) continue;
    out.push(`${prop}: ${value}`);
  }
  if (out.length) target.setAttribute('style', out.join('; '));
}

function cleanNode(node, doc) {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.nodeValue);
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = node.localName;
  if (DROP_TAGS.has(tag)) return null;
  const children = () => {
    const frag = doc.createDocumentFragment();
    for (const child of node.childNodes) {
      const clean = cleanNode(child, doc);
      if (clean) frag.append(clean);
    }
    return frag;
  };
  if (!ALLOWED_TAGS.has(tag)) return children(); // balise inconnue : on garde le contenu
  const el = doc.createElement(tag);
  const allowed = new Set([...ATTRS['*'], ...(ATTRS[tag] || [])]);
  for (const attr of [...node.attributes]) {
    const name = attr.name.toLowerCase();
    if (!allowed.has(name)) continue;
    if (name === 'style') cleanStyle(node, el);
    else if (name === 'class') {
      const classes = attr.value.split(/\s+/).filter((c) => CLASS_RE.test(c));
      if (classes.length) el.setAttribute('class', classes.join(' '));
    } else if (name === 'href') {
      const href = safeHref(attr.value);
      if (href) el.setAttribute('href', href);
    } else if (name === 'src') {
      const src = safeImageSrc(attr.value);
      if (src) el.setAttribute('src', src);
    } else if (/^[\p{L}\p{N}\s#%.,()_'-]*$/u.test(attr.value)) {
      el.setAttribute(name, attr.value.slice(0, 200));
    }
  }
  if (tag === 'img' && !el.hasAttribute('src')) return null;
  el.append(children());
  return el;
}

/** Retourne une version sûre du HTML fourni. */
export function sanitizeHtml(html) {
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${String(html || '')}`, 'text/html');
  const out = document.implementation.createHTMLDocument('');
  const root = out.createElement('div');
  for (const child of parsed.body.childNodes) {
    const clean = cleanNode(child, out);
    if (clean) root.append(clean);
  }
  return root.innerHTML;
}

/** Collage assaini dans une zone contenteditable. */
export function handleRichPaste(e) {
  const data = e.clipboardData;
  if (!data) return;
  e.preventDefault();
  const html = data.getData('text/html');
  if (html) {
    document.execCommand('insertHTML', false, sanitizeHtml(html));
    return;
  }
  const file = [...(data.files || [])].find((f) => f.type.startsWith('image/'));
  if (file) {
    readAsDataUrl(file).then((url) => {
      if (safeImageSrc(url)) document.execCommand('insertImage', false, url);
    });
    return;
  }
  document.execCommand('insertText', false, data.getData('text/plain'));
}

export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Texte brut -> HTML de paragraphes. */
export function textToHtml(text) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return String(text || '').split(/\r?\n/).map((line) => `<p>${esc(line) || '<br>'}</p>`).join('');
}
