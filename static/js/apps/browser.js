// Navigateur web : onglets, barre d'adresse/recherche, historique, favoris,
// page d'accueil, zoom, téléchargements vers le VFS.
// Les sites sont affichés via le mandataire du serveur (/web?url=...) dans une
// iframe sandbox SANS allow-same-origin (origine opaque : aucun accès à WinWeb).
// Le mode « Direct » charge le site tel quel (beaucoup de sites le refusent).
import { api } from '../api.js';
import { fsChanged } from '../bus.js';
import { showMenu } from '../contextMenu.js';
import { promptDialog } from '../dialogs.js';
import { toast, toastError } from '../notify.js';
import {
  basename, debounce, h, normPath, rawUrl, toWinPath,
} from '../utils.js';
import { createWindow } from '../windowManager.js';

const KEY = 'winweb.browser';
const HOME = 'about:accueil';
const ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://html.duckduckgo.com/html/?q=' },
  wikipedia: { name: 'Wikipédia', url: 'https://fr.wikipedia.org/w/index.php?search=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  google: { name: 'Google', url: 'https://www.google.com/search?hl=fr&q=' },
};
const DEFAULT_BOOKMARKS = [
  { title: 'Wikipédia', url: 'https://fr.wikipedia.org/' },
  { title: 'DuckDuckGo', url: 'https://html.duckduckgo.com/html/' },
  { title: 'Hacker News', url: 'https://news.ycombinator.com/' },
  { title: 'Projet Gutenberg', url: 'https://www.gutenberg.org/' },
  { title: 'Example.com', url: 'https://example.com/' },
];

function loadStore() {
  const defaults = { bookmarks: DEFAULT_BOOKMARKS, history: [], engine: 'duckduckgo', showBar: true, direct: false };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return defaults;
  }
}
let store = loadStore();
const persist = debounce(() => {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* stockage indisponible */ }
}, 300);

let proxyAvailable = null;
async function checkProxy() {
  if (proxyAvailable !== null) return proxyAvailable;
  try {
    const info = await api.system();
    proxyAvailable = info.web_proxy !== false;
  } catch {
    proxyAvailable = false;
  }
  return proxyAvailable;
}

