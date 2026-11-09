// Notes (format .wnote) : bloc-notes à la OneNote — sections colorées, pages,
// texte riche, listes de tâches, recherche, enregistrement automatique.
import { api } from '../../api.js';
import { fsChanged } from '../../bus.js';
import { showMenu } from '../../contextMenu.js';
import { confirmDialog, fileDialog, promptDialog } from '../../dialogs.js';
import { toastError } from '../../notify.js';
import {
  basename, debounce, dirname, escapeHtml, extname, h,
} from '../../utils.js';
import { createWindow } from '../../windowManager.js';
import {
  pickLocalImage, pickVfsImage, rbBtn, rbColor,
} from './common.js';
import { handleRichPaste, sanitizeHtml } from './sanitize.js';

const DEFAULT_PATH = '/Documents/Mes notes.wnote';
const COLORS = ['#7719aa', '#0078d4', '#107c41', '#c43e1c', '#ca5010', '#038387', '#8764b8', '#b4009e'];
let uid = 0;
const newId = () => `n${Date.now().toString(36)}${(uid++).toString(36)}`;
const now = () => Date.now();

function newPage(title = 'Page sans titre', html = '<p><br></p>') {
  return { id: newId(), title, html, created: now(), modified: now() };
}
function newSection(name, color) {
  return { id: newId(), name, color, pages: [newPage()] };
}
function defaultBook() {
  const welcome = newPage('Bienvenue dans Notes', `<h2>Bienvenue 👋</h2>
<p>Organisez vos idées en <b>sections</b> (onglets à gauche) et en <b>pages</b>.</p>
<ul class="wo-todo"><li data-done="1">Créer une section</li><li>Ajouter une page</li><li>Cocher une tâche d'un clic</li></ul>
<p>Tout est enregistré automatiquement dans <i>Documents\\Mes notes.wnote</i>.</p>`);
  return {
    sections: [
      { id: newId(), name: 'Notes rapides', color: COLORS[0], pages: [welcome] },
      newSection('Personnel', COLORS[1]),
      newSection('Travail', COLORS[2]),
    ],
  };
}

