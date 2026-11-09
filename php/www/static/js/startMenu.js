// Menu Démarrer : épinglés, toutes les applications, recherche, alimentation.
import { api } from './api.js';
import { on } from './bus.js';
import { appIcon, iconForEntry } from './icons.js';
import { getApps, launchApp, openPath, PINNED, getApp } from './registry.js';
import { getSettings } from './settings.js';
import { debounce, h, toWinPath } from './utils.js';

const RUNNABLE = new Set(['wapp', 'html', 'htm', 'js']);
let menu;
let searchInput;
let pinnedGrid;
let allList;
let resultsList;
let userName;
let handlers = {};
let searchToken = 0;

export function isStartOpen() {
  return menu && !menu.classList.contains('hidden');
}

export function closeStartMenu() {
  if (!menu || menu.classList.contains('hidden')) return;
  menu.classList.add('hidden');
  menu.classList.remove('show-all', 'searching');
  document.querySelector('.tb-start')?.classList.remove('open');
}

export function openStartMenu({ focusSearch = false } = {}) {
  if (!menu) return;
  searchInput.value = '';
  menu.classList.remove('searching', 'show-all');
  userName.textContent = getSettings().userName;
  renderPinned();
  renderAll();
  menu.classList.remove('hidden');
  document.querySelector('.tb-start')?.classList.add('open');
  setTimeout(() => (focusSearch ? searchInput.focus() : searchInput.focus({ preventScroll: true })), 20);
}

export function toggleStartMenu() {
  if (isStartOpen()) closeStartMenu();
  else openStartMenu();
}

function appTile(app) {
  return h('button', {
    class: 'sm-tile', type: 'button', title: app.description || app.name,
    onclick: () => { closeStartMenu(); launchApp(app.id); },
  }, h('span', { class: 'sm-tile-ico', html: appIcon(app.icon) }), h('span', { class: 'sm-tile-name', text: app.name }));
}

function listRow(icon, name, sub, action) {
  return h('button', { class: 'sm-row', type: 'button', onclick: () => { closeStartMenu(); action(); } },
    h('span', { class: 'sm-row-ico', html: icon }),
    h('span', { class: 'sm-row-text' }, h('span', { class: 'sm-row-name', text: name }),
      sub ? h('span', { class: 'sm-row-sub', text: sub }) : null));
}

function renderPinned() {
  pinnedGrid.replaceChildren(...PINNED.map(getApp).filter(Boolean).map(appTile));
}

async function renderAll() {
  const apps = getApps();
  const rows = [];
  let letter = '';
  for (const app of apps) {
    const first = app.name[0].toUpperCase();
    if (first !== letter) {
      letter = first;
      rows.push(h('div', { class: 'sm-letter', text: letter }));
    }
    rows.push(listRow(appIcon(app.icon), app.name, '', () => launchApp(app.id)));
  }
  allList.replaceChildren(...rows);
  try {
    const programs = (await api.list('/Programmes')).filter((e) => e.type === 'file' && RUNNABLE.has(e.ext));
    if (programs.length) {
      allList.append(h('div', { class: 'sm-letter', text: 'Programmes installés' }));
      for (const entry of programs) {
        allList.append(listRow(iconForEntry(entry), entry.name.replace(/\.[^.]+$/, ''), entry.ext.toUpperCase(),
          () => openPath(entry.path, entry)));
      }
    }
  } catch { /* dossier Programmes indisponible */ }
}