/** Saisie de la barre d'adresse -> { kind: 'about'|'file'|'web', target } */
export function resolveInput(input, engine = store.engine) {
  const text = String(input || '').trim();
  if (!text) return { kind: 'about', target: HOME };
  if (/^about:/i.test(text)) return { kind: 'about', target: text.toLowerCase() };
  if (/^[a-z]:\\/i.test(text)) return { kind: 'file', target: normPath(text.slice(2).replace(/\\/g, '/')) };
  if (/^file:\/\//i.test(text)) return { kind: 'file', target: normPath(decodeURIComponent(text.replace(/^file:\/\/(\/?[a-z]:)?/i, ''))) };
  if (text.startsWith('/')) return { kind: 'file', target: normPath(text) };
  if (/^https?:\/\//i.test(text)) return { kind: 'web', target: unwrapRedirect(text) };
  if (/^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?(\/\S*)?$/i.test(text) && !/\s/.test(text) && /\.[a-z]{2,}(?=$|[:/?#])/i.test(text)) {
    return { kind: 'web', target: `https://${text}` };
  }
  return { kind: 'web', target: (ENGINES[engine] || ENGINES.duckduckgo).url + encodeURIComponent(text), search: text };
}

/** Liens de redirection des moteurs de recherche -> adresse de destination. */
export function unwrapRedirect(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    let target = null;
    if (/(^|\.)duckduckgo\.com$/.test(host) && u.pathname.startsWith('/l/')) target = u.searchParams.get('uddg');
    else if (/^google\.[a-z.]+$/.test(host) && u.pathname === '/url') target = u.searchParams.get('q') || u.searchParams.get('url');
    return target && /^https?:\/\//i.test(target) ? target : url;
  } catch {
    return url;
  }
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function launch({ url = null, path = null } = {}) {
  const tabs = [];
  let active = null;

  const tabBar = h('div', { class: 'br-tabs' });
  const address = h('input', { class: 'br-address', spellcheck: 'false', placeholder: 'Rechercher ou saisir une adresse web' });
  const lock = h('span', { class: 'br-lock', text: '🔍' });
  const star = h('button', { class: 'br-btn br-star', type: 'button', title: 'Ajouter aux favoris (Ctrl+D)', text: '☆' });
  const back = h('button', { class: 'br-btn', type: 'button', title: 'Précédente (Alt+←)', text: '←' });
  const fwd = h('button', { class: 'br-btn', type: 'button', title: 'Suivante (Alt+→)', text: '→' });
  const reload = h('button', { class: 'br-btn', type: 'button', title: 'Actualiser (F5)', text: '⟳' });
  const home = h('button', { class: 'br-btn', type: 'button', title: 'Accueil', text: '⌂' });
  const modeBtn = h('button', { class: 'br-mode', type: 'button' });
  const menuBtn = h('button', { class: 'br-btn', type: 'button', title: 'Paramètres et plus', text: '⋯' });
  const bookmarkBar = h('div', { class: 'br-bookmarks' });
  const views = h('div', { class: 'br-views' });

  const win = createWindow({
    appId: 'browser', title: 'Navigateur', icon: '🌐', width: 1100, height: 720, minWidth: 420, minHeight: 300,
  });

  // ---------------------------------------------------------------- onglets
  function newTab(target = HOME, { activate: act = true } = {}) {
    const view = h('div', { class: 'br-view hidden' });
    const tab = {
      id: Math.random().toString(36).slice(2), view, frame: null, history: [], index: -1, title: 'Nouvel onglet',
      url: HOME, loading: false, zoom: 1, direct: store.direct,
    };
    views.append(view);
    tabs.push(tab);
    if (act) activate(tab);
    navigate(tab, target);
    return tab;
  }

  function activate(tab) {
    active = tab;
    for (const t of tabs) t.view.classList.toggle('hidden', t !== tab);
    renderTabs();
    updateChrome();
  }

  function closeTab(tab) {
    const idx = tabs.indexOf(tab);
    if (idx < 0) return;
    tabs.splice(idx, 1);
    tab.view.remove();
    if (!tabs.length) { win.close(); return; }
    if (active === tab) activate(tabs[Math.min(idx, tabs.length - 1)]);
    else renderTabs();
  }

  function renderTabs() {
    tabBar.replaceChildren(...tabs.map((tab) => h('div', {
      class: `br-tab${tab === active ? ' active' : ''}`, title: `${tab.title}\n${tab.url}`,
      onclick: () => activate(tab),
      onmousedown: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab); } },
    }, h('span', { class: `br-tab-ico${tab.loading ? ' spin' : ''}`, text: tab.loading ? '◌' : tab.url.startsWith('about:') ? '🏠' : tab.url.startsWith('file:') ? '📄' : '🌐' }),
    h('span', { class: 'br-tab-title', text: tab.title || tab.url }),
    h('button', { class: 'br-tab-x', type: 'button', text: '✕', title: 'Fermer l\'onglet (Ctrl+W)', onclick: (e) => { e.stopPropagation(); closeTab(tab); } }))),
    h('button', { class: 'br-tab-new', type: 'button', text: '+', title: 'Nouvel onglet (Ctrl+T)', onclick: () => newTab() }));
  }

  function updateChrome() {
    const tab = active;
    if (!tab) return;
    if (document.activeElement !== address) address.value = tab.url === HOME ? '' : tab.url.startsWith('file:') ? toWinPath(tab.url.slice(5)) : tab.url;
    back.disabled = tab.index <= 0;
    fwd.disabled = tab.index >= tab.history.length - 1;
    reload.textContent = tab.loading ? '✕' : '⟳';
    reload.title = tab.loading ? 'Arrêter' : 'Actualiser (F5)';
    const isWeb = /^https?:/.test(tab.url);
    lock.textContent = tab.url.startsWith('https:') ? '🔒' : isWeb ? 'ⓘ' : tab.url.startsWith('file:') ? '📄' : '🔍';
    lock.title = tab.url.startsWith('https:') ? 'Connexion sécurisée (via le serveur WinWeb)' : '';
    const marked = store.bookmarks.some((b) => b.url === tab.url);
    star.textContent = marked ? '★' : '☆';
    star.classList.toggle('on', marked);
    modeBtn.hidden = !isWeb;
    modeBtn.textContent = tab.direct ? '⚡ Direct' : '🛡️ Protégé';
    modeBtn.title = tab.direct
      ? 'Mode direct : le site est chargé tel quel (souvent refusé par les sites). Cliquez pour repasser par le serveur.'
      : 'Mode protégé : page récupérée par le serveur WinWeb et isolée (bac à sable). Cliquez pour le mode direct.';
    win.setTitle(`${tab.title || 'Nouvel onglet'} - Navigateur`);
    renderBookmarkBar();
  }

  // ---------------------------------------------------------------- navigation
  function navigate(tab, input, { push = true } = {}) {
    const { kind, target } = resolveInput(input);
    const url = kind === 'file' ? `file:${target}` : target;
    if (push) {
      tab.history = tab.history.slice(0, tab.index + 1);
      tab.history.push(url);
      tab.index = tab.history.length - 1;
    }
    tab.url = url;
    if (kind === 'about') showInternal(tab, target);
    else if (kind === 'file') showFile(tab, target);
    else showWeb(tab, target);
    if (tab === active) updateChrome();
    renderTabs();
  }

  function frameFor(tab, src, sandbox) {
    tab.view.replaceChildren();
    const frame = h('iframe', {
      class: 'br-frame', sandbox, referrerpolicy: 'no-referrer', allow: '', title: 'Contenu web',
    });
    frame.addEventListener('load', () => {
      tab.loading = false;
      renderTabs();
      if (tab === active) updateChrome();
    });
    tab.frame = frame;
    tab.view.append(frame);
    applyZoom(tab);
    tab.loading = true;
    frame.src = src;
    return frame;
  }

  async function showWeb(tab, url) {
    tab.title = hostOf(url);
    if (!tab.direct && !(await checkProxy())) {
      tab.direct = true;
      toast('Navigateur', 'Le mandataire web est désactivé sur le serveur : passage en mode direct.', { icon: '⚡' });
    }
    if (tab.direct) {
      // Origine externe : allow-same-origin est sans risque pour WinWeb (autre origine).
      frameFor(tab, url, 'allow-scripts allow-forms allow-same-origin allow-popups');
    } else {
      frameFor(tab, `/web?url=${encodeURIComponent(url)}`, 'allow-scripts allow-forms');
    }
    addHistory(url, tab.title);
  }

  function showFile(tab, vpath) {
    tab.title = basename(vpath) || 'Ce PC';
    frameFor(tab, rawUrl(vpath), 'allow-scripts');
  }

  function addHistory(url, title) {
    const last = store.history[0];
    if (last && last.url === url) { last.time = Date.now(); persist(); return; }
    store.history.unshift({ url, title, time: Date.now() });
    store.history = store.history.slice(0, 300);
    persist();
  }
  function updateHistoryTitle(url, title) {
    const item = store.history.find((x) => x.url === url);
    if (item && title) { item.title = title; persist(); }
  }

  function go(delta) {
    const tab = active;
    const i = tab.index + delta;
    if (i < 0 || i >= tab.history.length) return;
    tab.index = i;
    navigate(tab, tab.history[i], { push: false });
  }

  function reloadTab(tab = active) {
    if (tab.loading && tab.frame) {
      tab.frame.src = 'about:blank';
      tab.loading = false;
      updateChrome();
      renderTabs();
      return;
    }
    navigate(tab, tab.url.startsWith('file:') ? tab.url.slice(5) : tab.url, { push: false });
  }

  function applyZoom(tab) {
    if (!tab.frame) return;
    const z = tab.zoom;
    Object.assign(tab.frame.style, {
      width: `${100 / z}%`, height: `${100 / z}%`, transform: z === 1 ? '' : `scale(${z})`, transformOrigin: '0 0',
    });
  }
  function zoom(delta) {
    const tab = active;
    tab.zoom = delta === 0 ? 1 : Math.max(0.3, Math.min(3, Math.round((tab.zoom + delta) * 10) / 10));
    applyZoom(tab);
    toast('Zoom', `${Math.round(tab.zoom * 100)} %`, { icon: '🔎', timeout: 900 });
  }

  // Messages des pages servies par le mandataire (liens, formulaires, titre).
  function onMessage(e) {
    const tab = tabs.find((t) => t.frame && e.source === t.frame.contentWindow);
    if (!tab || tab.direct || !e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'winweb:navigate' && typeof e.data.url === 'string' && /^https?:\/\//i.test(e.data.url)) {
      navigate(tab, e.data.url.slice(0, 4096));
    } else if (e.data.type === 'winweb:title') {
      if (typeof e.data.title === 'string' && e.data.title.trim()) tab.title = e.data.title.trim().slice(0, 120);
      if (typeof e.data.url === 'string' && /^https?:\/\//i.test(e.data.url) && e.data.url !== tab.url && tab.url.startsWith('http')) {
        // Adresse finale après redirections.
        tab.url = e.data.url.slice(0, 4096);
        tab.history[tab.index] = tab.url;
      }
      updateHistoryTitle(tab.url, tab.title);
      renderTabs();
      if (tab === active) updateChrome();
    }
  }
  window.addEventListener('message', onMessage);

  // ---------------------------------------------------------------- pages internes
  function showInternal(tab, page) {
    tab.frame = null;
    tab.loading = false;
    let content;
    if (page === 'about:historique' || page === 'about:history') {
      tab.title = 'Historique';
      content = historyPage();
    } else if (page === 'about:favoris' || page === 'about:bookmarks') {
      tab.title = 'Favoris';
      content = bookmarksPage();
    } else {
      tab.title = 'Nouvel onglet';
      tab.url = HOME;
      content = homePage(tab);
    }
    tab.view.replaceChildren(h('div', { class: 'br-internal' }, content));
  }

  function homePage(tab) {
    const input = h('input', { class: 'br-home-search', placeholder: `Rechercher avec ${ENGINES[store.engine].name} ou saisir une adresse`, spellcheck: 'false' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) navigate(tab, input.value); });
    setTimeout(() => { if (tab === active) input.focus(); }, 50);
    return h('div', { class: 'br-home' },
      h('div', { class: 'br-home-logo', text: '🌐' }),
      h('h1', { text: 'Navigateur WinWeb' }),
      input,
      h('div', { class: 'br-tiles' }, store.bookmarks.slice(0, 12).map((b) => h('button', {
        class: 'br-tile', type: 'button', title: b.url, onclick: () => navigate(tab, b.url),
      }, h('span', { class: 'br-tile-ico', text: (b.title || hostOf(b.url))[0].toUpperCase() }), h('span', { class: 'br-tile-name', text: b.title || hostOf(b.url) })))),
      h('p', { class: 'br-home-note', text: 'Les pages sont récupérées par le serveur WinWeb et affichées dans un bac à sable. Les sites très dynamiques (connexion, applications web) peuvent mal s\'afficher : essayez alors le mode Direct ou ouvrez-les dans le navigateur de l\'ordinateur.' }),
      h('div', { class: 'br-home-links' },
        h('button', { class: 'btn flat', type: 'button', text: '🕘 Historique', onclick: () => navigate(tab, 'about:historique') }),
        h('button', { class: 'btn flat', type: 'button', text: '⭐ Favoris', onclick: () => navigate(tab, 'about:favoris') }),
        h('button', { class: 'btn flat', type: 'button', text: '📄 Fichiers locaux (C:\\)', onclick: () => navigate(tab, 'C:\\Documents') })));
  }

  function historyPage() {
    const list = h('div', { class: 'br-list' });
    const fill = () => {
      list.replaceChildren(...(store.history.length ? store.history.map((item) => h('div', { class: 'br-list-row' },
        h('span', { class: 'br-list-time', text: new Date(item.time).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) }),
        h('a', { class: 'br-list-title', href: '#', text: item.title || item.url, title: item.url, onclick: (e) => { e.preventDefault(); navigate(active, item.url); } }),
        h('span', { class: 'br-list-url', text: hostOf(item.url) }))) : [h('p', { text: 'Historique vide.' })]));
    };
    fill();
    return h('div', { class: 'br-page' }, h('h1', { text: '🕘 Historique' }),
      h('button', { class: 'btn', type: 'button', text: 'Effacer l\'historique', onclick: () => { store.history = []; persist(); fill(); } }), list);
  }

  function bookmarksPage() {
    const list = h('div', { class: 'br-list' });
    const fill = () => {
      list.replaceChildren(...(store.bookmarks.length ? store.bookmarks.map((b, i) => h('div', { class: 'br-list-row' },
        h('a', { class: 'br-list-title', href: '#', text: b.title || b.url, title: b.url, onclick: (e) => { e.preventDefault(); navigate(active, b.url); } }),
        h('span', { class: 'br-list-url', text: b.url }),
        h('button', { class: 'btn flat', type: 'button', text: '✏️', title: 'Renommer', onclick: async () => {
          const t = await promptDialog('Nom du favori :', b.title, { title: 'Favori', icon: '⭐' });
          if (t !== null) { b.title = t.trim() || b.title; persist(); fill(); renderBookmarkBar(); }
        } }),
        h('button', { class: 'btn flat', type: 'button', text: '🗑️', title: 'Supprimer', onclick: () => { store.bookmarks.splice(i, 1); persist(); fill(); renderBookmarkBar(); } }))) : [h('p', { text: 'Aucun favori.' })]));
    };
    fill();
    return h('div', { class: 'br-page' }, h('h1', { text: '⭐ Favoris' }), list);
  }

  function renderBookmarkBar() {
    bookmarkBar.classList.toggle('hidden', !store.showBar);
    bookmarkBar.replaceChildren(...store.bookmarks.map((b) => h('button', {
      class: 'br-bm', type: 'button', title: b.url, text: b.title || hostOf(b.url),
      onclick: (e) => (e.ctrlKey ? newTab(b.url) : navigate(active, b.url)),
      onauxclick: (e) => { if (e.button === 1) newTab(b.url, { activate: false }); },
    })));
  }

  function toggleBookmark() {
    const tab = active;
    if (!tab || tab.url === HOME) return;
    const idx = store.bookmarks.findIndex((b) => b.url === tab.url);
    if (idx >= 0) store.bookmarks.splice(idx, 1);
    else store.bookmarks.push({ title: tab.title || hostOf(tab.url), url: tab.url });
    persist();
    updateChrome();
  }

  async function downloadPage() {
    const tab = active;
    if (!/^https?:/.test(tab.url)) return;
    const t = toast('Téléchargement', tab.url, { icon: '⬇️', timeout: 0 });
    try {
      const data = await api.webDownload(tab.url);
      fsChanged(['/Téléchargements']);
      t.update(`Enregistré dans ${toWinPath(data.paths[0])}`);
      t.later(4000);
    } catch (err) {
      t.close();
      toastError(err.message, 'Téléchargement impossible');
    }
  }

  // ---------------------------------------------------------------- événements
  address.addEventListener('focus', () => setTimeout(() => address.select(), 0));
  address.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.altKey) newTab(address.value);
      else navigate(active, address.value);
      address.blur();
    } else if (e.key === 'Escape') {
      address.blur();
      updateChrome();
    }
  });
  back.addEventListener('click', () => go(-1));
  fwd.addEventListener('click', () => go(1));
  reload.addEventListener('click', () => reloadTab());
  home.addEventListener('click', () => navigate(active, HOME));
  star.addEventListener('click', toggleBookmark);
  modeBtn.addEventListener('click', () => {
    active.direct = !active.direct;
    store.direct = active.direct;
    persist();
    reloadTab();
  });
  menuBtn.addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const tab = active;
    const isWeb = /^https?:/.test(tab.url);
    showMenu(r.right - 280, r.bottom + 2, [
      { label: 'Nouvel onglet', hint: 'Ctrl+T', icon: '➕', action: () => newTab() },
      { label: 'Nouvelle fenêtre', icon: '🪟', action: () => launch() },
      { separator: true },
      { label: 'Historique', hint: 'Ctrl+H', icon: '🕘', action: () => navigate(tab, 'about:historique') },
      { label: 'Favoris', icon: '⭐', action: () => navigate(tab, 'about:favoris') },
      { label: 'Barre des favoris', icon: store.showBar ? '✔' : '', action: () => { store.showBar = !store.showBar; persist(); renderBookmarkBar(); } },
      { separator: true },
      { label: 'Zoom avant', hint: 'Ctrl++', action: () => zoom(0.1) },
      { label: 'Zoom arrière', hint: 'Ctrl+-', action: () => zoom(-0.1) },
      { label: `Réinitialiser le zoom (${Math.round(tab.zoom * 100)} %)`, hint: 'Ctrl+0', action: () => zoom(0) },
      { separator: true },
      { label: 'Enregistrer la page dans Téléchargements', icon: '⬇️', disabled: !isWeb, action: downloadPage },
      { label: 'Ouvrir dans le navigateur de l\'ordinateur', icon: '↗️', disabled: !isWeb, action: () => window.open(tab.url, '_blank', 'noopener,noreferrer') },
      { label: 'Copier l\'adresse', icon: '📋', disabled: tab.url === HOME, action: () => navigator.clipboard?.writeText(tab.url) },
      { separator: true },
      {
        label: 'Moteur de recherche', icon: '🔍',
        submenu: Object.entries(ENGINES).map(([id, eng]) => ({
          label: eng.name, icon: store.engine === id ? '✔' : '', action: () => { store.engine = id; persist(); },
        })),
      },
      { label: 'Effacer les données de navigation', icon: '🧹', action: () => { store.history = []; persist(); toast('Navigateur', 'Historique effacé', { icon: '🧹' }); } },
    ]);
  });

  win.body.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 't') { e.preventDefault(); newTab(); setTimeout(() => address.focus(), 30); }
    else if (ctrl && k === 'w') { e.preventDefault(); closeTab(active); }
    else if (ctrl && k === 'l') { e.preventDefault(); address.focus(); }
    else if (ctrl && k === 'd') { e.preventDefault(); toggleBookmark(); }
    else if (ctrl && k === 'h') { e.preventDefault(); navigate(active, 'about:historique'); }
    else if (ctrl && e.key === 'Tab') { e.preventDefault(); const i = tabs.indexOf(active); activate(tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]); }
    else if (ctrl && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoom(0.1); }
    else if (ctrl && e.key === '-') { e.preventDefault(); zoom(-0.1); }
    else if (ctrl && e.key === '0') { e.preventDefault(); zoom(0); }
    else if (e.key === 'F5' || (ctrl && k === 'r')) { e.preventDefault(); reloadTab(); }
    else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  });

  win.onDestroy = () => window.removeEventListener('message', onMessage);

  const toolbar = h('div', { class: 'br-toolbar' }, back, fwd, reload, home,
    h('div', { class: 'br-omnibox' }, lock, address, modeBtn, star), menuBtn);
  win.body.append(h('div', { class: 'browser' }, tabBar, toolbar, bookmarkBar, views));

  checkProxy();
  newTab(url || (path ? path : HOME));
  return win;
}

export default {
  id: 'browser', name: 'Navigateur web', icon: '🌐', launch, description: 'Naviguer sur Internet (onglets, favoris, historique)',
};