function launch({ path = null } = {}) {
  let book = defaultBook();
  let filePath = path || DEFAULT_PATH;
  let secId = book.sections[0].id;
  let pageId = book.sections[0].pages[0].id;
  let query = '';
  let saveState = 'saved';

  const sectionsEl = h('div', { class: 'nt-sections' });
  const pagesEl = h('div', { class: 'nt-pages' });
  const titleInput = h('input', { class: 'nt-title', placeholder: 'Titre de la page', spellcheck: 'true' });
  const dateEl = h('div', { class: 'nt-date' });
  const editor = h('div', { class: 'nt-editor', contenteditable: 'true', spellcheck: 'true' });
  const search = h('input', { class: 'nt-search', type: 'search', placeholder: '🔍 Rechercher dans les notes' });
  const saveInfo = h('span', { class: 'nt-save' });
  const bookName = h('span', { class: 'nt-book' });

  const win = createWindow({
    appId: 'notes', title: 'Notes', icon: '📓', width: 1000, height: 660, minWidth: 560, minHeight: 360,
  });

  const section = () => book.sections.find((s) => s.id === secId) || book.sections[0];
  const page = () => section()?.pages.find((p) => p.id === pageId) || null;

  // ---------------------------------------------------------------- fichier
  async function load(p) {
    try {
      const data = await api.read(p);
      const parsed = JSON.parse(data.content || '{}');
      if (parsed.format !== 'winweb-notes' || !Array.isArray(parsed.sections)) throw new Error('Ce fichier n\'est pas un bloc-notes valide');
      book = {
        sections: parsed.sections.map((s, i) => ({
          id: s.id || newId(), name: String(s.name || 'Section'), color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : COLORS[i % COLORS.length],
          pages: (Array.isArray(s.pages) ? s.pages : []).map((pg) => ({
            id: pg.id || newId(), title: String(pg.title || ''), html: sanitizeHtml(pg.html || ''),
            created: Number(pg.created) || now(), modified: Number(pg.modified) || now(),
          })),
        })),
      };
      if (!book.sections.length) book = defaultBook();
      filePath = data.path;
    } catch (err) {
      if (p !== DEFAULT_PATH || !/introuvable|existe pas|not found/i.test(err.message)) toastError(err.message, 'Notes');
      book = defaultBook();
      filePath = p;
      saveState = 'new';
      await save();
    }
    secId = book.sections[0].id;
    pageId = book.sections[0].pages[0]?.id || null;
    renderAll();
  }

  function serialize() {
    flush();
    return JSON.stringify({
      format: 'winweb-notes', version: 1,
      sections: book.sections.map((s) => ({ ...s, pages: s.pages.map((pg) => ({ ...pg, html: sanitizeHtml(pg.html) })) })),
    });
  }

  async function save() {
    try {
      saveInfo.textContent = 'Enregistrement…';
      const entry = await api.write(filePath, serialize());
      const first = saveState === 'new';
      saveState = 'saved';
      saveInfo.textContent = `✔ Enregistré à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
      if (first) fsChanged([dirname(entry.path)]);
      return true;
    } catch (err) {
      saveState = 'error';
      saveInfo.textContent = '⚠ Échec de l\'enregistrement';
      toastError(err.message, 'Notes');
      return false;
    }
  }
  const autosave = debounce(save, 800);
  function touched() {
    saveState = saveState === 'new' ? 'new' : 'dirty';
    saveInfo.textContent = 'Modifications…';
    autosave();
  }

  /** Recopie le contenu de l'éditeur dans le modèle. */
  function flush() {
    const pg = page();
    if (!pg) return;
    if (pg.html !== editor.innerHTML || pg.title !== titleInput.value) {
      pg.html = editor.innerHTML;
      pg.title = titleInput.value;
      pg.modified = now();
    }
  }

  // ---------------------------------------------------------------- rendu
  function renderSections() {
    sectionsEl.replaceChildren(...book.sections.map((s) => h('button', {
      class: `nt-sec${s.id === secId ? ' active' : ''}`, type: 'button', dataset: { color: s.color },
      onclick: () => { flush(); secId = s.id; pageId = s.pages[0]?.id || null; query = ''; search.value = ''; renderAll(); },
      ondblclick: () => renameSection(s),
      oncontextmenu: (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, [
          { label: 'Renommer…', icon: '✏️', action: () => renameSection(s) },
          { label: 'Couleur', icon: '🎨', submenu: COLORS.map((c) => ({ label: c, icon: `<span class="nt-dot" style="background:${c}"></span>`, action: () => { s.color = c; renderSections(); touched(); } })) },
          { separator: true },
          { label: 'Supprimer la section', icon: '🗑️', disabled: book.sections.length < 2, action: () => deleteSection(s) },
        ]);
      },
    }, h('span', { class: 'nt-sec-bar' }), h('span', { class: 'nt-sec-name', text: s.name }), h('span', { class: 'nt-sec-count', text: String(s.pages.length) }))),
    h('button', { class: 'nt-add', type: 'button', text: '+ Section', onclick: addSection }));
    sectionsEl.querySelectorAll('.nt-sec').forEach((b) => b.style.setProperty('--sec', b.dataset.color));
  }

  function pageMatches(pg) {
    if (!query) return true;
    const text = `${pg.title} ${pg.html.replace(/<[^>]+>/g, ' ')}`.toLowerCase();
    return text.includes(query);
  }

  function renderPages() {
    let items;
    if (query) {
      items = book.sections.flatMap((s) => s.pages.filter(pageMatches).map((pg) => ({ s, pg })));
    } else {
      items = section().pages.map((pg) => ({ s: section(), pg }));
    }
    pagesEl.replaceChildren(...[
      query ? h('div', { class: 'nt-pages-title', text: `${items.length} résultat(s)` }) : null,
      ...items.map(({ s, pg }) => {
        const snippet = pg.html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, '').replace(/\s+/g, ' ').trim().slice(0, 70);
        return h('button', {
          class: `nt-page${pg.id === pageId ? ' active' : ''}`, type: 'button',
          onclick: () => { flush(); secId = s.id; pageId = pg.id; renderAll(); },
          oncontextmenu: (e) => {
            e.preventDefault();
            showMenu(e.clientX, e.clientY, [
              { label: 'Dupliquer', icon: '⧉', action: () => duplicatePage(s, pg) },
              { label: 'Déplacer vers', icon: '📁', submenu: book.sections.filter((x) => x !== s).map((x) => ({ label: x.name, action: () => movePage(s, pg, x) })) },
              { separator: true },
              { label: 'Supprimer la page', icon: '🗑️', action: () => deletePage(s, pg) },
            ]);
          },
        }, h('span', { class: 'nt-page-title', text: pg.title || 'Page sans titre' }),
        h('span', { class: 'nt-page-snip', text: query ? `${s.name} · ${snippet}` : snippet || ' ' }));
      }),
      query ? null : h('button', { class: 'nt-add', type: 'button', text: '+ Page', onclick: addPage }),
    ].filter(Boolean));
  }

  function renderEditor() {
    const pg = page();
    const empty = !pg;
    titleInput.disabled = empty;
    editor.contentEditable = empty ? 'false' : 'true';
    titleInput.value = pg?.title || '';
    editor.innerHTML = pg ? sanitizeHtml(pg.html) : '<p class="wo-muted">Aucune page dans cette section.</p>';
    dateEl.textContent = pg ? new Date(pg.modified).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' }) : '';
  }

  function renderAll() {
    renderSections();
    renderPages();
    renderEditor();
    bookName.textContent = basename(filePath).replace(/\.wnote$/, '');
    win.setTitle(`${bookName.textContent} - Notes`);
    const sec = section();
    win.body.querySelector('.notes')?.style.setProperty('--sec', sec?.color || COLORS[0]);
  }

  // ---------------------------------------------------------------- actions
  async function addSection() {
    const name = await promptDialog('Nom de la nouvelle section :', 'Nouvelle section', { title: 'Notes', icon: '📓' });
    if (!name?.trim()) return;
    flush();
    const s = newSection(name.trim().slice(0, 60), COLORS[book.sections.length % COLORS.length]);
    book.sections.push(s);
    secId = s.id;
    pageId = s.pages[0].id;
    renderAll();
    touched();
  }
  async function renameSection(s) {
    const name = await promptDialog('Nom de la section :', s.name, { title: 'Renommer', icon: '✏️' });
    if (!name?.trim()) return;
    s.name = name.trim().slice(0, 60);
    renderSections();
    touched();
  }
  async function deleteSection(s) {
    if (book.sections.length < 2) return;
    if (!(await confirmDialog(`Supprimer la section « ${s.name} » et ses ${s.pages.length} page(s) ?`, { title: 'Notes', icon: '🗑️', danger: true }))) return;
    book.sections = book.sections.filter((x) => x !== s);
    secId = book.sections[0].id;
    pageId = book.sections[0].pages[0]?.id || null;
    renderAll();
    touched();
  }
  function addPage() {
    flush();
    const pg = newPage('');
    section().pages.unshift(pg);
    pageId = pg.id;
    renderAll();
    titleInput.focus();
    touched();
  }
  function duplicatePage(s, pg) {
    flush();
    const copy = { ...pg, id: newId(), title: `${pg.title} (copie)`, created: now(), modified: now() };
    s.pages.splice(s.pages.indexOf(pg) + 1, 0, copy);
    renderPages();
    touched();
  }
  function movePage(from, pg, to) {
    flush();
    from.pages = from.pages.filter((x) => x !== pg);
    to.pages.unshift(pg);
    secId = to.id;
    pageId = pg.id;
    renderAll();
    touched();
  }
  async function deletePage(s, pg) {
    if (!(await confirmDialog(`Supprimer la page « ${pg.title || 'Page sans titre'} » ?`, { title: 'Notes', icon: '🗑️', danger: true }))) return;
    s.pages = s.pages.filter((x) => x !== pg);
    if (pageId === pg.id) pageId = section().pages[0]?.id || null;
    renderAll();
    touched();
  }

  const exec = (cmd, value = null) => {
    editor.focus();
    document.execCommand(cmd, false, value);
    flush();
    touched();
  };
  function insertTodo() {
    exec('insertUnorderedList');
    const sel = window.getSelection();
    const ul = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest('ul');
    if (ul && editor.contains(ul)) ul.classList.add('wo-todo');
    flush();
  }
  async function insertImage(source) {
    const sel = window.getSelection();
    const range = sel.rangeCount && editor.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    const src = source === 'vfs' ? await pickVfsImage() : await pickLocalImage();
    if (!src) return;
    editor.focus();
    if (range) { sel.removeAllRanges(); sel.addRange(range); }
    exec('insertHTML', sanitizeHtml(`<img src="${escapeHtml(src)}" alt="" style="max-width: 100%">`));
  }

  async function openOther() {
    const target = await fileDialog({ mode: 'open', title: 'Ouvrir un bloc-notes', startDir: dirname(filePath), filter: ['wnote'] });
    if (!target || extname(target) !== 'wnote') return;
    flush();
    if (saveState !== 'saved') await save();
    load(target);
  }
  async function newBook() {
    const target = await fileDialog({ mode: 'save', title: 'Nouveau bloc-notes', startDir: dirname(filePath), defaultName: 'Bloc-notes.wnote' });
    if (!target) return;
    flush();
    if (saveState !== 'saved') await save();
    filePath = extname(target) === 'wnote' ? target : `${target}.wnote`;
    book = defaultBook();
    secId = book.sections[0].id;
    pageId = book.sections[0].pages[0].id;
    saveState = 'new';
    await save();
    renderAll();
  }

  // ---------------------------------------------------------------- événements
  editor.addEventListener('input', () => { flush(); touched(); });
  editor.addEventListener('paste', (e) => { handleRichPaste(e); setTimeout(() => { flush(); touched(); }); });
  editor.addEventListener('click', (e) => {
    // Case à cocher d'une liste de tâches : clic sur la case dessinée à gauche de l'élément.
    const li = e.target.closest('ul.wo-todo > li');
    if (!li) return;
    const r = li.getBoundingClientRect();
    if (e.clientX < r.left + 24) {
      if (li.dataset.done) delete li.dataset.done; else li.dataset.done = '1';
      flush();
      touched();
    }
  });
  titleInput.addEventListener('input', () => {
    flush();
    touched();
    const btn = pagesEl.querySelector('.nt-page.active .nt-page-title');
    if (btn) btn.textContent = titleInput.value || 'Page sans titre';
  });
  titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); editor.focus(); } });
  search.addEventListener('input', debounce(() => { flush(); query = search.value.trim().toLowerCase(); renderPages(); }, 150));

  win.body.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && key === 's') { e.preventDefault(); save(); }
    else if (ctrl && key === 'n') { e.preventDefault(); addPage(); }
    else if (ctrl && key === 'e') { e.preventDefault(); search.focus(); }
    else if (ctrl && key === '1') { e.preventDefault(); insertTodo(); }
  });

  win.onClose = async () => {
    flush();
    if (saveState !== 'saved') await save();
    return true;
  };

  const toolbar = h('div', { class: 'nt-toolbar' },
    rbBtn('<b>G</b>', 'Gras (Ctrl+B)', () => exec('bold')), rbBtn('<i>I</i>', 'Italique (Ctrl+I)', () => exec('italic')),
    rbBtn('<u>S</u>', 'Souligné (Ctrl+U)', () => exec('underline')), rbBtn('<s>ab</s>', 'Barré', () => exec('strikeThrough')),
    rbColor('🖍', 'Surligner', '#fff100', (c) => exec('hiliteColor', c)),
    rbColor('A', 'Couleur du texte', '#c00000', (c) => exec('foreColor', c)),
    h('span', { class: 'rb-sep' }),
    rbBtn('H1', 'Titre', () => exec('formatBlock', 'h2')), rbBtn('H2', 'Sous-titre', () => exec('formatBlock', 'h3')), rbBtn('¶', 'Texte normal', () => exec('formatBlock', 'p')),
    rbBtn('• ≡', 'Liste à puces', () => exec('insertUnorderedList')), rbBtn('1. ≡', 'Liste numérotée', () => exec('insertOrderedList')),
    rbBtn('☑ Tâches', 'Liste de tâches (Ctrl+1) — cliquez sur la case pour cocher', insertTodo),
    h('span', { class: 'rb-sep' }),
    rbBtn('🖼️', 'Image du dossier Images', () => insertImage('vfs')), rbBtn('💻', 'Image de l\'ordinateur', () => insertImage('local')),
    rbBtn('📅', 'Insérer la date et l\'heure', () => exec('insertText', new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }))),
    rbBtn('―', 'Ligne', () => exec('insertHorizontalRule')),
    h('span', { class: 'nt-spacer' }), saveInfo);

  const header = h('div', { class: 'nt-header' },
    h('button', {
      class: 'nt-book-btn', type: 'button', title: 'Blocs-notes',
      onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        showMenu(r.left, r.bottom + 2, [
          { label: 'Nouveau bloc-notes…', icon: '📓', action: newBook },
          { label: 'Ouvrir un bloc-notes…', icon: '📂', action: openOther },
          { label: 'Enregistrer maintenant', hint: 'Ctrl+S', icon: '💾', action: save },
          { separator: true },
          { label: 'Nouvelle fenêtre', action: () => launch() },
        ]);
      },
    }, '📓 ', bookName, ' ▾'), search);

  win.body.append(h('div', { class: 'office-app notes' }, header,
    h('div', { class: 'nt-main' },
      h('div', { class: 'nt-col-sections' }, sectionsEl),
      h('div', { class: 'nt-col-pages' }, pagesEl),
      h('div', { class: 'nt-col-editor' }, toolbar, h('div', { class: 'nt-paper' }, titleInput, dateEl, editor)))));

  renderAll();
  load(filePath);
  return win;
}

export default {
  id: 'notes', name: 'Notes', icon: '📓', launch, description: 'Bloc-notes numérique : sections, pages, tâches',
};
