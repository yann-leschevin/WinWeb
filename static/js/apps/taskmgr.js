// Gestionnaire des tâches : liste des fenêtres ouvertes, fin de tâche.
import { on } from '../bus.js';
import { appIcon } from '../icons.js';
import { getApp } from '../registry.js';
import { h } from '../utils.js';
import { activeWindow, createWindow, focusWindow, getWindows } from '../windowManager.js';

const bootTime = Date.now();

/** Estimation indicative (le navigateur n'expose pas la mémoire par fenêtre). */
function pseudoMemory(win) {
  const nodes = win.el.getElementsByTagName('*').length;
  const iframes = win.el.getElementsByTagName('iframe').length;
  return (nodes * 0.6 + iframes * 18000 + 2400) / 1024;
}

function uptime() {
  const s = Math.floor((Date.now() - bootTime) / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

function launch() {
  let selectedId = null;
  const tbody = h('tbody');
  const endBtn = h('button', { class: 'btn', type: 'button', text: 'Fin de tâche', disabled: true });
  const switchBtn = h('button', { class: 'btn', type: 'button', text: 'Basculer vers', disabled: true });
  const stats = h('div', { class: 'tm-stats' });
  const root = h('div', { class: 'taskmgr' },
    h('div', { class: 'tm-tabs' }, h('span', { class: 'tm-tab active', text: 'Processus' })),
    h('div', { class: 'tm-table-wrap' }, h('table', { class: 'tm-table' },
      h('thead', {}, h('tr', {},
        h('th', { text: 'Nom' }), h('th', { text: 'Application' }), h('th', { text: 'Statut' }), h('th', { class: 'num', text: 'Mémoire' }))),
      tbody)),
    h('div', { class: 'tm-footer' }, stats, h('span', { class: 'iv-spacer' }), switchBtn, endBtn));

  const win = createWindow({
    appId: 'taskmgr', title: 'Gestionnaire des tâches', icon: '📊', width: 700, height: 460, minWidth: 420, minHeight: 280, content: root,
  });

  function render() {
    const wins = getWindows();
    const active = activeWindow();
    if (selectedId && !wins.some((w) => w.id === selectedId)) selectedId = null;
    tbody.replaceChildren(...wins.map((w) => {
      const status = w.minimized ? 'Réduit' : w === active ? 'Actif' : 'En cours d\'exécution';
      const row = h('tr', { class: w.id === selectedId ? 'selected' : '' },
        h('td', {}, h('span', { class: 'tm-ico', html: appIcon(w.icon) }), h('span', { text: w.title })),
        h('td', { text: getApp(w.appId)?.name || w.appId }),
        h('td', { text: status }),
        h('td', { class: 'num', text: `${pseudoMemory(w).toFixed(1).replace('.', ',')} Mo` }));
      row.addEventListener('click', () => {
        selectedId = w.id;
        render();
      });
      row.addEventListener('dblclick', () => focusWindow(w));
      return row;
    }));
    endBtn.disabled = !selectedId || selectedId === win.id;
    switchBtn.disabled = !selectedId;
    const heap = performance.memory ? ` · Tas JS : ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} Mo` : '';
    stats.textContent = `${wins.length} fenêtre(s) · ${navigator.hardwareConcurrency || '?'} processeurs logiques · Activité : ${uptime()}${heap}`;
  }

  endBtn.addEventListener('click', () => {
    const target = getWindows().find((w) => w.id === selectedId);
    if (target && target !== win) target.close(true);
  });
  switchBtn.addEventListener('click', () => {
    const target = getWindows().find((w) => w.id === selectedId);
    if (target) focusWindow(target);
  });
  const off = on('windows-changed', render);
  const timer = setInterval(render, 2000);
  win.onDestroy = () => {
    off();
    clearInterval(timer);
  };
  render();
  return win;
}

export default { id: 'taskmgr', name: 'Gestionnaire des tâches', icon: '📊', launch, description: 'Processus et fenêtres ouvertes' };
