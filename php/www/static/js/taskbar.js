// Barre des tâches : Démarrer, recherche, applications épinglées/ouvertes,
// zone de notification avec heure et date, bouton « Afficher le Bureau ».
import { on } from './bus.js';
import { showMenu } from './contextMenu.js';
import { appIcon, LOGO_SVG } from './icons.js';
import { getApp, launchApp, PINNED } from './registry.js';
import { getSettings } from './settings.js';
import { openStartMenu, toggleStartMenu } from './startMenu.js';
import { h } from './utils.js';
import {
  activeWindow, focusWindow, getWindows, showDesktop, toggleFromTaskbar,
} from './windowManager.js';

let appsZone;
let clockTime;
let clockDate;
let popup = null;

const groupKey = (win) => win.groupKey || win.appId;

function closePopup() {
  popup?.remove();
  popup = null;
}

function showWindowList(button, wins) {
  closePopup();
  popup = h('div', { class: 'tb-popup' }, wins.map((w) => h('button', {
    class: `tb-popup-item${activeWindow() === w ? ' active' : ''}`, type: 'button',
    onclick: () => { closePopup(); focusWindow(w); },
  }, h('span', { class: 'tb-popup-icon', html: appIcon(w.icon) }), h('span', { text: w.title }),
  h('span', {
    class: 'tb-popup-close', text: '✕', title: 'Fermer',
    onclick: (e) => { e.stopPropagation(); closePopup(); w.close(); },
  }))));
  document.getElementById('desktop-root').append(popup);
  const r = button.getBoundingClientRect();
  const pr = popup.getBoundingClientRect();
  popup.style.left = `${Math.max(6, Math.min(r.left + r.width / 2 - pr.width / 2, window.innerWidth - pr.width - 6))}px`;
}

function render() {
  if (!appsZone) return;
  const wins = getWindows();
  const groups = new Map();
  for (const id of PINNED) groups.set(id, { appId: id, pinned: true, wins: [] });
  for (const w of wins) {
    const key = groupKey(w);
    if (!groups.has(key)) groups.set(key, { appId: w.appId, pinned: false, wins: [] });
    groups.get(key).wins.push(w);
  }
  const active = activeWindow();
  appsZone.replaceChildren();
  for (const [key, group] of groups) {
    const app = getApp(group.appId);
    const first = group.wins[0];
    if (!app && !first) continue;
    const icon = first && !group.pinned ? first.icon : (app?.icon || first?.icon);
    const label = group.wins.length === 1 ? first.title : (app?.name || first?.title || key);
    const isActive = group.wins.includes(active) && !active.minimized;
    const button = h('button', {
      class: `tb-btn tb-app${group.wins.length ? ' running' : ''}${isActive ? ' active' : ''}`,
      type: 'button', title: label, dataset: { key },
    }, h('span', { class: 'tb-ico', html: appIcon(icon) }),
    h('span', { class: 'tb-label', text: label }),
    group.wins.length > 1 ? h('span', { class: 'tb-count', text: String(group.wins.length) }) : null,
    h('i', { class: 'tb-indicator' }));
    button.addEventListener('click', () => {
      if (!group.wins.length) launchApp(group.appId);
      else if (group.wins.length === 1) toggleFromTaskbar(first);
      else showWindowList(button, group.wins);
    });
    button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const items = [];
      if (app && !app.hidden) items.push({ label: app.name, icon: appIcon(app.icon), action: () => launchApp(app.id) });
      if (group.wins.length) {
        items.push({ separator: true });
        items.push({
          label: group.wins.length > 1 ? 'Fermer toutes les fenêtres' : 'Fermer la fenêtre',
          icon: '✕', action: () => group.wins.forEach((w) => w.close()),
        });
      }
      if (items.length) {
        const r = button.getBoundingClientRect();
        showMenu(r.left, r.top - 8 - items.length * 34, items);
      }
    });
    appsZone.append(button);
  }
}

