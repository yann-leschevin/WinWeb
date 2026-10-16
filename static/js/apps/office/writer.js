// Traitement de texte (format .wdoc) : ruban, styles, tableaux, images,
// rechercher/remplacer, mise en page, export HTML/TXT, impression.
import { showMenu } from '../../contextMenu.js';
import { alertDialog, promptDialog } from '../../dialogs.js';
import { launchApp } from '../../registry.js';
import { escapeHtml, extname, h } from '../../utils.js';
import { createWindow } from '../../windowManager.js';
import {
  docController, fileShortcuts, pickLocalImage, pickVfsImage, printHtml, rbBtn, rbColor, rbSelect, ribbon,
} from './common.js';
import {
  handleRichPaste, safeHref, sanitizeHtml, textToHtml,
} from './sanitize.js';

const FONTS = ['Calibri', 'Arial', 'Segoe UI', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New', 'Comic Sans MS', 'Trebuchet MS'];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
const MARGINS = { normales: '2.5cm', etroites: '1.27cm', larges: '3.5cm' };
const STYLES = [['p', 'Normal'], ['h1', 'Titre 1'], ['h2', 'Titre 2'], ['h3', 'Titre 3'], ['blockquote', 'Citation'], ['pre', 'Code']];

function launch({ path = null } = {}) {
  const page = h('div', { class: 'wr-page', contenteditable: 'true', spellcheck: 'true' });
  const pageWrap = h('div', { class: 'wr-canvas' }, page);
  const status = h('div', { class: 'wr-status' });
  const zoomLabel = h('span', { class: 'wr-zoom-label', text: '100 %' });
  const findBar = h('div', { class: 'wr-find hidden' });
  const layout = { orientation: 'portrait', margin: 'normales', zoom: 1, pageColor: '#ffffff' };

  const win = createWindow({
    appId: 'writer', title: 'Traitement de texte', icon: '📘', width: 1000, height: 700, minWidth: 520, minHeight: 360,
  });

  const doc = docController({
    win, appName: 'Traitement de texte', icon: '📘', ext: 'wdoc', defaultName: 'Document1.wdoc',
    openFilter: ['wdoc', 'html', 'htm', 'txt', 'md'],
    serialize: () => JSON.stringify({
      format: 'winweb-doc', version: 1, layout, html: sanitizeHtml(page.innerHTML),
    }),
    load(content, p) {
      const ext = extname(p);
      if (ext === 'wdoc') {
        const data = JSON.parse(content || '{}');
        if (data.format !== 'winweb-doc') throw new Error('Ce fichier n\'est pas un document de traitement de texte');
        Object.assign(layout, data.layout || {});
        page.innerHTML = sanitizeHtml(data.html || '');
      } else if (ext === 'html' || ext === 'htm') {
        page.innerHTML = sanitizeHtml(content);
      } else {
        page.innerHTML = textToHtml(content);
      }
      if (!page.innerHTML.trim()) page.innerHTML = '<p><br></p>';
      applyLayout();
      updateStatus();
    },
    reset() {
      page.innerHTML = '<p><br></p>';
      Object.assign(layout, { orientation: 'portrait', margin: 'normales', pageColor: '#ffffff' });
      applyLayout();
      updateStatus();
    },
  });

  // ---------------------------------------------------------------- commandes
  const exec = (cmd, value = null) => {
    page.focus();
    document.execCommand(cmd, false, value);
    doc.touch();
    updateStatus();
    syncToolbar();
  };

  function applyLayout() {
    page.classList.toggle('landscape', layout.orientation === 'paysage');
    page.style.padding = MARGINS[layout.margin] || MARGINS.normales;
    page.style.background = layout.pageColor;
    page.style.transform = `scale(${layout.zoom})`;
    page.style.marginBottom = `${(layout.zoom - 1) * page.offsetHeight}px`;
    zoomLabel.textContent = `${Math.round(layout.zoom * 100)} %`;
  }

  function setZoom(z) {
    layout.zoom = Math.min(3, Math.max(0.3, Math.round(z * 10) / 10));
    applyLayout();
  }

  function setFontSize(pt) {
    // execCommand('fontSize') ne gère que 1..7 : on marque puis on remplace par un style en points.
    page.focus();
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('fontSize', false, '7');
    page.querySelectorAll('font[size="7"]').forEach((f) => {
      f.removeAttribute('size');
      f.style.fontSize = `${pt}pt`;
    });
    doc.touch();
  }

  function insertHtml(html) {
    page.focus();
    document.execCommand('insertHTML', false, sanitizeHtml(html));
    doc.touch();
    updateStatus();
  }

  async function insertTable() {
    const answer = await promptDialog('Dimensions du tableau (colonnes × lignes) :', '3 x 3', { title: 'Insérer un tableau', icon: '▦' });
    if (!answer) return;
    const [cols, rows] = answer.split(/[^0-9]+/).map(Number).filter(Boolean);
    const c = Math.min(20, cols || 3);
    const r = Math.min(100, rows || 3);
    const cell = '<td style="border: 1px solid #8a8a8a; padding: 4px 8px; min-width: 40px"><br></td>';
    const row = `<tr>${cell.repeat(c)}</tr>`;
    insertHtml(`<table style="border-collapse: collapse; width: 100%"><tbody>${row.repeat(r)}</tbody></table><p><br></p>`);
  }

  async function insertLink() {
    const sel = window.getSelection();
    const text = sel?.toString() || '';
    const url = await promptDialog('Adresse du lien (http://, https:// ou mailto:) :', 'https://', { title: 'Insérer un lien', icon: '🔗' });
    if (!url) return;
    const href = safeHref(url);
    if (!href) return;
    if (text) exec('createLink', href);
    else insertHtml(`<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`);
  }

  async function insertImage(source) {
    const range = saveRange();
    const src = source === 'vfs' ? await pickVfsImage() : await pickLocalImage();
    if (!src) return;
    restoreRange(range);
    insertHtml(`<img src="${escapeHtml(src)}" alt="" style="max-width: 100%">`);
  }

  function saveRange() {
    const sel = window.getSelection();
    return sel.rangeCount && page.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
  }
  function restoreRange(range) {
    page.focus();
    if (!range) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---------------------------------------------------------------- rechercher / remplacer
  const findInput = h('input', { class: 'input', placeholder: 'Rechercher', spellcheck: 'false' });
  const replInput = h('input', { class: 'input', placeholder: 'Remplacer par', spellcheck: 'false' });
  const caseBox = h('input', { type: 'checkbox' });
  const findInfo = h('span', { class: 'wr-find-info' });
  findBar.append(findInput, replInput, h('label', { class: 'wr-find-opt' }, caseBox, ' Respecter la casse'),
    h('button', { class: 'btn', type: 'button', text: 'Suivant', onclick: () => findNext() }),
    h('button', { class: 'btn', type: 'button', text: 'Remplacer', onclick: () => replaceOne() }),
    h('button', { class: 'btn', type: 'button', text: 'Tout remplacer', onclick: () => replaceAll() }),
    findInfo,
    h('button', { class: 'btn icon flat', type: 'button', text: '✕', title: 'Fermer', onclick: () => findBar.classList.add('hidden') }));

  function textNodes() {
    const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }
  const norm = (s) => (caseBox.checked ? s : s.toLowerCase());

  function findNext() {
    const needle = findInput.value;
    if (!needle) return false;
    const nodes = textNodes();
    const sel = window.getSelection();
    let startNode = null;
    let startOffset = 0;
    if (sel.rangeCount && page.contains(sel.focusNode)) {
      const r = sel.getRangeAt(0);
      startNode = r.endContainer;
      startOffset = r.endOffset;
    }
    let passed = !startNode || startNode.nodeType !== Node.TEXT_NODE;
    for (let round = 0; round < 2; round += 1) {
      for (const node of nodes) {
        let from = 0;
        if (!passed) {
          if (node !== startNode) continue;
          passed = true;
          from = startOffset;
        }
        const idx = norm(node.nodeValue).indexOf(norm(needle), from);
        if (idx >= 0) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + needle.length);
          sel.removeAllRanges();
          sel.addRange(range);
          node.parentElement?.scrollIntoView({ block: 'center' });
          findInfo.textContent = '';
          return true;
        }
      }
      passed = true;
    }
    findInfo.textContent = 'Introuvable';
    return false;
  }

  function replaceOne() {
    const sel = window.getSelection();
    if (sel.rangeCount && norm(sel.toString()) === norm(findInput.value) && findInput.value) {
      page.focus();
      document.execCommand('insertText', false, replInput.value);
      doc.touch();
    }
    findNext();
  }

  function replaceAll() {
    const needle = findInput.value;
    if (!needle) return;
    let count = 0;
    for (const node of textNodes()) {
      const src = node.nodeValue;
      const hay = norm(src);
      const n = norm(needle);
      let out = '';
      let i = 0;
      let idx;
      while ((idx = hay.indexOf(n, i)) >= 0) {
        out += src.slice(i, idx) + replInput.value;
        i = idx + needle.length;
        count += 1;
      }
      if (i) node.nodeValue = out + src.slice(i);
    }
    findInfo.textContent = `${count} remplacement(s)`;
    if (count) doc.touch();
    updateStatus();
  }

  function showFind() {
    findBar.classList.remove('hidden');
    const sel = window.getSelection()?.toString();
    if (sel && sel.length < 80) findInput.value = sel;
    findInput.focus();
    findInput.select();
  }

  // ---------------------------------------------------------------- ruban
  const fontSel = rbSelect(FONTS.map((f) => [f]), 'Police', (v) => exec('fontName', v), { width: 130 });
  const sizeSel = rbSelect(SIZES.map((s) => [String(s)]), 'Taille', (v) => setFontSize(v), { width: 58 });
  sizeSel.value = '11';
  const styleSel = rbSelect(STYLES, 'Style de paragraphe', (v) => exec('formatBlock', v), { width: 110 });
  const toggles = {};
  const tgl = (cmd, label, title) => {
    toggles[cmd] = rbBtn(label, title, () => exec(cmd));
    return toggles[cmd];
  };

  const fileMenu = () => [
    { label: 'Nouveau', hint: 'Ctrl+N', icon: '📄', action: doc.newDoc },
    { label: 'Nouvelle fenêtre', action: () => launch() },
    { label: 'Ouvrir…', hint: 'Ctrl+O', icon: '📂', action: doc.open },
    { label: 'Enregistrer', hint: 'Ctrl+S', icon: '💾', action: doc.save },
    { label: 'Enregistrer sous…', hint: 'Ctrl+Maj+S', action: doc.saveAs },
    { separator: true },
    { label: 'Exporter en HTML…', icon: '🌐', action: () => doc.exportAs('html', exportHtml) },
    { label: 'Exporter en texte brut…', icon: '📝', action: () => doc.exportAs('txt', () => page.innerText) },
    { label: 'Imprimer…', hint: 'Ctrl+P', icon: '🖨️', action: print },
    { separator: true },
    { label: 'Fermer', action: () => win.close() },
  ];

  const rb = ribbon([
    {
      label: 'Accueil',
      groups: [
        {
          label: 'Presse-papiers',
          items: [
            rbBtn('↶', 'Annuler (Ctrl+Z)', () => exec('undo')),
            rbBtn('↷', 'Rétablir (Ctrl+Y)', () => exec('redo')),
            rbBtn('✂️', 'Couper (Ctrl+X)', () => exec('cut')),
            rbBtn('📄', 'Copier (Ctrl+C)', () => exec('copy')),
          ],
        },
        {
          label: 'Police',
          items: [
            h('div', { class: 'rb-row' }, fontSel, sizeSel),
            h('div', { class: 'rb-row' },
              tgl('bold', '<b>G</b>', 'Gras (Ctrl+B)'), tgl('italic', '<i>I</i>', 'Italique (Ctrl+I)'),
              tgl('underline', '<u>S</u>', 'Souligné (Ctrl+U)'), tgl('strikeThrough', '<s>ab</s>', 'Barré'),
              rbBtn('x<sub>2</sub>', 'Indice', () => exec('subscript')), rbBtn('x<sup>2</sup>', 'Exposant', () => exec('superscript')),
              rbColor('A', 'Couleur du texte', '#c00000', (c) => exec('foreColor', c)),
              rbColor('🖍', 'Surlignage', '#ffff00', (c) => exec('hiliteColor', c)),
              rbBtn('🧹', 'Effacer la mise en forme', () => exec('removeFormat'))),
          ],
        },
        {
          label: 'Paragraphe',
          items: [
            h('div', { class: 'rb-row' },
              rbBtn('• ≡', 'Liste à puces', () => exec('insertUnorderedList')),
              rbBtn('1. ≡', 'Liste numérotée', () => exec('insertOrderedList')),
              rbBtn('⇤', 'Diminuer le retrait', () => exec('outdent')),
              rbBtn('⇥', 'Augmenter le retrait', () => exec('indent'))),
            h('div', { class: 'rb-row' },
              tgl('justifyLeft', '⯇≡', 'Aligner à gauche'), tgl('justifyCenter', '≡', 'Centrer'),
              tgl('justifyRight', '≡⯈', 'Aligner à droite'), tgl('justifyFull', '☰', 'Justifier')),
          ],
        },
        { label: 'Styles', items: [styleSel] },
        {
          label: 'Édition',
          items: [rbBtn('🔍 Rechercher', 'Rechercher et remplacer (Ctrl+F / Ctrl+H)', showFind)],
        },
      ],
    },
    {
      label: 'Insertion',
      groups: [
        { label: 'Tableaux', items: [rbBtn('▦<br>Tableau', 'Insérer un tableau', insertTable, { big: true })] },
        {
          label: 'Illustrations',
          items: [
            rbBtn('🖼️<br>Image', 'Image du dossier Images (WinWeb)', () => insertImage('vfs'), { big: true }),
            rbBtn('💻<br>Depuis l\'ordinateur', 'Image de votre ordinateur', () => insertImage('local'), { big: true }),
          ],
        },
        {
          label: 'Éléments',
          items: [
            rbBtn('🔗 Lien', 'Insérer un lien', insertLink),
            rbBtn('― Ligne', 'Ligne horizontale', () => exec('insertHorizontalRule')),
            rbBtn('⤓ Saut de page', 'Saut de page', () => insertHtml('<hr class="wo-page-break"><p><br></p>')),
            rbBtn('📅 Date', 'Insérer la date', () => insertHtml(escapeHtml(new Date().toLocaleDateString('fr-FR', { dateStyle: 'long' })))),
            rbBtn('Ω Symbole', 'Insérer un caractère spécial', async () => {
              const range = saveRange();
              const ch = await promptDialog('Caractère(s) à insérer :', '© ® ™ € £ ± × ÷ ≤ ≥ → ✓ « »', { title: 'Symbole', icon: 'Ω' });
              if (!ch) return;
              restoreRange(range);
              exec('insertText', ch);
            }),
          ],
        },
      ],
    },
    {
      label: 'Mise en page',
      groups: [
        {
          label: 'Orientation',
          items: [rbSelect([['portrait', 'Portrait'], ['paysage', 'Paysage']], 'Orientation', (v) => { layout.orientation = v; applyLayout(); doc.touch(); })],
        },
        {
          label: 'Marges',
          items: [rbSelect([['normales', 'Normales'], ['etroites', 'Étroites'], ['larges', 'Larges']], 'Marges', (v) => { layout.margin = v; applyLayout(); doc.touch(); })],
        },
        {
          label: 'Arrière-plan',
          items: [rbColor('🎨 Couleur de page', 'Couleur de la page', '#ffffff', (c) => { layout.pageColor = c; applyLayout(); doc.touch(); })],
        },
      ],
    },
    {
      label: 'Affichage',
      groups: [
        {
          label: 'Zoom',
          items: [
            rbBtn('➖', 'Zoom arrière', () => setZoom(layout.zoom - 0.1)),
            rbBtn('100 %', 'Taille réelle', () => setZoom(1)),
            rbBtn('➕', 'Zoom avant', () => setZoom(layout.zoom + 0.1)),
          ],
        },
        {
          label: 'Statistiques',
          items: [rbBtn('🔢 Compter les mots', 'Statistiques', () => {
            const s = stats();
            alertDialog(`Mots : ${s.words}\nCaractères (espaces compris) : ${s.chars}\nParagraphes : ${s.paras}`,
              { title: 'Statistiques', icon: '🔢' });
          })],
        },
      ],
    },
  ], { fileMenu, showMenu });

  function stats() {
    const text = page.innerText || '';
    return {
      words: (text.match(/[\p{L}\p{N}'’-]+/gu) || []).length,
      chars: text.replace(/\n/g, '').length,
      paras: page.querySelectorAll('p, h1, h2, h3, h4, li, blockquote, pre').length,
    };
  }

  function updateStatus() {
    const s = stats();
    const pageH = layout.orientation === 'paysage' ? 794 : 1123;
    const pages = Math.max(1, Math.ceil(page.scrollHeight / pageH));
    status.replaceChildren(
      h('span', { text: `Page(s) : ${pages}` }), h('span', { text: `${s.words} mots` }),
      h('span', { text: `${s.chars} caractères` }), h('span', { text: 'Français (France)' }),
      h('span', { class: 'wr-spacer' }),
      h('button', { class: 'wr-zbtn', type: 'button', text: '−', onclick: () => setZoom(layout.zoom - 0.1) }),
      zoomLabel,
      h('button', { class: 'wr-zbtn', type: 'button', text: '+', onclick: () => setZoom(layout.zoom + 0.1) }),
    );
  }

  function syncToolbar() {
    for (const [cmd, btn] of Object.entries(toggles)) {
      let on = false;
      try { on = document.queryCommandState(cmd); } catch { on = false; }
      btn.classList.toggle('on', on);
    }
    try {
      const block = String(document.queryCommandValue('formatBlock') || 'p').toLowerCase().replace(/[<>]/g, '');
      styleSel.value = STYLES.some(([v]) => v === block) ? block : 'p';
      const font = String(document.queryCommandValue('fontName') || '').replace(/["']/g, '').split(',')[0].trim();
      if (FONTS.includes(font)) fontSel.value = font;
    } catch { /* sélection hors éditeur */ }
  }

  function exportHtml() {
    return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(doc.state.name)}</title>
<style>body{font:11pt Calibri,Carlito,"Segoe UI",Arial,sans-serif;max-width:21cm;margin:2cm auto;padding:0 1cm;line-height:1.35}
img{max-width:100%}table{border-collapse:collapse}.wo-page-break{border:0;page-break-after:always}</style></head>
<body>${sanitizeHtml(page.innerHTML)}</body></html>`;
  }

  function print() {
    printHtml(doc.state.name, sanitizeHtml(page.innerHTML), `@page{margin:${MARGINS[layout.margin]}}`);
  }

  // ---------------------------------------------------------------- événements
  page.addEventListener('input', () => { doc.touch(); updateStatus(); });
  page.addEventListener('paste', (e) => { handleRichPaste(e); doc.touch(); setTimeout(updateStatus); });
  page.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); });
  page.addEventListener('dragover', (e) => e.stopPropagation());
  page.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (a && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const href = safeHref(a.getAttribute('href'));
      if (href && /^https?:/i.test(href)) launchApp('browser', { url: href });
    }
  });
  document.addEventListener('selectionchange', onSelection);
  function onSelection() {
    const sel = window.getSelection();
    if (sel.rangeCount && page.contains(sel.anchorNode)) syncToolbar();
  }
  win.onDestroy = () => document.removeEventListener('selectionchange', onSelection);

  win.body.addEventListener('keydown', (e) => {
    if (fileShortcuts(e, doc)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && (key === 'f' || key === 'h')) { e.preventDefault(); showFind(); }
    else if (ctrl && key === 'p') { e.preventDefault(); print(); }
    else if (ctrl && key === 'e') { e.preventDefault(); exec('justifyCenter'); }
    else if (ctrl && key === 'l') { e.preventDefault(); exec('justifyLeft'); }
    else if (ctrl && key === 'r') { e.preventDefault(); exec('justifyRight'); }
    else if (ctrl && key === 'j') { e.preventDefault(); exec('justifyFull'); }
    else if (e.key === 'Escape' && !findBar.classList.contains('hidden')) findBar.classList.add('hidden');
    else if (e.key === 'Enter' && e.target === findInput) { e.preventDefault(); findNext(); }
    else if (e.key === 'Tab' && e.target === page) {
      e.preventDefault();
      const inList = window.getSelection().anchorNode?.parentElement?.closest('li');
      if (inList) exec(e.shiftKey ? 'outdent' : 'indent');
      else exec('insertText', '\t');
    }
  });

  win.body.append(h('div', { class: 'office-app writer' }, rb, findBar, pageWrap, status));
  document.execCommand('defaultParagraphSeparator', false, 'p');
  page.innerHTML = '<p><br></p>';
  applyLayout();
  updateStatus();
  if (path) doc.load(path);
  setTimeout(() => page.focus(), 60);
  return win;
}

export default {
  id: 'writer', name: 'Traitement de texte', icon: '📘', launch, description: 'Rédiger des documents (.wdoc)',
};