const runSearch = debounce(async (text) => {
  const token = ++searchToken;
  const query = text.trim().toLowerCase();
  if (!query) {
    menu.classList.remove('searching');
    return;
  }
  menu.classList.add('searching');
  const apps = getApps().filter((a) => a.name.toLowerCase().includes(query) || a.id.includes(query));
  const rows = [h('div', { class: 'sm-letter', text: 'Applications' })];
  if (!apps.length) rows.push(h('div', { class: 'sm-empty', text: 'Aucune application' }));
  apps.forEach((app) => rows.push(listRow(appIcon(app.icon), app.name, 'Application', () => launchApp(app.id))));
  resultsList.replaceChildren(...rows);
  let files = [];
  try {
    files = await api.search(query);
  } catch { files = []; }
  if (token !== searchToken) return;
  resultsList.append(h('div', { class: 'sm-letter', text: 'Fichiers et dossiers' }));
  if (!files.length) resultsList.append(h('div', { class: 'sm-empty', text: 'Aucun fichier trouvé' }));
  files.slice(0, 12).forEach((entry) => resultsList.append(
    listRow(iconForEntry(entry), entry.name, toWinPath(entry.path), () => openPath(entry.path, entry)),
  ));
}, 150);

/** handlers : { lock(), restart(), shutdown() } */
export function initStartMenu(powerHandlers) {
  handlers = powerHandlers;
  menu = document.getElementById('start-menu');
  searchInput = h('input', {
    class: 'sm-search-input', type: 'search', placeholder: 'Rechercher des applications, des paramètres et des documents',
    'aria-label': 'Rechercher',
  });
  pinnedGrid = h('div', { class: 'sm-grid' });
  allList = h('div', { class: 'sm-list' });
  resultsList = h('div', { class: 'sm-list' });
  userName = h('span', { class: 'sm-user-name' });

  const power = (icon, label, action) => h('button', {
    class: 'sm-power', type: 'button', title: label, onclick: () => { closeStartMenu(); action(); },
  }, h('span', { text: icon }), h('span', { class: 'sm-power-label', text: label }));

  menu.replaceChildren(
    h('div', { class: 'sm-search' }, h('span', { class: 'sm-search-ico', text: '🔍' }), searchInput),
    h('div', { class: 'sm-body' },
      h('section', { class: 'sm-section sm-pinned' },
        h('div', { class: 'sm-header' }, h('h3', { text: 'Épinglé' }),
          h('button', { class: 'sm-chip', type: 'button', text: 'Toutes les applications ›', onclick: () => menu.classList.add('show-all') })),
        pinnedGrid),
      h('section', { class: 'sm-section sm-all' },
        h('div', { class: 'sm-header' }, h('h3', { text: 'Toutes les applications' }),
          h('button', { class: 'sm-chip', type: 'button', text: '‹ Retour', onclick: () => menu.classList.remove('show-all') })),
        allList),
      h('section', { class: 'sm-section sm-results' }, h('div', { class: 'sm-header' }, h('h3', { text: 'Meilleurs résultats' })), resultsList)),
    h('div', { class: 'sm-footer' },
      h('button', {
        class: 'sm-user', type: 'button', title: 'Paramètres du compte',
        onclick: () => { closeStartMenu(); launchApp('settings', { page: 'system' }); },
      }, h('span', { class: 'sm-avatar', text: '👤' }), userName),
      h('div', { class: 'sm-power-group' },
        power('🔒', 'Verrouiller', () => handlers.lock()),
        power('🔄', 'Redémarrer', () => handlers.restart()),
        power('⏻', 'Arrêter', () => handlers.shutdown()))),
  );

  searchInput.addEventListener('input', () => runSearch(searchInput.value));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = menu.querySelector(menu.classList.contains('searching') ? '.sm-results .sm-row' : '.sm-tile');
      first?.click();
    } else if (e.key === 'Escape') {
      closeStartMenu();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (isStartOpen() && !menu.contains(e.target) && !e.target.closest('.tb-start, .tb-search')) closeStartMenu();
  });
  // Touche « Méta » (Windows) pressée seule : ouvre/ferme le menu, si le navigateur la transmet.
  let metaAlone = false;
  document.addEventListener('keydown', (e) => {
    metaAlone = e.key === 'Meta' && !e.repeat;
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Meta' && metaAlone && document.body.classList.contains('session')) toggleStartMenu();
    metaAlone = false;
  });
  on('windows-changed', () => { if (isStartOpen()) closeStartMenu(); });
}