// ------------------------------------------------------------------ calendrier
let calMonth = null;
function renderCalendar() {
  const flyout = document.getElementById('calendar-flyout');
  const now = new Date();
  if (!calMonth) calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const startDay = (new Date(year, month, 1).getDay() + 6) % 7; // lundi = 0
  const days = new Date(year, month + 1, 0).getDate();
  const grid = h('div', { class: 'cal-grid' },
    ['lu', 'ma', 'me', 'je', 've', 'sa', 'di'].map((d) => h('span', { class: 'cal-head', text: d })));
  for (let i = 0; i < startDay; i += 1) grid.append(h('span'));
  for (let d = 1; d <= days; d += 1) {
    const today = d === now.getDate() && month === now.getMonth() && year === now.getFullYear();
    grid.append(h('span', { class: `cal-day${today ? ' today' : ''}`, text: String(d) }));
  }
  const title = calMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  flyout.replaceChildren(
    h('div', { class: 'cal-now' },
      h('div', { class: 'cal-time', text: now.toLocaleTimeString('fr-FR') }),
      h('div', { class: 'cal-date', text: now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) })),
    h('div', { class: 'cal-nav' },
      h('span', { class: 'cal-title', text: title }),
      h('button', { class: 'btn icon', type: 'button', text: '▲', title: 'Mois précédent', onclick: () => { calMonth = new Date(year, month - 1, 1); renderCalendar(); } }),
      h('button', { class: 'btn icon', type: 'button', text: '▼', title: 'Mois suivant', onclick: () => { calMonth = new Date(year, month + 1, 1); renderCalendar(); } })),
    grid,
  );
}

export function closeCalendar() {
  document.getElementById('calendar-flyout').classList.add('hidden');
}

function toggleCalendar() {
  const flyout = document.getElementById('calendar-flyout');
  if (flyout.classList.contains('hidden')) {
    calMonth = null;
    renderCalendar();
    flyout.classList.remove('hidden');
  } else {
    flyout.classList.add('hidden');
  }
}

function tickClock() {
  const now = new Date();
  clockTime.textContent = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  clockDate.textContent = now.toLocaleDateString('fr-FR');
  const flyout = document.getElementById('calendar-flyout');
  if (!flyout.classList.contains('hidden')) {
    const t = flyout.querySelector('.cal-time');
    if (t) t.textContent = now.toLocaleTimeString('fr-FR');
  }
}

function searchLabel() {
  return getSettings().style === 'win10' ? 'Taper ici pour rechercher' : 'Rechercher';
}

export function initTaskbar() {
  const bar = document.getElementById('taskbar');
  const startBtn = h('button', { class: 'tb-btn tb-start', type: 'button', title: 'Démarrer', html: LOGO_SVG });
  const searchText = h('span', { class: 'tb-search-text', text: searchLabel() });
  const searchBtn = h('button', { class: 'tb-btn tb-search', type: 'button', title: 'Rechercher' },
    h('span', { class: 'tb-search-ico', text: '🔍' }), searchText);
  appsZone = h('div', { class: 'tb-apps' });
  clockTime = h('span', { class: 'tb-time' });
  clockDate = h('span', { class: 'tb-date' });
  const clock = h('button', { class: 'tb-btn tb-clock', type: 'button', title: 'Date et heure' }, clockTime, clockDate);
  const tray = h('div', { class: 'tb-tray' },
    h('button', { class: 'tb-btn tb-tray-icons', type: 'button', title: 'Réseau : connecté · Volume : 70 %' },
      h('span', { text: '📶' }), h('span', { text: '🔊' }), h('span', { text: '🔋' })),
    clock,
    h('button', { class: 'tb-show-desktop', type: 'button', title: 'Afficher le Bureau', onclick: () => showDesktop() }));

  bar.replaceChildren(h('div', { class: 'tb-main' }, startBtn, searchBtn, appsZone), tray);

  startBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeCalendar();
    toggleStartMenu();
  });
  searchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeCalendar();
    openStartMenu({ focusSearch: true });
  });
  clock.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCalendar();
  });
  bar.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.tb-app')) return;
    e.preventDefault();
    showMenu(e.clientX, e.clientY - 120, [
      { label: 'Gestionnaire des tâches', icon: '📊', action: () => launchApp('taskmgr') },
      { label: 'Paramètres de la barre des tâches', icon: '⚙️', action: () => launchApp('settings', { page: 'perso' }) },
      { separator: true },
      { label: 'Afficher le Bureau', icon: '🖥️', action: () => showDesktop() },
    ]);
  });
  document.addEventListener('pointerdown', (e) => {
    if (popup && !popup.contains(e.target)) closePopup();
    const flyout = document.getElementById('calendar-flyout');
    if (!flyout.contains(e.target) && !e.target.closest('.tb-clock')) closeCalendar();
  });
  on('windows-changed', render);
  on('settings-changed', () => { searchText.textContent = searchLabel(); });
  on('apps-changed', render);
  tickClock();
  setInterval(tickClock, 1000);
  render();
}
